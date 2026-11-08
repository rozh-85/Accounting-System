-- =============================================================================
-- Vio Accounting — edit and delete posted entries, dollars, earlier dates
--
-- 1. A posted journal entry can now be edited or deleted by a user who may both
--    edit drafts and reverse entries, while its period is open. The change hits
--    the ledger at once and the previous figures are kept in the audit log.
--    Any entry can be deleted; only one that belongs to a voucher cannot be edited.
-- 2. An entry can be typed in US dollars with the day's rate. The books stay in
--    the company's base currency: each line is converted when it is saved, and
--    the typed dollars and the rate are kept beside it. exchange_rate means
--    "base currency per 1 unit of foreign_currency".
-- 3. An entry dated outside every fiscal year no longer fails: the missing year
--    and its monthly periods are opened automatically when it is posted.
-- 4. Document numbers follow the highest number in use, so deleting the latest
--    document frees its number, and existing gaps in entry numbers are closed.
-- =============================================================================

alter table public.journal_entries
  add column if not exists foreign_currency char(3) references public.currencies (code);

alter table public.journal_entry_lines
  add column if not exists foreign_debit numeric(20, 4) check (foreign_debit >= 0),
  add column if not exists foreign_credit numeric(20, 4) check (foreign_credit >= 0);

-- ---------------------------------------------------------------------------
-- Guards: a posted entry may change only inside save_journal_entry or
-- delete_journal_entry, which name it in a setting that lasts one transaction.
-- API callers cannot set it.
-- ---------------------------------------------------------------------------
create or replace function public._guard_journal_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_count int;
  v_debit_lines int;
  v_credit_lines int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      perform public._raise('INVALID_STATUS_TRANSITION', 'insert:' || new.status);
    end if;
    return new;
  end if;

  if current_setting('vio.posted_edit', true) = old.id::text then
    if tg_op = 'DELETE' then
      return old;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      perform public._raise('POSTED_ENTRY_IMMUTABLE', old.entry_number);
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status in ('posted', 'reversed') then
    if not (old.status = 'posted' and new.status = 'reversed') then
      perform public._raise('POSTED_ENTRY_IMMUTABLE', old.entry_number);
    end if;
    if (new.company_id, new.entry_number, new.entry_date, new.entry_type, new.voucher_id,
        new.description, new.currency_code, new.exchange_rate, new.total_debit, new.total_credit,
        new.period_id, new.posted_by, new.posted_at, new.created_by, new.approved_by, new.reversal_of_id)
       is distinct from
       (old.company_id, old.entry_number, old.entry_date, old.entry_type, old.voucher_id,
        old.description, old.currency_code, old.exchange_rate, old.total_debit, old.total_credit,
        old.period_id, old.posted_by, old.posted_at, old.created_by, old.approved_by, old.reversal_of_id) then
      perform public._raise('POSTED_ENTRY_IMMUTABLE', old.entry_number);
    end if;
  end if;

  if new.status = 'reversed' and old.status <> 'posted' then
    perform public._raise('INVALID_STATUS_TRANSITION', old.status || '->reversed');
  end if;

  if new.status = 'posted' and old.status <> 'posted' then
    select coalesce(sum(l.debit_amount), 0), coalesce(sum(l.credit_amount), 0), count(*),
           count(*) filter (where l.debit_amount > 0), count(*) filter (where l.credit_amount > 0)
      into v_debit, v_credit, v_count, v_debit_lines, v_credit_lines
      from public.journal_entry_lines l
     where l.journal_entry_id = new.id;
    if v_count < 2 or v_debit_lines < 1 or v_credit_lines < 1 then
      perform public._raise('ENTRY_MIN_LINES', new.entry_number);
    end if;
    if v_debit <> v_credit or v_debit <= 0 then
      perform public._raise('ENTRY_UNBALANCED', new.entry_number);
    end if;
    if new.total_debit <> v_debit or new.total_credit <> v_credit then
      perform public._raise('ENTRY_TOTALS_MISMATCH', new.entry_number);
    end if;
    if new.period_id is null or new.posted_at is null then
      perform public._raise('INVALID_STATUS_TRANSITION', 'missing posting metadata');
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public._guard_journal_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.entry_status;
  v_entry_id uuid := case when tg_op = 'DELETE' then old.journal_entry_id else new.journal_entry_id end;
