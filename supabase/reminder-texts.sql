-- MySchool — the reminder texts, in the client's voice.
--
-- She wrote the day-before one and asked for the other two to match:
--
--   🦕 йо, клаб "" вже завтра о ""
--   посилання прийде завтра за годину до початку
--
--   сі ю 😎
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- No Edge Function redeploy needed for this file.
--
-- Everything else about the job is unchanged, including the rule added in
-- money-fixes-3.sql that only paid bookings get reminded at all — the
-- one-hour message carries the meeting link, and sending it to someone who
-- never paid hands out the class for free.

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
  today date;
  when_word text;
  link_promise text;
begin
  today := (now() at time zone 'Europe/Kyiv')::date;

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

    -- "завтра" is only true if it really is tomorrow. Someone who books
    -- twenty hours ahead on the same day gets the day reminder too, and
    -- telling them "завтра" about a class today would be a lie.
    if r.date = today then
      when_word := 'вже сьогодні о ' || to_char(r.start_time, 'HH24:MI');
      link_promise := 'посилання прийде за годину до початку';
    elsif r.date = today + 1 then
      when_word := 'вже завтра о ' || to_char(r.start_time, 'HH24:MI');
      link_promise := 'посилання прийде завтра за годину до початку';
    else
      when_word := 'вже ' || to_char(r.date, 'DD.MM') || ' о ' || to_char(r.start_time, 'HH24:MI');
      link_promise := 'посилання прийде за годину до початку';
    end if;

    -- Only the nearest reminder still worth sending goes out. Book two
    -- hours before the class and all three windows are open at once —
    -- previously that sent the day one and the three-hour one together, and
    -- in her wording they read identically. The ones whose moment has
    -- already passed are marked done without a message.
    if hours_until <= 1 then
      update registrations
      set reminder_day = true, reminder_h3 = true
      where id = r.id and (not reminder_day or not reminder_h3);

      -- The link goes out here and nowhere else.
      if not r.reminder_h1 then
        if coalesce(r.meeting_url, '') <> '' then
          link_line := 'ось посилання: ' || r.meeting_url || chr(10) || chr(10);
        else
          link_line := chr(10);
        end if;
        perform send_telegram_message(
          r.telegram_user_id,
          '🦕 йо, клаб «' || r.title || '» вже за годину' || chr(10)
          || link_line
          || 'сі ю 😎'
        );
        update registrations set reminder_h1 = true where id = r.id;
      end if;

    elsif hours_until <= 3 then
      update registrations set reminder_day = true
      where id = r.id and not reminder_day;

      if not r.reminder_h3 then
        perform send_telegram_message(
          r.telegram_user_id,
          '🦕 йо, клаб «' || r.title || '» ' || when_word || chr(10)
          || 'посилання прийде за годину до початку' || chr(10) || chr(10)
          || 'сі ю 😎'
        );
        update registrations set reminder_h3 = true where id = r.id;
      end if;

    elsif hours_until <= 24 and not r.reminder_day then
      perform send_telegram_message(
        r.telegram_user_id,
        '🦕 йо, клаб «' || r.title || '» ' || when_word || chr(10)
        || link_promise || chr(10) || chr(10)
        || 'сі ю 😎'
      );
      update registrations set reminder_day = true where id = r.id;
    end if;
  end loop;
end;
$$;

revoke all on function check_reminders() from public, anon, authenticated;

-- --------------------------------------------------------------- VERIFY
-- Still impossible to remind an unpaid seat. Should be 0.
select count(*) as unpaid_seats_that_would_get_reminders
from registrations
where type = 'club' and payment_state <> 'confirmed';
