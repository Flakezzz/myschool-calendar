-- Reminders (day/12h/3h before a club) + admin notifications on purchase,
-- running entirely inside Supabase via pg_cron + pg_net. No external server
-- needs to be running for these to work.
--
-- BEFORE RUNNING: replace 'YOUR_BOT_TOKEN_HERE' in STEP 5 with the real
-- value from .env (BOT_TOKEN=...). Don't commit that edit — discard it
-- after pasting into the Supabase SQL Editor.
--
-- Run the whole file in one go. If a step errors, note WHICH step number
-- failed — that pinpoints the problem immediately.

-- ---------------------------------------------------------------- STEP 1
-- Extensions, installed without an explicit schema so each lands where
-- Supabase expects it. (Forcing `with schema extensions` can put pg_net's
-- functions somewhere `net.http_post` won't resolve.) The functions below
-- use a search_path covering every location these can land in.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- STEP 2
-- Deleting a club (or subscription plan) should take its bookings with it.
-- Without this, deleting anything that has ever been booked fails with a
-- foreign key violation.
alter table registrations drop constraint if exists registrations_club_id_fkey;
alter table registrations add constraint registrations_club_id_fkey
  foreign key (club_id) references clubs(id) on delete cascade;

alter table registrations drop constraint if exists registrations_subscription_id_fkey;
alter table registrations add constraint registrations_subscription_id_fkey
  foreign key (subscription_id) references subscriptions(id) on delete cascade;

-- ---------------------------------------------------------------- STEP 3
-- Reminder thresholds changed from (day/3h/1h) to (day/12h/3h).
alter table registrations drop column if exists reminder_h1;
alter table registrations add column if not exists reminder_h12 boolean not null default false;

-- ---------------------------------------------------------------- STEP 4
-- Admin Telegram IDs the trigger notifies on a new paid registration.
create table if not exists app_config (
  key text primary key,
  value text not null
);
insert into app_config (key, value) values ('admin_telegram_ids', '777037876')
on conflict (key) do update set value = excluded.value;

-- Internal-only: no public policy, so only service_role / the SQL editor
-- can read it.
alter table app_config enable row level security;

-- ---------------------------------------------------------------- STEP 5
-- Bot token, stored encrypted in Supabase Vault rather than plain in SQL.
-- Safe to re-run: updates the value if the secret already exists.
do $$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.secrets where name = 'telegram_bot_token';
  if existing_id is null then
    perform vault.create_secret('YOUR_BOT_TOKEN_HERE', 'telegram_bot_token');
  else
    perform vault.update_secret(existing_id, 'YOUR_BOT_TOKEN_HERE', 'telegram_bot_token');
  end if;
end $$;

-- ---------------------------------------------------------------- STEP 6
-- Sends one Telegram message via the Bot API. The search_path covers net /
-- extensions / public so http_post resolves wherever pg_net installed it.
create or replace function send_telegram_message(chat_id text, msg text)
returns void
language plpgsql
security definer
set search_path = net, extensions, public
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'telegram_bot_token';

  if token is null then
    raise exception 'telegram_bot_token secret not found in vault';
  end if;

  perform http_post(
    url := 'https://api.telegram.org/bot' || token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', chat_id, 'text', msg)
  );
end;
$$;

-- ---------------------------------------------------------------- STEP 7
-- Finds club registrations crossing the day/12h/3h-before thresholds that
-- haven't been notified yet. Scheduled in STEP 8.
create or replace function check_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  club_start timestamptz;
  hours_until numeric;
begin
  for r in
    select reg.id, reg.telegram_user_id, reg.reminder_day, reg.reminder_h12, reg.reminder_h3,
           c.title, c.teacher, c.date, c.start_time
    from registrations reg
    join clubs c on c.id = reg.club_id
    where reg.type = 'club'
  loop
    -- Club times are entered as local Kyiv time, but the database runs in
    -- UTC — casting straight to timestamptz would read 16:00 as 16:00 UTC
    -- (19:00 Kyiv) and fire every reminder ~3h late. AT TIME ZONE anchors
    -- the naive value to Kyiv and handles DST automatically.
    club_start := (r.date::text || ' ' || r.start_time::text)::timestamp
                  at time zone 'Europe/Kyiv';
    hours_until := extract(epoch from (club_start - now())) / 3600;

    if hours_until <= 0 then
      continue;
    end if;

    if hours_until <= 24 and not r.reminder_day then
      perform send_telegram_message(
        r.telegram_user_id,
        '⏰ Нагадування: клаб «' || r.title || '» починається за день (' || r.date || ' о ' || r.start_time || '). Викладач: ' || r.teacher || '.'
      );
      update registrations set reminder_day = true where id = r.id;
    end if;

    if hours_until <= 12 and not r.reminder_h12 then
      perform send_telegram_message(
        r.telegram_user_id,
        '⏰ Нагадування: клаб «' || r.title || '» починається за 12 годин (' || r.date || ' о ' || r.start_time || '). Викладач: ' || r.teacher || '.'
      );
      update registrations set reminder_h12 = true where id = r.id;
    end if;

    if hours_until <= 3 and not r.reminder_h3 then
      perform send_telegram_message(
        r.telegram_user_id,
        '⏰ Нагадування: клаб «' || r.title || '» починається за 3 години (' || r.date || ' о ' || r.start_time || '). Викладач: ' || r.teacher || '.'
      );
      update registrations set reminder_h3 = true where id = r.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- STEP 8
-- Run the reminder check every 5 minutes. Unschedule first so re-running
-- this file doesn't stack duplicate jobs.
do $$
begin
  perform cron.unschedule('check-reminders-every-5-min');
exception
  when others then null;
end $$;

select cron.schedule('check-reminders-every-5-min', '*/5 * * * *', $$select check_reminders();$$);

-- ---------------------------------------------------------------- STEP 9
-- Notify admins on every new paid registration/purchase.
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
  msg text;
begin
  select string_to_array(value, ',') into ids from app_config where key = 'admin_telegram_ids';
  if ids is null then
    return new;
  end if;

  if new.type = 'club' then
    select title into item_title from clubs where id = new.club_id;
    msg := '🎉 Нова оплачена заявка: ' || coalesce(item_title, new.club_id);
  else
    select title into item_title from subscriptions where id = new.subscription_id;
    msg := '🎉 Новий оплачений абонемент: ' || coalesce(item_title, new.subscription_id);
  end if;

  foreach admin_id in array ids loop
    perform send_telegram_message(trim(admin_id), msg);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_admin on registrations;
create trigger trg_notify_admin
  after insert on registrations
  for each row execute function notify_admin_on_registration();

-- --------------------------------------------------------------- VERIFY
-- After running, this should return one row with all three true.
select
  exists (select 1 from pg_proc where proname = 'send_telegram_message') as has_send_fn,
  exists (select 1 from pg_proc where proname = 'check_reminders') as has_reminder_fn,
  exists (select 1 from pg_trigger where tgname = 'trg_notify_admin') as has_admin_trigger;
