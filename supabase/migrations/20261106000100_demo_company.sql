-- =============================================================================
-- Vio Accounting — demo company
-- A switchable sandbox for learning the system. Sample data never goes into a
-- real company: it lives in its own company flagged is_demo, and switching the
-- demo off removes that company completely.
--
-- The accounting rules still apply to demo data, because it is created through
-- the normal save, post and reverse functions. delete_demo_company is the only
-- way posted entries can ever be removed, and it refuses any company that is
-- not flagged is_demo. Users cannot set the flag: companies only allows updates
-- to its descriptive columns through the API.
-- =============================================================================

alter table public.companies add column is_demo boolean not null default false;

create unique index companies_one_demo_per_user_idx on public.companies (created_by) where is_demo;

-- Saves one sample entry (skipped if dated in the future) and applies an action.
create or replace function public._demo_entry(
  p_company_id uuid,
  p_date date,
  p_description text,
  p_lines jsonb,
  p_action text default 'post',
  p_type text default 'standard'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lines jsonb;
begin
  if p_date > current_date then
    return null;
  end if;
  -- Lines arrive as [{code, debit, credit}]; the workflow functions take account ids.
  select jsonb_agg(jsonb_build_object('account_id', a.id, 'debit_amount', (l ->> 'debit')::numeric, 'credit_amount', (l ->> 'credit')::numeric))
    into v_lines
    from jsonb_array_elements(p_lines) l
    join public.accounts a on a.company_id = p_company_id and a.code = l ->> 'code';

  v_id := public.save_journal_entry(p_company_id, null,
    jsonb_build_object('entry_date', p_date, 'description', p_description, 'entry_type', p_type), v_lines);
  if p_action = 'post' then
    perform public.post_journal_entry(v_id);
  elsif p_action = 'submit' then
    perform public.submit_journal_entry(v_id);
  end if;
  return v_id;
end;
$$;

-- Saves one sample voucher (skipped if dated in the future) and applies an action.
create or replace function public._demo_voucher(
  p_company_id uuid,
  p_type text,
  p_date date,
  p_party text,
  p_description text,
  p_amount numeric,
  p_first_code text,
  p_second_code text,
  p_action text default 'post'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_first uuid;
  v_second uuid;
begin
  if p_date > current_date then
    return null;
  end if;
  select a.id into v_first from public.accounts a where a.company_id = p_company_id and a.code = p_first_code;
  select a.id into v_second from public.accounts a where a.company_id = p_company_id and a.code = p_second_code;

  v_id := public.save_voucher(p_company_id, null,
    jsonb_build_object('voucher_type', p_type, 'voucher_date', p_date, 'party_name', p_party, 'description', p_description, 'amount', p_amount)
    || case when p_type = 'transfer'
         then jsonb_build_object('from_account_id', v_first, 'to_account_id', v_second)
         else jsonb_build_object('cash_account_id', v_first, 'counter_account_id', v_second) end,
    '[]'::jsonb);
  if p_action = 'post' then
    perform public.post_voucher(v_id);
  elsif p_action = 'submit' then
    perform public.submit_voucher(v_id);
  end if;
  return v_id;
end;
$$;

-- Creates the caller's demo company with a year-to-date set of realistic
-- transactions, or returns the one they already have.
create or replace function public.create_demo_company()
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_year_start date := date_trunc('year', current_date)::date;
  v_year int := extract(year from current_date)::int;
  v_month int;
  v_scale numeric;
  v_id uuid;
  v_customers text[] := array['Al-Noor Trading', 'Baghdad Home Store', 'Erbil Furnishings', 'Sulaymaniyah Living'];
  v_suppliers text[] := array['Kurdistan Ceramics', 'Tigris Textiles', 'Zagros Wholesale'];
  v_customer text;
  v_supplier text;

begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select c.id into v_company
    from public.companies c
   where c.is_demo and c.created_by = auth.uid();
  if found then
    return v_company;
  end if;

  v_company := public.create_company('Vio Demo Company', 'شركة فيو التجريبية', 'IQD', v_year_start, true);
  update public.companies c set is_demo = true where c.id = v_company;

  -- Opening balances and financing.
  perform public._demo_entry(v_company, v_year_start, 'Opening balances',
    '[{"code":"1120","debit":150000000,"credit":0},{"code":"1140","debit":40000000,"credit":0},
      {"code":"1220","debit":35000000,"credit":0},{"code":"3100","debit":0,"credit":225000000}]'::jsonb,
    'post', 'opening');
  perform public._demo_entry(v_company, make_date(v_year, 2, 3), 'Long-term loan received from the bank',
    '[{"code":"1120","debit":50000000,"credit":0},{"code":"2210","debit":0,"credit":50000000}]'::jsonb);
  perform public._demo_entry(v_company, make_date(v_year, 3, 4), 'Showroom furniture bought with a bank transfer',
    '[{"code":"1230","debit":6000000,"credit":0},{"code":"1120","debit":0,"credit":6000000}]'::jsonb);

  for v_month in 1 .. extract(month from current_date)::int loop
    -- Sales and purchases move a little from month to month.
    v_scale := (100 + (v_month * 37) % 30) / 100.0;
    v_customer := v_customers[1 + v_month % array_length(v_customers, 1)];
    v_supplier := v_suppliers[1 + v_month % array_length(v_suppliers, 1)];

    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 2), 'City Rentals', 'Showroom rent', 3000000, '1110', '5300');
    perform public._demo_entry(v_company, make_date(v_year, v_month, 5), 'Goods purchased on credit from ' || v_supplier,
      jsonb_build_array(jsonb_build_object('code', '5100', 'debit', round(18000000 * v_scale, -3), 'credit', 0),
                        jsonb_build_object('code', '2110', 'debit', 0, 'credit', round(18000000 * v_scale, -3))));
    perform public._demo_entry(v_company, make_date(v_year, v_month, 10), 'Credit sales to ' || v_customer,
      jsonb_build_array(jsonb_build_object('code', '1130', 'debit', round(32000000 * v_scale, -3), 'credit', 0),
                        jsonb_build_object('code', '4100', 'debit', 0, 'credit', round(32000000 * v_scale, -3))));
    perform public._demo_entry(v_company, make_date(v_year, v_month, 12), 'Cash sales at the showroom',
      jsonb_build_array(jsonb_build_object('code', '1110', 'debit', round(14000000 * v_scale, -3), 'credit', 0),
                        jsonb_build_object('code', '4100', 'debit', 0, 'credit', round(14000000 * v_scale, -3))));
    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 15), 'Electricity Directorate', 'Electricity and water', round(900000 * v_scale, -3), '1110', '5400');
    perform public._demo_voucher(v_company, 'receipt', make_date(v_year, v_month, 18), v_customer, 'Collection on account', round(24000000 * v_scale, -3), '1120', '1130');
    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 20), v_supplier, 'Payment to supplier', round(13000000 * v_scale, -3), '1120', '2110');
    perform public._demo_voucher(v_company, 'transfer', make_date(v_year, v_month, 22), null, 'Showroom cash deposited at the bank', round(8000000 * v_scale, -3), '1110', '1120');
    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 25), 'Staff payroll', 'Monthly salaries', 9500000, '1120', '5200');
    if v_month % 3 = 0 then
      perform public._demo_entry(v_company, make_date(v_year, v_month, 28), 'Quarterly depreciation of equipment and furniture',
        '[{"code":"5500","debit":1200000,"credit":0},{"code":"1290","debit":0,"credit":1200000}]'::jsonb, 'post', 'adjusting');
    end if;
  end loop;

  -- One corrected mistake of each kind, to show how reversal works.
  v_id := public._demo_entry(v_company, v_year_start + 8, 'Office supplies recorded in error',
    '[{"code":"5600","debit":750000,"credit":0},{"code":"1110","debit":0,"credit":750000}]'::jsonb);
  if v_id is not null then
    perform public.reverse_journal_entry(v_id, v_year_start + 9, 'Recorded in error');
  end if;
  v_id := public._demo_voucher(v_company, 'receipt', v_year_start + 7, 'Al-Noor Trading', 'Duplicate receipt', 2500000, '1110', '1130');
  if v_id is not null then
    perform public.reverse_voucher(v_id, v_year_start + 9, 'Duplicate receipt');
  end if;

  -- Work still in progress, so the approval queue and drafts are not empty.
  perform public._demo_entry(v_company, current_date, 'Credit sale awaiting approval',
    '[{"code":"1130","debit":4200000,"credit":0},{"code":"4100","debit":0,"credit":4200000}]'::jsonb, 'submit');
  perform public._demo_entry(v_company, current_date, 'Maintenance invoice, still a draft',
    '[{"code":"5700","debit":650000,"credit":0},{"code":"1110","debit":0,"credit":650000}]'::jsonb, 'draft');
  perform public._demo_voucher(v_company, 'payment', current_date, 'Zagros Wholesale', 'Supplier payment awaiting approval', 3100000, '1120', '2110', 'submit');
  perform public._demo_voucher(v_company, 'receipt', current_date, 'Erbil Furnishings', 'Receipt, still a draft', 1800000, '1110', '1130', 'draft');

  perform public.save_recurring_template(v_company, null,
    jsonb_build_object('name', 'Monthly insurance', 'description', 'Monthly insurance premium', 'frequency', 'monthly', 'start_date', current_date),
    (select jsonb_agg(jsonb_build_object('account_id', a.id,
                                         'debit_amount', case when a.code = '5900' then 400000 else 0 end,
                                         'credit_amount', case when a.code = '1120' then 400000 else 0 end))
       from public.accounts a
      where a.company_id = v_company and a.code in ('5900', '1120')));

  return v_company;
