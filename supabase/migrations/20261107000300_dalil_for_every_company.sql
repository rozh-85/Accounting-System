-- =============================================================================
-- Vio Accounting — the dalil for every company, and no more demo data
-- The demo switch is gone: demo companies are deleted with everything in them,
-- and the demo functions and flag are dropped. New companies now start on the
-- 731-account Kurdistan chart (دلیل الحسابات) with its Arabic and English names,
-- in place of the short standard chart.
--
-- To clear the books of an existing company and move it to the dalil, run
-- supabase/scripts/clear_books_keep_dalil.sql once after this file.
-- =============================================================================

-- Deletes every entry, voucher, recurring template, attachment, audit row,
-- document number and account of a company, and with p_remove_company the
-- company itself. Not callable through the API; only migrations and the SQL
-- Editor use it.
create or replace function public._clear_company_books(p_company_id uuid, p_remove_company boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_table text;
  v_tables text[] := array['journal_entry_lines', 'journal_entries', 'voucher_lines', 'vouchers', 'accounts',
                           'fiscal_years', 'user_roles', 'audit_logs'];
begin
  -- Uploaded files. Some storage versions refuse direct deletes; the private
  -- files are then left unreachable rather than blocking the clear.
  begin
    delete from storage.objects o
     where o.bucket_id = 'attachments' and (storage.foldername(o.name))[1] = p_company_id::text;
  exception when others then
    null;
  end;

  -- The immutability guards stay switched off only inside this transaction. The
  -- table lock makes other writers wait until they are back on.
  foreach v_table in array v_tables loop
    execute format('alter table public.%I disable trigger user', v_table);
  end loop;

  delete from public.attachments a where a.company_id = p_company_id;
  delete from public.journal_entry_lines l where l.company_id = p_company_id;
  update public.vouchers v set journal_entry_id = null where v.company_id = p_company_id;
  delete from public.journal_entries e where e.company_id = p_company_id;
  delete from public.voucher_lines l where l.company_id = p_company_id;
  delete from public.vouchers v where v.company_id = p_company_id;
  delete from public.recurring_entry_templates t where t.company_id = p_company_id;
  delete from public.document_sequences s where s.company_id = p_company_id;
  update public.company_settings s set retained_earnings_account_id = null where s.company_id = p_company_id;
  update public.accounts a set parent_id = null where a.company_id = p_company_id;
  delete from public.accounts a where a.company_id = p_company_id;
  delete from public.audit_logs l where l.company_id = p_company_id;
  if p_remove_company then
    delete from public.companies c where c.id = p_company_id;
  end if;

  foreach v_table in array v_tables loop
    execute format('alter table public.%I enable trigger user', v_table);
  end loop;
end;
$$;

revoke execute on function public._clear_company_books(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Remove the demo
-- ---------------------------------------------------------------------------
select public._clear_company_books(c.id, true) from public.companies c where c.is_demo;

drop function public.create_demo_company();
drop function public.delete_demo_company(uuid);
drop function public._demo_entry(uuid, date, text, jsonb, text, text);
drop function public._demo_voucher(uuid, text, date, text, text, numeric, text, text, text);
drop index public.companies_one_demo_per_user_idx;
alter table public.companies drop column is_demo;

-- ---------------------------------------------------------------------------
-- The dalil becomes the chart every new company starts with
-- ---------------------------------------------------------------------------
drop function public._seed_demo_chart(uuid);
alter function public._seed_demo_chart_arabic(uuid) rename to _seed_dalil_chart;
alter function public._apply_demo_chart_english(uuid) rename to _apply_dalil_english_names;

-- create_company calls this when asked for a chart.
create or replace function public._seed_default_chart(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._seed_dalil_chart(p_company_id);
  perform public._apply_dalil_english_names(p_company_id);
end;
$$;

revoke execute on function public._seed_default_chart(uuid) from public, anon, authenticated;
revoke execute on function public._seed_dalil_chart(uuid) from public, anon, authenticated;
revoke execute on function public._apply_dalil_english_names(uuid) from public, anon, authenticated;
