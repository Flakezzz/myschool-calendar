-- MySchool — fifth money audit, 2026-10-13.
--
-- One hole: a refund that failed on an orphan payment was never tried
-- again and never reported.
--
-- When money lands after the seat has already been given away, the webhook
-- and the reconciler both refund it. If that refund call fails, the claim
-- is released so it can be retried — but nothing ever retries it. The
-- reconciler skips the payment, because Monobank says "success" and so do
-- we, and the statuses matching is its signal that there is nothing to do.
--
-- The money-check does list it (CHECK 2, money with no booking), so it is
-- not invisible — but it sits there until a person notices.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- AFTER this file: redeploy admin-write.

drop function if exists payments_to_reconcile(int);

create or replace function payments_to_reconcile(p_limit int default 50)
returns table (
  invoice_id text,
  our_status text,
  refund_claimed boolean,
  -- Money we are holding with nothing to show for it. Matching statuses
  -- would otherwise make the reconciler walk straight past it.
  no_booking boolean
)
language sql
security definer
set search_path = public
as $$
  select p.invoice_id,
         p.status,
         p.refunded_at is not null,
         p.registration_id is null
           or not exists (select 1 from registrations r where r.id = p.registration_id)
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

-- --------------------------------------------------------------- VERIFY
-- Money held with nothing behind it. Anything listed here is what the
-- reconciler will now try to give back.
select invoice_id, our_status, refund_claimed, no_booking
from payments_to_reconcile(200)
where no_booking and our_status in ('success', 'hold') and not refund_claimed;
