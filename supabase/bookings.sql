-- Bookings, cancellations and redeemable subscriptions.
--
-- Adds: real subscription passes (user_subscriptions), who-booked-what
-- details on registrations, a duplicate-booking guard, and atomic
-- book/buy/cancel functions that the admin-write Edge Function calls with
-- the service_role key.
--
-- No bot token needed. Safe to re-run.
-- Nothing here sends Telegram messages on its own, but STEP 9 replaces the
-- admin-notification trigger, so the NEXT real booking after this runs will
-- send a (nicer) message to every admin.
--
-- Run the whole file in one go. If a step errors, note WHICH step number
-- failed — that pinpoints the problem immediately.
--
-- AFTER this file: deploy the updated admin-write Edge Function and the
-- updated website, THEN run lock-down-writes.sql. Order matters — see the
-- comment at the top of that file.

-- ---------------------------------------------------------------- STEP 1
-- Subscription plans need machine-readable terms. `sessions` stayed free
-- text ("4 відвідування / 30 днів") for display; these two columns are what
-- the booking logic actually reads. sessions_count null = unlimited.
alter table subscriptions add column if not exists sessions_count int;
alter table subscriptions add column if not exists days_valid int not null default 30;

update subscriptions set sessions_count = 4 where id = 'sub-4' and sessions_count is null;
update subscriptions set sessions_count = 8 where id = 'sub-8' and sessions_count is null;
-- sub-unlim intentionally keeps sessions_count = null.

-- ---------------------------------------------------------------- STEP 2
-- A bought pass. Separate from `registrations` (which is the purchase
-- receipt / notification trigger) because a pass has state that changes:
-- sessions get spent and refunded as clubs are booked and cancelled.
--
-- title and sessions_total are snapshots, so deleting or re-pricing a plan
-- later never changes what someone already paid for.
create table if not exists user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null,
  subscription_id text references subscriptions(id) on delete set null,
  title text not null,
  sessions_total int,
  sessions_used int not null default 0,
  purchased_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_user_subs_user on user_subscriptions (telegram_user_id);

-- No public policy at all: the anon key can't read or write passes. Only
-- the Edge Function (service_role) touches this table.
alter table user_subscriptions enable row level security;

-- Backfill the passes people already "bought" before this table existed,
-- so nobody loses what they paid for. Runs once — the not-exists guard
-- makes a re-run a no-op.
insert into user_subscriptions (telegram_user_id, subscription_id, title, sessions_total, purchased_at, expires_at)
select r.telegram_user_id,
       r.subscription_id,
       s.title,
       s.sessions_count,
       r.created_at,
       r.created_at + make_interval(days => s.days_valid)
from registrations r
join subscriptions s on s.id = r.subscription_id
where r.type = 'subscription'
  and not exists (
    select 1 from user_subscriptions us
    where us.telegram_user_id = r.telegram_user_id
      and us.subscription_id = r.subscription_id
      and us.purchased_at = r.created_at
  );

-- ---------------------------------------------------------------- STEP 3
-- Who booked, and how they paid. Until now a registration was just a
-- Telegram ID — the admin had no way to tell whose booking it was.
--
-- The name fields are snapshots taken from Telegram's *verified* initData
-- at booking time (see the Edge Function), not client-supplied strings.
alter table registrations add column if not exists telegram_first_name text;
alter table registrations add column if not exists telegram_username text;
alter table registrations add column if not exists price_paid_uah int;
alter table registrations add column if not exists paid_with text not null default 'cash';
alter table registrations add column if not exists user_subscription_id uuid;

alter table registrations drop constraint if exists registrations_paid_with_check;
alter table registrations add constraint registrations_paid_with_check
  check (paid_with in ('cash', 'subscription'));

-- If a pass row is ever removed, keep the booking but forget the link.
alter table registrations drop constraint if exists registrations_user_subscription_id_fkey;
alter table registrations add constraint registrations_user_subscription_id_fkey
  foreign key (user_subscription_id) references user_subscriptions(id) on delete set null;

-- ---------------------------------------------------------------- STEP 4
-- One booking per person per club. The same person could book repeatedly,
-- which inflated the seat counter and multiplied their reminders.
--
-- Clean up the existing duplicates first (keep the earliest booking), then
-- recompute every club's seat counter from the surviving rows so `taken`
-- matches reality.
delete from registrations r
using registrations keeper
where r.type = 'club'
  and keeper.type = 'club'
  and r.club_id = keeper.club_id
  and r.telegram_user_id = keeper.telegram_user_id
  and (r.created_at, r.id) > (keeper.created_at, keeper.id);

update clubs c
set taken = (
  select count(*) from registrations r
  where r.club_id = c.id and r.type = 'club'
);

-- Partial index: subscription receipts have club_id = null and are excluded.
create unique index if not exists idx_unique_club_booking
  on registrations (club_id, telegram_user_id)
  where type = 'club';

-- ---------------------------------------------------------------- STEP 5
-- Cancelling (or deleting a club) must give the seat back and refund the
-- subscription session. Doing it in a trigger covers every delete path,
-- including the ON DELETE CASCADE from removing a whole club.
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

  if old.user_subscription_id is not null then
    update user_subscriptions
    set sessions_used = greatest(sessions_used - 1, 0)
    where id = old.user_subscription_id;
  end if;

  return old;
end;
$$;

revoke all on function release_club_seat() from public, anon, authenticated;

drop trigger if exists trg_release_club_seat on registrations;
create trigger trg_release_club_seat
  after delete on registrations
  for each row execute function release_club_seat();

