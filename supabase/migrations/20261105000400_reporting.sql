-- =============================================================================
-- Vio Accounting — reporting functions
-- All reports read posted ledger lines only (status posted or reversed; a
-- reversed entry stays in the ledger and is offset by its posted reversal).
-- Hierarchy roll-ups, balances and statements are assembled in
-- src/lib/accounting so the UI and PDF exports share one set of formulas.
-- =============================================================================

-- Per-account debit/credit sums. Lines dated before p_from are "opening";
-- lines from p_from to p_to are "period". When p_from is null every line up to
-- p_to is reported in the period columns.
-- p_mode filters entry types inside the reporting period:
--   all / post_closing : every posted entry
--   adjusted           : excludes closing entries
--   unadjusted         : excludes adjusting and closing entries
create or replace function public.account_balances(
  p_company_id uuid,
  p_from date default null,
  p_to date default null,
  p_mode text default 'all'
)
returns table (
  account_id uuid,
  opening_debit numeric,
  opening_credit numeric,
  period_debit numeric,
  period_credit numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_member(p_company_id);
  if coalesce(p_mode, 'all') not in ('all', 'unadjusted', 'adjusted', 'post_closing') then
    perform public._raise('INVALID_REPORT_MODE', p_mode);
  end if;

  return query
  with lines as (
    select l.account_id,
           l.debit_amount,
           l.credit_amount,
           (p_from is not null and e.entry_date < p_from) as is_opening,
           e.entry_type
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id
     where e.company_id = p_company_id
       and l.company_id = p_company_id
       and e.status in ('posted', 'reversed')
       and (p_to is null or e.entry_date <= p_to)
  )
  select x.account_id,
         coalesce(sum(x.debit_amount) filter (where x.is_opening), 0)::numeric,
         coalesce(sum(x.credit_amount) filter (where x.is_opening), 0)::numeric,
         coalesce(sum(x.debit_amount) filter (where not x.is_opening), 0)::numeric,
         coalesce(sum(x.credit_amount) filter (where not x.is_opening), 0)::numeric
    from lines x
   where x.is_opening
      or coalesce(p_mode, 'all') in ('all', 'post_closing')
      or (p_mode = 'adjusted' and x.entry_type <> 'closing')
      or (p_mode = 'unadjusted' and x.entry_type not in ('adjusting', 'closing'))
   group by x.account_id;
end;
$$;

-- Posted movements for one or more accounts, in ledger order.
create or replace function public.ledger_lines(
  p_company_id uuid,
  p_account_ids uuid[],
  p_from date default null,
  p_to date default null
)
returns table (
  line_id uuid,
  account_id uuid,
  entry_id uuid,
  entry_number text,
  entry_date date,
  entry_type public.entry_type,
  entry_status public.entry_status,
  voucher_id uuid,
  voucher_type public.voucher_type,
  voucher_number text,
  entry_description text,
  line_description text,
  debit_amount numeric,
  credit_amount numeric,
  line_number integer,
  counter_account_id uuid,
  counter_line_count integer,
  reversal_of_id uuid
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_member(p_company_id);
  return query
  select l.id, l.account_id, e.id, e.entry_number, e.entry_date, e.entry_type, e.status,
         e.voucher_id, e.voucher_type, e.voucher_number, e.description, l.description,
         l.debit_amount, l.credit_amount, l.line_number,
         c.counter_id, c.counter_count::integer, e.reversal_of_id
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    left join lateral (
      select (array_agg(o.account_id order by o.line_number))[1] as counter_id, count(*) as counter_count
        from public.journal_entry_lines o
       where o.journal_entry_id = l.journal_entry_id
         and ((l.debit_amount > 0 and o.credit_amount > 0) or (l.credit_amount > 0 and o.debit_amount > 0))
    ) c on true
   where e.company_id = p_company_id
     and l.company_id = p_company_id
     and e.status in ('posted', 'reversed')
     and l.account_id = any (p_account_ids)
     and (p_from is null or e.entry_date >= p_from)
     and (p_to is null or e.entry_date <= p_to)
   order by e.entry_date, e.entry_number, l.line_number;
end;
$$;

-- Paginated, filterable journal register.
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

create or replace function public.search_vouchers(
  p_company_id uuid,
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_types public.voucher_type[] default null,
  p_statuses public.voucher_status[] default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  voucher_type public.voucher_type,
  voucher_number text,
  voucher_date date,
  status public.voucher_status,
  party_name text,
  payment_method public.payment_method,
  amount numeric,
  currency_code char(3),
  description text,
  reference_number text,
  journal_entry_id uuid,
  journal_entry_number text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
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
  select v.id, v.voucher_type, v.voucher_number, v.voucher_date, v.status, v.party_name, v.payment_method,
         v.amount, v.currency_code, v.description, v.reference_number, v.journal_entry_id, e.entry_number,
         v.created_by, coalesce(p.full_name, p.email), v.created_at, count(*) over ()
    from public.vouchers v
    left join public.journal_entries e on e.id = v.journal_entry_id
    left join public.profiles p on p.id = v.created_by
   where v.company_id = p_company_id
     and (v_search is null
          or v.voucher_number ilike '%' || v_search || '%'
          or v.party_name ilike '%' || v_search || '%'
          or v.reference_number ilike '%' || v_search || '%'
          or v.description ilike '%' || v_search || '%')
     and (p_from is null or v.voucher_date >= p_from)
     and (p_to is null or v.voucher_date <= p_to)
     and (p_types is null or cardinality(p_types) = 0 or v.voucher_type = any (p_types))
     and (p_statuses is null or cardinality(p_statuses) = 0 or v.status = any (p_statuses))
   order by v.voucher_date desc, v.voucher_number desc
   limit greatest(1, least(coalesce(p_limit, 50), 1000))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public._display_name(p_user_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p.full_name, p.email) from public.profiles p where p.id = p_user_id;
$$;

create or replace function public._entity_history(p_entity_type text, p_entity_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'action', al.action,
           'actor_id', al.actor_id,
           'actor_name', public._display_name(al.actor_id),
           'created_at', al.created_at,
           'details', al.details) order by al.created_at, al.id), '[]'::jsonb)
    from public.audit_logs al
   where al.entity_type = p_entity_type and al.entity_id = p_entity_id;
$$;

create or replace function public._entity_attachments(p_entity_type text, p_entity_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'file_name', a.file_name, 'storage_path', a.storage_path, 'mime_type', a.mime_type,
           'size_bytes', a.size_bytes, 'uploaded_by_name', public._display_name(a.uploaded_by),
           'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
    from public.attachments a
   where a.entity_type = p_entity_type and a.entity_id = p_entity_id;
$$;

-- Complete journal entry document with lines, people, links and history.
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
                'debit_amount', l.debit_amount, 'credit_amount', l.credit_amount, 'description', l.description)
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

create or replace function public.get_voucher(p_voucher_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.vouchers%rowtype;
begin
  select * into v from public.vouchers x where x.id = p_voucher_id;
  if not found or not public.is_company_member(v.company_id) then
    perform public._raise('VOUCHER_NOT_FOUND');
  end if;

  return to_jsonb(v) || jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', l.id, 'line_number', l.line_number, 'account_id', l.account_id,
                'account_code', a.code, 'account_name_en', a.name_en, 'account_name_ar', a.name_ar,
                'debit_amount', l.debit_amount, 'credit_amount', l.credit_amount, 'description', l.description)
                order by l.line_number), '[]'::jsonb)
              from public.voucher_lines l join public.accounts a on a.id = l.account_id
              where l.voucher_id = v.id),
    'accounts', (select coalesce(jsonb_object_agg(a.id::text, jsonb_build_object(
                   'code', a.code, 'name_en', a.name_en, 'name_ar', a.name_ar)), '{}'::jsonb)
                 from public.accounts a
                 where a.id in (v.cash_account_id, v.counter_account_id, v.from_account_id, v.to_account_id)),
    'journal_entry_number', (select e.entry_number from public.journal_entries e where e.id = v.journal_entry_id),
    'journal_entry_status', (select e.status from public.journal_entries e where e.id = v.journal_entry_id),
    'created_by_name', public._display_name(v.created_by),
    'submitted_by_name', public._display_name(v.submitted_by),
    'approved_by_name', public._display_name(v.approved_by),
    'posted_by_name', public._display_name(v.posted_by),
    'reversed_by_name', public._display_name(v.reversed_by),
    'attachments', public._entity_attachments('voucher', v.id),
    'history', public._entity_history('voucher', v.id)
  );
