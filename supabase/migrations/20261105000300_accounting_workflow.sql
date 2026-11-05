-- =============================================================================
-- Vio Accounting — trusted accounting workflow
-- Every state change of a journal entry or voucher happens inside one of these
-- SECURITY DEFINER functions. Each function runs in a single transaction, takes
-- row locks before changing state and re-validates every accounting rule, so
-- the rules cannot be bypassed through direct API requests.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public._next_document_number(p_company_id uuid, p_doc_type text, p_date date)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from p_date)::int;
  v_value bigint;
begin
  insert into public.document_sequences as s (company_id, doc_type, year, next_value)
  values (p_company_id, p_doc_type, v_year, 2)
  on conflict (company_id, doc_type, year)
  do update set next_value = s.next_value + 1
  returning s.next_value - 1 into v_value;

  return p_doc_type || '-' || v_year::text || '-' || lpad(v_value::text, 5, '0');
end;
$$;

create or replace function public._to_amount(p_value text, p_line int default null)
returns numeric
language plpgsql immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or btrim(p_value) = '' then
    return 0;
  end if;
  begin
    v := p_value::numeric;
  exception when others then
    perform public._raise('LINE_INVALID_AMOUNT', coalesce(p_line::text, p_value));
  end;
  return v;
end;
$$;

