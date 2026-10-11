-- MySchool — third money audit, 2026-10-11.
--
-- One finding, and it is the worst one yet: the school's own bot was
-- handing the meeting link to people who had not paid.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- No Edge Function redeploy needed for this file.

-- ---------------------------------------------------------------- STEP 1
-- CRITICAL — the free club, again, by a different door.
--
-- Round one took the meeting link away from the public API. But the
-- reminder job sends that same link by Telegram an hour before the class,
-- and its query was:
--
--     from registrations reg join clubs c on c.id = reg.club_id
--     where reg.type = 'club'
--
-- No payment check. A seat held for an unpaid invoice is a registrations
-- row like any other, so:
--
--   1. less than an hour before an online club, tap "го"
--   2. the seat is held, nothing is paid
--   3. the job runs (every 5 minutes) and sends the link
--   4. walk away from the payment page; the sweep frees the seat 20 min later
--
-- Free class, delivered by the school's bot. The unpaid person also got
-- every other reminder, which is its own kind of wrong.
--
-- Reminders now go only to bookings that are actually paid for.
create or replace function check_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  -- Named lk, not c: the reminder loop below aliases the clubs table as c,
  -- and a variable of the same name makes "c.id" ambiguous at runtime.
  lk record;
  club_start timestamptz;
  hours_until numeric;
  link_line text;
begin
  -- Part 1: warn the admins about clubs that still have no meeting link.
  for lk in
    select cl.id, cl.title, cl.date, cl.start_time, cl.meeting_url,
           coalesce(a.warned_day, false) as warned_day,
           coalesce(a.warned_hour, false) as warned_hour
    from clubs cl
    left join club_link_alerts a on a.club_id = cl.id
  loop
    club_start := (lk.date::text || ' ' || lk.start_time::text)::timestamp
                  at time zone 'Europe/Kyiv';
    hours_until := extract(epoch from (club_start - now())) / 3600;
    if hours_until <= 0 or coalesce(lk.meeting_url, '') <> '' then
      continue;
    end if;

    if hours_until <= 24 and not lk.warned_day then
      perform notify_admins(
        '⚠️ У клаба «' || lk.title || '» (' || lk.date || ' о ' || to_char(lk.start_time, 'HH24:MI')
        || ') ще немає посилання на зустріч. Додайте його в адмін-панелі.'
      );
      insert into club_link_alerts (club_id, warned_day) values (lk.id, true)
      on conflict (club_id) do update set warned_day = true;
    end if;

    if hours_until <= 1 and not lk.warned_hour then
      perform notify_admins(
        '⚠️ Клаб «' || lk.title || '» починається за годину, а посилання так і немає. '
        || 'Нагадування учасникам пішло без нього.'
      );
      insert into club_link_alerts (club_id, warned_hour) values (lk.id, true)
      on conflict (club_id) do update set warned_hour = true;
    end if;
  end loop;

  -- Part 2: the reminders themselves.
  for r in
    select reg.id, reg.telegram_user_id, reg.reminder_day, reg.reminder_h3, reg.reminder_h1,
           c.title, c.teacher, c.date, c.start_time, c.meeting_url
    from registrations reg
    join clubs c on c.id = reg.club_id
    where reg.type = 'club'
      -- A seat held for an unpaid invoice is not a booking. Reminding its
      -- holder is wrong on its own, and the one-hour reminder carries the
      -- meeting link — which would hand out the class for free.
      and reg.payment_state = 'confirmed'
  loop
    -- Club times are entered as local Kyiv time while the database runs in
    -- UTC; AT TIME ZONE anchors the naive value and handles DST.
    club_start := (r.date::text || ' ' || r.start_time::text)::timestamp
                  at time zone 'Europe/Kyiv';
    hours_until := extract(epoch from (club_start - now())) / 3600;

    if hours_until <= 0 then
      continue;
    end if;

    if hours_until <= 24 and not r.reminder_day then
      perform send_telegram_message(
        r.telegram_user_id,
        '⏰ Нагадування: клаб «' || r.title || '» починається за день (' || r.date || ' о ' || to_char(r.start_time, 'HH24:MI') || '). Викладач: ' || r.teacher || '.'
      );
      update registrations set reminder_day = true where id = r.id;
    end if;

    if hours_until <= 3 and not r.reminder_h3 then
      perform send_telegram_message(
        r.telegram_user_id,
        '⏰ Нагадування: клаб «' || r.title || '» починається за 3 години (' || r.date || ' о ' || to_char(r.start_time, 'HH24:MI') || '). Викладач: ' || r.teacher || '.'
      );
      update registrations set reminder_h3 = true where id = r.id;
    end if;

    -- The link goes out here and nowhere else.
    if hours_until <= 1 and not r.reminder_h1 then
      if coalesce(r.meeting_url, '') <> '' then
        link_line := chr(10) || 'Посилання: ' || r.meeting_url;
      else
        link_line := '';
      end if;
      perform send_telegram_message(
        r.telegram_user_id,
        '⏰ Клаб «' || r.title || '» починається за годину.' || link_line
      );
      update registrations set reminder_h1 = true where id = r.id;
    end if;
  end loop;
end;
$$;

revoke all on function check_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------- STEP 2
-- A gap the health check could not see: cancelling a club refunds people
-- first and removes the club second. If the second half never runs — the
-- function dies in between — the money has gone back while the booking is
-- still standing, so those people would turn up to a class they no longer
-- paid for, and nothing anywhere would say so.
--
-- Nothing to change in the schema; this is a new query in money-check.sql
-- (CHECK 8). Kept here as the record of why it exists.

-- --------------------------------------------------------------- VERIFY
-- Reminders must now be impossible for an unpaid seat. Should be 0.
select count(*) as unpaid_seats_that_would_get_reminders
from registrations
where type = 'club' and payment_state <> 'confirmed';
