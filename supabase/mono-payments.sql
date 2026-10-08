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

  -- Terminal states never change again.
  if v_old in ('success', 'failure', 'reversed', 'expired') then
    return jsonb_build_object('invoice_id', p_invoice_id, 'status', v_old, 'repeat', true);
  end if;

  update payments set status = p_status, updated_at = now() where invoice_id = p_invoice_id;

  if p_status in ('hold', 'success') then
    update registrations set payment_state = 'confirmed'
    where id = v_reg_id and payment_state = 'pending';
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
      and created_at < now() - interval '15 minutes'
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
