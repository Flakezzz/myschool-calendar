-- MySchool — fourth money audit, 2026-10-13.
--
-- Two holes, both in deleting things. Reproduce before trusting either
-- description: both were found by reading, then confirmed in a replica.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- AFTER this file: redeploy admin-write and push the website.

-- ---------------------------------------------------------------- STEP 1
-- CRITICAL: deleting a club that already happened refunded everyone who
-- attended it.
--
-- Cancelling a future club and refunding its people is right. Removing an
-- old one from the calendar is housekeeping — the class was taught, the
-- money was earned. Nothing told the two apart, so tidying up last month's
-- clubs would have handed the money back for every one of them.
--
-- A club that has already started now refunds nobody, and its attendees
-- are not told their class is "cancelled" either — it already happened.
create or replace function prepare_club_cancellation(p_club_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_date date;
  v_start time;
  v_past boolean;
  v_refunds jsonb := '[]'::jsonb;
  r record;
begin
  select title, date, start_time into v_title, v_date, v_start
  from clubs where id = p_club_id for update;
  if not found then
    raise exception 'club_not_found';
  end if;

  v_past := (v_date::text || ' ' || v_start::text)::timestamp
            at time zone 'Europe/Kyiv' <= now();

  if not v_past then
    for r in
      select p.invoice_id, p.amount_kop, p.telegram_user_id
      from payments p
      join registrations g on g.id = p.registration_id
      where g.club_id = p_club_id
        and g.type = 'club'
        and p.status in ('success', 'hold')
        and p.refunded_at is null
    loop
      -- Claimed up front: whatever happens next, this invoice is not going
      -- to be refunded twice.
      update payments set refunded_at = now(), updated_at = now()
      where invoice_id = r.invoice_id;
      v_refunds := v_refunds || jsonb_build_object(
        'invoice_id', r.invoice_id, 'amount_kop', r.amount_kop, 'user_id', r.telegram_user_id);
    end loop;
  end if;

  return jsonb_build_object(
    'club_id', p_club_id,
    'title', v_title,
    'date', v_date,
    'past', v_past,
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
  v_past boolean;
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
  v_past := (v_date::text || ' ' || v_start::text)::timestamp
            at time zone 'Europe/Kyiv' <= now();

  -- Telling someone their class is cancelled, when they already sat
  -- through it, would be nonsense. A past club is removed in silence.
  if not v_past then
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
  end if;

  -- The cascade removes the bookings; trg_release_club_seat gives pass
  -- sessions back on the way out. For a past club that is wrong too — the
  -- visit was used — so those links are cut first.
  if v_past then
    update registrations set user_subscription_id = null
    where club_id = p_club_id and type = 'club';
  end if;

  delete from clubs where id = p_club_id;

  if v_told > 0 then
    perform notify_admins(
      '🗑 Клаб «' || v_title || '» ' || wen || ' скасовано.' || chr(10)
      || 'Попередили людей: ' || v_told || chr(10)
      || 'Повертаємо на карти: ' || v_paid || ' осіб, ' || v_sum || ' грн'
    );
  end if;

  return jsonb_build_object('told', v_told, 'card_refunds', v_paid,
                            'refund_uah', v_sum, 'past', v_past);
end;
$$;

revoke all on function finish_club_cancellation(text) from public, anon, authenticated;
grant execute on function finish_club_cancellation(text) to service_role;

-- ---------------------------------------------------------------- STEP 2
-- Deleting a subscription plan quietly destroyed the record of everyone
-- who had ever bought it: the receipts cascaded away with it, and the
-- payments lost the row they pointed at. The money check reads those.
--
-- Since is_visible exists there is no reason to delete a plan at all, so
-- the database now refuses when anyone has bought it. A plan nobody ever
-- bought still deletes cleanly.
alter table registrations drop constraint if exists registrations_subscription_id_fkey;
alter table registrations add constraint registrations_subscription_id_fkey
  foreign key (subscription_id) references subscriptions(id) on delete restrict;

-- --------------------------------------------------------------- VERIFY
select conname, confdeltype as on_delete
from pg_constraint
where conname in ('registrations_subscription_id_fkey', 'registrations_club_id_fkey');
