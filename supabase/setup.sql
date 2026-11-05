-- =============================================================================
-- Vio Accounting — complete database setup (generated, do not edit by hand)
-- Paste into Supabase Dashboard → SQL Editor → New query → Run, ONCE, on a
-- fresh project. Regenerate with `npm run db:setup-sql` after changing migrations.
-- =============================================================================

-- >>> 20261105000100_core_schema.sql
-- =============================================================================
-- Vio Accounting — core schema
-- Double-entry accounting ledger: companies, chart of accounts, fiscal periods,
-- journal entries, vouchers, attachments, audit trail.
--
-- Monetary values are stored as NUMERIC(20,4). Floating-point types are never
-- used for money. Display precision comes from public.currencies.decimals.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'accountant', 'reviewer', 'viewer');
create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type public.balance_side as enum ('debit', 'credit');
create type public.entry_type as enum ('standard', 'opening', 'adjusting', 'closing', 'reversing', 'recurring');
create type public.entry_status as enum ('draft', 'pending_approval', 'posted', 'reversed');
create type public.voucher_type as enum ('receipt', 'payment', 'journal', 'transfer');
create type public.voucher_status as enum ('draft', 'pending_approval', 'posted', 'reversed');
create type public.period_status as enum ('open', 'closed');
create type public.payment_method as enum ('cash', 'bank_transfer', 'cheque', 'card', 'other');
create type public.recurrence_frequency as enum ('weekly', 'monthly', 'quarterly', 'semiannual', 'yearly');
create type public.statement_section as enum (
  'current_assets', 'non_current_assets',
  'current_liabilities', 'non_current_liabilities',
  'equity', 'revenue', 'expenses'
);

-- ---------------------------------------------------------------------------
-- Reference data (global, read-only for application users)
-- ---------------------------------------------------------------------------
create table public.currencies (
  code      char(3) primary key,
  name_en   text not null,
  name_ar   text not null,
  symbol    text,
  decimals  smallint not null check (decimals between 0 and 4)
);

insert into public.currencies (code, name_en, name_ar, symbol, decimals) values
  ('IQD', 'Iraqi Dinar', 'دينار عراقي', 'IQD', 0),
  ('USD', 'US Dollar', 'دولار أمريكي', 'USD', 2),
  ('EUR', 'Euro', 'يورو', 'EUR', 2);

create table public.role_permissions (
  role        public.app_role not null,
  permission  text not null,
  primary key (role, permission)
);

insert into public.role_permissions (role, permission)
select 'admin'::public.app_role, p from unnest(array[
  'entries.create', 'entries.edit_draft', 'entries.submit', 'entries.approve', 'entries.post',
  'entries.reverse', 'accounts.manage', 'reports.export', 'audit.view', 'users.manage',
  'periods.manage', 'settings.manage'
]) as p
union all
select 'accountant'::public.app_role, p from unnest(array[
  'entries.create', 'entries.edit_draft', 'entries.submit', 'entries.post',
  'accounts.manage', 'reports.export'
]) as p
union all
select 'reviewer'::public.app_role, p from unnest(array[
  'entries.approve', 'entries.post', 'entries.reverse', 'reports.export', 'audit.view'
]) as p
union all
select 'viewer'::public.app_role, p from unnest(array['reports.export']) as p;

create table public.account_categories (
  code               text primary key,
  account_type       public.account_type not null,
  statement_section  public.statement_section not null,
  name_en            text not null,
  name_ar            text not null,
  is_cash_equivalent boolean not null default false,
  is_contra          boolean not null default false,
  sort_order         integer not null
);

insert into public.account_categories
  (code, account_type, statement_section, name_en, name_ar, is_cash_equivalent, is_contra, sort_order)
