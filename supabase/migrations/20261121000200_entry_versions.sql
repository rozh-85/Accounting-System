-- =============================================================================
-- Vio Accounting — every edit of a journal entry is a numbered version
-- The first save is version 1; each later edit, before or after posting, is
-- 1.1, 1.2, and so on. Each edit's audit row keeps who made it, when, and the
-- entry before and after, so the entry page can show exactly what changed and
-- by whom. Nothing about the entries themselves changes: numbers stay as they are.
-- =============================================================================

-- What an entry looked like, for the audit log.
create or replace function public._entry_snapshot(p_entry_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'entry_date', e.entry_date, 'entry_type', e.entry_type, 'description', e.description,
    'reference', e.reference_number, 'notes', e.notes, 'voucher_type', e.voucher_type, 'voucher_number', e.voucher_number,
    'total', e.total_debit, 'foreign_currency', e.foreign_currency, 'exchange_rate', e.exchange_rate,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'account', a.code, 'debit', l.debit_amount, 'credit', l.credit_amount, 'description', l.description,
                'foreign_debit', l.foreign_debit, 'foreign_credit', l.foreign_credit) order by l.line_number), '[]'::jsonb)
                from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
               where l.journal_entry_id = e.id))
    from public.journal_entries e where e.id = p_entry_id;
$$;

revoke execute on function public._entry_snapshot(uuid) from public, anon, authenticated;

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
  v_version int;
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
      perform set_config('vio.posted_edit', v_entry.id::text, true);
    elsif v_entry.status <> 'draft' then
      perform public._raise('ENTRY_NOT_EDITABLE', v_entry.entry_number);
    end if;
    v_before := public._entry_snapshot(v_entry.id);
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

  -- Every edit is a new version of the entry: 1.1, 1.2, ... The audit row keeps
  -- the entry as it was and as it became, and who changed it.
  if p_entry_id is not null then
    select count(*)::int + 1 into v_version
      from public.audit_logs al
     where al.entity_type = 'journal_entry' and al.entity_id = v_id
       and al.action in ('updated', 'edited_after_posting');
  end if;

  if v_posted_edit then
    -- Same checks as posting, and the new date's period must be open too.
    update public.journal_entries e set period_id = public._validate_entry(v_entry) where e.id = v_id;
    perform set_config('vio.posted_edit', '', true);
    perform public._audit(p_company_id, 'journal_entry', v_id, v_entry.entry_number, 'edited_after_posting',
      jsonb_build_object('version', v_version, 'before', v_before, 'after', public._entry_snapshot(v_id),
                         'total_debit', v_entry.total_debit, 'total_credit', v_entry.total_credit));
    return v_id;
  end if;

  perform public._audit(p_company_id, 'journal_entry', v_id, v_entry.entry_number,
    case when p_entry_id is null then 'created' else 'updated' end,
    jsonb_build_object('total_debit', v_entry.total_debit, 'total_credit', v_entry.total_credit,
                       'lines', jsonb_array_length(p_lines))
    || case when p_entry_id is null then '{}'::jsonb
            else jsonb_build_object('version', v_version, 'before', v_before, 'after', public._entry_snapshot(v_id)) end);
  return v_id;
end;
$$;


-- The journal list shows how many times each entry was edited.
drop function if exists public.search_journal_entries(uuid, text, date, date, public.entry_status[], public.entry_type[], uuid, public.voucher_type, uuid, integer, integer);

create or replace function public.search_journal_entries(
  p_company_id uuid,
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_statuses public.entry_status[] default null,
  p_entry_types public.entry_type[] default null,
  p_account_id uuid default null,
  p_voucher_type public.voucher_type default null,
  p_created_by uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  entry_number text,
  entry_date date,
  entry_type public.entry_type,
  status public.entry_status,
  voucher_id uuid,
  voucher_type public.voucher_type,
  voucher_number text,
  description text,
  reference_number text,
  total_debit numeric,
  total_credit numeric,
  currency_code char(3),
  source text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  posted_at timestamptz,
  reversal_of_id uuid,
  attachment_count bigint,
  edit_count integer,
  total_count bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public._require_member(p_company_id);
  return query
  select e.id, e.entry_number, e.entry_date, e.entry_type, e.status, e.voucher_id, e.voucher_type,
         e.voucher_number, e.description, e.reference_number, e.total_debit, e.total_credit, e.currency_code,
         e.source, e.created_by, coalesce(p.full_name, p.email), e.created_at, e.posted_at, e.reversal_of_id,
         (select count(*) from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = e.id),
         (select count(*)::int from public.audit_logs al
           where al.entity_type = 'journal_entry' and al.entity_id = e.id and al.action in ('updated', 'edited_after_posting')),
         count(*) over ()
    from public.journal_entries e
    left join public.profiles p on p.id = e.created_by
   where e.company_id = p_company_id
     and (v_search is null
          or e.entry_number ilike '%' || v_search || '%'
          or e.voucher_number ilike '%' || v_search || '%'
          or e.reference_number ilike '%' || v_search || '%'
          or e.description ilike '%' || v_search || '%')
     and (p_from is null or e.entry_date >= p_from)
     and (p_to is null or e.entry_date <= p_to)
     and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any (p_statuses))
     and (p_entry_types is null or cardinality(p_entry_types) = 0 or e.entry_type = any (p_entry_types))
     and (p_voucher_type is null or e.voucher_type = p_voucher_type)
     and (p_created_by is null or e.created_by = p_created_by)
     and (p_account_id is null or exists (
            select 1 from public.journal_entry_lines l
            where l.journal_entry_id = e.id and l.account_id = p_account_id))
   order by e.entry_date desc, e.entry_number desc
   limit greatest(1, least(coalesce(p_limit, 50), 1000))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke execute on function public.search_journal_entries(uuid, text, date, date, public.entry_status[], public.entry_type[], uuid, public.voucher_type, uuid, integer, integer) from public, anon;
grant execute on function public.search_journal_entries(uuid, text, date, date, public.entry_status[], public.entry_type[], uuid, public.voucher_type, uuid, integer, integer) to authenticated;
