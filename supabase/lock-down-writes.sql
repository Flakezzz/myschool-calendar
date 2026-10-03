-- RUN THIS LAST, and only after all three of these are done:
--   1. bookings.sql has been run
--   2. the updated admin-write Edge Function has been deployed
--   3. the updated website has been deployed (GitHub Actions finished)
--
-- Why the order matters: this removes the anon key's permission to insert
-- registrations. The old website booked by inserting directly from the
-- browser; the new one goes through the Edge Function. Run this before the
-- new website is live and booking stops working until it is.
--
-- Safe to re-run.

-- ================================================================ WHY
-- `telegram_user_id` used to come straight from the browser, so anyone
-- could POST a registration claiming to be someone else's Telegram ID —
-- filling a club with fake bookings, or signing a stranger up so they'd
-- get the reminder messages. There was no way for the database to tell.
--
-- Now every booking goes through the Edge Function, which verifies
-- Telegram's signed initData before calling book_club(). The identity is
-- cryptographically proven rather than claimed, which is also what makes
-- the names in the admin's booking list trustworthy.
drop policy if exists "public insert registrations" on registrations;

-- ================================================================ VERIFY
-- Expect exactly three rows, all cmd = SELECT: "public read clubs",
-- "public read subscriptions" and "public read admin ids". Any
-- INSERT/UPDATE/DELETE policy listed here would be a way to write data
-- without going through the Edge Function.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
