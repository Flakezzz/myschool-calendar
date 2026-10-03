-- Fix: a person could buy any number of subscriptions, stacking passes
-- forever. Each purchase created another pass, so someone could tap
-- "Придбати" ten times and end up with ten of them (and be charged ten
-- times, once Monobank is real).
--
-- Rule: one active pass at a time. "Active" means not expired AND still
-- has sessions left — exactly the condition book_club() uses to pick a
-- pass to spend, so you can always buy again the moment your current one
-- runs out or expires.
--
-- Run this in the SQL Editor. Safe to re-run. No bot token needed.
-- Nothing here sends Telegram messages.

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

  -- One active pass at a time. Matches book_club()'s "usable pass" test.
  if exists (
    select 1 from user_subscriptions
    where telegram_user_id = p_user_id
      and expires_at > now()
      and (sessions_total is null or sessions_used < sessions_total)
  ) then
    raise exception 'already_has_pass';
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

-- -------------------------------------------------------------- OPTIONAL
-- The test accounts are holding 9 passes left over from earlier testing,
-- so with the new rule they can't buy anything until those are used up or
-- expire — which makes the purchase flow impossible to demo.
--
-- Uncomment these two lines to clear the old test purchases and start
-- clean. They only touch rows created before today.
--
-- delete from user_subscriptions where purchased_at < current_date;
-- delete from registrations where type = 'subscription' and created_at < current_date;

-- --------------------------------------------------------------- VERIFY
-- How many active passes each person holds. After the cleanup above this
-- should be empty; without it, nobody should ever go above 1 from now on.
select telegram_user_id, count(*) as active_passes
from user_subscriptions
where expires_at > now()
  and (sessions_total is null or sessions_used < sessions_total)
group by telegram_user_id
order by active_passes desc;