create or replace function public._company_currency(p_company_id uuid, out o_code char(3), out o_decimals smallint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  select c.base_currency, cur.decimals into o_code, o_decimals
    from public.companies c
    join public.currencies cur on cur.code = c.base_currency
   where c.id = p_company_id;
  if not found then
    perform public._raise('COMPANY_NOT_FOUND');
  end if;
end;
$$;

create or replace function public._check_amount(p_amount numeric, p_decimals smallint, p_line int default null)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount < 0 then
    perform public._raise('LINE_INVALID_AMOUNT', coalesce(p_line::text, ''));
  end if;
  if round(p_amount, p_decimals) <> p_amount then
    perform public._raise('AMOUNT_PRECISION', coalesce(p_line::text, p_amount::text));
  end if;
  if p_amount >= 1e15 then
    perform public._raise('LINE_INVALID_AMOUNT', coalesce(p_line::text, ''));
  end if;
end;
$$;

create or replace function public._assert_postable_account(p_company_id uuid, p_account_id uuid, p_line int default null)
returns public.accounts
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.accounts%rowtype;
begin
  if p_account_id is null then
    perform public._raise('LINE_ACCOUNT_REQUIRED', coalesce(p_line::text, ''));
  end if;
  select * into v from public.accounts a where a.id = p_account_id and a.company_id = p_company_id;
  if not found then
    perform public._raise('ACCOUNT_NOT_FOUND', coalesce(p_line::text, ''));
  end if;
  if not v.is_posting then
    perform public._raise('ACCOUNT_NOT_POSTABLE', v.code);
  end if;
  if not v.is_active then
    perform public._raise('ACCOUNT_INACTIVE', v.code);
  end if;
  return v;
end;
$$;

-- Returns the open accounting period that contains p_date.
create or replace function public._open_period_for(p_company_id uuid, p_date date)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_period_status public.period_status;
  v_year_status public.period_status;
begin
  select p.id, p.status, fy.status
    into v_period_id, v_period_status, v_year_status
    from public.accounting_periods p
    join public.fiscal_years fy on fy.id = p.fiscal_year_id
   where p.company_id = p_company_id
     and p_date between p.start_date and p.end_date
   order by p.start_date
   limit 1;

  if v_period_id is null then
    perform public._raise('PERIOD_MISSING', p_date::text);
  end if;
  if v_period_status <> 'open' or v_year_status <> 'open' then
    perform public._raise('PERIOD_CLOSED', p_date::text);
  end if;
  return v_period_id;
end;
$$;

create or replace function public._user_role(p_company_id uuid)
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select ur.role from public.user_roles ur
  where ur.company_id = p_company_id and ur.user_id = auth.uid();
$$;

-- Replaces all lines of a draft entry from a JSON array of
-- {account_id, debit_amount, credit_amount, description}.
create or replace function public._write_entry_lines(p_entry_id uuid, p_company_id uuid, p_lines jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_decimals smallint;
  v_currency char(3);
  v_line jsonb;
  v_index int := 0;
  v_debit numeric;
  v_credit numeric;
  v_account uuid;
begin
  select o_code, o_decimals into v_currency, v_decimals from public._company_currency(p_company_id);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    perform public._raise('ENTRY_MIN_LINES');
  end if;

  delete from public.journal_entry_lines l where l.journal_entry_id = p_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    v_account := public.safe_uuid(v_line ->> 'account_id');
    v_debit := public._to_amount(v_line ->> 'debit_amount', v_index);
    v_credit := public._to_amount(v_line ->> 'credit_amount', v_index);
    perform public._check_amount(v_debit, v_decimals, v_index);
    perform public._check_amount(v_credit, v_decimals, v_index);
    if (v_debit > 0) = (v_credit > 0) then
      perform public._raise('LINE_INVALID_AMOUNT', v_index::text);
    end if;
    perform public._assert_postable_account(p_company_id, v_account, v_index);

    insert into public.journal_entry_lines
      (journal_entry_id, company_id, line_number, account_id, debit_amount, credit_amount, description)
    values
      (p_entry_id, p_company_id, v_index, v_account, v_debit, v_credit,
       nullif(btrim(coalesce(v_line ->> 'description', '')), ''));
  end loop;

  update public.journal_entries e
     set total_debit = coalesce((select sum(l.debit_amount) from public.journal_entry_lines l where l.journal_entry_id = p_entry_id), 0),
         total_credit = coalesce((select sum(l.credit_amount) from public.journal_entry_lines l where l.journal_entry_id = p_entry_id), 0)
   where e.id = p_entry_id;
end;
$$;

-- Full posting validation. Returns the open period id for the entry date.
create or replace function public._validate_entry(p_entry public.journal_entries)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_count int;
  v_debit_lines int;
  v_credit_lines int;
  v_line record;
  v_currency char(3);
  v_decimals smallint;
begin
  select o_code, o_decimals into v_currency, v_decimals from public._company_currency(p_entry.company_id);
  if p_entry.currency_code <> v_currency then
    perform public._raise('CURRENCY_NOT_SUPPORTED', p_entry.currency_code);
  end if;
  if btrim(coalesce(p_entry.description, '')) = '' then
    perform public._raise('ENTRY_DESCRIPTION_REQUIRED', p_entry.entry_number);
  end if;

  select coalesce(sum(l.debit_amount), 0), coalesce(sum(l.credit_amount), 0), count(*),
         count(*) filter (where l.debit_amount > 0), count(*) filter (where l.credit_amount > 0)
    into v_debit, v_credit, v_count, v_debit_lines, v_credit_lines
    from public.journal_entry_lines l
   where l.journal_entry_id = p_entry.id;

  if v_count < 2 or v_debit_lines < 1 or v_credit_lines < 1 then
    perform public._raise('ENTRY_MIN_LINES', p_entry.entry_number);
  end if;
  if v_debit <= 0 then
    perform public._raise('ENTRY_ZERO_TOTAL', p_entry.entry_number);
  end if;
  if v_debit <> v_credit then
    perform public._raise('ENTRY_UNBALANCED', (v_debit - v_credit)::text);
  end if;

  for v_line in select l.line_number, l.account_id from public.journal_entry_lines l where l.journal_entry_id = p_entry.id loop
    perform public._assert_postable_account(p_entry.company_id, v_line.account_id, v_line.line_number);
  end loop;

  return public._open_period_for(p_entry.company_id, p_entry.entry_date);
end;
$$;

-- Posts a draft or pending entry. Callers must have checked permissions.
create or replace function public._post_entry(p_entry_id uuid, p_mark_approved boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_period uuid;
begin
  select * into v_entry from public.journal_entries e where e.id = p_entry_id for update;
  if not found then
    perform public._raise('ENTRY_NOT_FOUND');
  end if;
  if v_entry.status in ('posted', 'reversed') then
    perform public._raise('ENTRY_ALREADY_POSTED', v_entry.entry_number);
  end if;

  v_period := public._validate_entry(v_entry);

  update public.journal_entries e
     set status = 'posted',
         period_id = v_period,
         posted_by = auth.uid(),
         posted_at = now(),
         approved_by = case when p_mark_approved then auth.uid() else e.approved_by end,
         approved_at = case when p_mark_approved then now() else e.approved_at end,
         rejection_reason = null
   where e.id = p_entry_id;

  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'posted',
    jsonb_build_object('total', v_entry.total_debit, 'approved', p_mark_approved));
end;
$$;

create or replace function public._load_entry_for_action(p_entry_id uuid, p_permission text)
returns public.journal_entries
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select * into v_entry from public.journal_entries e where e.id = p_entry_id;
  if not found or not public.is_company_member(v_entry.company_id) then
    perform public._raise('ENTRY_NOT_FOUND');
  end if;
  perform public._require_permission(v_entry.company_id, p_permission);
  select * into v_entry from public.journal_entries e where e.id = p_entry_id for update;
  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal entries — public API
-- ---------------------------------------------------------------------------
create or replace function public.save_journal_entry(
  p_company_id uuid,
  p_entry_id uuid,
  p_header jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_id uuid;
  v_currency char(3);
  v_decimals smallint;
  v_date date;
  v_type public.entry_type;
  v_voucher_type public.voucher_type;
  v_description text := btrim(coalesce(p_header ->> 'description', ''));
begin
  if p_entry_id is null then
    perform public._require_permission(p_company_id, 'entries.create');
  else
    perform public._require_permission(p_company_id, 'entries.edit_draft');
  end if;

  v_date := nullif(p_header ->> 'entry_date', '')::date;
  if v_date is null then
    perform public._raise('ENTRY_DATE_REQUIRED');
  end if;
  if v_description = '' then
    perform public._raise('ENTRY_DESCRIPTION_REQUIRED');
  end if;
  v_type := coalesce(nullif(p_header ->> 'entry_type', ''), 'standard')::public.entry_type;
  v_voucher_type := nullif(p_header ->> 'voucher_type', '')::public.voucher_type;

  select o_code, o_decimals into v_currency, v_decimals from public._company_currency(p_company_id);
  if coalesce(nullif(p_header ->> 'currency_code', ''), v_currency) <> v_currency then
    perform public._raise('CURRENCY_NOT_SUPPORTED', p_header ->> 'currency_code');
  end if;

  if p_entry_id is null then
    insert into public.journal_entries
      (company_id, entry_number, entry_date, entry_type, voucher_type, voucher_number, description,
       notes, reference_number, currency_code, created_by, source)
    values
      (p_company_id, public._next_document_number(p_company_id, 'JE', v_date), v_date, v_type,
       v_voucher_type, nullif(btrim(coalesce(p_header ->> 'voucher_number', '')), ''), v_description,
       nullif(btrim(coalesce(p_header ->> 'notes', '')), ''),
       nullif(btrim(coalesce(p_header ->> 'reference_number', '')), ''),
       v_currency, auth.uid(), 'manual')
    returning id into v_id;
  else
    select * into v_entry from public.journal_entries e
     where e.id = p_entry_id and e.company_id = p_company_id
     for update;
    if not found then
      perform public._raise('ENTRY_NOT_FOUND');
    end if;
    if v_entry.status <> 'draft' then
      perform public._raise('ENTRY_NOT_EDITABLE', v_entry.entry_number);
    end if;
    update public.journal_entries e
       set entry_date = v_date,
           entry_type = v_type,
           voucher_type = v_voucher_type,
           voucher_number = nullif(btrim(coalesce(p_header ->> 'voucher_number', '')), ''),
           description = v_description,
           notes = nullif(btrim(coalesce(p_header ->> 'notes', '')), ''),
           reference_number = nullif(btrim(coalesce(p_header ->> 'reference_number', '')), '')
     where e.id = p_entry_id;
    v_id := p_entry_id;
  end if;

  perform public._write_entry_lines(v_id, p_company_id, p_lines);

  select * into v_entry from public.journal_entries e where e.id = v_id;
  perform public._audit(p_company_id, 'journal_entry', v_id, v_entry.entry_number,
    case when p_entry_id is null then 'created' else 'updated' end,
    jsonb_build_object('total_debit', v_entry.total_debit, 'total_credit', v_entry.total_credit,
                       'lines', jsonb_array_length(p_lines)));
  return v_id;
end;
$$;

create or replace function public.submit_journal_entry(p_entry_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.submit');
  if v_entry.status <> 'draft' then
    perform public._raise('INVALID_STATUS_TRANSITION', v_entry.status::text || '->pending_approval');
  end if;
  perform public._validate_entry(v_entry);
  update public.journal_entries e
     set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now(), rejection_reason = null
   where e.id = p_entry_id;
  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'submitted', '{}'::jsonb);
end;
$$;

create or replace function public.approve_journal_entry(p_entry_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.approve');
  if v_entry.status <> 'pending_approval' then
    perform public._raise('INVALID_STATUS_TRANSITION', v_entry.status::text || '->posted');
  end if;
  if v_entry.created_by = auth.uid() and public._user_role(v_entry.company_id) <> 'admin' then
    perform public._raise('SELF_APPROVAL_NOT_ALLOWED', v_entry.entry_number);
  end if;
  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'approved', '{}'::jsonb);
  perform public._post_entry(p_entry_id, true);
end;
$$;

create or replace function public.reject_journal_entry(p_entry_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.approve');
  if v_entry.status <> 'pending_approval' then
    perform public._raise('INVALID_STATUS_TRANSITION', v_entry.status::text || '->draft');
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    perform public._raise('REASON_REQUIRED');
  end if;
  update public.journal_entries e
     set status = 'draft', rejection_reason = btrim(p_reason)
   where e.id = p_entry_id;
  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'rejected',
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- Direct posting. When the company requires approval, only users who may
-- approve can post directly; preparers must submit for approval instead.
create or replace function public.post_journal_entry(p_entry_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_require_approval boolean;
  v_can_approve boolean;
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.post');
  if v_entry.status not in ('draft', 'pending_approval') then
    perform public._raise('ENTRY_ALREADY_POSTED', v_entry.entry_number);
  end if;
  select s.require_approval into v_require_approval from public.company_settings s where s.company_id = v_entry.company_id;
  v_can_approve := public.has_permission(v_entry.company_id, 'entries.approve');
  if coalesce(v_require_approval, true) and not v_can_approve then
    perform public._raise('APPROVAL_REQUIRED', v_entry.entry_number);
  end if;
  if v_can_approve and v_entry.created_by = auth.uid() and v_entry.status = 'pending_approval'
     and public._user_role(v_entry.company_id) <> 'admin' then
    perform public._raise('SELF_APPROVAL_NOT_ALLOWED', v_entry.entry_number);
  end if;
  perform public._post_entry(p_entry_id, v_can_approve);
end;
$$;

create or replace function public.reverse_journal_entry(p_entry_id uuid, p_reversal_date date, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_new_id uuid;
  v_date date;
  v_number text;
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.reverse');
  if v_entry.status = 'reversed' then
    perform public._raise('ENTRY_ALREADY_REVERSED', v_entry.entry_number);
  end if;
  if v_entry.status <> 'posted' then
    perform public._raise('ENTRY_NOT_POSTED', v_entry.entry_number);
  end if;
  if v_entry.reversal_of_id is not null then
    perform public._raise('ENTRY_IS_REVERSAL', v_entry.entry_number);
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    perform public._raise('REASON_REQUIRED');
  end if;
  v_date := coalesce(p_reversal_date, v_entry.entry_date);
  if v_date < v_entry.entry_date then
    perform public._raise('REVERSAL_DATE_INVALID', v_entry.entry_date::text);
  end if;

  v_number := public._next_document_number(v_entry.company_id, 'JE', v_date);
  insert into public.journal_entries
    (company_id, entry_number, entry_date, entry_type, voucher_type, voucher_number, description, notes,
     reference_number, currency_code, exchange_rate, created_by, source, reversal_of_id)
  values
    (v_entry.company_id, v_number, v_date, 'reversing', v_entry.voucher_type, v_entry.voucher_number,
     btrim(p_reason), v_entry.description, v_entry.entry_number, v_entry.currency_code,
     v_entry.exchange_rate, auth.uid(), 'reversal', v_entry.id)
  returning id into v_new_id;

  insert into public.journal_entry_lines
    (journal_entry_id, company_id, line_number, account_id, debit_amount, credit_amount, description)
  select v_new_id, l.company_id, l.line_number, l.account_id, l.credit_amount, l.debit_amount, l.description
    from public.journal_entry_lines l
   where l.journal_entry_id = v_entry.id;

  update public.journal_entries e
     set total_debit = v_entry.total_credit, total_credit = v_entry.total_debit
   where e.id = v_new_id;

  perform public._audit(v_entry.company_id, 'journal_entry', v_new_id, v_number, 'created',
    jsonb_build_object('reversal_of', v_entry.entry_number));
  perform public._post_entry(v_new_id, true);

  update public.journal_entries e
     set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversed_entry_id = v_new_id
   where e.id = v_entry.id;

  if v_entry.voucher_id is not null then
    update public.vouchers v
       set status = 'reversed', reversed_by = auth.uid(), reversed_at = now()
     where v.id = v_entry.voucher_id;
  end if;

  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'reversed',
    jsonb_build_object('reversal_entry', v_number, 'reason', btrim(p_reason), 'reversal_date', v_date));
  return v_new_id;
end;
$$;

create or replace function public.delete_journal_entry(p_entry_id uuid)
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_paths text[];
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.edit_draft');
  if v_entry.status <> 'draft' then
    perform public._raise('ENTRY_NOT_EDITABLE', v_entry.entry_number);
  end if;
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = p_entry_id;
  delete from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = p_entry_id;
  delete from public.journal_entries e where e.id = p_entry_id;
  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'deleted',
    jsonb_build_object('description', v_entry.description, 'total', v_entry.total_debit));
  return v_paths;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vouchers
-- ---------------------------------------------------------------------------
create or replace function public._voucher_doc_type(p_type public.voucher_type)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_type when 'receipt' then 'RV' when 'payment' then 'PV' when 'journal' then 'JV' else 'TV' end;
$$;

create or replace function public._assert_cash_account(p_company_id uuid, p_account_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public._assert_postable_account(p_company_id, p_account_id);
  if not exists (
    select 1 from public.accounts a
    join public.account_categories c on c.code = a.category_code
    where a.id = p_account_id and c.is_cash_equivalent
  ) then
    perform public._raise('VOUCHER_CASH_ACCOUNT_INVALID');
  end if;
end;
$$;

-- Validates a voucher completely and returns the journal lines it produces.
create or replace function public._voucher_journal_lines(p_voucher public.vouchers)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_debit numeric;
  v_credit numeric;
  v_count int;
begin
  if p_voucher.voucher_type in ('receipt', 'payment', 'transfer') and p_voucher.amount <= 0 then
    perform public._raise('VOUCHER_AMOUNT_REQUIRED');
  end if;

  case p_voucher.voucher_type
    when 'receipt' then
      if p_voucher.cash_account_id is null or p_voucher.counter_account_id is null then
        perform public._raise('VOUCHER_ACCOUNT_REQUIRED');
      end if;
      if p_voucher.cash_account_id = p_voucher.counter_account_id then
        perform public._raise('VOUCHER_SAME_ACCOUNTS');
      end if;
      perform public._assert_cash_account(p_voucher.company_id, p_voucher.cash_account_id);
      perform public._assert_postable_account(p_voucher.company_id, p_voucher.counter_account_id);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', p_voucher.cash_account_id, 'debit_amount', p_voucher.amount, 'credit_amount', 0, 'description', p_voucher.party_name),
        jsonb_build_object('account_id', p_voucher.counter_account_id, 'debit_amount', 0, 'credit_amount', p_voucher.amount, 'description', p_voucher.party_name));
    when 'payment' then
      if p_voucher.cash_account_id is null or p_voucher.counter_account_id is null then
        perform public._raise('VOUCHER_ACCOUNT_REQUIRED');
      end if;
      if p_voucher.cash_account_id = p_voucher.counter_account_id then
        perform public._raise('VOUCHER_SAME_ACCOUNTS');
      end if;
      perform public._assert_cash_account(p_voucher.company_id, p_voucher.cash_account_id);
      perform public._assert_postable_account(p_voucher.company_id, p_voucher.counter_account_id);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', p_voucher.counter_account_id, 'debit_amount', p_voucher.amount, 'credit_amount', 0, 'description', p_voucher.party_name),
        jsonb_build_object('account_id', p_voucher.cash_account_id, 'debit_amount', 0, 'credit_amount', p_voucher.amount, 'description', p_voucher.party_name));
    when 'transfer' then
      if p_voucher.from_account_id is null or p_voucher.to_account_id is null then
        perform public._raise('VOUCHER_ACCOUNT_REQUIRED');
      end if;
      if p_voucher.from_account_id = p_voucher.to_account_id then
        perform public._raise('VOUCHER_SAME_ACCOUNTS');
      end if;
      perform public._assert_cash_account(p_voucher.company_id, p_voucher.from_account_id);
      perform public._assert_cash_account(p_voucher.company_id, p_voucher.to_account_id);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', p_voucher.to_account_id, 'debit_amount', p_voucher.amount, 'credit_amount', 0, 'description', null),
        jsonb_build_object('account_id', p_voucher.from_account_id, 'debit_amount', 0, 'credit_amount', p_voucher.amount, 'description', null));
    else
      select coalesce(sum(l.debit_amount), 0), coalesce(sum(l.credit_amount), 0), count(*),
             coalesce(jsonb_agg(jsonb_build_object('account_id', l.account_id, 'debit_amount', l.debit_amount,
                                                   'credit_amount', l.credit_amount, 'description', l.description)
                                order by l.line_number), '[]'::jsonb)
        into v_debit, v_credit, v_count, v_lines
        from public.voucher_lines l where l.voucher_id = p_voucher.id;
      if v_count < 2 then
        perform public._raise('ENTRY_MIN_LINES');
      end if;
      if v_debit <> v_credit then
        perform public._raise('ENTRY_UNBALANCED', (v_debit - v_credit)::text);
      end if;
      if v_debit <= 0 then
        perform public._raise('ENTRY_ZERO_TOTAL');
      end if;
  end case;

  if btrim(coalesce(p_voucher.description, '')) = '' then
    perform public._raise('ENTRY_DESCRIPTION_REQUIRED');
  end if;
  if p_voucher.voucher_type in ('receipt', 'payment') and btrim(coalesce(p_voucher.party_name, '')) = '' then
    perform public._raise('VOUCHER_PARTY_REQUIRED');
  end if;
  perform public._open_period_for(p_voucher.company_id, p_voucher.voucher_date);
  return v_lines;
end;
$$;

create or replace function public.save_voucher(
  p_company_id uuid,
  p_voucher_id uuid,
  p_data jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_existing public.vouchers%rowtype;
  v_id uuid;
  v_type public.voucher_type;
  v_date date;
  v_currency char(3);
  v_decimals smallint;
  v_amount numeric;
  v_line jsonb;
  v_index int := 0;
  v_debit numeric;
  v_credit numeric;
  v_account uuid;
  v_cash uuid := public.safe_uuid(p_data ->> 'cash_account_id');
  v_counter uuid := public.safe_uuid(p_data ->> 'counter_account_id');
  v_from uuid := public.safe_uuid(p_data ->> 'from_account_id');
  v_to uuid := public.safe_uuid(p_data ->> 'to_account_id');
  v_number text;
begin
  if p_voucher_id is null then
    perform public._require_permission(p_company_id, 'entries.create');
  else
    perform public._require_permission(p_company_id, 'entries.edit_draft');
  end if;

  v_type := (p_data ->> 'voucher_type')::public.voucher_type;
  v_date := nullif(p_data ->> 'voucher_date', '')::date;
  if v_type is null then
    perform public._raise('VOUCHER_TYPE_REQUIRED');
  end if;
  if v_date is null then
    perform public._raise('ENTRY_DATE_REQUIRED');
  end if;

  select o_code, o_decimals into v_currency, v_decimals from public._company_currency(p_company_id);
  if coalesce(nullif(p_data ->> 'currency_code', ''), v_currency) <> v_currency then
    perform public._raise('CURRENCY_NOT_SUPPORTED', p_data ->> 'currency_code');
  end if;

  v_amount := public._to_amount(p_data ->> 'amount');
  perform public._check_amount(v_amount, v_decimals);

  if v_type in ('receipt', 'payment') then
    v_from := null; v_to := null;
    if v_cash is not null then perform public._assert_cash_account(p_company_id, v_cash); end if;
    if v_counter is not null then perform public._assert_postable_account(p_company_id, v_counter); end if;
    if v_cash is not null and v_cash = v_counter then perform public._raise('VOUCHER_SAME_ACCOUNTS'); end if;
  elsif v_type = 'transfer' then
    v_cash := null; v_counter := null;
    if v_from is not null then perform public._assert_cash_account(p_company_id, v_from); end if;
    if v_to is not null then perform public._assert_cash_account(p_company_id, v_to); end if;
    if v_from is not null and v_from = v_to then perform public._raise('VOUCHER_SAME_ACCOUNTS'); end if;
  else
    v_cash := null; v_counter := null; v_from := null; v_to := null;
  end if;

  if p_voucher_id is null then
    v_number := public._next_document_number(p_company_id, public._voucher_doc_type(v_type), v_date);
    insert into public.vouchers
      (company_id, voucher_type, voucher_number, voucher_date, party_name, payment_method, cheque_number,
       cash_account_id, counter_account_id, from_account_id, to_account_id, amount, currency_code,
       description, notes, reference_number, created_by)
    values
      (p_company_id, v_type, v_number, v_date,
       nullif(btrim(coalesce(p_data ->> 'party_name', '')), ''),
       coalesce(nullif(p_data ->> 'payment_method', ''), 'cash')::public.payment_method,
       nullif(btrim(coalesce(p_data ->> 'cheque_number', '')), ''),
       v_cash, v_counter, v_from, v_to, v_amount, v_currency,
       btrim(coalesce(p_data ->> 'description', '')),
       nullif(btrim(coalesce(p_data ->> 'notes', '')), ''),
       nullif(btrim(coalesce(p_data ->> 'reference_number', '')), ''),
       auth.uid())
    returning id into v_id;
  else
    select * into v_existing from public.vouchers v
     where v.id = p_voucher_id and v.company_id = p_company_id for update;
    if not found then
      perform public._raise('VOUCHER_NOT_FOUND');
    end if;
    if v_existing.status <> 'draft' then
      perform public._raise('VOUCHER_NOT_EDITABLE', v_existing.voucher_number);
    end if;
    if v_existing.voucher_type <> v_type then
      perform public._raise('VOUCHER_TYPE_IMMUTABLE');
    end if;
    update public.vouchers v
       set voucher_date = v_date,
           party_name = nullif(btrim(coalesce(p_data ->> 'party_name', '')), ''),
           payment_method = coalesce(nullif(p_data ->> 'payment_method', ''), 'cash')::public.payment_method,
           cheque_number = nullif(btrim(coalesce(p_data ->> 'cheque_number', '')), ''),
           cash_account_id = v_cash,
           counter_account_id = v_counter,
           from_account_id = v_from,
           to_account_id = v_to,
           amount = v_amount,
           description = btrim(coalesce(p_data ->> 'description', '')),
           notes = nullif(btrim(coalesce(p_data ->> 'notes', '')), ''),
           reference_number = nullif(btrim(coalesce(p_data ->> 'reference_number', '')), ''),
           rejection_reason = null
     where v.id = p_voucher_id;
    v_id := p_voucher_id;
    v_number := v_existing.voucher_number;
  end if;

  delete from public.voucher_lines l where l.voucher_id = v_id;
  if v_type = 'journal' then
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
      perform public._raise('ENTRY_MIN_LINES');
    end if;
    for v_line in select value from jsonb_array_elements(p_lines) loop
      v_index := v_index + 1;
      v_account := public.safe_uuid(v_line ->> 'account_id');
      v_debit := public._to_amount(v_line ->> 'debit_amount', v_index);
      v_credit := public._to_amount(v_line ->> 'credit_amount', v_index);
      perform public._check_amount(v_debit, v_decimals, v_index);
      perform public._check_amount(v_credit, v_decimals, v_index);
      if (v_debit > 0) = (v_credit > 0) then
        perform public._raise('LINE_INVALID_AMOUNT', v_index::text);
      end if;
      perform public._assert_postable_account(p_company_id, v_account, v_index);
      insert into public.voucher_lines
        (voucher_id, company_id, line_number, account_id, debit_amount, credit_amount, description)
      values
        (v_id, p_company_id, v_index, v_account, v_debit, v_credit,
         nullif(btrim(coalesce(v_line ->> 'description', '')), ''));
    end loop;
    update public.vouchers v
       set amount = coalesce((select sum(l.debit_amount) from public.voucher_lines l where l.voucher_id = v_id), 0)
     where v.id = v_id;
  end if;

  perform public._audit(p_company_id, 'voucher', v_id, v_number,
    case when p_voucher_id is null then 'created' else 'updated' end,
    jsonb_build_object('type', v_type));
  return v_id;
end;
$$;

create or replace function public._load_voucher_for_action(p_voucher_id uuid, p_permission text)
returns public.vouchers
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select * into v from public.vouchers x where x.id = p_voucher_id;
  if not found or not public.is_company_member(v.company_id) then
    perform public._raise('VOUCHER_NOT_FOUND');
  end if;
  perform public._require_permission(v.company_id, p_permission);
  select * into v from public.vouchers x where x.id = p_voucher_id for update;
  return v;
end;
$$;

-- Creates and posts the journal entry for a voucher. The voucher row is locked
-- and journal_entries.voucher_id is UNIQUE, so a voucher can be posted only once
-- even under concurrent requests.
create or replace function public._post_voucher(p_voucher_id uuid, p_mark_approved boolean)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
  v_lines jsonb;
  v_entry_id uuid;
  v_number text;
begin
  select * into v from public.vouchers x where x.id = p_voucher_id for update;
  if v.status in ('posted', 'reversed') or v.journal_entry_id is not null then
    perform public._raise('VOUCHER_ALREADY_POSTED', v.voucher_number);
  end if;

  v_lines := public._voucher_journal_lines(v);
  v_number := public._next_document_number(v.company_id, 'JE', v.voucher_date);

  insert into public.journal_entries
    (company_id, entry_number, entry_date, entry_type, voucher_id, voucher_type, voucher_number, description,
     notes, reference_number, currency_code, created_by, source)
  values
    (v.company_id, v_number, v.voucher_date, 'standard', v.id, v.voucher_type, v.voucher_number, v.description,
     v.notes, v.reference_number, v.currency_code, coalesce(v.created_by, auth.uid()), 'voucher')
  returning id into v_entry_id;

  perform public._write_entry_lines(v_entry_id, v.company_id, v_lines);
  perform public._post_entry(v_entry_id, p_mark_approved);

  update public.vouchers x
     set status = 'posted',
         journal_entry_id = v_entry_id,
         posted_by = auth.uid(),
         posted_at = now(),
         approved_by = case when p_mark_approved then auth.uid() else x.approved_by end,
         approved_at = case when p_mark_approved then now() else x.approved_at end
   where x.id = p_voucher_id;

  perform public._audit(v.company_id, 'voucher', v.id, v.voucher_number, 'posted',
    jsonb_build_object('journal_entry', v_number, 'amount', v.amount));
  return v_entry_id;
end;
$$;

create or replace function public.submit_voucher(p_voucher_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
begin
  v := public._load_voucher_for_action(p_voucher_id, 'entries.submit');
  if v.status <> 'draft' then
    perform public._raise('INVALID_STATUS_TRANSITION', v.status::text || '->pending_approval');
  end if;
  perform public._voucher_journal_lines(v);
  update public.vouchers x
     set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now(), rejection_reason = null
   where x.id = p_voucher_id;
  perform public._audit(v.company_id, 'voucher', v.id, v.voucher_number, 'submitted', '{}'::jsonb);
end;
$$;

create or replace function public.approve_voucher(p_voucher_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
begin
  v := public._load_voucher_for_action(p_voucher_id, 'entries.approve');
  if v.status <> 'pending_approval' then
    if v.status in ('posted', 'reversed') then
      perform public._raise('VOUCHER_ALREADY_POSTED', v.voucher_number);
    end if;
    perform public._raise('INVALID_STATUS_TRANSITION', v.status::text || '->posted');
  end if;
  if v.created_by = auth.uid() and public._user_role(v.company_id) <> 'admin' then
    perform public._raise('SELF_APPROVAL_NOT_ALLOWED', v.voucher_number);
  end if;
  perform public._audit(v.company_id, 'voucher', v.id, v.voucher_number, 'approved', '{}'::jsonb);
  return public._post_voucher(p_voucher_id, true);
end;
$$;

create or replace function public.reject_voucher(p_voucher_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
begin
  v := public._load_voucher_for_action(p_voucher_id, 'entries.approve');
  if v.status <> 'pending_approval' then
    perform public._raise('INVALID_STATUS_TRANSITION', v.status::text || '->draft');
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    perform public._raise('REASON_REQUIRED');
  end if;
  update public.vouchers x set status = 'draft', rejection_reason = btrim(p_reason) where x.id = p_voucher_id;
  perform public._audit(v.company_id, 'voucher', v.id, v.voucher_number, 'rejected',
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.post_voucher(p_voucher_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
  v_require_approval boolean;
  v_can_approve boolean;
begin
  v := public._load_voucher_for_action(p_voucher_id, 'entries.post');
  if v.status in ('posted', 'reversed') or v.journal_entry_id is not null then
    perform public._raise('VOUCHER_ALREADY_POSTED', v.voucher_number);
  end if;
  select s.require_approval into v_require_approval from public.company_settings s where s.company_id = v.company_id;
  v_can_approve := public.has_permission(v.company_id, 'entries.approve');
  if coalesce(v_require_approval, true) and not v_can_approve then
    perform public._raise('APPROVAL_REQUIRED', v.voucher_number);
  end if;
  if v_can_approve and v.created_by = auth.uid() and v.status = 'pending_approval'
     and public._user_role(v.company_id) <> 'admin' then
    perform public._raise('SELF_APPROVAL_NOT_ALLOWED', v.voucher_number);
  end if;
  return public._post_voucher(p_voucher_id, v_can_approve);
end;
$$;

create or replace function public.reverse_voucher(p_voucher_id uuid, p_reversal_date date, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
begin
  v := public._load_voucher_for_action(p_voucher_id, 'entries.reverse');
  if v.status <> 'posted' or v.journal_entry_id is null then
    perform public._raise('ENTRY_NOT_POSTED', v.voucher_number);
  end if;
  return public.reverse_journal_entry(v.journal_entry_id, p_reversal_date, p_reason);
end;
$$;

create or replace function public.delete_voucher(p_voucher_id uuid)
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
  v_paths text[];
begin
  v := public._load_voucher_for_action(p_voucher_id, 'entries.edit_draft');
  if v.status <> 'draft' then
    perform public._raise('VOUCHER_NOT_EDITABLE', v.voucher_number);
  end if;
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.attachments a where a.entity_type = 'voucher' and a.entity_id = p_voucher_id;
  delete from public.attachments a where a.entity_type = 'voucher' and a.entity_id = p_voucher_id;
  delete from public.vouchers x where x.id = p_voucher_id;
  perform public._audit(v.company_id, 'voucher', v.id, v.voucher_number, 'deleted',
    jsonb_build_object('amount', v.amount));
  return v_paths;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fiscal years and accounting periods
-- ---------------------------------------------------------------------------
create or replace function public.create_fiscal_year(
  p_company_id uuid, p_name text, p_start_date date, p_end_date date, p_monthly boolean default true)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cursor date;
  v_end date;
  v_index int := 0;
begin
  perform public._require_permission(p_company_id, 'periods.manage');
  if p_start_date is null or p_end_date is null or p_end_date <= p_start_date
     or p_end_date > (p_start_date + interval '2 years')::date then
    perform public._raise('FISCAL_YEAR_INVALID');
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    perform public._raise('FISCAL_YEAR_INVALID', 'name');
  end if;

  insert into public.fiscal_years (company_id, name, start_date, end_date, created_by)
  values (p_company_id, btrim(p_name), p_start_date, p_end_date, auth.uid())
  returning id into v_id;

  if coalesce(p_monthly, true) then
    v_cursor := p_start_date;
    while v_cursor <= p_end_date loop
      v_index := v_index + 1;
      v_end := least((date_trunc('month', v_cursor) + interval '1 month' - interval '1 day')::date, p_end_date);
      insert into public.accounting_periods (company_id, fiscal_year_id, period_number, name, start_date, end_date)
      values (p_company_id, v_id, v_index, to_char(v_cursor, 'YYYY-MM'), v_cursor, v_end);
      v_cursor := v_end + 1;
    end loop;
  else
    insert into public.accounting_periods (company_id, fiscal_year_id, period_number, name, start_date, end_date)
    values (p_company_id, v_id, 1, btrim(p_name), p_start_date, p_end_date);
  end if;
  return v_id;
end;
$$;

create or replace function public.close_accounting_period(p_period_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.accounting_periods%rowtype;
begin
  select * into v from public.accounting_periods p where p.id = p_period_id;
  if not found or not public.is_company_member(v.company_id) then
    perform public._raise('PERIOD_NOT_FOUND');
  end if;
  perform public._require_permission(v.company_id, 'periods.manage');
  if v.status = 'closed' then
    return;
  end if;
  if exists (select 1 from public.journal_entries e
             where e.company_id = v.company_id and e.status = 'pending_approval'
               and e.entry_date between v.start_date and v.end_date)
     or exists (select 1 from public.vouchers x
             where x.company_id = v.company_id and x.status = 'pending_approval'
               and x.voucher_date between v.start_date and v.end_date) then
    perform public._raise('PERIOD_HAS_PENDING', v.name);
  end if;
  update public.accounting_periods p
     set status = 'closed', closed_by = auth.uid(), closed_at = now()
   where p.id = p_period_id;
end;
$$;

create or replace function public.reopen_accounting_period(p_period_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.accounting_periods%rowtype;
  v_year_status public.period_status;
begin
  select * into v from public.accounting_periods p where p.id = p_period_id;
  if not found or not public.is_company_member(v.company_id) then
    perform public._raise('PERIOD_NOT_FOUND');
  end if;
  perform public._require_permission(v.company_id, 'periods.manage');
  if btrim(coalesce(p_reason, '')) = '' then
    perform public._raise('REASON_REQUIRED');
  end if;
  select fy.status into v_year_status from public.fiscal_years fy where fy.id = v.fiscal_year_id;
  if v_year_status = 'closed' then
    perform public._raise('FISCAL_YEAR_CLOSED');
  end if;
  update public.accounting_periods p
     set status = 'open', reopened_by = auth.uid(), reopened_at = now()
   where p.id = p_period_id;
  perform public._audit(v.company_id, 'accounting_periods', v.id, v.name, 'reopened',
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.close_fiscal_year(p_fiscal_year_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.fiscal_years%rowtype;
begin
  select * into v from public.fiscal_years f where f.id = p_fiscal_year_id;
  if not found or not public.is_company_member(v.company_id) then
    perform public._raise('FISCAL_YEAR_NOT_FOUND');
  end if;
  perform public._require_permission(v.company_id, 'periods.manage');
  if exists (select 1 from public.journal_entries e
             where e.company_id = v.company_id and e.status = 'pending_approval'
               and e.entry_date between v.start_date and v.end_date)
     or exists (select 1 from public.vouchers x
             where x.company_id = v.company_id and x.status = 'pending_approval'
               and x.voucher_date between v.start_date and v.end_date) then
    perform public._raise('PERIOD_HAS_PENDING', v.name);
  end if;
  update public.accounting_periods p
     set status = 'closed', closed_by = auth.uid(), closed_at = now()
   where p.fiscal_year_id = p_fiscal_year_id and p.status = 'open';
  update public.fiscal_years f
     set status = 'closed', closed_by = auth.uid(), closed_at = now()
   where f.id = p_fiscal_year_id;
end;
$$;

create or replace function public.reopen_fiscal_year(p_fiscal_year_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.fiscal_years%rowtype;
begin
  select * into v from public.fiscal_years f where f.id = p_fiscal_year_id;
  if not found or not public.is_company_member(v.company_id) then
    perform public._raise('FISCAL_YEAR_NOT_FOUND');
  end if;
  perform public._require_permission(v.company_id, 'periods.manage');
  if btrim(coalesce(p_reason, '')) = '' then
    perform public._raise('REASON_REQUIRED');
  end if;
  update public.fiscal_years f set status = 'open', closed_by = null, closed_at = null where f.id = p_fiscal_year_id;
  perform public._audit(v.company_id, 'fiscal_years', v.id, v.name, 'reopened',
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- Builds a draft closing entry that transfers the fiscal year's revenue and
-- expense balances to retained earnings. It is reviewed and posted like any
-- other entry.
create or replace function public.create_closing_entry(p_fiscal_year_id uuid, p_description text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_year public.fiscal_years%rowtype;
  v_re uuid;
  v_lines jsonb := '[]'::jsonb;
  v_net numeric := 0;
  v_row record;
  v_entry_id uuid;
  v_number text;
  v_currency char(3);
  v_decimals smallint;
begin
  select * into v_year from public.fiscal_years f where f.id = p_fiscal_year_id;
  if not found or not public.is_company_member(v_year.company_id) then
    perform public._raise('FISCAL_YEAR_NOT_FOUND');
  end if;
  perform public._require_permission(v_year.company_id, 'entries.create');

  select s.retained_earnings_account_id into v_re from public.company_settings s where s.company_id = v_year.company_id;
  if v_re is null then
    perform public._raise('RETAINED_EARNINGS_REQUIRED');
  end if;
  perform public._assert_postable_account(v_year.company_id, v_re);

  if exists (select 1 from public.journal_entries e
             where e.company_id = v_year.company_id and e.entry_type = 'closing'
               and e.status in ('draft', 'pending_approval')
               and e.entry_date between v_year.start_date and v_year.end_date) then
    perform public._raise('CLOSING_ENTRY_EXISTS', v_year.name);
  end if;

  for v_row in
    select a.id, sum(l.debit_amount) - sum(l.credit_amount) as net
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id
      join public.accounts a on a.id = l.account_id
     where e.company_id = v_year.company_id
       and e.status in ('posted', 'reversed')
       and e.entry_date between v_year.start_date and v_year.end_date
       and a.account_type in ('revenue', 'expense')
     group by a.id, a.code
    having sum(l.debit_amount) - sum(l.credit_amount) <> 0
     order by a.code
  loop
    v_net := v_net + v_row.net;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_row.id,
      'debit_amount', case when v_row.net < 0 then -v_row.net else 0 end,
      'credit_amount', case when v_row.net > 0 then v_row.net else 0 end));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    perform public._raise('NOTHING_TO_CLOSE', v_year.name);
  end if;

  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_re,
      'debit_amount', case when v_net > 0 then v_net else 0 end,
      'credit_amount', case when v_net < 0 then -v_net else 0 end));
  end if;

  select o_code, o_decimals into v_currency, v_decimals from public._company_currency(v_year.company_id);
  v_number := public._next_document_number(v_year.company_id, 'JE', v_year.end_date);
  insert into public.journal_entries
    (company_id, entry_number, entry_date, entry_type, description, currency_code, created_by, source)
  values
    (v_year.company_id, v_number, v_year.end_date, 'closing',
     coalesce(nullif(btrim(p_description), ''), 'Closing entry ' || v_year.name),
     v_currency, auth.uid(), 'closing')
  returning id into v_entry_id;

  perform public._write_entry_lines(v_entry_id, v_year.company_id, v_lines);
  perform public._audit(v_year.company_id, 'journal_entry', v_entry_id, v_number, 'created',
    jsonb_build_object('closing_fiscal_year', v_year.name));
  return v_entry_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recurring entry templates
-- ---------------------------------------------------------------------------
create or replace function public._frequency_interval(p_frequency public.recurrence_frequency)
returns interval
language sql immutable
set search_path = ''
as $$
  select case p_frequency
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    else interval '1 year'
  end;
$$;

create or replace function public.save_recurring_template(
  p_company_id uuid, p_template_id uuid, p_data jsonb, p_lines jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_existing public.recurring_entry_templates%rowtype;
  v_id uuid;
  v_currency char(3);
  v_decimals smallint;
  v_start date := nullif(p_data ->> 'start_date', '')::date;
  v_end date := nullif(p_data ->> 'end_date', '')::date;
  v_line jsonb;
  v_index int := 0;
  v_debit numeric;
  v_credit numeric;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_account uuid;
begin
  perform public._require_permission(p_company_id, 'entries.create');
  if v_start is null then
    perform public._raise('ENTRY_DATE_REQUIRED');
  end if;
  if btrim(coalesce(p_data ->> 'name', '')) = '' or btrim(coalesce(p_data ->> 'description', '')) = '' then
    perform public._raise('ENTRY_DESCRIPTION_REQUIRED');
  end if;
  select o_code, o_decimals into v_currency, v_decimals from public._company_currency(p_company_id);

  if p_template_id is null then
    insert into public.recurring_entry_templates
      (company_id, name, description, frequency, start_date, end_date, next_run_date, is_active, currency_code, created_by)
    values
      (p_company_id, btrim(p_data ->> 'name'), btrim(p_data ->> 'description'),
       (p_data ->> 'frequency')::public.recurrence_frequency, v_start, v_end, v_start,
       coalesce((p_data ->> 'is_active')::boolean, true), v_currency, auth.uid())
    returning id into v_id;
  else
    select * into v_existing from public.recurring_entry_templates t
     where t.id = p_template_id and t.company_id = p_company_id for update;
    if not found then
      perform public._raise('TEMPLATE_NOT_FOUND');
    end if;
    update public.recurring_entry_templates t
       set name = btrim(p_data ->> 'name'),
           description = btrim(p_data ->> 'description'),
           frequency = (p_data ->> 'frequency')::public.recurrence_frequency,
           start_date = v_start,
           end_date = v_end,
           next_run_date = case when t.generated_count = 0 then v_start else t.next_run_date end,
           is_active = coalesce((p_data ->> 'is_active')::boolean, t.is_active)
     where t.id = p_template_id;
    v_id := p_template_id;
  end if;

  delete from public.recurring_template_lines l where l.template_id = v_id;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_account := public.safe_uuid(v_line ->> 'account_id');
    v_debit := public._to_amount(v_line ->> 'debit_amount', v_index);
    v_credit := public._to_amount(v_line ->> 'credit_amount', v_index);
    perform public._check_amount(v_debit, v_decimals, v_index);
    perform public._check_amount(v_credit, v_decimals, v_index);
    if (v_debit > 0) = (v_credit > 0) then
      perform public._raise('LINE_INVALID_AMOUNT', v_index::text);
    end if;
    perform public._assert_postable_account(p_company_id, v_account, v_index);
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    insert into public.recurring_template_lines
      (template_id, company_id, line_number, account_id, debit_amount, credit_amount, description)
    values (v_id, p_company_id, v_index, v_account, v_debit, v_credit,
            nullif(btrim(coalesce(v_line ->> 'description', '')), ''));
  end loop;

  if v_index < 2 then
    perform public._raise('ENTRY_MIN_LINES');
  end if;
  if v_total_debit <> v_total_credit then
    perform public._raise('ENTRY_UNBALANCED', (v_total_debit - v_total_credit)::text);
  end if;

  perform public._audit(p_company_id, 'recurring_template', v_id, btrim(p_data ->> 'name'),
    case when p_template_id is null then 'created' else 'updated' end, '{}'::jsonb);
  return v_id;
end;
$$;

-- Generates real, dated draft entries for every occurrence due on or before
-- p_until. Previously generated entries are never modified.
create or replace function public.generate_recurring_entries(p_template_id uuid, p_until date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.recurring_entry_templates%rowtype;
  v_count int := 0;
  v_entry_id uuid;
  v_number text;
  v_lines jsonb;
begin
  select * into t from public.recurring_entry_templates x where x.id = p_template_id;
  if not found or not public.is_company_member(t.company_id) then
    perform public._raise('TEMPLATE_NOT_FOUND');
  end if;
  perform public._require_permission(t.company_id, 'entries.create');
  select * into t from public.recurring_entry_templates x where x.id = p_template_id for update;
  if not t.is_active then
    perform public._raise('TEMPLATE_INACTIVE', t.name);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('account_id', l.account_id, 'debit_amount', l.debit_amount,
                                               'credit_amount', l.credit_amount, 'description', l.description)
                            order by l.line_number), '[]'::jsonb)
    into v_lines
    from public.recurring_template_lines l where l.template_id = t.id;

  while t.next_run_date <= p_until and (t.end_date is null or t.next_run_date <= t.end_date) and v_count < 120 loop
    v_number := public._next_document_number(t.company_id, 'JE', t.next_run_date);
    insert into public.journal_entries
      (company_id, entry_number, entry_date, entry_type, description, currency_code, created_by, source,
       recurring_template_id, reference_number)
    values
      (t.company_id, v_number, t.next_run_date, 'recurring', t.description, t.currency_code, auth.uid(),
       'recurring', t.id, t.name)
    returning id into v_entry_id;
    perform public._write_entry_lines(v_entry_id, t.company_id, v_lines);
    perform public._audit(t.company_id, 'journal_entry', v_entry_id, v_number, 'created',
      jsonb_build_object('recurring_template', t.name));

    v_count := v_count + 1;
    t.generated_count := t.generated_count + 1;
    t.next_run_date := (t.start_date + public._frequency_interval(t.frequency) * t.generated_count)::date;
  end loop;

  update public.recurring_entry_templates x
     set next_run_date = t.next_run_date,
         generated_count = t.generated_count,
         last_generated_at = case when v_count > 0 then now() else x.last_generated_at end
   where x.id = t.id;
  return v_count;
end;
$$;

create or replace function public.delete_recurring_template(p_template_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.recurring_entry_templates%rowtype;
begin
  select * into t from public.recurring_entry_templates x where x.id = p_template_id;
  if not found or not public.is_company_member(t.company_id) then
    perform public._raise('TEMPLATE_NOT_FOUND');
  end if;
  perform public._require_permission(t.company_id, 'entries.edit_draft');
  delete from public.recurring_entry_templates x where x.id = p_template_id;
  perform public._audit(t.company_id, 'recurring_template', t.id, t.name, 'deleted', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create or replace function public.register_attachment(
  p_company_id uuid, p_entity_type text, p_entity_id uuid, p_file_name text,
  p_storage_path text, p_mime_type text, p_size_bytes bigint)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_label text;
begin
  perform public._require_permission(p_company_id, 'entries.create');
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> p_company_id::text then
    perform public._raise('ATTACHMENT_PATH_INVALID');
  end if;
  if p_entity_type = 'journal_entry' then
    select e.entry_number into v_label from public.journal_entries e where e.id = p_entity_id and e.company_id = p_company_id;
  elsif p_entity_type = 'voucher' then
    select x.voucher_number into v_label from public.vouchers x where x.id = p_entity_id and x.company_id = p_company_id;
  end if;
  if v_label is null then
    perform public._raise('ATTACHMENT_ENTITY_INVALID');
  end if;
  insert into public.attachments
    (company_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values
    (p_company_id, p_entity_type, p_entity_id, left(btrim(p_file_name), 255), p_storage_path, p_mime_type, p_size_bytes, auth.uid())
  returning id into v_id;
  perform public._audit(p_company_id, p_entity_type, p_entity_id, v_label, 'attachment_added',
    jsonb_build_object('file', p_file_name));
  return v_id;
end;
$$;

-- Attachments of posted documents are retained as evidence; only attachments of
-- drafts can be removed.
create or replace function public.delete_attachment(p_attachment_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.attachments%rowtype;
  v_status text;
begin
  select * into a from public.attachments x where x.id = p_attachment_id;
  if not found or not public.is_company_member(a.company_id) then
    perform public._raise('ATTACHMENT_NOT_FOUND');
  end if;
  perform public._require_permission(a.company_id, 'entries.edit_draft');
  if a.entity_type = 'journal_entry' then
    select e.status::text into v_status from public.journal_entries e where e.id = a.entity_id;
  else
    select x.status::text into v_status from public.vouchers x where x.id = a.entity_id;
  end if;
  if v_status is distinct from 'draft' then
    perform public._raise('ATTACHMENT_LOCKED');
  end if;
  delete from public.attachments x where x.id = p_attachment_id;
  perform public._audit(a.company_id, a.entity_type, a.entity_id, a.file_name, 'attachment_removed', '{}'::jsonb);
  return a.storage_path;
end;
$$;

create or replace function public.attachment_path_in_use(p_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.attachments a where a.storage_path = p_path);
$$;

-- ---------------------------------------------------------------------------
-- Company membership
-- ---------------------------------------------------------------------------
create or replace function public.add_company_member(p_company_id uuid, p_email text, p_role public.app_role)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform public._require_permission(p_company_id, 'users.manage');
  select p.id into v_user from public.profiles p where lower(p.email) = lower(btrim(p_email));
  if v_user is null then
    perform public._raise('MEMBER_NOT_FOUND', p_email);
  end if;
  if exists (select 1 from public.user_roles ur where ur.company_id = p_company_id and ur.user_id = v_user) then
    perform public._raise('MEMBER_EXISTS', p_email);
  end if;
  insert into public.user_roles (company_id, user_id, role, created_by)
  values (p_company_id, v_user, p_role, auth.uid());
  update public.profiles p set default_company_id = p_company_id
   where p.id = v_user and p.default_company_id is null;
  return v_user;
end;
$$;

create or replace function public.update_member_role(p_company_id uuid, p_user_id uuid, p_role public.app_role)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_permission(p_company_id, 'users.manage');
  if p_role <> 'admin' and exists (
       select 1 from public.user_roles ur
       where ur.company_id = p_company_id and ur.user_id = p_user_id and ur.role = 'admin')
     and (select count(*) from public.user_roles ur where ur.company_id = p_company_id and ur.role = 'admin') <= 1 then
    perform public._raise('LAST_ADMIN');
  end if;
  update public.user_roles ur set role = p_role where ur.company_id = p_company_id and ur.user_id = p_user_id;
  if not found then
    perform public._raise('MEMBER_NOT_FOUND');
  end if;
end;
$$;

create or replace function public.remove_company_member(p_company_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_permission(p_company_id, 'users.manage');
  if exists (select 1 from public.user_roles ur
             where ur.company_id = p_company_id and ur.user_id = p_user_id and ur.role = 'admin')
     and (select count(*) from public.user_roles ur where ur.company_id = p_company_id and ur.role = 'admin') <= 1 then
    perform public._raise('LAST_ADMIN');
  end if;
  delete from public.user_roles ur where ur.company_id = p_company_id and ur.user_id = p_user_id;
end;
$$;

create or replace function public.list_company_members(p_company_id uuid)
returns table (user_id uuid, email text, full_name text, role public.app_role, joined_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public._require_member(p_company_id);
  return query
    select ur.user_id, p.email, p.full_name, ur.role, ur.created_at
      from public.user_roles ur
      left join public.profiles p on p.id = ur.user_id
     where ur.company_id = p_company_id
     order by ur.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Company bootstrap with a bilingual standard chart of accounts
-- ---------------------------------------------------------------------------
create or replace function public._seed_default_chart(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select * from (values
      ('1000', null,   'Assets',                    'الأصول',                         'asset',     null,                       'debit',  false),
      ('1100', '1000', 'Current Assets',            'الأصول المتداولة',               'asset',     null,                       'debit',  false),
      ('1110', '1100', 'Cash on Hand',              'الصندوق',                        'asset',     'cash',                     'debit',  true),
      ('1120', '1100', 'Bank - Current Account',    'المصرف - الحساب الجاري',         'asset',     'bank',                     'debit',  true),
      ('1130', '1100', 'Accounts Receivable',       'الذمم المدينة',                  'asset',     'receivables',              'debit',  true),
      ('1140', '1100', 'Inventory',                 'المخزون',                        'asset',     'inventory',                'debit',  true),
      ('1150', '1100', 'Prepaid Expenses',          'المصروفات المدفوعة مقدماً',      'asset',     'prepayments',              'debit',  true),
      ('1200', '1000', 'Non-current Assets',        'الأصول غير المتداولة',           'asset',     null,                       'debit',  false),
      ('1210', '1200', 'Land and Buildings',        'الأراضي والمباني',               'asset',     'property_equipment',       'debit',  true),
      ('1220', '1200', 'Equipment',                 'المعدات',                        'asset',     'property_equipment',       'debit',  true),
      ('1230', '1200', 'Furniture and Fixtures',    'الأثاث والتجهيزات',              'asset',     'property_equipment',       'debit',  true),
      ('1240', '1200', 'Vehicles',                  'وسائط النقل',                    'asset',     'property_equipment',       'debit',  true),
      ('1290', '1200', 'Accumulated Depreciation',  'مجمع الإهلاك',                   'asset',     'accumulated_depreciation', 'credit', true),
      ('2000', null,   'Liabilities',               'الالتزامات',                     'liability', null,                       'credit', false),
      ('2100', '2000', 'Current Liabilities',       'الالتزامات المتداولة',           'liability', null,                       'credit', false),
      ('2110', '2100', 'Accounts Payable',          'الذمم الدائنة',                  'liability', 'payables',                 'credit', true),
      ('2120', '2100', 'Short-term Loans',          'القروض قصيرة الأجل',             'liability', 'short_term_loans',         'credit', true),
      ('2130', '2100', 'Accrued Expenses',          'المصروفات المستحقة',             'liability', 'accrued_liabilities',      'credit', true),
      ('2140', '2100', 'Taxes Payable',             'الضرائب المستحقة',               'liability', 'accrued_liabilities',      'credit', true),
      ('2200', '2000', 'Non-current Liabilities',   'الالتزامات غير المتداولة',       'liability', null,                       'credit', false),
      ('2210', '2200', 'Long-term Loans',           'القروض طويلة الأجل',             'liability', 'long_term_loans',          'credit', true),
      ('3000', null,   'Equity',                    'حقوق الملكية',                   'equity',    null,                       'credit', false),
      ('3100', '3000', 'Owner Capital',             'رأس المال',                      'equity',    'capital',                  'credit', true),
      ('3200', '3000', 'Retained Earnings',         'الأرباح المحتجزة',               'equity',    'retained_earnings',        'credit', true),
      ('3300', '3000', 'Owner Drawings',            'المسحوبات الشخصية',              'equity',    'drawings',                 'debit',  true),
      ('4000', null,   'Revenue',                   'الإيرادات',                      'revenue',   null,                       'credit', false),
      ('4100', '4000', 'Sales Revenue',             'إيرادات المبيعات',               'revenue',   'operating_revenue',        'credit', true),
      ('4200', '4000', 'Service Revenue',           'إيرادات الخدمات',                'revenue',   'operating_revenue',        'credit', true),
      ('4900', '4000', 'Other Revenue',             'إيرادات أخرى',                   'revenue',   'other_revenue',            'credit', true),
      ('5000', null,   'Expenses',                  'المصروفات',                      'expense',   null,                       'debit',  false),
      ('5100', '5000', 'Purchases',                 'المشتريات',                      'expense',   'cost_of_sales',            'debit',  true),
      ('5150', '5000', 'Cost of Goods Sold',        'تكلفة البضاعة المباعة',          'expense',   'cost_of_sales',            'debit',  true),
      ('5200', '5000', 'Salaries and Wages',        'الرواتب والأجور',                'expense',   'operating_expenses',       'debit',  true),
      ('5300', '5000', 'Rent Expense',              'مصروف الإيجار',                  'expense',   'operating_expenses',       'debit',  true),
      ('5400', '5000', 'Utilities Expense',         'مصروف الماء والكهرباء',          'expense',   'operating_expenses',       'debit',  true),
      ('5500', '5000', 'Depreciation Expense',      'مصروف الإهلاك',                  'expense',   'operating_expenses',       'debit',  true),
      ('5600', '5000', 'Office Supplies Expense',   'مصروف القرطاسية واللوازم',       'expense',   'operating_expenses',       'debit',  true),
      ('5700', '5000', 'Maintenance Expense',       'مصروف الصيانة',                  'expense',   'operating_expenses',       'debit',  true),
      ('5900', '5000', 'Other Expenses',            'مصروفات أخرى',                   'expense',   'other_expenses',           'debit',  true)
    ) as t(code, parent_code, name_en, name_ar, account_type, category_code, normal_balance, is_posting)
  loop
    insert into public.accounts
      (company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance, is_posting, created_by)
    values
      (p_company_id, r.code, r.name_en, r.name_ar,
       (select a.id from public.accounts a where a.company_id = p_company_id and a.code = r.parent_code),
       r.account_type::public.account_type, r.category_code, r.normal_balance::public.balance_side,
       r.is_posting, auth.uid());
  end loop;

  update public.company_settings s
     set retained_earnings_account_id = (select a.id from public.accounts a where a.company_id = p_company_id and a.code = '3200')
   where s.company_id = p_company_id;
end;
$$;

create or replace function public.create_company(
  p_name_en text,
  p_name_ar text,
  p_base_currency char(3) default 'IQD',
  p_fiscal_year_start date default null,
  p_seed_chart boolean default true
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_start date := coalesce(p_fiscal_year_start, date_trunc('year', current_date)::date);
  v_end date;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if btrim(coalesce(p_name_en, '')) = '' or btrim(coalesce(p_name_ar, '')) = '' then
    perform public._raise('COMPANY_NAME_REQUIRED');
  end if;

  insert into public.companies (name_en, name_ar, base_currency, created_by)
  values (btrim(p_name_en), btrim(p_name_ar), coalesce(p_base_currency, 'IQD'), auth.uid())
  returning id into v_company;

  insert into public.company_settings (company_id, fiscal_year_start_month)
  values (v_company, extract(month from v_start)::smallint);

  insert into public.user_roles (company_id, user_id, role, created_by)
  values (v_company, auth.uid(), 'admin', auth.uid());

  update public.profiles p set default_company_id = v_company
   where p.id = auth.uid() and (p.default_company_id is null
     or not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.company_id = p.default_company_id));

  v_end := (v_start + interval '1 year' - interval '1 day')::date;
  perform public.create_fiscal_year(
    v_company,
    case when extract(month from v_start) = 1 then to_char(v_start, 'YYYY')
         else to_char(v_start, 'YYYY') || '/' || to_char(v_end, 'YYYY') end,
    v_start, v_end, true);

  if coalesce(p_seed_chart, true) then
    perform public._seed_default_chart(v_company);
  end if;

  perform public._audit(v_company, 'companies', v_company, btrim(p_name_en), 'created', '{}'::jsonb);
  return v_company;
end;
$$;
