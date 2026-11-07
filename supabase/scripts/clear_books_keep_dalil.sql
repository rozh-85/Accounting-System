-- =============================================================================
-- Vio Accounting — clear all data and keep only the dalil
-- Run once in the Supabase SQL Editor, after
-- migrations/20261107000300_dalil_for_every_company.sql.
--
-- For EVERY company in the database this permanently deletes all journal
-- entries, vouchers, recurring templates, attachments, the audit log and the
-- document numbering, and replaces its chart of accounts with the 731-account
-- dalil. It cannot be undone.
--
-- Kept: the companies and their settings, users and roles, fiscal years and
-- periods.
-- =============================================================================

begin;

do $$
declare
  c record;
begin
  for c in select id from public.companies loop
    perform public._clear_company_books(c.id, false);
    perform public._seed_default_chart(c.id);
  end loop;
end;
$$;

commit;