end;
$$;

-- Journal lines for the daily journal report (PDF / CSV).
create or replace function public.journal_report_lines(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_statuses public.entry_status[] default array['posted', 'reversed']::public.entry_status[]
)
returns table (
  entry_id uuid,
  entry_number text,
  entry_date date,
  entry_type public.entry_type,
  status public.entry_status,
  voucher_type public.voucher_type,
  voucher_number text,
  entry_description text,
  reference_number text,
  line_number integer,
  account_code text,
  account_name_en text,
  account_name_ar text,
  line_description text,
  debit_amount numeric,
  credit_amount numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_member(p_company_id);
  return query
  select e.id, e.entry_number, e.entry_date, e.entry_type, e.status, e.voucher_type, e.voucher_number,
         e.description, e.reference_number, l.line_number, a.code, a.name_en, a.name_ar, l.description,
         l.debit_amount, l.credit_amount
    from public.journal_entries e
    join public.journal_entry_lines l on l.journal_entry_id = e.id
    join public.accounts a on a.id = l.account_id
   where e.company_id = p_company_id
     and (p_from is null or e.entry_date >= p_from)
     and (p_to is null or e.entry_date <= p_to)
     and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any (p_statuses))
   order by e.entry_date, e.entry_number, l.line_number
   limit 20000;
