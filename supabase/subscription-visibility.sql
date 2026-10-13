-- MySchool — show or hide a subscription plan.
--
-- A plan can now be taken off the shelf without deleting it: flip one
-- checkbox in the Supabase table editor and it disappears from the app.
-- Deleting would be the wrong tool — the row is what the purchase receipts
-- point at, and the money check reads it.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- AFTER this file: redeploy admin-write and push the website.

-- ---------------------------------------------------------------- STEP 1
-- Everything already on sale stays on sale.
alter table subscriptions add column if not exists is_visible boolean not null default true;

comment on column subscriptions.is_visible is
  'Знято галочку — абонемент зникає з додатка і його не можна купити. Рядок лишається, бо на нього посилаються куплені абонементи.';

-- ---------------------------------------------------------------- STEP 2
-- Hiding has to mean "not for sale", not just "not on the list". Someone
-- with the sheet already open would otherwise still be able to buy it, and
-- so would anyone calling the API directly.
create or replace function reserve_subscription(
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
  v_price int;
  v_visible boolean;
  v_reg_id uuid;
begin
  select title, sessions_count, price_uah, is_visible
  into v_title, v_count, v_price, v_visible
  from subscriptions where id = p_subscription_id;
  if not found or not v_visible then
    raise exception 'subscription_not_found';
  end if;

  if exists (
    select 1 from user_subscriptions
    where telegram_user_id = p_user_id
      and expires_at > now()
      and (sessions_total is null or sessions_used < sessions_total)
  ) then
    raise exception 'already_has_pass';
  end if;

  -- A purchase already waiting on an invoice is not "already bought".
  if exists (
    select 1 from registrations
    where type = 'subscription' and telegram_user_id = p_user_id
      and payment_state = 'pending'
  ) then
    raise exception 'payment_pending';
  end if;

  insert into registrations (
    type, subscription_id, telegram_user_id, telegram_first_name, telegram_username,
    paid_with, price_paid_uah, payment_state
  ) values (
    'subscription', p_subscription_id, p_user_id, p_first_name, p_username,
    'card', v_price, 'pending'
  )
  returning id into v_reg_id;

  return jsonb_build_object(
    'registration_id', v_reg_id,
    'needs_payment', true,
    'title', v_title,
    'sessions_total', v_count,
    'price_uah', v_price,
    'amount_kop', v_price * 100
  );
end;
$$;

revoke all on function reserve_subscription(text, text, text, text) from public, anon, authenticated;
grant execute on function reserve_subscription(text, text, text, text) to service_role;

-- --------------------------------------------------------------- VERIFY
select id, title, price_uah, is_visible from subscriptions order by price_uah;
