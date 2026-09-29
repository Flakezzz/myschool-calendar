-- MySchool calendar: initial schema, RLS policies, and seed data.
-- Run this once in the Supabase SQL Editor on a fresh project.

create table if not exists clubs (
  id text primary key,
  title text not null,
  description text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  teacher text not null,
  level text not null,
  seats int not null,
  taken int not null default 0,
  price_uah int not null,
  color text not null
);

create table if not exists subscriptions (
  id text primary key,
  title text not null,
  sessions text not null,
  description text not null,
  price_uah int not null
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('club', 'subscription')),
  club_id text references clubs(id),
  subscription_id text references subscriptions(id),
  telegram_user_id text not null,
  created_at timestamptz not null default now(),
  reminder_day boolean not null default false,
  reminder_h3 boolean not null default false,
  reminder_h1 boolean not null default false
);

-- Keep clubs.taken accurate automatically, regardless of which client inserts.
create or replace function increment_club_taken() returns trigger as $$
begin
  if new.type = 'club' and new.club_id is not null then
    update clubs set taken = taken + 1 where id = new.club_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_increment_club_taken on registrations;
create trigger trg_increment_club_taken
  after insert on registrations
  for each row execute function increment_club_taken();

alter table clubs enable row level security;
alter table subscriptions enable row level security;
alter table registrations enable row level security;

-- Anyone (the public web app, using the anon key) can read the catalog.
create policy "public read clubs" on clubs for select using (true);
create policy "public read subscriptions" on subscriptions for select using (true);

-- Anyone can create a registration (simulated instant payment for this MVP
-- stage), but nobody using the anon key can read, update, or delete
-- registrations — that data (Telegram user IDs, reminder state) is only
-- readable by the server via the service_role key.
create policy "public insert registrations" on registrations for insert with check (true);

-- clubs/subscriptions have no public insert/update/delete policy, so only
-- the server (service_role, bypasses RLS) can write to them — used by the
-- future admin panel.

insert into clubs (id, title, description, date, start_time, end_time, teacher, level, seats, taken, price_uah, color) values
  ('1', 'Drama Club', 'Рольові ігри, діалоги та міні-вистави англійською.', '2026-09-25', '16:00', '17:30', 'Ms. Anna', 'A2–B1', 12, 8, 350, '#E85D4C'),
  ('2', 'Movie Talk', 'Короткі сцени з фільмів, словник і обговорення.', '2026-09-25', '18:00', '19:00', 'Mr. James', 'B1+', 10, 10, 300, '#3BA99C'),
  ('3', 'Kids Speaking', 'Ігри та speaking для дітей 7–10 років.', '2026-09-27', '11:00', '12:00', 'Ms. Oksana', 'Kids', 8, 3, 280, '#E8B86D'),
  ('4', 'Exam Boost', 'Speaking для підготовки до іспитів.', '2026-09-30', '17:00', '18:30', 'Ms. Anna', 'B2', 6, 2, 450, '#1B4D6E')
on conflict (id) do nothing;

insert into subscriptions (id, title, sessions, description, price_uah) values
  ('sub-4', '4 клаби', '4 відвідування / 30 днів', 'Підходить, якщо ходите на клаби раз на тиждень.', 1200),
  ('sub-8', '8 клабів', '8 відвідувань / 30 днів', 'Оптимальний варіант для двох клабів на тиждень.', 2200),
  ('sub-unlim', 'Безліміт', 'Необмежено / 30 днів', 'Відвідуйте будь-яку кількість клабів без обмежень.', 3500)
on conflict (id) do nothing;