begin
  select e.status into v_status from public.journal_entries e where e.id = v_entry_id;

  if v_status is not null and v_status <> 'draft'
     and current_setting('vio.posted_edit', true) is distinct from v_entry_id::text then
    perform public._raise('POSTED_ENTRY_IMMUTABLE');
  end if;
  if tg_op = 'UPDATE' and new.journal_entry_id <> old.journal_entry_id then
    perform public._raise('POSTED_ENTRY_IMMUTABLE');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Earlier (or later) dates: open the missing fiscal year automatically
-- ---------------------------------------------------------------------------
create or replace function public._create_period_for(p_company_id uuid, p_date date)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_month smallint;
  v_start date;
  v_end date;
  v_previous date;
  v_next date;
  v_name text;
  v_year uuid;
  v_cursor date;
  v_period_end date;
  v_index int := 0;
  v_period uuid;
  v_found uuid;
begin
  -- A date this far away is a typing mistake, not a missing year.
  if p_date < (current_date - interval '20 years')::date or p_date > (current_date + interval '2 years')::date then
    perform public._raise('PERIOD_MISSING', p_date::text);
  end if;

  -- Two entries posted at once must not both create the year.
  perform 1 from public.companies c where c.id = p_company_id for update;
  select p.id into v_period from public.accounting_periods p
   where p.company_id = p_company_id and p_date between p.start_date and p.end_date
   limit 1;
  if v_period is not null then
    return v_period;
  end if;

  select coalesce((select s.fiscal_year_start_month from public.company_settings s where s.company_id = p_company_id), 1)
    into v_month;
  v_start := make_date(extract(year from p_date)::int - case when extract(month from p_date) < v_month then 1 else 0 end, v_month, 1);
  v_end := (v_start + interval '1 year' - interval '1 day')::date;

  -- Fit between the neighbouring years, which may not start on a month boundary.
  select max(f.end_date) into v_previous from public.fiscal_years f where f.company_id = p_company_id and f.end_date < p_date;
  select min(f.start_date) into v_next from public.fiscal_years f where f.company_id = p_company_id and f.start_date > p_date;
  v_start := greatest(v_start, v_previous + 1);
  v_end := least(v_end, v_next - 1);
  if v_end <= v_start then
    v_start := v_end - 1;   -- a fiscal year needs at least two days
  end if;

  v_name := case when extract(year from v_start) = extract(year from v_end) then to_char(v_start, 'YYYY')
                 else to_char(v_start, 'YYYY') || '/' || to_char(v_end, 'YYYY') end;
  if exists (select 1 from public.fiscal_years f where f.company_id = p_company_id and f.name = v_name) then
    v_name := v_name || ' (' || to_char(v_start, 'DD/MM') || ')';
  end if;

  insert into public.fiscal_years (company_id, name, start_date, end_date, created_by)
  values (p_company_id, v_name, v_start, v_end, auth.uid())
  returning id into v_year;

  v_cursor := v_start;
  while v_cursor <= v_end loop
    v_index := v_index + 1;
    v_period_end := least((date_trunc('month', v_cursor) + interval '1 month' - interval '1 day')::date, v_end);
    insert into public.accounting_periods (company_id, fiscal_year_id, period_number, name, start_date, end_date)
    values (p_company_id, v_year, v_index, to_char(v_cursor, 'YYYY-MM'), v_cursor, v_period_end)
    returning id into v_period;
    if p_date between v_cursor and v_period_end then
      v_found := v_period;
    end if;
    v_cursor := v_period_end + 1;
  end loop;

  return v_found;
end;
$$;

create or replace function public._open_period_for(p_company_id uuid, p_date date)
returns uuid
language plpgsql security definer
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
    return public._create_period_for(p_company_id, p_date);
  end if;
  if v_period_status <> 'open' or v_year_status <> 'open' then
    perform public._raise('PERIOD_CLOSED', p_date::text);
  end if;
  return v_period_id;