end;
$$;

-- Permanently removes a demo company and everything in it. Refuses any company
-- that is not flagged is_demo.
create or replace function public.delete_demo_company(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_is_demo boolean;
  v_table text;
  v_tables text[] := array['journal_entry_lines', 'journal_entries', 'voucher_lines', 'vouchers', 'accounts',
                           'fiscal_years', 'user_roles', 'audit_logs'];
begin
  perform public._require_permission(p_company_id, 'settings.manage');

  select c.is_demo into v_is_demo from public.companies c where c.id = p_company_id for update;
  if not coalesce(v_is_demo, false) then
    perform public._raise('NOT_A_DEMO_COMPANY');
  end if;

  -- Uploaded files. Some storage versions refuse direct deletes; the private
  -- files are then left unreachable rather than blocking the removal.
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
  update public.company_settings s set retained_earnings_account_id = null where s.company_id = p_company_id;
  update public.accounts a set parent_id = null where a.company_id = p_company_id;
  delete from public.accounts a where a.company_id = p_company_id;
  delete from public.companies c where c.id = p_company_id;

  foreach v_table in array v_tables loop
    execute format('alter table public.%I enable trigger user', v_table);
  end loop;
end;
$$;

revoke execute on function public._demo_entry(uuid, date, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public._demo_voucher(uuid, text, date, text, text, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_demo_company() from public, anon;
revoke execute on function public.delete_demo_company(uuid) from public, anon;
grant execute on function public.create_demo_company() to authenticated;
grant execute on function public.delete_demo_company(uuid) to authenticated;
