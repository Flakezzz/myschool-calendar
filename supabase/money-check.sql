-- MySchool — money health check. READ ONLY: changes nothing, ever.
--
-- Run the whole file in the Supabase SQL Editor whenever you want to know
-- that the money is right. Every section is named, and a section with zero
-- rows is a section with nothing wrong.
--
-- What this file cannot see: whether a refund Monobank accepted actually
-- landed. Only Monobank knows that — that is what the admin panel's
-- reconcile action asks about.

-- ============================================================== CHECK 1
-- Somebody is attending without paying.
-- A confirmed card booking must have money behind it that was not returned.
select 'CHECK 1: booking with no money' as check,
       r.id as registration_id, r.type, r.club_id, r.subscription_id,
       r.telegram_user_id, r.price_paid_uah, r.created_at
from registrations r
where r.paid_with = 'card'
  and r.payment_state = 'confirmed'
  and not exists (
    select 1 from payments p
    where p.registration_id = r.id
      and p.status in ('success', 'hold')
      and p.refunded_at is null
  )
order by r.created_at desc;

-- ============================================================== CHECK 2
-- We are holding money for nothing.
-- Every payment we treat as ours must still have something it paid for.
-- A deleted club or plan also lands here, which is exactly right: that is
-- money that needs a decision.
select 'CHECK 2: money with no booking' as check,
       p.invoice_id, p.amount_kop / 100 as uah, p.telegram_user_id,
       p.status, p.created_at
from payments p
where p.status in ('success', 'hold')
  and p.refunded_at is null
  and (p.registration_id is null or not exists (
    select 1 from registrations r where r.id = p.registration_id
  ))
order by p.created_at desc;

-- ============================================================== CHECK 3
-- A payment that never settled.
-- The sweep marks these 'expired' within 20 minutes, so anything older and
-- still open means the sweep is not running.
select 'CHECK 3: stuck payment' as check,
       p.invoice_id, p.status, p.amount_kop / 100 as uah,
       round(extract(epoch from (now() - p.created_at)) / 60) as age_minutes
from payments p
where p.status in ('created', 'processing')
  and p.created_at < now() - interval '25 minutes'
order by p.created_at;

-- ============================================================== CHECK 4
-- A paid pass purchase that handed out no pass.
-- This is the failure that took 1200 грн and gave nothing back; it cannot
-- happen after money-fixes.sql, and this proves it stays fixed.
select 'CHECK 4: paid for a pass, got none' as check,
       r.id as registration_id, r.telegram_user_id, r.subscription_id,
       r.price_paid_uah, r.created_at
from registrations r
where r.type = 'subscription'
  and r.payment_state = 'confirmed'
  and r.activated_pass_id is null
order by r.created_at desc;

-- ============================================================== CHECK 5
-- A seat counter that drifted away from the real bookings. Harmless to the
-- money, but it either hides seats or sells ones that do not exist.
-- Note: test clubs seeded with a fake `taken` show up here by design.
select 'CHECK 5: seat counter drift' as check,
       c.id, c.title, c.date, c.taken as counter,
       (select count(*) from registrations r
        where r.club_id = c.id and r.type = 'club') as real_bookings
from clubs c
where c.taken <> (select count(*) from registrations r
                  where r.club_id = c.id and r.type = 'club')
order by c.date;

-- ============================================================== CHECK 6
-- Somebody holding more than one usable pass. One is the rule.
select 'CHECK 6: stacked passes' as check,
       telegram_user_id, count(*) as usable_passes
from user_subscriptions
where expires_at > now()
  and (sessions_total is null or sessions_used < sessions_total)
group by telegram_user_id
having count(*) > 1;

-- ============================================================== CHECK 7
-- A pass that spent more sessions than it had.
select 'CHECK 7: pass overspent' as check,
       id, telegram_user_id, title, sessions_used, sessions_total
from user_subscriptions
where sessions_total is not null and sessions_used > sessions_total;

-- =============================================================== TOTALS
-- What the books say we took. Compare the first number with the Monobank
-- cabinet for the same period; they must match to the kopeck.
select 'TOTALS' as report,
       count(*) filter (where status in ('success', 'hold') and refunded_at is null) as kept_payments,
       coalesce(sum(amount_kop) filter (where status in ('success', 'hold') and refunded_at is null), 0) / 100 as kept_uah,
       count(*) filter (where refunded_at is not null) as refunds_started,
       coalesce(sum(amount_kop) filter (where refunded_at is not null), 0) / 100 as refunded_uah,
       count(*) filter (where status = 'expired') as never_paid,
       count(*) filter (where status in ('created', 'processing')) as in_flight
from payments;