end;
$$;

-- These two called the lookup as read-only; it can now write.
alter function public._validate_entry(public.journal_entries) volatile;
alter function public._voucher_journal_lines(public.vouchers) volatile;

-- ---------------------------------------------------------------------------
-- Helpers for saving
-- ---------------------------------------------------------------------------
-- Stops a non-draft entry being changed unless this user may. Rejects a closed period.
create or replace function public._assert_posted_changeable(p_entry public.journal_entries)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_permission(p_entry.company_id, 'entries.reverse');
  perform public._open_period_for(p_entry.company_id, p_entry.entry_date);
end;
$$;

-- What an entry looked like, for the audit log.
create or replace function public._entry_snapshot(p_entry_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'entry_date', e.entry_date, 'description', e.description, 'reference', e.reference_number,
    'total', e.total_debit, 'foreign_currency', e.foreign_currency, 'exchange_rate', e.exchange_rate,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('account', a.code, 'debit', l.debit_amount, 'credit', l.credit_amount) order by l.line_number), '[]'::jsonb)
                from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
               where l.journal_entry_id = e.id))
    from public.journal_entries e where e.id = p_entry_id;
$$;

-- Converts typed foreign amounts to base currency, line by line. When the typed
-- amounts balance but rounding leaves the base amounts apart, the largest credit
-- line takes the difference.
create or replace function public._lines_to_base(p_lines jsonb, p_rate numeric, p_base_decimals smallint, p_foreign_decimals smallint)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_line jsonb;
  v_index int := 0;
  v_fd numeric; v_fc numeric; v_d numeric; v_c numeric;
  v_sum_fd numeric := 0; v_sum_fc numeric := 0; v_sum_d numeric := 0; v_sum_c numeric := 0;
  v_largest int;
  v_largest_amount numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return p_lines;  -- _write_entry_lines reports it
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    v_fd := public._to_amount(v_line ->> 'debit_amount', v_index);
    v_fc := public._to_amount(v_line ->> 'credit_amount', v_index);
    perform public._check_amount(v_fd, p_foreign_decimals, v_index);
    perform public._check_amount(v_fc, p_foreign_decimals, v_index);
    v_d := round(v_fd * p_rate, p_base_decimals);
    v_c := round(v_fc * p_rate, p_base_decimals);
    v_sum_fd := v_sum_fd + v_fd; v_sum_fc := v_sum_fc + v_fc;
    v_sum_d := v_sum_d + v_d; v_sum_c := v_sum_c + v_c;
    if v_c > v_largest_amount then
      v_largest_amount := v_c;
      v_largest := v_index - 1;
    end if;
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object('debit_amount', v_d, 'credit_amount', v_c));
  end loop;
  if v_sum_fd = v_sum_fc and v_sum_d <> v_sum_c and v_largest is not null then
    v_out := jsonb_set(v_out, array[v_largest::text, 'credit_amount'], to_jsonb(v_largest_amount + v_sum_d - v_sum_c));
  end if;
  return v_out;
end;
$$;

