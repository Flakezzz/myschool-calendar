-- MySchool — money audit fixes.
--
-- Found by auditing the live database against Monobank on 2026-10-11.
-- Every item below was reproduced in a throwaway Postgres before being
-- written, and each STEP says what was broken.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- AFTER this file: redeploy the admin-write Edge Function and the website.
-- Order matters for STEP 1 — see the warning there.

-- ---------------------------------------------------------------- STEP 1
-- CRITICAL, and the only real "free club" found: `meeting_url` was readable
-- with the anon key, which ships inside the website's JavaScript by design.
-- Anyone could ask the API for every club's Google Meet link and join an
-- online class without paying for it:
--
--   GET /rest/v1/clubs?select=title,meeting_url   ->  all links, no login
--
-- RLS cannot restrict columns, so the table-level SELECT grant has to go
-- and come back as a list of columns that does not include the link.
--
-- WARNING: the public website currently does `select *` on clubs, which
-- would start failing. Deploy the updated website together with this.
revoke select on clubs from anon, authenticated;
grant select (
  id, title, description, date, start_time, end_time,
  teacher, level, seats, taken, price_uah, color, video_url
) on clubs to anon, authenticated;

-- The link now reaches people through the Edge Function, which checks that
-- the caller actually has a paid booking for that club.
create or replace function club_link_for_user(p_club_id text, p_user_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  select c.meeting_url into v_url
  from clubs c
  join registrations r on r.club_id = c.id and r.type = 'club'
  where c.id = p_club_id
    and r.telegram_user_id = p_user_id
    and r.payment_state = 'confirmed';
  return v_url;
end;
$$;

revoke all on function club_link_for_user(text, text) from public, anon, authenticated;
grant execute on function club_link_for_user(text, text) to service_role;

-- ---------------------------------------------------------------- STEP 2
-- CRITICAL: money taken, nothing sold.
--
-- Activation refused to create a pass if the same person had bought the
-- same plan within the last day. That guard was meant to make a repeated
-- webhook harmless, but it cannot tell a repeat from a genuine second
-- purchase. Use up a 4-visit pass and buy the same one again the same day
-- and the money went through, the purchase was marked confirmed, and no
-- pass appeared. Nobody was told, so it would never have been noticed.
--
-- The receipt row now remembers which pass it created, so a repeat webhook
-- is recognised exactly and a real second purchase is not mistaken for one.
alter table registrations add column if not exists activated_pass_id uuid;

alter table registrations drop constraint if exists registrations_activated_pass_id_fkey;
alter table registrations add constraint registrations_activated_pass_id_fkey
  foreign key (activated_pass_id) references user_subscriptions(id) on delete set null;

-- Backfill, so re-running this never duplicates an existing pass: link each
-- past purchase to the pass it most plausibly created.
update registrations r
set activated_pass_id = u.id
from user_subscriptions u
where r.type = 'subscription'
  and r.activated_pass_id is null
  and u.telegram_user_id = r.telegram_user_id
  and u.subscription_id = r.subscription_id
  and u.purchased_at between r.created_at - interval '1 hour' and r.created_at + interval '1 hour';

create or replace function activate_paid_subscription(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id text;
  v_user text;
  v_title text;
  v_count int;
  v_days int;
  v_already uuid;
  v_new uuid;
begin
  select r.subscription_id, r.telegram_user_id, r.activated_pass_id,
         s.title, s.sessions_count, s.days_valid
  into v_sub_id, v_user, v_already, v_title, v_count, v_days
  from registrations r
  join subscriptions s on s.id = r.subscription_id
  where r.id = p_registration_id and r.type = 'subscription'
  for update;
  if not found then
    return;
  end if;

  -- This exact purchase already produced a pass: a repeated webhook.
  if v_already is not null then
    return;
  end if;

  -- The days start now, when it was paid for, not when it was reserved.
  insert into user_subscriptions (telegram_user_id, subscription_id, title, sessions_total, expires_at)
  values (v_user, v_sub_id, v_title, v_count, now() + make_interval(days => coalesce(v_days, 30)))
  returning id into v_new;

  update registrations set activated_pass_id = v_new where id = p_registration_id;
end;
$$;

revoke all on function activate_paid_subscription(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- STEP 3
-- A purchase receipt now points at a pass, and the seat-release trigger
-- refunds a session whenever a deleted row has a pass attached. Without
-- this guard, deleting a *purchase* receipt would hand back a session that
-- was never spent. Sessions are only ever spent by club bookings.
create or replace function release_club_seat() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.type = 'club' and old.club_id is not null then
    -- No-op when the club row itself is being deleted (cascade), which is
    -- what we want: the counter goes away with it.
    update clubs set taken = greatest(taken - 1, 0) where id = old.club_id;
  end if;

  if old.type = 'club' and old.user_subscription_id is not null then
    update user_subscriptions
    set sessions_used = greatest(sessions_used - 1, 0)
    where id = old.user_subscription_id;
  end if;

  return old;
end;
$$;

revoke all on function release_club_seat() from public, anon, authenticated;

-- ---------------------------------------------------------------- STEP 4
-- Our books said money was ours after Monobank had given it back.
-- Proven on the live data: invoice 261008BUCTUg1Eey4Ktc was `reversed` at
-- Monobank with finalAmount 0, and `success` here.
--
-- A refund we started is recorded by cancel_booking stamping refunded_at,
-- but the `reversed` webhook that confirms it landed hit the "terminal
-- state never changes" branch and was dropped. So a refund that failed
-- afterwards, or one somebody made in the Monobank cabinet, was invisible.
--
-- `reversed` is now the one transition allowed out of success/hold. The
-- booking is deliberately NOT deleted: if the person still holds a seat,
-- that is an admin decision, not something a webhook should do silently.
create or replace function apply_payment_status(
  p_invoice_id text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg_id uuid;
  v_old text;
  v_seat_held boolean;
begin
  select registration_id, status into v_reg_id, v_old
  from payments where invoice_id = p_invoice_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- A payment that lands after we gave up on it is the dangerous case: the
  -- sweep has already written 'expired' and freed the seat, so treating the
  -- webhook as a duplicate would quietly keep the money. Refund instead.
  if v_old in ('expired', 'failure') and p_status in ('success', 'hold') then
    update payments set status = p_status, refunded_at = now(), updated_at = now()
    where invoice_id = p_invoice_id;
    perform notify_admins(
      '⚠️ Оплата без запису: ' || p_invoice_id || chr(10)
      || 'Гроші прийшли після того, як місце вже звільнили — повертаємо автоматично. Варто перевірити.'
    );
    return jsonb_build_object('invoice_id', p_invoice_id, 'status', p_status,
                              'repeat', false, 'orphan', true);
  end if;

  -- Monobank confirming that money went back. The only way out of success.
  if p_status = 'reversed' and v_old in ('success', 'hold') then
    select exists (
      select 1 from registrations where id = v_reg_id and payment_state = 'confirmed'
    ) into v_seat_held;
    update payments
    set status = 'reversed', refunded_at = coalesce(refunded_at, now()), updated_at = now()
    where invoice_id = p_invoice_id;
    if v_seat_held then
      perform notify_admins(
        '↩️ Гроші повернули, а запис лишився: ' || p_invoice_id || chr(10)
        || 'Хтось повернув оплату (кабінет моно або банк клієнта), але людина досі записана. '
        || 'Треба вирішити вручну: лишити як подарунок чи зняти запис.'
      );
    end if;
    return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'reversed',
                              'repeat', false, 'seat_still_held', v_seat_held);
  end if;

  -- Otherwise a terminal state never changes again.
  if v_old in ('success', 'failure', 'reversed', 'expired') then
    return jsonb_build_object('invoice_id', p_invoice_id, 'status', v_old, 'repeat', true);
  end if;

  update payments set status = p_status, updated_at = now() where invoice_id = p_invoice_id;

  if p_status in ('hold', 'success') then
    update registrations set payment_state = 'confirmed'
    where id = v_reg_id and payment_state = 'pending';

    -- A paid pass only comes into existence here.
    if found and exists (
      select 1 from registrations where id = v_reg_id and type = 'subscription'
    ) then
      perform activate_paid_subscription(v_reg_id);
    end if;

    -- Nothing was confirmed: the reservation is gone, released by the sweep
    -- or cancelled, while the money still arrived. Keeping it would be
    -- taking payment for a seat the person does not have, so the caller is
    -- told to refund and the admins are told a human should look.
    if not found then
      update payments set refunded_at = now(), updated_at = now()
      where invoice_id = p_invoice_id;
      perform notify_admins(
        '⚠️ Оплата без запису: ' || p_invoice_id || chr(10)
        || 'Гроші прийшли, але запису вже не було — повертаємо автоматично. Варто перевірити.'
      );
      return jsonb_build_object('invoice_id', p_invoice_id, 'status', p_status,
                                'repeat', false, 'orphan', true);
    end if;
  elsif p_status in ('failure', 'expired') then
    -- Deleting frees the seat through trg_release_club_seat.
    delete from registrations where id = v_reg_id and payment_state = 'pending';
  end if;

  return jsonb_build_object('invoice_id', p_invoice_id, 'status', p_status, 'repeat', false);
end;
$$;

revoke all on function apply_payment_status(text, text) from public, anon, authenticated;
grant execute on function apply_payment_status(text, text) to service_role;

-- ---------------------------------------------------------------- STEP 5
-- The sweep ran a single minute after the invoice's own 15-minute validity.
-- Monobank will not accept a payment after that, but its webhook can
-- easily take longer than a minute to arrive — and when it did, the seat
-- was already gone and a customer who paid on time got a refund instead of
-- a place. Twenty minutes gives the webhook five minutes of slack while
-- still being long before anyone needs the seat.
create or replace function release_stale_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select invoice_id, registration_id
    from payments
    where status in ('created', 'processing')
      and created_at < now() - interval '20 minutes'
  loop
    delete from registrations where id = r.registration_id and payment_state = 'pending';
    update payments set status = 'expired', updated_at = now() where invoice_id = r.invoice_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function release_stale_reservations() from public, anon, authenticated;

-- ---------------------------------------------------------------- STEP 6
-- CRITICAL: deleting a club was pure profit. `delete from clubs` cascaded
-- the bookings away — the seats vanished, the money stayed with the school
-- and nobody was told their class was off, not even by a notification.
--
-- Cancelling is now two steps, because the refunds happen between them:
-- prepare claims every refund that is owed (so a double click cannot pay
-- twice) and reports it, then finish tells the people and removes the club.
create or replace function prepare_club_cancellation(p_club_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_date date;
  v_refunds jsonb := '[]'::jsonb;
  r record;
begin
  select title, date into v_title, v_date from clubs where id = p_club_id for update;
  if not found then
    raise exception 'club_not_found';
  end if;

  for r in
    select p.invoice_id, p.amount_kop, p.telegram_user_id
    from payments p
    join registrations g on g.id = p.registration_id
    where g.club_id = p_club_id
      and g.type = 'club'
      and p.status in ('success', 'hold')
      and p.refunded_at is null
  loop
    -- Claimed up front: whatever happens next, this invoice is not going to
    -- be refunded twice.
    update payments set refunded_at = now(), updated_at = now()
    where invoice_id = r.invoice_id;
    v_refunds := v_refunds || jsonb_build_object(
      'invoice_id', r.invoice_id, 'amount_kop', r.amount_kop, 'user_id', r.telegram_user_id);
  end loop;

  return jsonb_build_object(
    'club_id', p_club_id,
    'title', v_title,
    'date', v_date,
    'refunds', v_refunds,
    'paid_people', (select count(*) from registrations
                    where club_id = p_club_id and type = 'club' and payment_state = 'confirmed'),
    'pending_people', (select count(*) from registrations
                       where club_id = p_club_id and type = 'club' and payment_state = 'pending')
  );
end;
$$;

revoke all on function prepare_club_cancellation(text) from public, anon, authenticated;
grant execute on function prepare_club_cancellation(text) to service_role;

create or replace function finish_club_cancellation(p_club_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_date date;
  v_start time;
  v_told int := 0;
  v_paid int := 0;
  v_sum int := 0;
  r record;
  msg text;
  wen text;
begin
  select title, date, start_time into v_title, v_date, v_start
  from clubs where id = p_club_id for update;
  if not found then
    raise exception 'club_not_found';
  end if;

  wen := to_char(v_date, 'DD.MM') || ' о ' || to_char(v_start, 'HH24:MI');

  for r in
    select telegram_user_id, paid_with, payment_state, price_paid_uah
    from registrations
    where club_id = p_club_id and type = 'club'
  loop
    if r.payment_state = 'pending' then
      msg := 'клаб «' || v_title || '» ' || wen || ' скасували 😔' || chr(10)
          || 'ти якраз був на оплаті — гроші не списались, робити нічого не треба.';
    elsif r.paid_with = 'card' then
      msg := 'клаб «' || v_title || '» ' || wen || ' скасували 😔' || chr(10)
          || 'гроші вже летять назад на карту, зазвичай 1–3 робочі дні.';
      v_paid := v_paid + 1;
      v_sum := v_sum + coalesce(r.price_paid_uah, 0);
    elsif r.paid_with = 'subscription' then
      msg := 'клаб «' || v_title || '» ' || wen || ' скасували 😔' || chr(10)
          || 'відвідування повернули на твій абон, воно ціле.';
    else
      msg := 'клаб «' || v_title || '» ' || wen || ' скасували 😔' || chr(10)
          || 'напиши нам — домовимось, що робити з оплатою.';
    end if;
    perform send_telegram_message(r.telegram_user_id, msg);
    v_told := v_told + 1;
  end loop;

  -- The cascade removes the bookings; trg_release_club_seat gives pass
  -- sessions back on the way out.
  delete from clubs where id = p_club_id;

  if v_told > 0 then
    perform notify_admins(
      '🗑 Клаб «' || v_title || '» ' || wen || ' скасовано.' || chr(10)
      || 'Попередили людей: ' || v_told || chr(10)
      || 'Повертаємо на карти: ' || v_paid || ' осіб, ' || v_sum || ' грн'
    );
  end if;

  return jsonb_build_object('told', v_told, 'card_refunds', v_paid, 'refund_uah', v_sum);
end;
$$;

revoke all on function finish_club_cancellation(text) from public, anon, authenticated;
grant execute on function finish_club_cancellation(text) to service_role;

-- ---------------------------------------------------------------- STEP 7
-- Nothing ever compared our records with Monobank's, so a payment whose
-- webhook never arrived stayed wrong forever. This lists the invoices worth
-- asking about; the Edge Function asks Monobank and feeds the answer back
-- through apply_payment_status.
create or replace function payments_to_reconcile(p_limit int default 50)
returns table (invoice_id text, our_status text)
language sql
security definer
set search_path = public
as $$
  select p.invoice_id, p.status
  from payments p
  where
    -- Should have settled by now but never did.
    (p.status in ('created', 'processing') and p.created_at < now() - interval '20 minutes')
    -- Or we believe the money is ours; worth confirming it still is.
    or (p.status in ('success', 'hold') and p.updated_at > now() - interval '30 days')
  order by p.updated_at desc
  limit p_limit;
$$;

revoke all on function payments_to_reconcile(int) from public, anon, authenticated;
grant execute on function payments_to_reconcile(int) to service_role;

-- A refund Monobank has actually completed, recorded without touching the
-- booking. Used by reconciliation when a `reversed` webhook never arrived.
create or replace function mark_refund_done(p_invoice_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update payments
  set status = 'reversed', refunded_at = coalesce(refunded_at, now()), updated_at = now()
  where invoice_id = p_invoice_id and status in ('success', 'hold');
end;
$$;

revoke all on function mark_refund_done(text) from public, anon, authenticated;
grant execute on function mark_refund_done(text) to service_role;

-- --------------------------------------------------------------- VERIFY
-- 1. The public key must not be able to see meeting links any more.
select string_agg(a.attname, ', ' order by a.attname) as columns_anon_can_read
from pg_attribute a
where a.attrelid = 'clubs'::regclass
  and a.attnum > 0 and not a.attisdropped
  and has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT');

-- 2. Every paid pass purchase should now point at the pass it created.
select count(*) as purchases_without_a_pass
from registrations
where type = 'subscription' and payment_state = 'confirmed' and activated_pass_id is null;
