-- Security hardening. Safe to re-run. No bot token needed.
-- Nothing here sends Telegram messages.

-- ================================================================ FIX 1
-- CRITICAL. Postgres grants EXECUTE on new functions to PUBLIC by default,
-- and PostgREST exposes every public-schema function as an RPC endpoint.
-- Combined with SECURITY DEFINER, that meant anyone holding the anon key
-- — which is published in the website's JavaScript, by design — could call
--
--   POST /rest/v1/rpc/send_telegram_message {"chat_id":"...","msg":"..."}
--
-- and send any message to any chat from the school's bot. That's a spam /
-- phishing vector and a good way to get the bot banned by Telegram.
--
-- These functions only ever need to be called by pg_cron and by triggers,
-- both of which run as the owner — not through the API. So revoking API
-- access breaks nothing.
revoke all on function send_telegram_message(text, text) from public, anon, authenticated;
revoke all on function check_reminders() from public, anon, authenticated;
revoke all on function notify_admin_on_registration() from public, anon, authenticated;
revoke all on function increment_club_taken() from public, anon, authenticated;

-- ================================================================ FIX 2
-- Capacity was never enforced in the database: the counter trigger
-- incremented unconditionally, so a club could be booked past its seat
-- limit — either by a race between two people booking the last seat, or by
-- anyone calling the API directly and ignoring the UI's "Немає місць".
--
-- SELECT ... FOR UPDATE locks the club row so two simultaneous bookings
-- can't both pass the check.
create or replace function increment_club_taken() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.type = 'club' and new.club_id is not null then
    select taken, seats into c from clubs where id = new.club_id for update;

    if c is null then
      raise exception 'club_not_found';
    end if;

    if c.taken >= c.seats then
      raise exception 'club_full';
    end if;

    update clubs set taken = taken + 1 where id = new.club_id;
  end if;
  return new;
end;
$$;

revoke all on function increment_club_taken() from public, anon, authenticated;

-- ================================================================ FIX 3
-- Tidy: the admin list picked up a trailing newline when it was edited.
-- Everything that reads it trims, so this was harmless — but a clean value
-- is easier to reason about.
update app_config
set value = regexp_replace(value, '\s', '', 'g')
where key = 'admin_telegram_ids';

-- ================================================================ VERIFY
-- Should show the cleaned admin list and no whitespace:
select value, length(value) from app_config where key = 'admin_telegram_ids';
