-- Stops publishing the admins' Telegram ids to anyone who looks.
--
-- app_config had a public SELECT policy so the web app could read the
-- admin list with the anon key and decide whether to draw the admin
-- button. But the anon key ships inside the website's JavaScript, so that
-- made the list readable by anybody:
--
--   GET /rest/v1/app_config  ->  {"value":"526386894, 777037876"}
--
-- Those are real personal Telegram ids. It was never an authorization
-- bypass — admin writes are verified server-side — but it handed anyone a
-- precise list of which two accounts to target for phishing.
--
-- The app now asks the Edge Function "am I an admin?" instead, which
-- answers only about the caller and never returns the list.
--
-- RUN THIS LAST, after the updated Edge Function AND the updated website
-- are both deployed. Run it earlier and the admin button disappears until
-- they are.
--
-- Safe to re-run. Nothing here sends Telegram messages.

drop policy if exists "public read admin ids" on app_config;

-- The value picked up a space when the admin list was last edited. Every
-- reader trims, so this was harmless — but a clean value is easier to
-- reason about.
update app_config
set value = regexp_replace(value, '\s', '', 'g')
where key = 'admin_telegram_ids';

-- ================================================================ VERIFY
-- 1. No policy on app_config at all now:
select count(*) as app_config_policies
from pg_policies
where schemaname = 'public' and tablename = 'app_config';

-- 2. The admin list is intact and whitespace-free:
select value, length(value) from app_config where key = 'admin_telegram_ids';
