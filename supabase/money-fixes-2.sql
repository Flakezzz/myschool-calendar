-- MySchool — second money audit, 2026-10-11.
--
-- The first round closed the holes that were visible from the outside. This
-- round came from attacking the fixes themselves: each item below was
-- reproduced in a throwaway Postgres first.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- AFTER this file: redeploy the admin-write Edge Function.

-- ---------------------------------------------------------------- STEP 1
-- CRITICAL: money kept, silently, forever.
--
-- Reconciliation only ever asked Monobank about payments we thought were
-- open or paid. A payment the sweep had written off as 'expired' was never
-- asked about again — and that is exactly the case where the money may be
-- ours: the person paid inside the 15 minutes, the webhook was lost, the
-- sweep gave the seat away and marked the invoice expired. Nobody was told,
-- nothing looked again, and the money stayed.
--
-- Proven in the replica: an expired payment was offered for reconciliation
-- zero times and produced zero admin warnings.
--
-- Written-off payments are now offered too, and `refund_claimed` is
-- reported so the caller can also catch STEP 2 below.
drop function if exists payments_to_reconcile(int);

create or replace function payments_to_reconcile(p_limit int default 50)
returns table (invoice_id text, our_status text, refund_claimed boolean)
language sql
security definer
set search_path = public
as $$
  select p.invoice_id, p.status, p.refunded_at is not null
  from payments p
  where
    -- Should have settled by now but never did.
    (p.status in ('created', 'processing') and p.created_at < now() - interval '20 minutes')
    -- We believe the money is ours; worth confirming it still is, and that
    -- a refund we promised actually went out.
    or (p.status in ('success', 'hold') and p.updated_at > now() - interval '30 days')
    -- We wrote it off. If Monobank took the money anyway, this is the only
    -- thing that will ever find out.
    or (p.status in ('expired', 'failure') and p.updated_at > now() - interval '14 days')
  order by p.updated_at desc
  limit p_limit;
$$;

revoke all on function payments_to_reconcile(int) from public, anon, authenticated;
grant execute on function payments_to_reconcile(int) to service_role;

-- ---------------------------------------------------------------- STEP 2
-- SERIOUS: a refund that was promised and never sent.
--
-- Cancelling claims the refund on the payment row before calling Monobank,
-- so a double click cannot pay twice. If the call then never happens — the
-- function times out, the container dies — the row still says "refunded"
-- while the money is sitting with us. Nothing noticed: the money-check
-- skips refunded rows by design, and reconciliation saw Monobank say
-- 'success', the same as us, and moved on.
--
-- The Edge Function now compares the claim with Monobank and retries. This
-- is the counterpart it needs: release the claim so the retry is allowed.
-- (mark_refund_failed already does exactly that, so this is only a comment
-- pointing at where the fix lives — in the function, not the schema.)

-- ---------------------------------------------------------------- STEP 3
-- You could book, and be charged for, a class that had already happened.
-- reserve_club checked seats, duplicates and passes, but never the clock.
-- Cancelling checked it; booking did not. Proven: a club dated a week ago
-- took a 300 грн reservation.
create or replace function reserve_club(
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
  v_title text;
  v_date date;
  v_start time;
  v_sub_id uuid;
  v_sub_total int;
  v_sub_used int;
  v_used_sub boolean := false;
  v_reg_id uuid;
begin
  -- FOR UPDATE serialises concurrent bookings of the same club.
  select seats, taken, price_uah, title, date, start_time
  into v_seats, v_taken, v_price, v_title, v_date, v_start
  from clubs where id = p_club_id for update;
  if not found then
    raise exception 'club_not_found';
  end if;

  -- A class in the past cannot be attended, so it must not be sold.
  if (v_date::text || ' ' || v_start::text)::timestamp at time zone 'Europe/Kyiv' <= now() then
    raise exception 'club_already_started';
  end if;

  -- An unpaid reservation is not a booking, and saying "already booked"
  -- about one is misleading: the person is mid-payment, not done.
  if exists (
    select 1 from registrations
    where type = 'club' and club_id = p_club_id and telegram_user_id = p_user_id
      and payment_state = 'pending'
  ) then
    raise exception 'payment_pending';
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
    paid_with, price_paid_uah, user_subscription_id, payment_state
  ) values (
    'club', p_club_id, p_user_id, p_first_name, p_username,
    case when v_used_sub then 'subscription' else 'card' end,
    case when v_used_sub then 0 else v_price end,
    case when v_used_sub then v_sub_id else null end,
    case when v_used_sub then 'confirmed' else 'pending' end
  )
  returning id into v_reg_id;

  return jsonb_build_object(
    'registration_id', v_reg_id,
    'needs_payment', not v_used_sub,
    'paid_with', case when v_used_sub then 'subscription' else 'card' end,
    'price_paid_uah', case when v_used_sub then 0 else v_price end,
    'amount_kop', case when v_used_sub then 0 else v_price * 100 end,
    'club_title', v_title,
    'sessions_left', case
      when v_used_sub and v_sub_total is not null then v_sub_total - v_sub_used - 1
      else null
    end
  );
end;
$$;

revoke all on function reserve_club(text, text, text, text) from public, anon, authenticated;
grant execute on function reserve_club(text, text, text, text) to service_role;

-- ---------------------------------------------------------------- STEP 4
-- Tidy, but the kind of tidy that bites: two versions of record_payment
-- existed side by side, the old six-argument one and the seven-argument one
-- that remembers the payment page. PostgREST cannot choose between
-- overloads and answers PGRST203 when a call matches both — which is what a
-- probe with six arguments got. The old one has no callers left.
drop function if exists record_payment(text, uuid, text, text, int, text);

-- --------------------------------------------------------------- VERIFY
-- One version of record_payment, and reconciliation now looks at write-offs.
select count(*) as record_payment_versions from pg_proc where proname = 'record_payment';
select count(*) as written_off_now_reconciled
from payments_to_reconcile(500) where our_status in ('expired', 'failure');