end;
$$;

create or replace function public.dashboard_summary(p_company_id uuid, p_today date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_period jsonb;
begin
  perform public._require_member(p_company_id);

  select jsonb_build_object('id', p.id, 'name', p.name, 'start_date', p.start_date, 'end_date', p.end_date,
                            'status', p.status, 'fiscal_year_id', fy.id, 'fiscal_year_name', fy.name,
                            'fiscal_year_start', fy.start_date, 'fiscal_year_end', fy.end_date,
                            'fiscal_year_status', fy.status)
    into v_period
    from public.accounting_periods p
    join public.fiscal_years fy on fy.id = p.fiscal_year_id
   where p.company_id = p_company_id
   order by (v_today between p.start_date and p.end_date) desc,
            (p.status = 'open') desc,
            abs(p.start_date - v_today)
   limit 1;

  return jsonb_build_object(
    'entries', (select jsonb_build_object(
                  'draft', count(*) filter (where e.status = 'draft'),
                  'pending_approval', count(*) filter (where e.status = 'pending_approval'),
                  'posted', count(*) filter (where e.status = 'posted'),
                  'reversed', count(*) filter (where e.status = 'reversed'))
                from public.journal_entries e where e.company_id = p_company_id),
    'vouchers', (select jsonb_build_object(
                  'draft', count(*) filter (where x.status = 'draft'),
                  'pending_approval', count(*) filter (where x.status = 'pending_approval'),
                  'posted', count(*) filter (where x.status = 'posted'),
                  'reversed', count(*) filter (where x.status = 'reversed'))
                from public.vouchers x where x.company_id = p_company_id),
    'current_period', v_period,
    'last_posted_at', (select max(e.posted_at) from public.journal_entries e where e.company_id = p_company_id),
    'posting_accounts', (select count(*) from public.accounts a
                         where a.company_id = p_company_id and a.is_posting and a.is_active),
    'open_periods', (select count(*) from public.accounting_periods p
                     where p.company_id = p_company_id and p.status = 'open')
  );
end;
$$;

create or replace function public.search_audit_logs(
  p_company_id uuid,
  p_entity_type text default null,
  p_action text default null,
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  entity_type text,
  entity_id uuid,
  entity_label text,
  action text,
  actor_id uuid,
  actor_name text,
  details jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public._require_permission(p_company_id, 'audit.view');
  return query
  select al.id, al.entity_type, al.entity_id, al.entity_label, al.action, al.actor_id,
         public._display_name(al.actor_id), al.details, al.created_at, count(*) over ()
    from public.audit_logs al
   where al.company_id = p_company_id
     and (p_entity_type is null or al.entity_type = p_entity_type)
     and (p_action is null or al.action = p_action)
     and (p_from is null or al.created_at >= p_from::timestamptz)
     and (p_to is null or al.created_at < (p_to + 1)::timestamptz)
     and (v_search is null or al.entity_label ilike '%' || v_search || '%')
   order by al.created_at desc, al.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
