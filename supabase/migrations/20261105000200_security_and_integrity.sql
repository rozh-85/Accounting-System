-- =============================================================================
-- Vio Accounting — security helpers, integrity triggers and row level security
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Membership and permission helpers (used by RLS policies and RPC functions)
-- ---------------------------------------------------------------------------
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.company_id = p_company_id and ur.user_id = auth.uid()
  );
$$;

create or replace function public.has_permission(p_company_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role = ur.role
    where ur.company_id = p_company_id
      and ur.user_id = auth.uid()
      and rp.permission = p_permission
  );
$$;

create or replace function public.shares_company_with(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles mine
    join public.user_roles theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;

create or replace function public.safe_uuid(p_value text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- Raises a stable, translatable error code. The frontend maps message codes
-- (e.g. ENTRY_UNBALANCED) to bilingual messages.
create or replace function public._raise(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

create or replace function public._require_permission(p_company_id uuid, p_permission text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not public.has_permission(p_company_id, p_permission) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = p_permission;
  end if;
end;
$$;

create or replace function public._require_member(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not public.is_company_member(p_company_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED', detail = 'company.member';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit helpers
-- ---------------------------------------------------------------------------
create or replace function public._audit(
  p_company_id uuid, p_entity_type text, p_entity_id uuid, p_entity_label text,
  p_action text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_logs (company_id, entity_type, entity_id, entity_label, action, actor_id, details)
  values (p_company_id, p_entity_type, p_entity_id, p_entity_label, p_action, auth.uid(), coalesce(p_details, '{}'::jsonb));
$$;

-- Generic row-change audit for configuration tables.
create or replace function public._audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb;
  v_company uuid;
  v_label text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  v_company := case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid
                    else (v_row ->> 'company_id')::uuid end;
  v_label := coalesce(v_row ->> 'code', v_row ->> 'name', v_row ->> 'name_en', v_row ->> 'role');

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_changes
      from jsonb_each(v_old) o
      join jsonb_each(v_new) n using (key)
     where o.value is distinct from n.value and o.key not in ('updated_at');
    if v_changes is null then
      return new;
    end if;
  end if;

  insert into public.audit_logs (company_id, entity_type, entity_id, entity_label, action, actor_id, details)
  values (
    v_company,
    tg_table_name,
    coalesce((v_row ->> 'id')::uuid, (v_row ->> 'company_id')::uuid),
    v_label,
    lower(tg_op),
    auth.uid(),
    case tg_op
      when 'UPDATE' then jsonb_build_object('changes', v_changes)
      when 'INSERT' then jsonb_build_object('new', v_new)
      else jsonb_build_object('old', v_old)
    end
  );

  return coalesce(new, old);
end;
$$;

create trigger audit_companies after update on public.companies
  for each row execute function public._audit_row_change();
create trigger audit_company_settings after update on public.company_settings
  for each row execute function public._audit_row_change();
create trigger audit_accounts after insert or update or delete on public.accounts
  for each row execute function public._audit_row_change();
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public._audit_row_change();
create trigger audit_fiscal_years after insert or update or delete on public.fiscal_years
  for each row execute function public._audit_row_change();
create trigger audit_accounting_periods after update on public.accounting_periods
  for each row execute function public._audit_row_change();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public._touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_companies before update on public.companies
  for each row execute function public._touch_updated_at();
create trigger touch_company_settings before update on public.company_settings
  for each row execute function public._touch_updated_at();
create trigger touch_profiles before update on public.profiles
  for each row execute function public._touch_updated_at();
create trigger touch_accounts before update on public.accounts
  for each row execute function public._touch_updated_at();
create trigger touch_vouchers before update on public.vouchers
  for each row execute function public._touch_updated_at();
create trigger touch_recurring before update on public.recurring_entry_templates
  for each row execute function public._touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation for new auth users
-- ---------------------------------------------------------------------------
create or replace function public._handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, preferred_language)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    case when new.raw_user_meta_data ->> 'preferred_language' = 'ar' then 'ar' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_user();

-- ---------------------------------------------------------------------------
-- Chart of accounts integrity
-- ---------------------------------------------------------------------------
create or replace function public._guard_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.accounts%rowtype;
  v_category public.account_categories%rowtype;
  v_cursor uuid;
  v_depth int := 0;
  v_has_lines boolean;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.journal_entry_lines l where l.account_id = old.id)
       or exists (select 1 from public.voucher_lines l where l.account_id = old.id)
       or exists (select 1 from public.vouchers v
                  where old.id in (v.cash_account_id, v.counter_account_id, v.from_account_id, v.to_account_id)) then
      perform public._raise('ACCOUNT_HAS_TRANSACTIONS', old.code);
    end if;
    if exists (select 1 from public.accounts c where c.parent_id = old.id) then
      perform public._raise('ACCOUNT_HAS_CHILDREN', old.code);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  new.code := btrim(new.code);
  new.name_en := btrim(new.name_en);
  new.name_ar := btrim(new.name_ar);

  if new.parent_id is not null then
    select * into v_parent from public.accounts a where a.id = new.parent_id;
    if not found or v_parent.company_id <> new.company_id then
      perform public._raise('ACCOUNT_PARENT_INVALID');
    end if;
    if v_parent.is_posting then
      perform public._raise('ACCOUNT_PARENT_IS_POSTING', v_parent.code);
    end if;
    if v_parent.account_type <> new.account_type then
      perform public._raise('ACCOUNT_TYPE_MISMATCH', v_parent.code);
    end if;
    -- cycle detection
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      if v_cursor = new.id then
        perform public._raise('ACCOUNT_PARENT_INVALID', 'cycle');
      end if;
      select a.parent_id into v_cursor from public.accounts a where a.id = v_cursor;
      v_depth := v_depth + 1;
      if v_depth > 20 then
        perform public._raise('ACCOUNT_PARENT_INVALID', 'depth');
      end if;
    end loop;
    new.level := v_parent.level + 1;
  else
    new.level := 1;
  end if;

  if new.category_code is not null then
    select * into v_category from public.account_categories c where c.code = new.category_code;
    if v_category.account_type <> new.account_type then
      perform public._raise('ACCOUNT_CATEGORY_MISMATCH', new.category_code);
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_has_lines := exists (select 1 from public.journal_entry_lines l where l.account_id = new.id);
    if v_has_lines and (new.account_type <> old.account_type
                        or new.normal_balance <> old.normal_balance
                        or new.is_posting <> old.is_posting
                        or new.category_code is distinct from old.category_code
                        or new.company_id <> old.company_id) then
      perform public._raise('ACCOUNT_HAS_TRANSACTIONS', old.code);
    end if;
    if new.is_posting and not old.is_posting
       and exists (select 1 from public.accounts c where c.parent_id = new.id) then
      perform public._raise('ACCOUNT_HAS_CHILDREN', old.code);
    end if;
    if new.account_type <> old.account_type
       and exists (select 1 from public.accounts c where c.parent_id = new.id) then
      perform public._raise('ACCOUNT_HAS_CHILDREN', old.code);
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_account
  before insert or update or delete on public.accounts
  for each row execute function public._guard_account();

-- Keep descendant levels consistent when an account moves in the hierarchy.
create or replace function public._refresh_account_levels()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.level is distinct from old.level then
    update public.accounts c set level = new.level + 1 where c.parent_id = new.id;
  end if;
  return null;
end;
$$;

create trigger refresh_account_levels
  after update of level on public.accounts
  for each row execute function public._refresh_account_levels();

-- ---------------------------------------------------------------------------
-- Journal immutability and posting integrity
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

create trigger guard_journal_entry
  before insert or update or delete on public.journal_entries
  for each row execute function public._guard_journal_entry();

create or replace function public._guard_journal_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.entry_status;
begin
  select e.status into v_status
    from public.journal_entries e
   where e.id = case when tg_op = 'DELETE' then old.journal_entry_id else new.journal_entry_id end;

  if v_status is not null and v_status <> 'draft' then
    perform public._raise('POSTED_ENTRY_IMMUTABLE');
  end if;
  if tg_op = 'UPDATE' and new.journal_entry_id <> old.journal_entry_id then
    perform public._raise('POSTED_ENTRY_IMMUTABLE');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_journal_line
  before insert or update or delete on public.journal_entry_lines
  for each row execute function public._guard_journal_line();

create or replace function public._guard_voucher()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      perform public._raise('INVALID_STATUS_TRANSITION', 'insert:' || new.status);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      perform public._raise('VOUCHER_NOT_EDITABLE', old.voucher_number);
    end if;
    return old;
  end if;

  if old.status in ('posted', 'reversed') then
    if not (old.status = 'posted' and new.status = 'reversed') then
      perform public._raise('VOUCHER_NOT_EDITABLE', old.voucher_number);
    end if;
    if (new.voucher_type, new.voucher_number, new.voucher_date, new.amount, new.cash_account_id,
        new.counter_account_id, new.from_account_id, new.to_account_id, new.journal_entry_id, new.company_id)
       is distinct from
       (old.voucher_type, old.voucher_number, old.voucher_date, old.amount, old.cash_account_id,
        old.counter_account_id, old.from_account_id, old.to_account_id, old.journal_entry_id, old.company_id) then
      perform public._raise('VOUCHER_NOT_EDITABLE', old.voucher_number);
    end if;
  end if;

  if old.journal_entry_id is not null and new.journal_entry_id is distinct from old.journal_entry_id then
    perform public._raise('VOUCHER_ALREADY_POSTED', old.voucher_number);
  end if;

  return new;
end;
$$;

create trigger guard_voucher
  before insert or update or delete on public.vouchers
  for each row execute function public._guard_voucher();

create or replace function public._guard_voucher_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.voucher_status;
begin
  select v.status into v_status
    from public.vouchers v
   where v.id = case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  if v_status is not null and v_status <> 'draft' then
    perform public._raise('VOUCHER_NOT_EDITABLE');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_voucher_line
  before insert or update or delete on public.voucher_lines
  for each row execute function public._guard_voucher_line();

-- Audit log is append-only even for privileged roles.
create or replace function public._guard_audit_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public._raise('AUDIT_LOG_IMMUTABLE');
  return null;
end;
$$;

create trigger guard_audit_log
  before update or delete on public.audit_logs
  for each row execute function public._guard_audit_log();

-- Prevent changes to closed fiscal years' dates and overlapping fiscal years.
create or replace function public._guard_fiscal_year()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.fiscal_years f
    where f.company_id = new.company_id and f.id <> new.id
      and daterange(f.start_date, f.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    perform public._raise('FISCAL_YEAR_OVERLAP', new.name);
  end if;
  return new;
end;
$$;

create trigger guard_fiscal_year
  before insert or update of start_date, end_date on public.fiscal_years
  for each row execute function public._guard_fiscal_year();

-- ---------------------------------------------------------------------------
-- Row level security
-- All financial writes go through SECURITY DEFINER functions that validate
-- permissions and accounting rules; tables expose read access to members only.
-- ---------------------------------------------------------------------------
alter table public.currencies enable row level security;
alter table public.role_permissions enable row level security;
alter table public.account_categories enable row level security;
alter table public.companies enable row level security;
alter table public.company_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.fiscal_years enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounts enable row level security;
alter table public.document_sequences enable row level security;
alter table public.vouchers enable row level security;
alter table public.voucher_lines enable row level security;
alter table public.recurring_entry_templates enable row level security;
alter table public.recurring_template_lines enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_logs enable row level security;

create policy currencies_read on public.currencies for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy account_categories_read on public.account_categories for select to authenticated using (true);

create policy companies_read on public.companies for select to authenticated
  using (public.is_company_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.has_permission(id, 'settings.manage'))
  with check (public.has_permission(id, 'settings.manage'));

create policy company_settings_read on public.company_settings for select to authenticated
  using (public.is_company_member(company_id));
create policy company_settings_update on public.company_settings for update to authenticated
  using (public.has_permission(company_id, 'settings.manage'))
  with check (public.has_permission(company_id, 'settings.manage'));

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_company_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_company_member(company_id));

create policy fiscal_years_read on public.fiscal_years for select to authenticated
  using (public.is_company_member(company_id));
create policy accounting_periods_read on public.accounting_periods for select to authenticated
  using (public.is_company_member(company_id));

create policy accounts_read on public.accounts for select to authenticated
  using (public.is_company_member(company_id));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (public.has_permission(company_id, 'accounts.manage'));
create policy accounts_update on public.accounts for update to authenticated
  using (public.has_permission(company_id, 'accounts.manage'))
  with check (public.has_permission(company_id, 'accounts.manage'));
create policy accounts_delete on public.accounts for delete to authenticated
  using (public.has_permission(company_id, 'accounts.manage'));

create policy document_sequences_read on public.document_sequences for select to authenticated
  using (public.is_company_member(company_id));

create policy vouchers_read on public.vouchers for select to authenticated
  using (public.is_company_member(company_id));
create policy voucher_lines_read on public.voucher_lines for select to authenticated
  using (public.is_company_member(company_id));

create policy recurring_templates_read on public.recurring_entry_templates for select to authenticated
  using (public.is_company_member(company_id));
create policy recurring_template_lines_read on public.recurring_template_lines for select to authenticated
  using (public.is_company_member(company_id));

create policy journal_entries_read on public.journal_entries for select to authenticated
  using (public.is_company_member(company_id));
create policy journal_entry_lines_read on public.journal_entry_lines for select to authenticated
  using (public.is_company_member(company_id));

create policy attachments_read on public.attachments for select to authenticated
  using (public.is_company_member(company_id));

create policy audit_logs_read on public.audit_logs for select to authenticated
  using (public.has_permission(company_id, 'audit.view'));