revoke execute on function public._create_period_for(uuid, date) from public, anon, authenticated;
revoke execute on function public._assert_posted_changeable(public.journal_entries) from public, anon, authenticated;
revoke execute on function public._entry_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public._lines_to_base(jsonb, numeric, smallint, smallint) from public, anon, authenticated;

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
  v_foreign char(3) := nullif(upper(btrim(coalesce(p_header ->> 'foreign_currency', ''))), '');
  v_foreign_decimals smallint;
  v_rate numeric;
  v_lines jsonb := p_lines;
  v_posted_edit boolean := false;
  v_before jsonb;
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

  if v_foreign = v_currency then
    v_foreign := null;
  end if;
  if v_foreign is not null then
    select c.decimals into v_foreign_decimals from public.currencies c where c.code = v_foreign;
    if not found then
      perform public._raise('CURRENCY_NOT_SUPPORTED', v_foreign);
    end if;
    begin
      v_rate := nullif(btrim(coalesce(p_header ->> 'exchange_rate', '')), '')::numeric;
    exception when others then
      perform public._raise('EXCHANGE_RATE_INVALID');
    end;
    if v_rate is null or v_rate <= 0 or v_rate >= 1e10 or round(v_rate, 8) <> v_rate then
      perform public._raise('EXCHANGE_RATE_INVALID');
    end if;
    v_lines := public._lines_to_base(p_lines, v_rate, v_decimals, v_foreign_decimals);
  end if;

  if p_entry_id is null then
    insert into public.journal_entries
      (company_id, entry_number, entry_date, entry_type, voucher_type, voucher_number, description,
       notes, reference_number, currency_code, foreign_currency, exchange_rate, created_by, source)
    values
      (p_company_id, public._next_document_number(p_company_id, 'JE', v_date), v_date, v_type,
       v_voucher_type, nullif(btrim(coalesce(p_header ->> 'voucher_number', '')), ''), v_description,
       nullif(btrim(coalesce(p_header ->> 'notes', '')), ''),
       nullif(btrim(coalesce(p_header ->> 'reference_number', '')), ''),
       v_currency, v_foreign, coalesce(v_rate, 1), auth.uid(), 'manual')
    returning id into v_id;
  else
    select * into v_entry from public.journal_entries e
     where e.id = p_entry_id and e.company_id = p_company_id
     for update;
    if not found then
      perform public._raise('ENTRY_NOT_FOUND');
    end if;
    if v_entry.status in ('posted', 'reversed') then
      if v_entry.voucher_id is not null then
        perform public._raise('ENTRY_NOT_EDITABLE', v_entry.entry_number);  -- the voucher would no longer match
      end if;
      perform public._assert_posted_changeable(v_entry);
      v_posted_edit := true;
      v_before := public._entry_snapshot(v_entry.id);
      perform set_config('vio.posted_edit', v_entry.id::text, true);
    elsif v_entry.status <> 'draft' then
      perform public._raise('ENTRY_NOT_EDITABLE', v_entry.entry_number);
    end if;
    update public.journal_entries e
       set entry_date = v_date,
           entry_type = v_type,
           voucher_type = v_voucher_type,
           voucher_number = nullif(btrim(coalesce(p_header ->> 'voucher_number', '')), ''),
           description = v_description,
           notes = nullif(btrim(coalesce(p_header ->> 'notes', '')), ''),
           reference_number = nullif(btrim(coalesce(p_header ->> 'reference_number', '')), ''),
           foreign_currency = v_foreign,
           exchange_rate = coalesce(v_rate, 1)
     where e.id = p_entry_id;
    v_id := p_entry_id;
  end if;

  perform public._write_entry_lines(v_id, p_company_id, v_lines);

  if v_foreign is not null then
    update public.journal_entry_lines l
       set foreign_debit = public._to_amount(x.value ->> 'debit_amount'),
           foreign_credit = public._to_amount(x.value ->> 'credit_amount')
      from jsonb_array_elements(p_lines) with ordinality as x(value, position)
     where l.journal_entry_id = v_id and l.line_number = x.position;
  end if;

  select * into v_entry from public.journal_entries e where e.id = v_id;

  if v_posted_edit then
    -- Same checks as posting, and the new date's period must be open too.
    update public.journal_entries e set period_id = public._validate_entry(v_entry) where e.id = v_id;
    perform set_config('vio.posted_edit', '', true);
    perform public._audit(p_company_id, 'journal_entry', v_id, v_entry.entry_number, 'edited_after_posting',
      jsonb_build_object('before', v_before, 'total_debit', v_entry.total_debit, 'total_credit', v_entry.total_credit));
    return v_id;
  end if;

  perform public._audit(p_company_id, 'journal_entry', v_id, v_entry.entry_number,
    case when p_entry_id is null then 'created' else 'updated' end,
    jsonb_build_object('total_debit', v_entry.total_debit, 'total_credit', v_entry.total_credit,
                       'lines', jsonb_array_length(p_lines)));
  return v_id;
