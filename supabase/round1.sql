-- MySchool — client feedback round 1, database part.
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- WARNING: this project has no database backup. Read each step before
-- running it. Steps are independent — you can run them one at a time.

-- ---------------------------------------------------------------- STEP 1
-- Per-session media and meeting link. A club row is one session, so both
-- live on the club: the same weekly link is simply typed into each row.
alter table clubs add column if not exists meeting_url text;
alter table clubs add column if not exists video_url text;

-- ---------------------------------------------------------------- STEP 2
-- Reminders move from (day / 12h / 3h) to (24h / 3h / 1h). The meeting link
-- is sent only in the last one.
alter table registrations drop column if exists reminder_h12;
alter table registrations add column if not exists reminder_h1 boolean not null default false;

-- Admins are warned once per club when an online club is about to start
-- without a link. Remembered here so the warning is not repeated.
create table if not exists club_link_alerts (
  club_id text primary key references clubs(id) on delete cascade,
  warned_day boolean not null default false,
  warned_hour boolean not null default false
);
alter table club_link_alerts enable row level security;

create or replace function notify_admins(msg text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
  admin_id text;
begin
  select string_to_array(value, ',') into ids from app_config where key = 'admin_telegram_ids';
  if ids is null then
    return;
  end if;
  foreach admin_id in array ids loop
    perform send_telegram_message(trim(admin_id), msg);
  end loop;
end;
$$;

revoke all on function notify_admins(text) from public, anon, authenticated;

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

-- ---------------------------------------------------------------- STEP 3
-- New passes: 4 / 8 / 12 visits a month. "Безліміт" is retired — people who
-- already hold one keep it until it expires, it just can't be bought again.
update subscriptions
set title = '4 клаби', sessions = '4 клаба на місяць', price_uah = 1200, sessions_count = 4
where id = 'sub-4';

update subscriptions
set title = '8 клабів', sessions = '8 клабів на місяць', price_uah = 2600, sessions_count = 8
where id = 'sub-8';

insert into subscriptions (id, title, sessions, description, price_uah)
values ('sub-12', '12 клабів', '12 клабів на місяць', 'ходи на шо хо, але вже більше разів', 3600)
on conflict (id) do update
set title = excluded.title, sessions = excluded.sessions,
    description = excluded.description, price_uah = excluded.price_uah;

update subscriptions set sessions_count = 12, days_valid = 30 where id = 'sub-12';

delete from subscriptions where id = 'sub-unlim';

-- ---------------------------------------------------------------- STEP 4
-- Cancelling inside 24 hours frees the seat but burns the pass session.
-- Clearing user_subscription_id first stops trg_release_club_seat from
-- refunding it, so the rule lives in one place.
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
  v_burned boolean := false;
begin
  select r.club_id, r.user_subscription_id, c.date, c.start_time
  into v_club_id, v_pass_id, v_date, v_start
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

  if v_pass_id is not null and v_club_start - now() < interval '24 hours' then
    update registrations set user_subscription_id = null where id = p_registration_id;
    v_burned := true;
  end if;

  delete from registrations where id = p_registration_id;

  return jsonb_build_object('club_id', v_club_id, 'session_burned', v_burned);
end;
$$;

revoke all on function cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function cancel_booking(uuid, text) to service_role;