-- ---------------------------------------------------------------- STEP 6
-- Booking, as one atomic step: duplicate check, capacity check, spend a
-- subscription session if the user has one, insert the registration.
--
-- Doing this in SQL rather than in the Edge Function matters: two people
-- booking the last seat at the same moment, or one person tapping twice,
-- can't interleave between the check and the insert.
create or replace function book_club(
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
  v_sub_id uuid;
  v_sub_total int;
  v_sub_used int;
  v_used_sub boolean := false;
  v_reg_id uuid;
begin
  -- FOR UPDATE serialises concurrent bookings of the same club.
  select seats, taken, price_uah into v_seats, v_taken, v_price
  from clubs where id = p_club_id for update;
  if not found then
    raise exception 'club_not_found';
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

  -- Spend a limited pass before an unlimited one, and the soonest-expiring
  -- limited pass first, so nothing goes to waste.
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
    paid_with, price_paid_uah, user_subscription_id
  ) values (
    'club', p_club_id, p_user_id, p_first_name, p_username,
    case when v_used_sub then 'subscription' else 'cash' end,
    case when v_used_sub then 0 else v_price end,
    case when v_used_sub then v_sub_id else null end
  )
  returning id into v_reg_id;

  return jsonb_build_object(
    'registration_id', v_reg_id,
    'paid_with', case when v_used_sub then 'subscription' else 'cash' end,
    'price_paid_uah', case when v_used_sub then 0 else v_price end,
    'sessions_left', case
      when v_used_sub and v_sub_total is not null then v_sub_total - v_sub_used - 1
      else null
    end
  );
end;
$$;

revoke all on function book_club(text, text, text, text) from public, anon, authenticated;
grant execute on function book_club(text, text, text, text) to service_role;

-- ---------------------------------------------------------------- STEP 7
-- Buying a pass: creates the pass and the purchase receipt together. The
-- receipt insert is what fires the admin notification (STEP 9).
create or replace function buy_subscription(
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
  v_days int;
  v_price int;
  v_pass_id uuid;
  v_expires timestamptz;
begin
  select title, sessions_count, days_valid, price_uah
  into v_title, v_count, v_days, v_price
  from subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;

  v_expires := now() + make_interval(days => v_days);

  insert into user_subscriptions (
    telegram_user_id, subscription_id, title, sessions_total, expires_at
  ) values (
    p_user_id, p_subscription_id, v_title, v_count, v_expires
  )
  returning id into v_pass_id;

  insert into registrations (
    type, subscription_id, telegram_user_id, telegram_first_name, telegram_username,
    paid_with, price_paid_uah
  ) values (
    'subscription', p_subscription_id, p_user_id, p_first_name, p_username,
    'cash', v_price
  );

  return jsonb_build_object(
    'user_subscription_id', v_pass_id,
    'title', v_title,
    'sessions_total', v_count,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function buy_subscription(text, text, text, text) from public, anon, authenticated;
grant execute on function buy_subscription(text, text, text, text) to service_role;

-- ---------------------------------------------------------------- STEP 8
-- Cancelling your own booking. The ownership check lives in the WHERE
-- clause, so passing someone else's registration id deletes nothing.
-- The STEP 5 trigger returns the seat and refunds the session.
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
begin
  select r.club_id, c.date, c.start_time
  into v_club_id, v_date, v_start
  from registrations r
  join clubs c on c.id = r.club_id
  where r.id = p_registration_id
    and r.telegram_user_id = p_user_id
    and r.type = 'club';
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Club times are entered as Kyiv local time while the database runs in
  -- UTC, so the naive value has to be anchored to Kyiv before comparing.
  v_club_start := (v_date::text || ' ' || v_start::text)::timestamp
                  at time zone 'Europe/Kyiv';
  if v_club_start <= now() then
    raise exception 'club_already_started';
  end if;

  delete from registrations where id = p_registration_id;

  return jsonb_build_object('club_id', v_club_id);
end;
$$;

revoke all on function cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function cancel_booking(uuid, text) to service_role;

-- ---------------------------------------------------------------- STEP 9
-- The admin notification now says who booked and how they paid, instead of
-- just the club title.
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
  else
    how := coalesce(new.price_paid_uah::text, '?') || ' ₴';
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
        || 'Сума: ' || coalesce(new.price_paid_uah::text, '?') || ' ₴';
  end if;

  foreach admin_id in array ids loop
    perform send_telegram_message(trim(admin_id), msg);
  end loop;

  return new;
end;
$$;

revoke all on function notify_admin_on_registration() from public, anon, authenticated;

-- -------------------------------------------------------------- OPTIONAL
-- STEP 2 honours every past subscription purchase, including the ones made
-- while testing — so after this runs, the test accounts hold real, usable
-- passes and their club bookings will come out free. To wipe the test
-- purchases instead, uncomment and run this:
--
-- delete from user_subscriptions where purchased_at < '2026-10-03';
-- delete from registrations where type = 'subscription' and created_at < '2026-10-03';

-- --------------------------------------------------------------- VERIFY
-- Expect: all four true, duplicates = 0.
select
  exists (select 1 from pg_proc where proname = 'book_club') as has_book_fn,
  exists (select 1 from pg_proc where proname = 'buy_subscription') as has_buy_fn,
  exists (select 1 from pg_proc where proname = 'cancel_booking') as has_cancel_fn,
  exists (select 1 from pg_trigger where tgname = 'trg_release_club_seat') as has_release_trigger,
  (select count(*) from (
     select club_id, telegram_user_id from registrations
     where type = 'club' group by club_id, telegram_user_id having count(*) > 1
   ) d) as duplicates;