end;
$$;

-- Deletes any entry whose period is open. What it is linked to goes with it: a
-- reversed entry takes its reversal, deleting a reversal puts the original back
-- to posted, and an entry that belongs to a voucher takes the voucher.
create or replace function public.delete_journal_entry(p_entry_id uuid)
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_pair public.journal_entries%rowtype;
  v_voucher public.vouchers%rowtype;
  v_paths text[];
  v_voucher_paths text[];
  v_before jsonb;
  v_table text;
  v_tables text[] := array['journal_entries', 'journal_entry_lines', 'vouchers', 'voucher_lines'];
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.edit_draft');
  if v_entry.status <> 'draft' then
    perform public._assert_posted_changeable(v_entry);
  end if;
  v_before := public._entry_snapshot(v_entry.id);
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = p_entry_id;
  delete from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = p_entry_id;

  if v_entry.voucher_id is null and v_entry.reversal_of_id is null and v_entry.reversed_entry_id is null then
    perform set_config('vio.posted_edit', v_entry.id::text, true);
    delete from public.journal_entries e where e.id = p_entry_id;
    perform set_config('vio.posted_edit', '', true);
  else
    if v_entry.reversed_entry_id is not null then
      select * into v_pair from public.journal_entries e where e.id = v_entry.reversed_entry_id for update;
      perform public._open_period_for(v_pair.company_id, v_pair.entry_date);
    end if;

    -- Several linked documents change together, so the guards stay off for the
    -- rest of this transaction; the table lock makes other writers wait.
    foreach v_table in array v_tables loop
      execute format('alter table public.%I disable trigger user', v_table);
    end loop;

    if v_entry.reversal_of_id is not null then
      update public.journal_entries e
         set status = 'posted', reversed_by = null, reversed_at = null, reversed_entry_id = null
       where e.id = v_entry.reversal_of_id;
      update public.vouchers v
         set status = 'posted', reversed_by = null, reversed_at = null
       where v.journal_entry_id = v_entry.reversal_of_id;
    end if;

    if v_entry.reversed_entry_id is not null then
      update public.journal_entries e set reversed_entry_id = null where e.id = v_entry.id;
      delete from public.journal_entries e where e.id = v_pair.id;
      perform public._audit(v_entry.company_id, 'journal_entry', v_pair.id, v_pair.entry_number, 'deleted',
        jsonb_build_object('status', v_pair.status, 'reversal_of', v_entry.entry_number));
    end if;

    if v_entry.voucher_id is not null then
      select * into v_voucher from public.vouchers x where x.id = v_entry.voucher_id for update;
      select coalesce(array_agg(a.storage_path), '{}') into v_voucher_paths
        from public.attachments a where a.entity_type = 'voucher' and a.entity_id = v_voucher.id;
      v_paths := v_paths || v_voucher_paths;
      delete from public.attachments a where a.entity_type = 'voucher' and a.entity_id = v_voucher.id;
      update public.vouchers x set journal_entry_id = null where x.id = v_voucher.id;
      update public.journal_entries e set voucher_id = null where e.id = v_entry.id;
      delete from public.vouchers x where x.id = v_voucher.id;
      perform public._audit(v_entry.company_id, 'voucher', v_voucher.id, v_voucher.voucher_number, 'deleted',
        jsonb_build_object('status', v_voucher.status, 'journal_entry', v_entry.entry_number));
    end if;

    delete from public.journal_entries e where e.id = p_entry_id;

    foreach v_table in array v_tables loop
      execute format('alter table public.%I enable trigger user', v_table);
    end loop;
  end if;

  perform public._audit(v_entry.company_id, 'journal_entry', v_entry.id, v_entry.entry_number, 'deleted',
    jsonb_build_object('status', v_entry.status, 'before', v_before));
  return v_paths;
end;
$$;