values
  ('cash',                          'asset',     'current_assets',          'Cash on hand',                          'النقدية في الصندوق',                    true,  false, 10),
  ('bank',                          'asset',     'current_assets',          'Cash at bank',                          'النقدية لدى المصارف',                   true,  false, 20),
  ('receivables',                   'asset',     'current_assets',          'Receivables',                           'الذمم المدينة',                          false, false, 30),
  ('inventory',                     'asset',     'current_assets',          'Inventory',                             'المخزون',                                false, false, 40),
  ('prepayments',                   'asset',     'current_assets',          'Prepayments and other current assets',  'المدفوعات المقدمة وأصول متداولة أخرى',  false, false, 50),
  ('property_equipment',            'asset',     'non_current_assets',      'Property, plant and equipment',         'الممتلكات والمعدات',                    false, false, 60),
  ('accumulated_depreciation',      'asset',     'non_current_assets',      'Accumulated depreciation',              'مجمع الإهلاك',                           false, true,  70),
  ('intangible_assets',             'asset',     'non_current_assets',      'Intangible assets',                     'الأصول غير الملموسة',                   false, false, 80),
  ('other_non_current_assets',      'asset',     'non_current_assets',      'Other non-current assets',              'أصول غير متداولة أخرى',                 false, false, 90),
  ('payables',                      'liability', 'current_liabilities',     'Payables',                              'الذمم الدائنة',                          false, false, 110),
  ('short_term_loans',              'liability', 'current_liabilities',     'Short-term loans',                      'القروض قصيرة الأجل',                    false, false, 120),
  ('accrued_liabilities',           'liability', 'current_liabilities',     'Accrued and other current liabilities', 'المستحقات والتزامات متداولة أخرى',     false, false, 130),
  ('long_term_loans',               'liability', 'non_current_liabilities', 'Long-term loans',                       'القروض طويلة الأجل',                    false, false, 140),
  ('other_non_current_liabilities', 'liability', 'non_current_liabilities', 'Other non-current liabilities',         'التزامات غير متداولة أخرى',             false, false, 150),
  ('capital',                       'equity',    'equity',                  'Capital',                               'رأس المال',                              false, false, 210),
  ('retained_earnings',             'equity',    'equity',                  'Retained earnings',                     'الأرباح المحتجزة',                       false, false, 220),
  ('reserves',                      'equity',    'equity',                  'Reserves',                              'الاحتياطيات',                            false, false, 230),
  ('drawings',                      'equity',    'equity',                  'Owner drawings',                        'المسحوبات الشخصية',                      false, true,  240),
  ('operating_revenue',             'revenue',   'revenue',                 'Operating revenue',                     'الإيرادات التشغيلية',                    false, false, 310),
  ('other_revenue',                 'revenue',   'revenue',                 'Other revenue',                         'إيرادات أخرى',                           false, false, 320),
  ('cost_of_sales',                 'expense',   'expenses',                'Cost of sales and purchases',           'تكلفة المبيعات والمشتريات',             false, false, 410),
  ('operating_expenses',            'expense',   'expenses',                'Operating expenses',                    'المصروفات التشغيلية',                    false, false, 420),
  ('other_expenses',                'expense',   'expenses',                'Other expenses',                        'مصروفات أخرى',                           false, false, 430);

-- ---------------------------------------------------------------------------
-- Companies, settings, users
-- ---------------------------------------------------------------------------
create table public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name_en             text not null check (length(btrim(name_en)) > 0),
  name_ar             text not null check (length(btrim(name_ar)) > 0),
  legal_name          text,
  tax_number          text,
  registration_number text,
  address_en          text,
  address_ar          text,
  phone               text,
  email               text,
  website             text,
  base_currency       char(3) not null default 'IQD' references public.currencies (code),
  logo_path           text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.company_settings (
  company_id                    uuid primary key references public.companies (id) on delete cascade,
  require_approval              boolean not null default true,
  fiscal_year_start_month       smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  retained_earnings_account_id  uuid,
  default_language              text not null default 'en' check (default_language in ('en', 'ar')),
  report_show_signatures        boolean not null default true,
  updated_at                    timestamptz not null default now()
);

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text,
  email               text,
  preferred_language  text not null default 'en' check (preferred_language in ('en', 'ar')),
  default_company_id  uuid references public.companies (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.app_role not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, user_id)
);

create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------------
-- Fiscal years and accounting periods
-- ---------------------------------------------------------------------------
create table public.fiscal_years (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      public.period_status not null default 'open',
  closed_at   timestamptz,
  closed_by   uuid references auth.users (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date > start_date),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.accounting_periods (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  fiscal_year_id  uuid not null,
  period_number   smallint not null check (period_number > 0),
  name            text not null,
  start_date      date not null,
  end_date        date not null,
  status          public.period_status not null default 'open',
  closed_at       timestamptz,
  closed_by       uuid references auth.users (id) on delete set null,
  reopened_at     timestamptz,
  reopened_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date),
  unique (fiscal_year_id, period_number),
  foreign key (fiscal_year_id, company_id) references public.fiscal_years (id, company_id) on delete cascade
);

create index accounting_periods_lookup_idx on public.accounting_periods (company_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  code            text not null check (code ~ '^[0-9A-Za-z][0-9A-Za-z.\-]{0,23}$'),
  name_en         text not null check (length(btrim(name_en)) > 0),
  name_ar         text not null check (length(btrim(name_ar)) > 0),
  parent_id       uuid,
  account_type    public.account_type not null,
  category_code   text references public.account_categories (code),
  normal_balance  public.balance_side not null,
  is_posting      boolean not null default true,
  is_active       boolean not null default true,
  description     text,
  level           smallint not null default 1,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id),
  check (not is_posting or category_code is not null),
  foreign key (parent_id, company_id) references public.accounts (id, company_id) on delete restrict
);

create index accounts_parent_idx on public.accounts (company_id, parent_id);

