-- Reminders (day/12h/3h before a club) + admin notifications on purchase,
-- running entirely inside Supabase via pg_cron + pg_net. No external server
-- needs to be running for these to work.
--
-- BEFORE RUNNING: replace 'YOUR_BOT_TOKEN_HERE' below with the real value
-- from your local .env (BOT_TOKEN=...). Do not commit the real token to
-- git — this file is meant to be edited locally before pasting into the
-- Supabase SQL Editor, then you can discard the edit.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Small config table: admin Telegram IDs the trigger notifies on a new
-- paid registration. Comma-separated.
create table if not exists app_config (
  key text primary key,
  value text not null
);
insert into app_config (key, value) values ('admin_telegram_ids', '777037876')
on conflict (key) do update set value = excluded.value;

-- app_config is internal-only: no public select/insert/update/delete policy,
-- so only service_role (the server) or the SQL editor (as owner) can read it.
alter table app_config enable row level security;

-- Store the bot token encrypted in Supabase Vault rather than in plain SQL.
-- Safe to re-run: skips if a secret with this name already exists.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'telegram_bot_token') then
    perform vault.create_secret('YOUR_BOT_TOKEN_HERE', 'telegram_bot_token');
  end if;
end $$;

-- Reminder thresholds changed from (day/3h/1h) to (day/12h/3h).
alter table registrations drop column if exists reminder_h1;
alter table registrations add column if not exists reminder_h12 boolean not null default false;

create or replace function send_telegram_message(chat_id text, msg text) returns void as $$
declare
  token text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'telegram_bot_token';
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', chat_id, 'text', msg)
  );
end;
$$ language plpgsql security definer;

-- Runs on a schedule (see cron.schedule below): finds club registrations
-- crossing the day/12h/3h-before threshold and haven't been notified yet.
create or replace function check_reminders() returns void as $$
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
    club_start := (r.date::text || ' ' || r.start_time::text)::timestamptz;
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
$$ language plpgsql security definer;

select cron.schedule('check-reminders-every-5-min', '*/5 * * * *', $$select check_reminders();$$);

-- Notify admins on every new paid registration/purchase.
create or replace function notify_admin_on_registration() returns trigger as $$
declare
  ids text[];
  admin_id text;
  item_title text;
  msg text;
begin
  select string_to_array(value, ',') into ids from app_config where key = 'admin_telegram_ids';

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
$$ language plpgsql security definer;

drop trigger if exists trg_notify_admin on registrations;
create trigger trg_notify_admin
  after insert on registrations
  for each row execute function notify_admin_on_registration();
