-- MySchool — Monobank payments, stage 1: reserve a seat, hold the money,
-- confirm from the webhook, release what was never paid.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- WARNING: no database backup exists. Read each step before running it.

-- ---------------------------------------------------------------- STEP 1
-- A card booking exists before it is paid for, so a registration now has a
-- state. Everything booked so far was paid one way or another: 'confirmed'.
alter table registrations add column if not exists payment_state text not null default 'confirmed';

alter table registrations drop constraint if exists registrations_payment_state_check;
alter table registrations add constraint registrations_payment_state_check
  check (payment_state in ('pending', 'confirmed'));

alter table registrations drop constraint if exists registrations_paid_with_check;
alter table registrations add constraint registrations_paid_with_check
  check (paid_with in ('cash', 'subscription', 'card'));

-- ---------------------------------------------------------------- STEP 2
-- One row per Monobank invoice. invoiceId is the key, which is what makes
-- the webhook idempotent: it can arrive three times and change nothing.
create table if not exists payments (
  invoice_id text primary key,
  registration_id uuid references registrations(id) on delete set null,
  telegram_user_id text not null,
  club_id text references clubs(id) on delete set null,
  amount_kop int not null,
  status text not null default 'created',
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_open
  on payments (created_at) where status in ('created', 'processing');

-- Internal only: no policy, so the anon key cannot see who paid what.
alter table payments enable row level security;

-- ---------------------------------------------------------------- STEP 3
-- Admins should hear about a booking when it is real, not when someone
-- opened a payment page. Pending rows stay silent; the notification moves
-- to the moment the state flips.
create or replace function notify_admin_on_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
  admin_id text;
  item_title text;
  club_date date;
  club_start time;
  who text;
  how text;
  msg text;
begin
  if tg_op = 'INSERT' and new.payment_state = 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (old.payment_state = 'pending' and new.payment_state = 'confirmed') then
    return new;
  end if;

  select string_to_array(value, ',') into ids from app_config where key = 'admin_telegram_ids';
  if ids is null then
    return new;
  end if;

  who := coalesce(nullif(new.telegram_first_name, ''), 'ID ' || new.telegram_user_id);
  if new.telegram_username is not null and new.telegram_username <> '' then
    who := who || ' (@' || new.telegram_username || ')';
  end if;

  if new.paid_with = 'subscription' then
    how := 'абонемент';
  elsif new.paid_with = 'card' then
    how := coalesce(new.price_paid_uah::text, '?') || ' грн карткою';
  else
    how := coalesce(new.price_paid_uah::text, '?') || ' грн';
  end if;

  if new.type = 'club' then
    select title, date, start_time into item_title, club_date, club_start
    from clubs where id = new.club_id;
    msg := '🎉 Новий запис на клаб' || chr(10)
        || 'Клаб: ' || coalesce(item_title, new.club_id) || chr(10)
        || 'Коли: ' || coalesce(club_date::text, '?') || ' о ' || coalesce(to_char(club_start, 'HH24:MI'), '?') || chr(10)
        || 'Учасник: ' || who || chr(10)
        || 'Оплата: ' || how;
  else
    select title into item_title from subscriptions where id = new.subscription_id;
    msg := '🎉 Новий оплачений абонемент' || chr(10)
        || 'Абонемент: ' || coalesce(item_title, new.subscription_id) || chr(10)
        || 'Покупець: ' || who || chr(10)
        || 'Сума: ' || coalesce(new.price_paid_uah::text, '?') || ' грн';
  end if;

  foreach admin_id in array ids loop
    perform send_telegram_message(trim(admin_id), msg);
  end loop;

  return new;
end;
$$;

revoke all on function notify_admin_on_registration() from public, anon, authenticated;

drop trigger if exists trg_notify_admin on registrations;
create trigger trg_notify_admin
  after insert on registrations
  for each row execute function notify_admin_on_registration();

drop trigger if exists trg_notify_admin_confirmed on registrations;
create trigger trg_notify_admin_confirmed
  after update of payment_state on registrations
  for each row execute function notify_admin_on_registration();

-- ---------------------------------------------------------------- STEP 4
-- Booking in one atomic step, now aware of card payments: a usable pass is
-- still spent first and the booking is instantly real; otherwise the seat
-- is held as 'pending' and the caller is told to create an invoice.
create or replace function reserve_club(
  p_club_id text,
  p_user_id text,
  p_first_name text,
  p_username text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats int;
  v_taken int;
  v_price int;
  v_title text;
  v_sub_id uuid;
  v_sub_total int;
  v_sub_used int;
  v_used_sub boolean := false;
  v_reg_id uuid;
begin
  -- FOR UPDATE serialises concurrent bookings of the same club.
  select seats, taken, price_uah, title into v_seats, v_taken, v_price, v_title
  from clubs where id = p_club_id for update;
  if not found then
    raise exception 'club_not_found';
  end if;

  -- An unpaid reservation is not a booking, and saying "already booked"
  -- about one is misleading: the person is mid-payment, not done.
  if exists (
    select 1 from registrations
    where type = 'club' and club_id = p_club_id and telegram_user_id = p_user_id
      and payment_state = 'pending'
  ) then
    raise exception 'payment_pending';
  end if;

  if exists (
    select 1 from registrations
    where type = 'club' and club_id = p_club_id and telegram_user_id = p_user_id
  ) then
    raise exception 'already_booked';
  end if;

  if v_taken >= v_seats then
    raise exception 'club_full';
  end if;

  select id, sessions_total, sessions_used
  into v_sub_id, v_sub_total, v_sub_used
  from user_subscriptions
  where telegram_user_id = p_user_id
    and expires_at > now()
    and (sessions_total is null or sessions_used < sessions_total)
  order by (sessions_total is null), expires_at
  limit 1
  for update;

  if v_sub_id is not null then
    update user_subscriptions set sessions_used = sessions_used + 1 where id = v_sub_id;
    v_used_sub := true;
  end if;

  insert into registrations (
    type, club_id, telegram_user_id, telegram_first_name, telegram_username,
    paid_with, price_paid_uah, user_subscription_id, payment_state
  ) values (
    'club', p_club_id, p_user_id, p_first_name, p_username,
    case when v_used_sub then 'subscription' else 'card' end,
    case when v_used_sub then 0 else v_price end,
    case when v_used_sub then v_sub_id else null end,
    case when v_used_sub then 'confirmed' else 'pending' end
  )
  returning id into v_reg_id;

  return jsonb_build_object(
    'registration_id', v_reg_id,
    'needs_payment', not v_used_sub,
    'paid_with', case when v_used_sub then 'subscription' else 'card' end,
    'price_paid_uah', case when v_used_sub then 0 else v_price end,
    'amount_kop', case when v_used_sub then 0 else v_price * 100 end,
    'club_title', v_title,
    'sessions_left', case
      when v_used_sub and v_sub_total is not null then v_sub_total - v_sub_used - 1
      else null
    end
  );
end;
$$;

revoke all on function reserve_club(text, text, text, text) from public, anon, authenticated;
grant execute on function reserve_club(text, text, text, text) to service_role;

-- ---------------------------------------------------------------- STEP 5
-- Remember the invoice the reservation is waiting on.
create or replace function record_payment(
  p_invoice_id text,
  p_registration_id uuid,
  p_user_id text,
  p_club_id text,
  p_amount_kop int,
  p_reference text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into payments (invoice_id, registration_id, telegram_user_id, club_id, amount_kop, reference)
  values (p_invoice_id, p_registration_id, p_user_id, p_club_id, p_amount_kop, p_reference)
  on conflict (invoice_id) do nothing;
end;
$$;

revoke all on function record_payment(text, uuid, text, text, int, text) from public, anon, authenticated;
grant execute on function record_payment(text, uuid, text, text, int, text) to service_role;

-- ---------------------------------------------------------------- STEP 6
-- What the webhook calls. Idempotent by invoice: Monobank retries up to
-- three times, and a repeat must change nothing.
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
  elsif p_status in ('failure', 'expired', 'reversed') then
    -- Deleting frees the seat through trg_release_club_seat.
    delete from registrations where id = v_reg_id and payment_state = 'pending';
  end if;

  return jsonb_build_object('invoice_id', p_invoice_id, 'status', p_status, 'repeat', false);
end;
$$;

revoke all on function apply_payment_status(text, text) from public, anon, authenticated;
grant execute on function apply_payment_status(text, text) to service_role;

-- ---------------------------------------------------------------- STEP 7
-- A seat may not be held hostage by someone who closed the payment page.
-- Monobank expires the invoice itself after the same 15 minutes, and the
-- 'expired' status never arrives as a webhook — so this is the only thing
-- that frees those seats.
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
      -- A minute past the invoice's own 15-minute validity, so Monobank has
      -- already refused the payment before the seat is handed to anyone else.
      -- Without that gap a payment landing on the last second would be taken
      -- for a seat that had just been released.
      and created_at < now() - interval '16 minutes'
  loop
    delete from registrations where id = r.registration_id and payment_state = 'pending';
    update payments set status = 'expired', updated_at = now() where invoice_id = r.invoice_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function release_stale_reservations() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('release-stale-reservations');
exception
  when others then null;
end $$;

select cron.schedule('release-stale-reservations', '*/2 * * * *', $$select release_stale_reservations();$$);

-- ---------------------------------------------------------------- STEP 8
-- Money is taken immediately (paymentType "debit"), so an early
-- cancellation owes a real refund. Remembered on the payment row, which is
-- what stops the same invoice being refunded twice.
alter table payments add column if not exists refunded_at timestamptz;

-- Cancelling now reports what the caller must refund. The 24-hour rule is
-- the same one the FAQ states for pass visits: earlier than a day before
-- the class the money comes back, same day it does not.
create or replace function cancel_booking(
  p_registration_id uuid,
  p_user_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id text;
  v_date date;
  v_start time;
  v_club_start timestamptz;
  v_pass_id uuid;
  v_paid_with text;
  v_burned boolean := false;
  v_invoice text;
  v_amount int;
  v_refund boolean := false;
begin
  select r.club_id, r.user_subscription_id, r.paid_with, c.date, c.start_time
  into v_club_id, v_pass_id, v_paid_with, v_date, v_start
  from registrations r
  join clubs c on c.id = r.club_id
  where r.id = p_registration_id
    and r.telegram_user_id = p_user_id
    and r.type = 'club';
  if not found then
    raise exception 'booking_not_found';
  end if;

  v_club_start := (v_date::text || ' ' || v_start::text)::timestamp
                  at time zone 'Europe/Kyiv';
  if v_club_start <= now() then
    raise exception 'club_already_started';
  end if;

  -- Read the invoice before the delete: payments.registration_id is set to
  -- null by the foreign key as soon as the registration goes.
  select invoice_id, amount_kop into v_invoice, v_amount
  from payments
  where registration_id = p_registration_id
    and status in ('success', 'hold')
    and refunded_at is null
  limit 1;

  if v_club_start - now() < interval '24 hours' then
    -- Inside a day: a pass visit burns, and money is not returned either.
    if v_pass_id is not null then
      update registrations set user_subscription_id = null where id = p_registration_id;
      v_burned := true;
    end if;
    if v_paid_with = 'card' then
      v_burned := true;
    end if;
  elsif v_invoice is not null then
    v_refund := true;
    -- Claim it now so a second cancel cannot ask for the money twice.
    update payments set refunded_at = now(), updated_at = now() where invoice_id = v_invoice;
  end if;

  delete from registrations where id = p_registration_id;

  return jsonb_build_object(
    'club_id', v_club_id,
    'session_burned', v_burned,
    'refund_invoice_id', case when v_refund then v_invoice else null end,
    'refund_amount_kop', case when v_refund then v_amount else null end
  );
end;
$$;

revoke all on function cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function cancel_booking(uuid, text) to service_role;

-- Called when Monobank refuses the refund, so the claim does not block a
-- later retry by the admin.
create or replace function mark_refund_failed(p_invoice_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update payments set refunded_at = null, updated_at = now() where invoice_id = p_invoice_id;
end;
$$;

revoke all on function mark_refund_failed(text) from public, anon, authenticated;
grant execute on function mark_refund_failed(text) to service_role;

-- ---------------------------------------------------------------- STEP 9
-- Passes go through the same gate as clubs. The crucial difference: the
-- pass itself is not created until the money is in. Creating it earlier
-- would hand out free bookings to anyone who opened a payment page, and
-- would also start its 30 days before the person had paid for them.
create or replace function reserve_subscription(
  p_subscription_id text,
  p_user_id text,
  p_first_name text,
  p_username text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_count int;
  v_price int;
  v_reg_id uuid;
begin
  select title, sessions_count, price_uah
  into v_title, v_count, v_price
  from subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;

  if exists (
    select 1 from user_subscriptions
    where telegram_user_id = p_user_id
      and expires_at > now()
      and (sessions_total is null or sessions_used < sessions_total)
  ) then
    raise exception 'already_has_pass';
  end if;

  -- A purchase already waiting on an invoice is not "already bought".
  if exists (
    select 1 from registrations
    where type = 'subscription' and telegram_user_id = p_user_id
      and payment_state = 'pending'
  ) then
    raise exception 'payment_pending';
  end if;

  insert into registrations (
    type, subscription_id, telegram_user_id, telegram_first_name, telegram_username,
    paid_with, price_paid_uah, payment_state
  ) values (
    'subscription', p_subscription_id, p_user_id, p_first_name, p_username,
    'card', v_price, 'pending'
  )
  returning id into v_reg_id;

  return jsonb_build_object(
    'registration_id', v_reg_id,
    'needs_payment', true,
    'title', v_title,
    'sessions_total', v_count,
    'price_uah', v_price,
    'amount_kop', v_price * 100
  );
end;
$$;

revoke all on function reserve_subscription(text, text, text, text) from public, anon, authenticated;
grant execute on function reserve_subscription(text, text, text, text) to service_role;

-- Creates the pass once its payment is confirmed. Separate and idempotent,
-- because a webhook may arrive more than once.
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
begin
  select r.subscription_id, r.telegram_user_id, s.title, s.sessions_count, s.days_valid
  into v_sub_id, v_user, v_title, v_count, v_days
  from registrations r
  join subscriptions s on s.id = r.subscription_id
  where r.id = p_registration_id and r.type = 'subscription';
  if not found then
    return;
  end if;

  -- Already activated by an earlier delivery of the same webhook.
  if exists (
    select 1 from user_subscriptions
    where telegram_user_id = v_user and subscription_id = v_sub_id
      and purchased_at > now() - interval '1 day'
  ) then
    return;
  end if;

  -- The 30 days start now, when it was paid for, not when it was reserved.
  insert into user_subscriptions (telegram_user_id, subscription_id, title, sessions_total, expires_at)
  values (v_user, v_sub_id, v_title, v_count, now() + make_interval(days => coalesce(v_days, 30)));
end;
$$;

revoke all on function activate_paid_subscription(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------- STEP 10
-- Walking away from the payment page used to lock the person out for the
-- full fifteen minutes. Tapping again should simply carry on with the same
-- invoice, so the page it lives at has to be remembered.
alter table payments add column if not exists page_url text;

create or replace function record_payment(
  p_invoice_id text,
  p_registration_id uuid,
  p_user_id text,
  p_club_id text,
  p_amount_kop int,
  p_reference text,
  p_page_url text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into payments (invoice_id, registration_id, telegram_user_id, club_id,
                        amount_kop, reference, page_url)
  values (p_invoice_id, p_registration_id, p_user_id, p_club_id,
          p_amount_kop, p_reference, p_page_url)
  on conflict (invoice_id) do nothing;
end;
$$;

revoke all on function record_payment(text, uuid, text, text, int, text, text) from public, anon, authenticated;
grant execute on function record_payment(text, uuid, text, text, int, text, text) to service_role;

/** The unfinished payment for this exact thing, if there is one. */
create or replace function find_pending_payment(
  p_user_id text,
  p_club_id text default null,
  p_subscription_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select p.invoice_id, p.page_url, p.registration_id
  into v
  from payments p
  join registrations r on r.id = p.registration_id
  where p.telegram_user_id = p_user_id
    and p.status in ('created', 'processing')
    and r.payment_state = 'pending'
    and (
      (p_club_id is not null and r.club_id = p_club_id)
      or (p_subscription_id is not null and r.subscription_id = p_subscription_id)
    )
  order by p.created_at desc
  limit 1;

  if not found then
    return null;
  end if;
  return jsonb_build_object('invoice_id', v.invoice_id, 'page_url', v.page_url,
                            'registration_id', v.registration_id);
end;
$$;

revoke all on function find_pending_payment(text, text, text) from public, anon, authenticated;
grant execute on function find_pending_payment(text, text, text) to service_role;

/** Throws away a reservation whose invoice can no longer be paid, so the
 * person can start a clean one instead of waiting out the sweep. */
create or replace function drop_pending_payment(p_invoice_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg uuid;
begin
  select registration_id into v_reg from payments where invoice_id = p_invoice_id;
  delete from registrations where id = v_reg and payment_state = 'pending';
  update payments set status = 'expired', updated_at = now() where invoice_id = p_invoice_id;
end;
$$;

revoke all on function drop_pending_payment(text) from public, anon, authenticated;
grant execute on function drop_pending_payment(text) to service_role;
