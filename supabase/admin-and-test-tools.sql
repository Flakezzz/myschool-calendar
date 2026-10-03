-- Admin management + a reminder self-test you can run any time.
-- Safe to re-run. No bot token needed in this file.

-- ================================================================ PART 1
-- Make app_config.admin_telegram_ids readable by the app, so the admin
-- list has ONE home (this table) instead of being duplicated into the
-- Edge Function secret and the web build. Only this one key is exposed —
-- it isn't a secret (real authorization happens server-side in the
-- admin-write Edge Function, which verifies Telegram's signature).
drop policy if exists "public read admin ids" on app_config;
create policy "public read admin ids" on app_config
  for select using (key = 'admin_telegram_ids');

-- ---------------------------------------------------------------------
-- TO ADD MORE ADMINS: put every Telegram ID here, comma-separated, no
-- spaces needed. This one line is now the only place you change.
-- Keep this value current — re-running the file writes it back over
-- whatever is in the database.
update app_config
set value = '777037876,526386894'
where key = 'admin_telegram_ids';

-- Check who's an admin right now:
select value as admin_telegram_ids from app_config where key = 'admin_telegram_ids';


-- ================================================================ PART 2
-- Reminder self-test. Creates a club timed 2h55m from now (Kyiv time), so
-- all three thresholds (day / 12h / 3h) qualify at once, registers every
-- current admin for it, and runs the check immediately.
--
-- Expect 4 Telegram messages per admin within a few seconds:
--   1 booking notification (proves the admin-notify trigger works)
--   3 reminders — day / 12 hours / 3 hours
do $$
declare
  test_id text := 'zz-reminder-selftest';
  local_start timestamp := (now() at time zone 'Europe/Kyiv') + interval '2 hours 55 minutes';
  ids text[];
  admin_id text;
begin
  -- clear any previous run (cascade also removes its registrations)
  delete from clubs where id = test_id;

  insert into clubs (id, title, description, date, start_time, end_time,
                     teacher, level, seats, taken, price_uah, color)
  values (test_id, 'ТЕСТ нагадувань', 'Тимчасовий клаб для перевірки нагадувань',
          local_start::date, local_start::time, (local_start + interval '1 hour')::time,
          'Тест', 'Test', 99, 0, 0, '#3BA99C');

  select string_to_array(value, ',') into ids
  from app_config where key = 'admin_telegram_ids';

  foreach admin_id in array ids loop
    insert into registrations (type, club_id, telegram_user_id)
    values ('club', test_id, trim(admin_id));
  end loop;
end $$;

-- Fire the reminder check now instead of waiting for the 5-minute cron.
select check_reminders();

-- Confirm all three thresholds were marked as sent:
select telegram_user_id, reminder_day, reminder_h12, reminder_h3
from registrations
where club_id = 'zz-reminder-selftest';


-- ================================================================ PART 3
-- Is the automatic scheduler actually alive? This is the part most likely
-- to fail silently — it proves reminders fire on their own, unattended.
select jobid, schedule, active, jobname
from cron.job
where jobname = 'check-reminders-every-5-min';

-- Recent automatic runs (should fill up over time, one every 5 minutes):
select status, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 5;


-- ================================================================ CLEANUP
-- Run this once you've confirmed the messages arrived, to remove the test
-- club (cascade removes its registrations too).
-- delete from clubs where id = 'zz-reminder-selftest';