alter table public.company_settings
  add constraint company_settings_retained_earnings_fk
  foreign key (retained_earnings_account_id) references public.accounts (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Document numbering
-- ---------------------------------------------------------------------------
create table public.document_sequences (
  company_id  uuid not null references public.companies (id) on delete cascade,
  doc_type    text not null check (doc_type in ('JE', 'RV', 'PV', 'JV', 'TV')),
  year        integer not null,
  next_value  bigint not null default 1 check (next_value > 0),
  primary key (company_id, doc_type, year)
);

-- ---------------------------------------------------------------------------
-- Vouchers (receipt, payment, journal, transfer)
-- ---------------------------------------------------------------------------
create table public.vouchers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  voucher_type        public.voucher_type not null,
  voucher_number      text not null,
  voucher_date        date not null,
  status              public.voucher_status not null default 'draft',
  party_name          text,
  payment_method      public.payment_method,
  cheque_number       text,
  cash_account_id     uuid,
  counter_account_id  uuid,
  from_account_id     uuid,
  to_account_id       uuid,
  amount              numeric(20, 4) not null default 0 check (amount >= 0),
  currency_code       char(3) not null references public.currencies (code),
  description         text not null default '',
  notes               text,
  reference_number    text,
  journal_entry_id    uuid unique,
  created_by          uuid references auth.users (id) on delete set null,
  submitted_by        uuid references auth.users (id) on delete set null,
  submitted_at        timestamptz,
  approved_by         uuid references auth.users (id) on delete set null,
  approved_at         timestamptz,
  posted_by           uuid references auth.users (id) on delete set null,
  posted_at           timestamptz,
  reversed_by         uuid references auth.users (id) on delete set null,
  reversed_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, voucher_number),
  unique (id, company_id),
  foreign key (cash_account_id, company_id) references public.accounts (id, company_id),
  foreign key (counter_account_id, company_id) references public.accounts (id, company_id),
  foreign key (from_account_id, company_id) references public.accounts (id, company_id),
  foreign key (to_account_id, company_id) references public.accounts (id, company_id)
);

create index vouchers_company_date_idx on public.vouchers (company_id, voucher_date desc);
create index vouchers_company_status_idx on public.vouchers (company_id, status);

create table public.voucher_lines (
  id             uuid primary key default gen_random_uuid(),
  voucher_id     uuid not null,
  company_id     uuid not null,
  line_number    integer not null check (line_number > 0),
  account_id     uuid not null,
  debit_amount   numeric(20, 4) not null default 0,
  credit_amount  numeric(20, 4) not null default 0,
  description    text,
  unique (voucher_id, line_number),
  check (debit_amount >= 0 and credit_amount >= 0),
  check ((debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)),
  foreign key (voucher_id, company_id) references public.vouchers (id, company_id) on delete cascade,
  foreign key (account_id, company_id) references public.accounts (id, company_id)
);

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------
create table public.recurring_entry_templates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  name              text not null check (length(btrim(name)) > 0),
  description       text not null default '',
  frequency         public.recurrence_frequency not null,
  start_date        date not null,
  end_date          date,
  next_run_date     date not null,
  generated_count   integer not null default 0 check (generated_count >= 0),
  is_active         boolean not null default true,
  currency_code     char(3) not null references public.currencies (code),
  last_generated_at timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  unique (id, company_id)
);

create table public.recurring_template_lines (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null,
  company_id     uuid not null,
  line_number    integer not null check (line_number > 0),
  account_id     uuid not null,
  debit_amount   numeric(20, 4) not null default 0,
  credit_amount  numeric(20, 4) not null default 0,
  description    text,
  unique (template_id, line_number),
  check (debit_amount >= 0 and credit_amount >= 0),
  check ((debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)),
  foreign key (template_id, company_id) references public.recurring_entry_templates (id, company_id) on delete cascade,
  foreign key (account_id, company_id) references public.accounts (id, company_id)
);

create table public.journal_entries (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  entry_number           text not null,
  entry_date             date not null,
  entry_type             public.entry_type not null default 'standard',
  status                 public.entry_status not null default 'draft',
  voucher_id             uuid unique,
  voucher_type           public.voucher_type,
  voucher_number         text,
  description            text not null default '',
  notes                  text,
  reference_number       text,
  currency_code          char(3) not null references public.currencies (code),
  exchange_rate          numeric(18, 8) not null default 1 check (exchange_rate > 0),
  total_debit            numeric(20, 4) not null default 0,
  total_credit           numeric(20, 4) not null default 0,
  period_id              uuid references public.accounting_periods (id),
  source                 text not null default 'manual'
                           check (source in ('manual', 'voucher', 'reversal', 'recurring', 'closing')),
  recurring_template_id  uuid references public.recurring_entry_templates (id) on delete set null,
  reversal_of_id         uuid references public.journal_entries (id),
  reversed_entry_id      uuid references public.journal_entries (id),
  rejection_reason       text,
  created_by             uuid references auth.users (id) on delete set null,
  submitted_by           uuid references auth.users (id) on delete set null,
  submitted_at           timestamptz,
  approved_by            uuid references auth.users (id) on delete set null,
  approved_at            timestamptz,
  posted_by              uuid references auth.users (id) on delete set null,
  posted_at              timestamptz,
  reversed_by            uuid references auth.users (id) on delete set null,
  reversed_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, entry_number),
  unique (id, company_id),
  foreign key (voucher_id, company_id) references public.vouchers (id, company_id)
);