create or replace function public.get_journal_entry(p_entry_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  e public.journal_entries%rowtype;
begin
  select * into e from public.journal_entries x where x.id = p_entry_id;
  if not found or not public.is_company_member(e.company_id) then
    perform public._raise('ENTRY_NOT_FOUND');
  end if;

  return to_jsonb(e) || jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', l.id, 'line_number', l.line_number, 'account_id', l.account_id,
                'account_code', a.code, 'account_name_en', a.name_en, 'account_name_ar', a.name_ar,
                'debit_amount', l.debit_amount, 'credit_amount', l.credit_amount, 'description', l.description,
                'foreign_debit', l.foreign_debit, 'foreign_credit', l.foreign_credit)
                order by l.line_number), '[]'::jsonb)
              from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
              where l.journal_entry_id = e.id),
    'created_by_name', public._display_name(e.created_by),
    'submitted_by_name', public._display_name(e.submitted_by),
    'approved_by_name', public._display_name(e.approved_by),
    'posted_by_name', public._display_name(e.posted_by),
    'reversed_by_name', public._display_name(e.reversed_by),
    'reversal_of_number', (select x.entry_number from public.journal_entries x where x.id = e.reversal_of_id),
    'reversed_entry_number', (select x.entry_number from public.journal_entries x where x.id = e.reversed_entry_id),
    'period_name', (select p.name from public.accounting_periods p where p.id = e.period_id),
    'attachments', public._entity_attachments('journal_entry', e.id),
    'history', public._entity_history('journal_entry', e.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Document numbers: next after the highest in use
-- ---------------------------------------------------------------------------
create or replace function public._next_document_number(p_company_id uuid, p_doc_type text, p_date date)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from p_date)::int;
  v_prefix text := p_doc_type || '-' || v_year::text || '-';
  v_highest bigint;
  v_value bigint;
begin
  -- The row lock makes two people saving at once take turns.
  insert into public.document_sequences as s (company_id, doc_type, year, next_value)
  values (p_company_id, p_doc_type, v_year, 1)
  on conflict (company_id, doc_type, year)
  do update set next_value = s.next_value;

  if p_doc_type = 'JE' then
    select max(substring(e.entry_number from length(v_prefix) + 1)::bigint) into v_highest
      from public.journal_entries e
     where e.company_id = p_company_id and e.entry_number ~ ('^' || v_prefix || '[0-9]+$');
  else
    select max(substring(x.voucher_number from length(v_prefix) + 1)::bigint) into v_highest
      from public.vouchers x
     where x.company_id = p_company_id and x.voucher_number ~ ('^' || v_prefix || '[0-9]+$');
  end if;

  v_value := coalesce(v_highest, 0) + 1;
  update public.document_sequences s
     set next_value = v_value + 1
   where s.company_id = p_company_id and s.doc_type = p_doc_type and s.year = v_year;

  return v_prefix || lpad(v_value::text, 5, '0');
end;
$$;

-- One-time: close the gaps deleted entries left, keeping the order. Each entry
-- only ever moves down into a number already freed.
do $$
declare
  r record;
  v_group text := '';
  v_count int := 0;
  v_new text;
begin
  alter table public.journal_entries disable trigger user;

  for r in
    select e.id, e.company_id, e.entry_number, substring(e.entry_number from 4 for 4) as year_text
      from public.journal_entries e
     where e.entry_number ~ '^JE-[0-9]{4}-[0-9]+$'
     order by e.company_id, 4, substring(e.entry_number from 9)::bigint
  loop
    if v_group <> r.company_id::text || r.year_text then
      v_group := r.company_id::text || r.year_text;
      v_count := 0;
    end if;
    v_count := v_count + 1;
    v_new := 'JE-' || r.year_text || '-' || lpad(v_count::text, 5, '0');
    if v_new <> r.entry_number then
      update public.journal_entries e set entry_number = v_new where e.id = r.id;
      -- A reversal quotes the number of the entry it reverses.
      update public.journal_entries e
         set reference_number = v_new
       where e.reversal_of_id = r.id and e.reference_number = r.entry_number;
    end if;
  end loop;

  alter table public.journal_entries enable trigger user;
end;
$$;