create index journal_entries_company_date_idx on public.journal_entries (company_id, entry_date);
create index journal_entries_company_status_idx on public.journal_entries (company_id, status);
create unique index journal_entries_one_reversal_idx on public.journal_entries (reversal_of_id)
  where reversal_of_id is not null;

alter table public.vouchers
  add constraint vouchers_journal_entry_fk
  foreign key (journal_entry_id) references public.journal_entries (id);

create table public.journal_entry_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null,
  company_id        uuid not null,
  line_number       integer not null check (line_number > 0),
  account_id        uuid not null,
  debit_amount      numeric(20, 4) not null default 0,
  credit_amount     numeric(20, 4) not null default 0,
  description       text,
  unique (journal_entry_id, line_number),
  check (debit_amount >= 0 and credit_amount >= 0),
  check ((debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)),
  foreign key (journal_entry_id, company_id) references public.journal_entries (id, company_id) on delete cascade,
  foreign key (account_id, company_id) references public.accounts (id, company_id) on delete restrict
);

create index journal_entry_lines_account_idx on public.journal_entry_lines (company_id, account_id);
create index journal_entry_lines_entry_idx on public.journal_entry_lines (journal_entry_id);

-- ---------------------------------------------------------------------------
-- Attachments (files live in Supabase Storage bucket "attachments")
-- ---------------------------------------------------------------------------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  entity_type   text not null check (entity_type in ('journal_entry', 'voucher')),
  entity_id     uuid not null,
  file_name     text not null,
  storage_path  text not null unique,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  uploaded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index attachments_entity_idx on public.attachments (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id            bigint generated always as identity primary key,
  company_id    uuid references public.companies (id) on delete cascade,
  entity_type   text not null,
  entity_id     uuid,
  entity_label  text,
  action        text not null,
  actor_id      uuid references auth.users (id) on delete set null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- >>> 20261105000200_security_and_integrity.sql
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

-- >>> 20261105000300_accounting_workflow.sql
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

-- >>> 20261105000400_reporting.sql
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

-- >>> 20261105000500_storage_and_grants.sql
-- =============================================================================
-- Vio Accounting — storage bucket, storage policies and privilege hardening
-- =============================================================================

-- Private bucket for supporting documents. Object paths are
--   <company_id>/<entity_type>/<entity_id>/<uuid>-<file name>
--   <company_id>/branding/<uuid>-logo.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 10485760,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy attachments_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_company_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy attachments_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and case
          when (storage.foldername(name))[2] = 'branding'
            then public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'settings.manage')
          else public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'entries.create')
        end
  );

-- Only files that are no longer referenced by an attachment record (i.e. the
-- record was removed from a draft through delete_attachment) can be deleted.
create policy attachments_delete_unreferenced on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[2] <> 'branding'
    and public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'entries.edit_draft')
    and not public.attachment_path_in_use(name)
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- Tables are readable through RLS; financial tables are written exclusively by
-- SECURITY DEFINER functions. Internal helpers (prefixed with "_") are not
-- callable through the API.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.accounts to authenticated;
grant update on public.companies, public.company_settings to authenticated;
grant update (full_name, preferred_language, default_company_id) on public.profiles to authenticated;

revoke all on all sequences in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '\_%'
       and p.proname <> '_raise'
  loop
    execute format('revoke execute on function %s from authenticated', r.signature);
  end loop;
end;
$$;

-- Companies and settings may only change descriptive columns through the API.
revoke update on public.companies from authenticated;
grant update (name_en, name_ar, legal_name, tax_number, registration_number, address_en, address_ar,
              phone, email, website, logo_path)
  on public.companies to authenticated;

revoke update on public.company_settings from authenticated;
grant update (require_approval, retained_earnings_account_id, default_language, report_show_signatures)
  on public.company_settings to authenticated;

revoke insert, update, delete on public.accounts from authenticated;
grant insert (company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance,
              is_posting, is_active, description, created_by)
  on public.accounts to authenticated;
grant update (code, name_en, name_ar, parent_id, account_type, category_code, normal_balance,
              is_posting, is_active, description)
  on public.accounts to authenticated;
grant delete on public.accounts to authenticated;
