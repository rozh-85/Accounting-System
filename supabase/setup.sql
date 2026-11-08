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

-- >>> 20261106000100_demo_company.sql
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

-- >>> 20261107000100_demo_chart_of_accounts.sql
-- =============================================================================
-- Vio Accounting — the demo company uses the Kurdistan chart of accounts
-- All 731 accounts of the client's chart (دلیل الحسابات, Iraqi unified system),
-- used only by the demo company. Real companies keep the standard chart.
--
-- Class 2 of that system mixes liabilities with capital and reserves, while this
-- app needs a child account to share its parent's type. So 21 and 22 are equity
-- roots of their own, and 231 (accumulated depreciation) is a contra-asset, which
-- deducts it from assets on the statement of financial position.
-- The source has Arabic names only, so name_en repeats them.
-- =============================================================================

create or replace function public._seed_demo_chart(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- One insert, not one per account: the row-by-row guard and audit triggers take
  -- too long for the API's statement timeout and would add 731 audit rows. The
  -- list is fixed, and supabase/tests/demo.test.ts re-checks what the guard checks.
  alter table public.accounts disable trigger user;

  with chart (code, name_ar, parent_code, account_type, category_code, normal_balance, is_posting, level) as (
    values
      ('1', 'الموجودات', null, 'asset', null, 'debit', false, 1),
      ('2', 'المطلوبات', null, 'liability', null, 'credit', false, 1),
      ('3', 'المصروفات', null, 'expense', null, 'debit', false, 1),
      ('4', 'الإیرادات', null, 'revenue', null, 'credit', false, 1),
      ('11', 'الموجودات الثابتة', '1', 'asset', null, 'debit', false, 2),
      ('12', 'مشروعات تحت التنفیذ', '1', 'asset', null, 'debit', false, 2),
      ('13', 'المخزون', '1', 'asset', null, 'debit', false, 2),
      ('14', 'القروض الممنوحة', '1', 'asset', null, 'debit', false, 2),
      ('15', 'الاستثمارات المالیة', '1', 'asset', null, 'debit', false, 2),
      ('16', 'المدینون', '1', 'asset', null, 'debit', false, 2),
      ('18', 'النقود', '1', 'asset', null, 'debit', false, 2),
      ('19', 'الحسابات المتقابلة المدینة', '1', 'asset', null, 'debit', false, 2),
      ('21', 'راس المال', null, 'equity', null, 'credit', false, 1),
      ('22', 'الاحتیاطیات', null, 'equity', null, 'credit', false, 1),
      ('23', 'التخصیصات', '2', 'liability', null, 'credit', false, 2),
      ('24', 'القروض المستلمة', '2', 'liability', null, 'credit', false, 2),
      ('25', 'المصارف الدائنة', '2', 'liability', null, 'credit', false, 2),
      ('26', 'الدائنون', '2', 'liability', null, 'credit', false, 2),
      ('28', 'حسابات العملیات الجاریة', '2', 'liability', null, 'credit', false, 2),
      ('29', 'الحسابات المتقابلة الدائنة', '2', 'liability', null, 'credit', false, 2),
      ('31', 'الرواتب والاجور', '3', 'expense', null, 'debit', false, 2),
      ('32', 'المستلزمات السلعیة', '3', 'expense', null, 'debit', false, 2),
      ('33', 'المستلزمات الخدمیة', '3', 'expense', null, 'debit', false, 2),
      ('34', 'مقاولات وخدمات', '3', 'expense', null, 'debit', false, 2),
      ('35', 'مشتریات بضائع واراضی بغرض البیع', '3', 'expense', null, 'debit', false, 2),
      ('36', 'الفوائد وایجارات الاراضی', '3', 'expense', null, 'debit', false, 2),
      ('37', 'اندثارات', '3', 'expense', null, 'debit', false, 2),
      ('38', 'المصروفات التحویلیة', '3', 'expense', null, 'debit', false, 2),
      ('39', 'المصروفات الاخرى', '3', 'expense', null, 'debit', false, 2),
      ('41', 'ایراد نشاط الانتاج السلعی', '4', 'revenue', null, 'credit', false, 2),
      ('42', 'ایراد النشاط التجاری', '4', 'revenue', null, 'credit', false, 2),
      ('43', 'ایراد النشاط الخدمی', '4', 'revenue', null, 'credit', false, 2),
      ('44', 'ایراد التشغیل', '4', 'revenue', null, 'credit', false, 2),
      ('45', 'كلفة الموجودات المصنعة محلیا', '4', 'revenue', null, 'credit', false, 2),
      ('46', 'الفوائد وایجارات الاراضی', '4', 'revenue', null, 'credit', false, 2),
      ('47', 'اعانات', '4', 'revenue', null, 'credit', false, 2),
      ('48', 'الایرادات التحویلیة', '4', 'revenue', null, 'credit', false, 2),
      ('49', 'الایرادات الاخرى', '4', 'revenue', null, 'credit', false, 2),
      ('111', 'اراضی', '11', 'asset', null, 'debit', false, 3),
      ('112', 'مبانی وانشاءات وطرق', '11', 'asset', null, 'debit', false, 3),
      ('113', 'الات ومعدات', '11', 'asset', null, 'debit', false, 3),
      ('114', 'وسائط نقل وانتقال', '11', 'asset', null, 'debit', false, 3),
      ('115', 'عدد وقوالب', '11', 'asset', null, 'debit', false, 3),
      ('116', 'اثاث واجهزة مكاتب', '11', 'asset', null, 'debit', false, 3),
      ('117', 'الموجودات الحیة لاغراض العرض والانتاج', '11', 'asset', null, 'debit', false, 3),
      ('118', 'نفقات ایرادیة مؤجلة', '11', 'asset', null, 'debit', false, 3),
      ('121', 'اراضی', '12', 'asset', null, 'debit', false, 3),
      ('122', 'مبانی وانشاءات وطرق', '12', 'asset', null, 'debit', false, 3),
      ('123', 'الات ومعدات', '12', 'asset', 'property_equipment', 'debit', true, 3),
      ('124', 'وسائط نقل وانتقال', '12', 'asset', null, 'debit', false, 3),
      ('125', 'عدد وقوالب', '12', 'asset', null, 'debit', false, 3),
      ('126', 'اثاث واجهزة مكاتب', '12', 'asset', null, 'debit', false, 3),
      ('127', 'الموجودات الحیة لاغراض العرض والانتاج', '12', 'asset', null, 'debit', false, 3),
      ('128', 'نفقات ایرادیة مؤجلة', '12', 'asset', null, 'debit', false, 3),
      ('129', 'انفاق استثماری', '12', 'asset', null, 'debit', false, 3),
      ('131', 'مخزن الخامات والمواد الاولیة', '13', 'asset', 'inventory', 'debit', true, 3),
      ('132', 'مخزن الوقود والزیوت', '13', 'asset', 'inventory', 'debit', true, 3),
      ('133', 'مخزن الادوات الاحتیاطیة', '13', 'asset', 'inventory', 'debit', true, 3),
      ('134', 'مخزن مواد التعبئة والتغلیف', '13', 'asset', null, 'debit', false, 3),
      ('135', 'مخزن المتنوعات', '13', 'asset', null, 'debit', false, 3),
      ('136', 'مخزن الانتاج', '13', 'asset', null, 'debit', false, 3),
      ('137', 'مخزن البضائع والاراضی بغرض البیع', '13', 'asset', null, 'debit', false, 3),
      ('138', 'اعتمادات مستندیة لشراء المواد', '13', 'asset', null, 'debit', false, 3),
      ('139', 'مخزن المواد الاخرى', '13', 'asset', null, 'debit', false, 3),
      ('141', 'قروض ممنوحة طویلة الاجل', '14', 'asset', null, 'debit', false, 3),
      ('142', 'قروض ممنوحة قصیرة الاجل', '14', 'asset', null, 'debit', false, 3),
      ('151', 'استثمارات مالیة طویلة الاجل', '15', 'asset', null, 'debit', false, 3),
      ('152', 'استثمارات مالیة قصیرة الاجل', '15', 'asset', null, 'debit', false, 3),
      ('161', 'مدینون تجاریون (عملاء)', '16', 'asset', null, 'debit', false, 3),
      ('162', 'اوراق قبض', '16', 'asset', null, 'debit', false, 3),
      ('163', 'حسابات جاریة مدینة', '16', 'asset', null, 'debit', false, 3),
      ('164', 'سلف التعهدات الثانویة', '16', 'asset', 'receivables', 'debit', true, 3),
      ('165', 'مدینو نشاط غیر جاری', '16', 'asset', 'receivables', 'debit', true, 3),
      ('166', 'حسابات مدینة متنوعة', '16', 'asset', null, 'debit', false, 3),
      ('167', 'سلف', '16', 'asset', null, 'debit', false, 3),
      ('181', 'نقدیة بالصندوق', '18', 'asset', null, 'debit', false, 3),
      ('182', 'سلف مستدیمة', '18', 'asset', 'cash', 'debit', true, 3),
      ('183', 'نقدیة لدى المصارف', '18', 'asset', null, 'debit', false, 3),
      ('184', 'نقدیة لدى الخزائن', '18', 'asset', 'cash', 'debit', true, 3),
      ('185', 'صكوك وحوالات', '18', 'asset', null, 'debit', false, 3),
      ('191', 'حركة الانتاج التام بسعر البیع', '19', 'asset', 'other_non_current_assets', 'debit', true, 3),
      ('192', 'حساب الالتزامات المدینة', '19', 'asset', null, 'debit', false, 3),
      ('193', 'حسابات بالقیمة الرمزیة', '19', 'asset', 'other_non_current_assets', 'debit', true, 3),
      ('194', 'حسابات النتیجة المدینة', '19', 'asset', null, 'debit', false, 3),
      ('195', 'موجودات اثریة وفنیة', '19', 'asset', 'other_non_current_assets', 'debit', true, 3),
      ('211', 'راس المال المدفوع', '21', 'equity', 'capital', 'credit', true, 2),
      ('212', 'راس المال (صافی الموجودات)', '21', 'equity', 'capital', 'credit', true, 2),
      ('213', 'راس المال المتبرع به', '21', 'equity', 'capital', 'credit', true, 2),
      ('221', 'احتیاطیات راسمالیة', '22', 'equity', null, 'credit', false, 2),
      ('222', 'احتیاطی عام', '22', 'equity', 'reserves', 'credit', true, 2),
      ('223', 'احتیاطیات متنوعة', '22', 'equity', 'reserves', 'credit', true, 2),
      ('224', 'الفائض المتراكم', '22', 'equity', 'retained_earnings', 'credit', true, 2),
      ('225', 'العجز المتراكم (مدین)', '22', 'equity', 'retained_earnings', 'debit', true, 2),
      ('231', 'مخصص الاندثار المتراكم', null, 'asset', null, 'credit', false, 1),
      ('232', 'مخصص الدیون المشكوك فی تحصیلها', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('234', 'مخصص مصروفات الشراء', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('235', 'مخصص خسائر متوقعة لمشاریع قید الانجاز', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('236', 'مخصص مصاریف الصیانة المحتملة', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('237', 'مخصص هبوط اسعار المخزون السلعی', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('238', 'مخصص هبوط الإستثمارات المالیة', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('239', 'تخصیصات متنوعة', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('241', 'قروض مستلمة طویلة الاجل', '24', 'liability', null, 'credit', false, 3),
      ('242', 'قروض مستلمة قصیرة الاجل', '24', 'liability', null, 'credit', false, 3),
      ('251', 'جاری مكشوف', '25', 'liability', 'short_term_loans', 'credit', true, 3),
      ('261', 'مجهزون تجاریون', '26', 'liability', null, 'credit', false, 3),
      ('262', 'اوراق دفع', '26', 'liability', null, 'credit', false, 3),
      ('263', 'حسابات جاریة دائنة', '26', 'liability', null, 'credit', false, 3),
      ('264', 'حسابات التعهدات', '26', 'liability', null, 'credit', false, 3),
      ('265', 'دائنو نشاط غیر جاری', '26', 'liability', null, 'credit', false, 3),
      ('266', 'حسابات دائنة متنوعة', '26', 'liability', null, 'credit', false, 3),
      ('267', 'استقطاعات لحساب الغیر', '26', 'liability', null, 'credit', false, 3),
      ('268', 'دائنو توزیع الارباح', '26', 'liability', null, 'credit', false, 3),
      ('281', 'حساب النشاط الجاری', '28', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('291', 'مقابل حركة الانتاج التام بسعر البیع', '29', 'liability', 'other_non_current_liabilities', 'credit', true, 3),
      ('292', 'حسابات الالتزامات الدائنة', '29', 'liability', null, 'credit', false, 3),
      ('293', 'مقابل الحسابات بالقیمة الرمزیة', '29', 'liability', 'other_non_current_liabilities', 'credit', true, 3),
      ('294', 'حسابات النتیجة الدائنة', '29', 'liability', null, 'credit', false, 3),
      ('295', 'مقابل موجودات اثریة وفنیة', '29', 'liability', 'other_non_current_liabilities', 'credit', true, 3),
      ('311', 'الرواتب النقدیة للموظفین', '31', 'expense', null, 'debit', false, 3),
      ('312', 'الاجور النقدیة للعمال', '31', 'expense', null, 'debit', false, 3),
      ('313', 'رواتب واجور ومخصصات غیر العراقیین', '31', 'expense', 'operating_expenses', 'debit', true, 3),
      ('314', 'المساهمة فی الضمان الاجتماعی للموظفین', '31', 'expense', null, 'debit', false, 3),
      ('315', 'المساهمة للضمان الاجتماعی للعمال', '31', 'expense', null, 'debit', false, 3),
      ('316', 'المساهمة فی الضمان الاجتماعی لغیر العراقیین', '31', 'expense', 'operating_expenses', 'debit', true, 3),
      ('321', 'الخامات والمواد الاولیة', '32', 'expense', 'operating_expenses', 'debit', true, 3),
      ('322', 'الوقود والزیوت', '32', 'expense', null, 'debit', false, 3),
      ('323', 'الادوات الااحتیاطیة', '32', 'expense', 'operating_expenses', 'debit', true, 3),
      ('324', 'مواد تعبئة وتغلیف', '32', 'expense', null, 'debit', false, 3),
      ('325', 'المتنوعات', '32', 'expense', null, 'debit', false, 3),
      ('326', 'تجهیزات العاملین', '32', 'expense', null, 'debit', false, 3),
      ('327', 'المیاه والكهرباء', '32', 'expense', null, 'debit', false, 3),
      ('329', 'مستلزمات سلعیة اخرى', '32', 'expense', null, 'debit', false, 3),
      ('331', 'خدمات الصیانة', '33', 'expense', null, 'debit', false, 3),
      ('332', 'خدمات ابحاث واستشارات', '33', 'expense', 'operating_expenses', 'debit', true, 3),
      ('333', 'دعایة وطبع وضیافة', '33', 'expense', null, 'debit', false, 3),
      ('334', 'نقل وایفاد واتصالات', '33', 'expense', null, 'debit', false, 3),
      ('335', 'استئجار موجودات ثابتة', '33', 'expense', null, 'debit', false, 3),
      ('336', 'مصروفات خدمیة متنوعة', '33', 'expense', null, 'debit', false, 3),
      ('337', 'خدمات الحراسة', '33', 'expense', 'operating_expenses', 'debit', true, 3),
      ('341', 'مقاولات ثانویة', '34', 'expense', null, 'debit', false, 3),
      ('342', 'خدمات التشغیل', '34', 'expense', 'operating_expenses', 'debit', true, 3),
      ('351', 'مشتریات بضائع بغرض البیع', '35', 'expense', null, 'debit', false, 3),
      ('352', 'مشتریات اراضی بغرض البیع', '35', 'expense', null, 'debit', false, 3),
      ('361', 'فوائد مدینة', '36', 'expense', null, 'debit', false, 3),
      ('362', 'ایجارات الاراضی', '36', 'expense', 'other_expenses', 'debit', true, 3),
      ('372', 'اندثار مبانی وانشاءات وطرق', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('373', 'اندثار الات ومعدات', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('374', 'اندثار وسائط نقل وانتقال', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('375', 'اندثار عدد وقوالب', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('376', 'اندثار اثاث واجهزة ومكاتب', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('377', 'اهلاك موجودات جیة لاغراض العرض والانتاج', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('378', 'اطفاء نفقات مؤجلة', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('381', 'نفقات التقاعد والضمان الاجتماعی', '38', 'expense', null, 'debit', false, 3),
      ('382', 'المساهمة فی نفقات الوحدات الرئیسیة او التابعة', '38', 'expense', 'other_expenses', 'debit', true, 3),
      ('383', 'مصروفات تحویلیة متنوعة', '38', 'expense', null, 'debit', false, 3),
      ('384', 'ضرائب ورسوم', '38', 'expense', null, 'debit', false, 3),
      ('385', 'اعانات', '38', 'expense', null, 'debit', false, 3),
      ('386', 'مرکز تبدیل عمله', '38', 'expense', 'other_expenses', 'debit', true, 3),
      ('391', 'مصروفات سنوات سابقة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('392', 'مصروفات عرضیة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('393', 'خسائر راسمالیة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('394', 'خسائر متوقعة لمشاریع قید الانجاز', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('395', 'مصاریف الصیانة المحتملة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('396', 'خسائر هبوط اسعار المخزون السلعی', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('397', 'خسائر هبوط اسعار الاستثمارات المالیة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('411', 'ایراد نشاط الصناعات الاستخراجیة', '41', 'revenue', null, 'credit', false, 3),
      ('412', 'ایراد نشاط الصناعات التحویلیة', '41', 'revenue', null, 'credit', false, 3),
      ('413', 'ایراد نشاط التشیید', '41', 'revenue', null, 'credit', false, 3),
      ('414', 'ایراد نشاط الانتاج الغذائی', '41', 'revenue', null, 'credit', false, 3),
      ('415', 'ایراد نشاط الانتاج الحیوانی', '41', 'revenue', null, 'credit', false, 3),
      ('416', 'ایراد ماء وكهرباء', '41', 'revenue', null, 'credit', false, 3),
      ('417', 'ایراد بیع مخلفات', '41', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('421', 'صافی مبیعات بضائع واراضی بغرض البیع', '42', 'revenue', null, 'credit', false, 3),
      ('422', 'تغیر مخزون بضائع واراضی بغرض البیع', '42', 'revenue', null, 'credit', false, 3),
      ('423', 'عمولة مستلمة', '42', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('424', 'ایراد الفندقة والسیاحة', '42', 'revenue', null, 'credit', false, 3),
      ('425', 'ایرادات متنوعة', '42', 'revenue', null, 'credit', false, 3),
      ('431', 'ایراد خدمات النقل', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('432', 'ایراد خدمات الاتصالات', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('433', 'ایراد خدمات الصیانة والتصلیح', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('434', 'ایراد خدمات استشاریة وفنیة', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('435', 'ایراد خدمات اجتماعیة', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('436', 'ایراد انتساب واشتراك', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('437', 'ایراد خدمات متنوعة', '43', 'revenue', null, 'credit', false, 3),
      ('438', 'ایجار موجودات ثابتة (عدا الاراضی)', '43', 'revenue', null, 'credit', false, 3),
      ('439', 'ایراد الرسوم', '43', 'revenue', null, 'credit', false, 3),
      ('441', 'ایراد التشغیل للغیر', '44', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('451', 'كلفة الموجودات الثابتة المصنعة', '45', 'revenue', 'other_revenue', 'credit', true, 3),
      ('452', 'كلفة الادوات الاحتیاطیة المصنعة', '45', 'revenue', 'other_revenue', 'credit', true, 3),
      ('453', 'كلفة مواد التعبئة المتداولة المصنعة', '45', 'revenue', 'other_revenue', 'credit', true, 3),
      ('461', 'فوائد دائنة', '46', 'revenue', 'other_revenue', 'credit', true, 3),
      ('462', 'ایجارات الاراضی', '46', 'revenue', 'other_revenue', 'credit', true, 3),
      ('463', 'ایرادات الاستثمارات المالیة', '46', 'revenue', 'other_revenue', 'credit', true, 3),
      ('471', 'اعانات سلع مستوردة', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('472', 'اعانات انتاج محلی', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('473', 'اعانات تصدیر', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('474', 'اعانات اخرى', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('481', 'ایرادات التقاعد والضمان الاجتماعی', '48', 'revenue', null, 'credit', false, 3),
      ('482', 'منح تمویلیة', '48', 'revenue', null, 'credit', false, 3),
      ('483', 'ایرادات تحویلیة متنوعة', '48', 'revenue', null, 'credit', false, 3),
      ('486', 'مرکز تبدیل عمله', '48', 'revenue', 'other_revenue', 'credit', true, 3),
      ('491', 'ایرادات سنوات سابقة', '49', 'revenue', 'other_revenue', 'credit', true, 3),
      ('492', 'ایرادات عرضیة', '49', 'revenue', 'other_revenue', 'credit', true, 3),
      ('1111', 'اراضى زراعیة', '111', 'asset', null, 'debit', false, 4),
      ('1112', 'اراضی بناء', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1113', 'اراضی التجاریة', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1114', 'اراضی السكنیة', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1116', 'اراضی الفضاء', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1117', 'اراضی اخرى', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1121', 'مبانی', '112', 'asset', null, 'debit', false, 4),
      ('1122', 'مخازن وخزانات وسایلوات', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1123', 'منشات سكنیة', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1124', 'ابار ومناجم ومقالع', '112', 'asset', null, 'debit', false, 4),
      ('1125', 'سدود', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1126', 'منشات عائمة', '112', 'asset', null, 'debit', false, 4),
      ('1127', 'طرق وجسور', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1128', 'منشات نقل', '112', 'asset', null, 'debit', false, 4),
      ('1129', 'منشات اخرى', '112', 'asset', null, 'debit', false, 4),
      ('1141', 'وسائط نقل بالسیارات', '114', 'asset', null, 'debit', false, 4),
      ('1142', 'وسائط نقل بالسكك الحدیدیة', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1143', 'وسائط النقل النهری', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1144', 'وسائط النقل البحری', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1145', 'وسائط النقل الجوی', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1146', 'خطوط انابیب النفط والغاز', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1151', 'عدد', '115', 'asset', 'property_equipment', 'debit', true, 4),
      ('1152', 'قوالب', '115', 'asset', 'property_equipment', 'debit', true, 4),
      ('1153', 'خیم وجوادر', '115', 'asset', 'property_equipment', 'debit', true, 4),
      ('1161', 'اثاث', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1162', 'اجهزة تكییف وتبرید', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1163', 'حاسبات الكترونیة', '116', 'asset', null, 'debit', false, 4),
      ('1164', 'الات حاسبة وكاتبة استنساخ', '116', 'asset', null, 'debit', false, 4),
      ('1165', 'ادوات واجهزة مكاتب', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1166', 'ستائر ومفروشات', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1167', 'كتب ومراجع علمیة', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1171', 'نباتات لاغراض العرض والانتاج', '117', 'asset', null, 'debit', false, 4),
      ('1172', 'حیوانات لاغراض العرض والانتاج', '117', 'asset', null, 'debit', false, 4),
      ('1181', 'نفقات التاسیس', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1182', 'نفقات قبل التشغیل', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1183', 'نفقات استكشاف وبحث', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1184', 'نفقات ابحاث وتجارب', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1185', 'موجودات ثابتة معنویة', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1186', 'دیكورات وتركیبات وقواطع', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1187', 'نفقات مؤجلة متنوعة', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1188', 'نفقات مؤجلة متنوعة', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1211', 'اراضی زراعیة', '121', 'asset', null, 'debit', false, 4),
      ('1212', 'اراضی بناء', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1213', 'اراضی التجاریة', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1214', 'اراضی السكنیة', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1216', 'اراضی الفضاء', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1217', 'اراضی اخرى', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1221', 'مبانی', '122', 'asset', null, 'debit', false, 4),
      ('1222', 'مخازن وخزانات وسایلوات', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1223', 'منشات سكنیة', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1224', 'ابار ومناجم ومقالع', '122', 'asset', null, 'debit', false, 4),
      ('1225', 'سدود', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1226', 'منشات عائمة', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1227', 'طرق وجسور', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1228', 'منشات نقل', '122', 'asset', null, 'debit', false, 4),
      ('1229', 'منشات اخرى', '122', 'asset', null, 'debit', false, 4),
      ('1241', 'وسائط نقل بالسیارات', '124', 'asset', null, 'debit', false, 4),
      ('1242', 'وسائط نقل بالسكك الحدیدیة', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1243', 'وسائط النقل النهری', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1244', 'وسائط النقل البحری', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1245', 'وسائط النقل الجوی', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1246', 'خطوط انابیب النفط والغاز', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1251', 'عدد', '125', 'asset', 'property_equipment', 'debit', true, 4),
      ('1252', 'قوالب', '125', 'asset', 'property_equipment', 'debit', true, 4),
      ('1253', 'خیم وجوادر', '125', 'asset', 'property_equipment', 'debit', true, 4),
      ('1261', 'اثاث', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1262', 'اجهزة تكییف وتبرید', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1263', 'حاسبات الكترونیة', '126', 'asset', null, 'debit', false, 4),
      ('1264', 'الات حاسبة وكاتبة استنساخ', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1265', 'ادوات واجهزة مكاتب', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1266', 'ستائر ومفروشات', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1267', 'كتب ومراجع علمیة', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1271', 'نباتات لاغراض العرض والانتاج', '127', 'asset', null, 'debit', false, 4),
      ('1272', 'حیوانات لاغراض العرض والانتاج', '127', 'asset', null, 'debit', false, 4),
      ('1281', 'نفقات التاسیس', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1282', 'نفقات قبل التشغیل', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1283', 'نفقات استكشاف وبحث', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1284', 'نفقات ابحاث وتجارب', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1285', 'موجودات ثابتة معنویة', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1286', 'دیكورات وتركیبات وقواطع', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1287', 'نفقات مؤجلة متنوعة', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1288', 'نفقات مؤجلة متنوعة', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1291', 'دفعات مقدمة', '129', 'asset', 'property_equipment', 'debit', true, 4),
      ('1292', 'اعتمادات مستندیة لموجودات ثابتة', '129', 'asset', 'property_equipment', 'debit', true, 4),
      ('1341', 'مخزن مواد التعبئة والتغلیف المستهلكة', '134', 'asset', 'inventory', 'debit', true, 4),
      ('1342', 'مخزن مواد التعبئة والتغلیف المتداولة', '134', 'asset', 'inventory', 'debit', true, 4),
      ('1351', 'مخزن اللوازم والمهمات', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1352', 'مخزن القرطاسیة', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1353', 'مخزن الكتب العلمیة', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1354', 'مخزن المخلفات والمستهلكات', '135', 'asset', null, 'debit', false, 4),
      ('1355', 'مخزن تجهیزات العاملین', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1361', 'مخزن الانتاج التام', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1362', 'مخزن الانتاج غیر التام', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1363', 'اعمال تحت التنفیذ', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1364', 'المخزون النباتی زراعة قائمة', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1365', 'المخزون الحیوانی تحت التكوین', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1371', 'مخزن البضائع بغرض البیع', '137', 'asset', 'inventory', 'debit', true, 4),
      ('1372', 'الاراضی یغرض البیع', '137', 'asset', null, 'debit', false, 4),
      ('1381', 'اعتمادات مستندیة لحساب الوحدة الاقتصادیة', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1382', 'بضائع بطریق الشحن لحساب الوحدة الاقتصادیة', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1383', 'اعتمادات مستندیة لحساب الغیر', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1384', 'بضائع بطریق الشحن لحساب الغیر', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1385', 'حوالات مستندیة', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1391', 'بضائع لدى الغیر', '139', 'asset', 'inventory', 'debit', true, 4),
      ('1411', 'قروض طویلة للقطاع العام', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1412', 'قروض طویلة للقطاع التعاونیی', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1413', 'قروض طویلة للقطاع المختلط', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1414', 'قروض طویلة للقطاع الخاص', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1415', 'قروض طویلة للعالم الخارجی', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1421', 'قروض طویلة للقطاع العام', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1422', 'قروض طویلة للقطاع التعاوني', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1423', 'قروض طویلة للقطاع المختلط', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1424', 'قروض طویلة للقطاع الخاص', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1425', 'قروض طویلة للعالم الخارجی', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1511', 'استثمارات مالیة طویلة فی القطاع العام', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1512', 'استثمارات مالیة طویلة فی القطاع التعاونی', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1513', 'استثمارات مالیة طویلة فی القطاع المختلط', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1514', 'استثمارات مالیة طویلة فی القطاع الخاص', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1515', 'استثمارات مالیة طویلة فی ا لعالم الخارجی', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1521', 'استثمارات قصیرة فی القطاع العام', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1522', 'استثمارات قصیرة فی القطاع التعاونی', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1523', 'استثمارات قصیرة فی القطاع المختلط', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1524', 'استثمارات قصیرة فی القطاع الخاص', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1525', 'استثمارات قصیرة فی العالم الخارجی', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1611', 'مدینون قطاع اشتراكی', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1612', 'مدینون قطاع تعاونی', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1613', 'مدینون قطاع مختلط', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1614', 'مدینون قطاع خاص', '161', 'asset', null, 'debit', false, 4),
      ('1615', 'مدینون عالم خارجی', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1621', 'اوراق قبض قطاع عام', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1622', 'اوراق قبض قطاع تعاونی', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1623', 'اوراق قبض قطاع مختلط', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1624', 'اوراق قبض قطاع خاص', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1625', 'اوراق قبض عالم خارجی', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1626', 'اوراق قبض برسم التحصیل', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1631', 'حسابات جاریة مدینة داخل الوحدة الاقتصادیة الرئیسیة', '163', 'asset', 'receivables', 'debit', true, 4),
      ('1632', 'حسابات جاریة مدینة داخل الوحدة الاقتصادیة الفرعیة', '163', 'asset', 'receivables', 'debit', true, 4),
      ('1633', 'حسابات جاریة مدینة داخل الوحدة الاقتصادیة المشاریع', '163', 'asset', 'receivables', 'debit', true, 4),
      ('1661', 'تامینات لدى الغیر', '166', 'asset', null, 'debit', false, 4),
      ('1662', 'ایرادات مستحقة', '166', 'asset', null, 'debit', false, 4),
      ('1663', 'مصاریف مدفوعة مقدما', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1664', 'طلبات التعویض', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1665', 'فروقات موجودات نقدیة ومخزنیة وثابتة لظروف اعتیادیة', '166', 'asset', null, 'debit', false, 4),
      ('1666', 'فروقات موجودات نقدیة ومخزنیة وثابتة لظروف غیر اعتیادیة', '166', 'asset', null, 'debit', false, 4),
      ('1667', 'وزارة المالیة -رواتب اجازات الامومة', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1668', 'وزارة المالیة-رواتب الملتحقین بالخدمة العسكریة', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1671', 'سلف لاغراض النشاط', '167', 'asset', 'prepayments', 'debit', true, 4),
      ('1672', 'سلف المنتسبین', '167', 'asset', 'prepayments', 'debit', true, 4),
      ('1673', 'سلف الزواج', '167', 'asset', 'prepayments', 'debit', true, 4),
      ('1811', 'صندوق المركز', '181', 'asset', 'cash', 'debit', true, 4),
      ('1812', 'صندوق الفرع', '181', 'asset', 'cash', 'debit', true, 4),
      ('1813', 'صندوق المعارض', '181', 'asset', 'cash', 'debit', true, 4),
      ('1831', 'مصارف حكومیة', '183', 'asset', 'bank', 'debit', true, 4),
      ('1832', 'مصارف اهلیة', '183', 'asset', 'bank', 'debit', true, 4),
      ('1833', 'الصیرفة', '183', 'asset', 'bank', 'debit', true, 4),
      ('1851', 'صكوك وحوالات قید النحصیل', '185', 'asset', 'bank', 'debit', true, 4),
      ('1852', 'حوالات بالطریق', '185', 'asset', 'bank', 'debit', true, 4),
      ('1853', 'شیكات وحوالات مرفوضة', '185', 'asset', 'bank', 'debit', true, 4),
      ('1921', 'الاعتمادات المستندیة المستلمة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1922', 'مقابل الاعتمادات المستندیة الصادرة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1923', 'خطابات الضمن المستلمة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1924', 'مقابل الخطابات الضمان الصادرة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1925', 'العقود', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1941', 'فرق الایجار المحتسب', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1942', 'فرق الفوائد المحتسبة', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1943', 'فرق تقویم تغیر مخزون الانتاج التام', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1944', 'فرق تقویم مخزون بضائع واراضی بغرض البیع', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('2211', 'احتیاطی التوسعات', '221', 'equity', null, 'credit', false, 3),
      ('2212', 'احتیاطی استبدال الموجودات الثابتة', '221', 'equity', 'reserves', 'credit', true, 3),
      ('2213', 'احتیاطی مكاسب راسمالیة', '221', 'equity', 'reserves', 'credit', true, 3),
      ('2312', 'مخصص اندثار مبانی وانشاءات وطرق', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2313', 'مخصص اندثار الات ومعدات', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2314', 'مخصص اندثار وسائط نقل وانتقال', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2315', 'مخصص اندثار عدد وقوالب', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2316', 'مخصص اندثار اثاث واجهزة مكاتب', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2411', 'قروض مستلمة طویلة من القطاع العام', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2412', 'قروض مستلمة طویلة من القطاع التعاونی', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2413', 'قروض مستلمة طویلة من القطاع المختلط', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2414', 'قروض مستلمة طویلة من القطاع الخاص', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2415', 'قروض مستلمة طویلة من العالم الخارجی', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2421', 'قروض مستلمة قصیرة من القطاع العام', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2422', 'قروض مستلمة قصیرة من القطاع التعاونی', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2423', 'قروض مستلمة قصیرة من القطاع المختلط', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2424', 'قروض مستلمة قصیرة من القطاع الخاص', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2425', 'قروض مستلمة قصیرة من العالم الخارجی', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2611', 'مجهزون قطاع عام', '261', 'liability', 'payables', 'credit', true, 4),
      ('2612', 'مجهزون قطاع تعاونی', '261', 'liability', 'payables', 'credit', true, 4),
      ('2613', 'مجهزون قطاع مختلط', '261', 'liability', 'payables', 'credit', true, 4),
      ('2614', 'مجهزون قطاع خاص', '261', 'liability', 'payables', 'credit', true, 4),
      ('2615', 'مجهزون عالم خارجی', '261', 'liability', 'payables', 'credit', true, 4),
      ('2616', 'مجهزون الدفع بالاجل', '261', 'liability', 'payables', 'credit', true, 4),
      ('2621', 'اوراق دفع قطاع عام', '262', 'liability', 'payables', 'credit', true, 4),
      ('2622', 'اوراق دفع قطاع تعاونی', '262', 'liability', 'payables', 'credit', true, 4),
      ('2623', 'اوراق دفع قطاع مختلط', '262', 'liability', 'payables', 'credit', true, 4),
      ('2624', 'اوراق دفع قطاع خاص', '262', 'liability', 'payables', 'credit', true, 4),
      ('2625', 'اوراق دفع عالم خارجی', '262', 'liability', 'payables', 'credit', true, 4),
      ('2631', 'حسابات جاریة دائنة داخل الوحدة الاقتصادیة الرئیسیة', '263', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2632', 'حسابات جاریة دائنة داخل الوحدة الاقتصادیة الفرعیة', '263', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2641', 'سلف مستلمة مقدما', '264', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2642', 'الذرعات المنجزة', '264', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2651', 'دائنو نشاط غیر جاری', '265', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2652', 'احطیاطات اسطقطاعات من المنتسبین', '265', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2661', 'تامینات مستلمة وحسابات التوفیر', '266', 'liability', null, 'credit', false, 4),
      ('2662', 'ایرادات مستلمة مقدما', '266', 'liability', null, 'credit', false, 4),
      ('2663', 'مصاریف مستحقة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2664', 'رواتب واجور مستحقة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2665', 'رواتب واجور معادة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2666', 'هیئة التقاعد الوطنیة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2667', 'دائرة التقاعد والضمان الاجتماعی', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2668', 'فروقات نقدیة ومخزنیة دائنة', '266', 'liability', null, 'credit', false, 4),
      ('2669', 'تعویضات وغرامات مؤجلة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2671', 'استقطاعات من المنتسبین لحساب الغیر', '267', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2672', 'استقطاعات من غیر المنتسبین لحساب الغیر', '267', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2681', 'حصة الخزینة العامة', '268', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2682', 'حصة العاملین', '268', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2921', 'مقابل الاعتمادات المستندیة المستلمة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2922', 'الاعتمادات المستندیة الصادرة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2923', 'مقابل خطابات الضمان المستلمة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2924', 'خطابات الضمان الصادرة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2925', 'مقابل العقود', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2941', 'مقابل فرق الایجار المحتسب', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2942', 'مقابل فرق الفوائد المحتسبة', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2943', 'مقابل فرق تقویم تغیر مخزون الانتاج التام', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2944', 'مقابل فرق تقویم تغیر مخزون بضائع واراضی بغرض البیع', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('3111', 'رواتب', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3112', 'مخصصات الشهادة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3113', 'مخصصات المنصب', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3114', 'مخصصات عائلیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3115', 'مخصصات مهنیة وفنیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3116', 'اجور اعمال اضافیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3117', 'مخصصات تعویضیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3118', 'مكافئات تشجیعیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3119', 'مخصصات اخرى', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3121', 'اجور', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3122', 'مخصصات الشهادة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3123', 'مخصصات المنصب', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3124', 'مخصصات عائلیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3125', 'مخصصات مهنیة وفنیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3126', 'اجور اعمال اضافیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3127', 'مخصصات تعویضیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3128', 'مكافئات تشجیعیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3129', 'مخصصات اخرى', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3141', 'حصة المنشاة فی الضمان', '314', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3142', 'التامین على الموظفین', '314', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3143', 'الضمان الصحی للموظفین', '314', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3151', 'حصة المنشاة فی الضمان', '315', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3152', 'التامین على العمال', '315', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3153', 'الضمان الصحی للعمال', '315', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3221', 'مواد نفطیة', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3222', 'غاز', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3223', 'زیوت وشحوم', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3224', 'فحم', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3225', 'بنزین', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3226', 'كاز', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3241', 'مواد تعبئة وتغلیف مستهلكة', '324', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3242', 'مواد تعبئة وتغلیف متداولة', '324', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3251', 'اللوازم والمهمات', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3252', 'القرطاسیة', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3253', 'الكتب العلمیة', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3254', 'المخلفات والمستهلكات', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3255', 'خصم مسموح به', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3261', 'كساوی', '326', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3262', 'مواد غذائیة', '326', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3263', 'مواد طبیة', '326', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3271', 'المیاه', '327', 'expense', null, 'debit', false, 4),
      ('3272', 'الكهرباء', '327', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3291', 'مستلزمات تعطیر الفندق', '329', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3292', 'مستلزمات تعقیم الفندق', '329', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3311', 'صیانة مشاتل ومنتزهات وحدائق', '331', 'expense', null, 'debit', false, 4),
      ('3312', 'صیانة مبانی وانشاءات وطرق', '331', 'expense', null, 'debit', false, 4),
      ('3313', 'صیانة الات ومعدات', '331', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3314', 'صیانة وسائط نقل وانتقال', '331', 'expense', null, 'debit', false, 4),
      ('3315', 'صیانة عدد وقوالب', '331', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3316', 'صیانة اثاث واجهزة مكاتب', '331', 'expense', null, 'debit', false, 4),
      ('3331', 'دعایة واعلان', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3332', 'نشر وطبع', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3333', 'ضیافة', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3334', 'مصاریف المعارض', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3335', 'احتفالات', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3341', 'نقل العاملین', '334', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3342', 'نقل السلع والبضائع', '334', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3343', 'السفر والایفاد', '334', 'expense', null, 'debit', false, 4),
      ('3344', 'اتصالات عامة', '334', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3352', 'استئجار مبانی وانشاءات', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3353', 'استئجار الات ومعدات', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3354', 'استئجار وسائط نقل ولنتقال', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3355', 'استئجار عدد وقوالب', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3356', 'استئجار اثاث واجهزة مكاتب', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3361', 'اشتراكات وانتماءات', '336', 'expense', null, 'debit', false, 4),
      ('3362', 'اقساط التامین', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3363', 'مكافئات لغیر العاملین عن خدمات مؤداة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3364', 'ضرائب ورسوم مدفوعة لجهات اجنبیة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3365', 'خدمات قانونیة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3366', 'خدمات مصرفیة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3367', 'تدریب وتاهیل', '336', 'expense', null, 'debit', false, 4),
      ('3368', 'اجور تنظیم وتدقیق', '336', 'expense', null, 'debit', false, 4),
      ('3369', 'مصروفات خدمیة اخرى', '336', 'expense', null, 'debit', false, 4),
      ('3411', 'مبالغ مدفوعة لمقاولین عراقیین', '341', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3412', 'مبالغ مدفوعة لمقاولین غیر عراقیین', '341', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3511', 'مشتریات بضائع بغرض البیع محلیة', '351', 'expense', 'cost_of_sales', 'debit', true, 4),
      ('3512', 'مشتریات بضائع بغرض البیع مستوردة', '351', 'expense', null, 'debit', false, 4),
      ('3521', 'الاراضی بالاسعار التجاریة', '352', 'expense', 'cost_of_sales', 'debit', true, 4),
      ('3522', 'الاراضی بالاسعار المنخفضة', '352', 'expense', 'cost_of_sales', 'debit', true, 4),
      ('3611', 'فوائد مدینة محلیة', '361', 'expense', 'other_expenses', 'debit', true, 4),
      ('3612', 'فوائد مدینة خارجیة', '361', 'expense', 'other_expenses', 'debit', true, 4),
      ('3811', 'رواتب تقاعدیة', '381', 'expense', 'other_expenses', 'debit', true, 4),
      ('3812', 'مكافئات اجتماعیة', '381', 'expense', 'other_expenses', 'debit', true, 4),
      ('3831', 'تبرعات للغیر', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3832', 'تعویضات وغرامات', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3833', 'دیون مشطوبة', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3834', 'نفقات خدمات خاصة', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3835', 'اطفاء سلف زواج', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3836', 'حصة الوحدة الاقتصادیةفی تمویل الجهات ذات النفع العام', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3837', 'سلع وخدمات مجانیة', '383', 'expense', null, 'debit', false, 4),
      ('3838', 'تسویة مصروفات الکاشیر', '383', 'expense', null, 'debit', false, 4),
      ('3841', 'رسوم انتاج', '384', 'expense', 'other_expenses', 'debit', true, 4),
      ('3842', 'ضرائب ورسوم اخرى', '384', 'expense', null, 'debit', false, 4),
      ('3851', 'اعانات داخلیة', '385', 'expense', 'other_expenses', 'debit', true, 4),
      ('3852', 'اعانات خارجیة', '385', 'expense', 'other_expenses', 'debit', true, 4),
      ('4111', 'صافی المبیعات ( نشاط الصناعات الاستخراجیة )', '411', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4112', 'تغیر مخزون انتاج تام', '411', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4113', 'تغیر مخزون انتاج غیر تام', '411', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4121', 'صافی المبیعات (نشاط الصناعات التحویلیة )', '412', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4122', 'تغیر مخزون انتاج تام', '412', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4123', 'تغیر مخزون انتاج غیر تام', '412', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4131', 'ایراد ذرعات منجزة', '413', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4132', 'تغیر اعمال تحت التنفیذ', '413', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4141', 'صافی المبیعات (انتاج الماکولات)', '414', 'revenue', null, 'credit', false, 4),
      ('4142', 'تغیر مخزون انتاج تام', '414', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4143', 'تغیر مخزون الانتاج النباتی زراعة قائمة', '414', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4151', 'صافی المبیعات (انتاج حیواني)', '415', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4152', 'تغیر مخزون انتاج تام', '415', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4153', 'تغیر مخزون الانتاج الحیوانی تحت التكوین', '415', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4161', 'ایراد ماء', '416', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4162', 'ایراد كهرباء', '416', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4211', 'صافی مبیعات بضائع بغرض البیع', '421', 'revenue', null, 'credit', false, 4),
      ('4212', 'صافی مبیعات اراضی بغرض البیع', '421', 'revenue', null, 'credit', false, 4),
      ('4213', 'صافی مبیعات شقق بغرض البیع', '421', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4221', 'تغیر مخزون بضائع بغرض البیع', '422', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4222', 'تغیر اراضی بغرض البیع', '422', 'revenue', null, 'credit', false, 4),
      ('4241', 'ایراد الفندقة والسیاحة قرض', '424', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4251', 'خصم مكتسب', '425', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4371', 'ایراد خدمات التنظیف', '437', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4372', 'ایراد خدمات التبلیط', '437', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4382', 'ایجار مبانی', '438', 'revenue', null, 'credit', false, 4),
      ('4383', 'ایجار الات ومعدات', '438', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4384', 'ایجار وسائط نقل', '438', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4391', 'رسوم الاعمال والمهن', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4392', 'رسوم الاعلان', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4393', 'رسوم منح وتجدید الاجازات', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4394', 'رسوم اخرى', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4811', 'مساهمة التقاعد والضمان الاجتماعی', '481', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4812', 'حصة الضمان من ارباح الوحدات الاقتصادیة', '481', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4821', 'منحة الخزینة العامة', '482', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4822', 'منح الوحدات المركزیة او التابعة', '482', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4831', 'تبرعات مستلمة', '483', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4832', 'تعویضات وغرامات', '483', 'revenue', null, 'credit', false, 4),
      ('4833', 'دیون سبق شطبها', '483', 'revenue', 'other_revenue', 'credit', true, 4),
      ('11111', 'كلفة شراء', '1111', 'asset', 'property_equipment', 'debit', true, 5),
      ('11112', 'كلفة الاستصلاح', '1111', 'asset', null, 'debit', false, 5),
      ('11211', 'مبانی صناعیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11212', 'مبانی تجاریة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11213', 'مبانی خدمیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11214', 'مبانی ترفیهیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11215', 'مبانی صحیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11241', 'ابار', '1124', 'asset', 'property_equipment', 'debit', true, 5),
      ('11242', 'مناجم', '1124', 'asset', 'property_equipment', 'debit', true, 5),
      ('11243', 'مقالع', '1124', 'asset', 'property_equipment', 'debit', true, 5),
      ('11281', 'خطوط السكك الحدیدیة', '1128', 'asset', 'property_equipment', 'debit', true, 5),
      ('11282', 'ارصفة الموانیء والمراسی', '1128', 'asset', null, 'debit', false, 5),
      ('11283', 'مدارج طائرات', '1128', 'asset', 'property_equipment', 'debit', true, 5),
      ('11291', 'مجاری المیاه الثقیلة', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11292', 'احواض مائیة', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11293', 'بیوت زجاجیة', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11294', 'خطوط انابیب ماء', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11295', 'خطوط الكهرباء والماء', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11301', 'الأجهزة والمعدات الریاضیة', '113', 'asset', 'property_equipment', 'debit', true, 4),
      ('11411', 'وسائط نقل الركاب', '1141', 'asset', 'property_equipment', 'debit', true, 5),
      ('11412', 'وسائط نقل البضائع', '1141', 'asset', 'property_equipment', 'debit', true, 5),
      ('11413', 'عربات اخرى', '1141', 'asset', 'property_equipment', 'debit', true, 5),
      ('11631', 'كومبیوترات كبیرة -سیرفر', '1163', 'asset', 'property_equipment', 'debit', true, 5),
      ('11632', 'كومبیوترات صغیرة -كلاینت', '1163', 'asset', 'property_equipment', 'debit', true, 5),
      ('11633', 'برامج حاسبات', '1163', 'asset', 'property_equipment', 'debit', true, 5),
      ('11641', 'برنتر حجم كبیر -سیرفر', '1164', 'asset', 'property_equipment', 'debit', true, 5),
      ('11642', 'برنتر حجم صغیر', '1164', 'asset', 'property_equipment', 'debit', true, 5),
      ('11711', 'نباتات لاغراض العرض', '1171', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('11712', 'نباتات لاغراض الانتاج', '1171', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('11721', 'حیوانات لاغراض العرض', '1172', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('11722', 'حیوانات لاغراض الانتاج', '1172', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('12111', 'كلفة شراء', '1211', 'asset', 'property_equipment', 'debit', true, 5),
      ('12112', 'كلفة الاستصلاح', '1211', 'asset', null, 'debit', false, 5),
      ('12211', 'مبانی صناعیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12212', 'مبانی تجاریة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12213', 'مبانی خدمیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12214', 'مبانی ترفیهیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12215', 'مبانی صحیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12241', 'ابار', '1224', 'asset', 'property_equipment', 'debit', true, 5),
      ('12242', 'مناجم', '1224', 'asset', 'property_equipment', 'debit', true, 5),
      ('12243', 'مقالع', '1224', 'asset', 'property_equipment', 'debit', true, 5),
      ('12281', 'خطوط السكك الحدیدیة', '1228', 'asset', 'property_equipment', 'debit', true, 5),
      ('12282', 'ارصفة الموانیء والمراسی', '1228', 'asset', null, 'debit', false, 5),
      ('12283', 'مدارج طائرات', '1228', 'asset', 'property_equipment', 'debit', true, 5),
      ('12291', 'مجاری المیاه الثقیلة', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12292', 'احواض مائیة', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12293', 'بیوت زجاجیة', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12294', 'خطوط انابیب ماء', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12295', 'خطوط الكهرباء والماء', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12411', 'وسائط نقل الركاب', '1241', 'asset', 'property_equipment', 'debit', true, 5),
      ('12412', 'وسائط نقل البضائع', '1241', 'asset', 'property_equipment', 'debit', true, 5),
      ('12413', 'عربات اخرى', '1241', 'asset', 'property_equipment', 'debit', true, 5),
      ('12633', 'برنامج حاسبات', '1263', 'asset', 'property_equipment', 'debit', true, 5),
      ('12711', 'نباتات لاغراض العرض', '1271', 'asset', 'property_equipment', 'debit', true, 5),
      ('12712', 'نباتات لاغراض الانتاج', '1271', 'asset', 'property_equipment', 'debit', true, 5),
      ('12721', 'حیوانات لاغراض العرض', '1272', 'asset', 'property_equipment', 'debit', true, 5),
      ('12722', 'حیوانات لاغراض الانتاج', '1272', 'asset', 'property_equipment', 'debit', true, 5),
      ('13541', 'مخزن المخلفات والمستهلكات لظروف اعتیادیة', '1354', 'asset', 'inventory', 'debit', true, 5),
      ('13542', 'مخزن المخلفات والمستهلكات لظروف غیراعتیادیة', '1354', 'asset', 'inventory', 'debit', true, 5),
      ('13721', 'الاراضی بالاسعار التجاریة', '1372', 'asset', 'inventory', 'debit', true, 5),
      ('13722', 'الاراضی یالاسعار المخفضة', '1372', 'asset', 'inventory', 'debit', true, 5),
      ('16141', 'مدینون قطاع خاص کاش', '1614', 'asset', 'receivables', 'debit', true, 5),
      ('16611', 'تامینات لدى الغیر قصیرة الاجل', '1661', 'asset', 'prepayments', 'debit', true, 5),
      ('16612', 'تامینات لدى الغیر طویلة الاجل', '1661', 'asset', 'prepayments', 'debit', true, 5),
      ('16621', 'ایرادات مستحقة -شقق', '1662', 'asset', 'prepayments', 'debit', true, 5),
      ('16651', 'فروقات نقدیة', '1665', 'asset', 'prepayments', 'debit', true, 5),
      ('16652', 'فروقات ومخزنیة', '1665', 'asset', 'prepayments', 'debit', true, 5),
      ('16653', 'فروقات موجودات ثابتة', '1665', 'asset', 'prepayments', 'debit', true, 5),
      ('16661', 'فروقات نقدیة', '1666', 'asset', 'prepayments', 'debit', true, 5),
      ('16662', 'فروقات ومخزنیة', '1666', 'asset', 'prepayments', 'debit', true, 5),
      ('16663', 'فروقات موجودات ثابتة', '1666', 'asset', 'prepayments', 'debit', true, 5),
      ('22111', 'احتیاطی توسعات مستخدم', '2211', 'equity', 'reserves', 'credit', true, 4),
      ('22112', 'احتیاطی توسعات غیر مستخدم', '2211', 'equity', 'reserves', 'credit', true, 4),
      ('26611', 'تامینات مستلمة قصیرة الاجل', '2661', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26612', 'تامینات مستلمة طویلة الاجل', '2661', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26613', 'حسابات التوفیر', '2661', 'liability', null, 'credit', false, 5),
      ('26621', 'ایرادات مستلمة مقدما -شقق', '2662', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26681', 'فروقات نقدیة دائنة', '2668', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26682', 'فروقات مخزنیة دائنة', '2668', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('32711', 'میاه شرب', '3271', 'expense', 'operating_expenses', 'debit', true, 5),
      ('32712', 'میاه سقی', '3271', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33111', 'صیانة مشاتل', '3311', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33112', 'صیانة منتزهات', '3311', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33113', 'صیانة حدائق', '3311', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33121', 'صیانة مبانی', '3312', 'expense', null, 'debit', false, 5),
      ('33122', 'صیانة مخازن وخزانات وسایلوات', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33123', 'صیانة منشات سكنیة', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33124', 'صیانة ابار ومناجم ومقالع', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33125', 'صیانة سدود وقنوات', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33126', 'صیانة منشات قائمة', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33127', 'صیانة طرق وجسور', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33128', 'صیانة منشات نقل', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33129', 'صیانة منشات اخرى', '3312', 'expense', null, 'debit', false, 5),
      ('33141', 'صیانة وسائط نقل بالسیارات', '3314', 'expense', null, 'debit', false, 5),
      ('33142', 'صیانة نقل بالسكك الحدیدیة', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33143', 'صیانة وسائط النقل البری', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33144', 'صیانة وسائط النقل البحری', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33145', 'صیانة وسائط النقل الجوی', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33146', 'صیانة خطوط انابیب النفط والغاز', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33147', 'صیانة لأجهزة والمعدات الریاضیة', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33161', 'صیانة اثاث', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33162', 'صیانة اجهزة تكییف وتبرید', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33163', 'صیانة حاسبات الكترونیة', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33164', 'صیانة الات حاسبة وكاتبة استنساخ', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33165', 'صیانة ادوات واجهزة مكاتب', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33167', 'صیانة كتب ومراجع علمیة', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33431', 'السفر والایفاد لغرض التدریب والدراسة', '3343', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33432', 'السفر والایفاد لاغراض النشاط', '3343', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33611', 'اشتراكات وانتماءات داخلیة', '3361', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33612', 'اشتراكات وانتماءات خارجیة', '3361', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33671', 'مخصصات الطلبة والمتدربین', '3367', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33672', 'اجور تدریب ودراسة', '3367', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33681', 'اجور تنظیم', '3368', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33682', 'اجور تدقیق', '3368', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33691', 'عموله سیاحیه', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33692', 'بوکین ئهدڤایسرس', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33693', 'عموله نسبة طلبات', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33694', 'نسبة مبیعات تکت', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('35121', 'مشتریات لحساب الوحدة الاقتصادیة', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('35122', 'مشتریات لحساب الغیر', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('35123', 'مشتریات نماذج تجاریة', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('35124', 'مشتریات بغرض البیع متضررة', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('38371', 'سلع وخدمات مجانیة مقدمة بموجب التشریعات', '3837', 'expense', 'other_expenses', 'debit', true, 5),
      ('38372', 'سلع وخدمات مجانیة مقدمة بموجب قرارات اداریة', '3837', 'expense', 'other_expenses', 'debit', true, 5),
      ('38381', 'سلع وخدمات مخفضة مقدمة بموجب التشریعات', '3838', 'expense', 'other_expenses', 'debit', true, 5),
      ('38382', 'سلع وخدمات مخفضة مقدمة بموجب قرارات اداریة', '3838', 'expense', 'other_expenses', 'debit', true, 5),
      ('38421', 'ضریبه عقار', '3842', 'expense', 'other_expenses', 'debit', true, 5),
      ('38422', 'ضرائب اخری', '3842', 'expense', 'other_expenses', 'debit', true, 5),
      ('38423', 'رسوم اقامه', '3842', 'expense', 'other_expenses', 'debit', true, 5),
      ('41411', 'صافی المبیعات (انتاج الماکولات) قرض', '4141', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42111', 'المبیعات', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42112', 'خصم المبیعات', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42113', 'خصم مكتسب', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42114', 'كلفة المبیعات', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42121', 'الاراضی بالاسعار التجاریة', '4212', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42122', 'الاراضی بالاسعار التجاریة', '4212', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42221', 'الاراضی بالاسعار التجاریة', '4222', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42222', 'الاراضی بالاسعار التجاریة', '4222', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('43821', 'ایجار مبانی سكنیة', '4382', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('43822', 'ایجار مبانی تجاریة', '4382', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('43823', 'ایجار مبانی خدمیة', '4382', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('48321', 'تعویضات', '4832', 'revenue', 'other_revenue', 'credit', true, 5),
      ('48322', 'غرامات', '4832', 'revenue', null, 'credit', false, 5),
      ('111121', 'اراضی الحدائق والمنتزهات', '11112', 'asset', 'property_equipment', 'debit', true, 6),
      ('111122', 'اراضی المشاتل', '11112', 'asset', 'property_equipment', 'debit', true, 6),
      ('112621', 'ارصفة الموانیء', '1126', 'asset', 'property_equipment', 'debit', true, 5),
      ('112821', 'المراسی', '11282', 'asset', 'property_equipment', 'debit', true, 6),
      ('112822', 'المراسی', '11282', 'asset', 'property_equipment', 'debit', true, 6),
      ('121121', 'اراضی الحدائق والمنتزهات', '12112', 'asset', 'property_equipment', 'debit', true, 6),
      ('121122', 'اراضی المشاتل', '12112', 'asset', 'property_equipment', 'debit', true, 6),
      ('122821', 'ارصفة الموانیء', '12282', 'asset', 'property_equipment', 'debit', true, 6),
      ('122822', 'المراسی', '12282', 'asset', 'property_equipment', 'debit', true, 6),
      ('122823', 'مدارج المطارات', '12282', 'asset', 'property_equipment', 'debit', true, 6),
      ('266131', 'توفیر عادی', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266132', 'توفیر مدرسی', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266133', 'حوالات داخلیة', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266134', 'حوالات خارجیة', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266135', 'تحاویل بریدیة', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('331211', 'صیانة مبانی صناعیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331212', 'صیانة مبانی تجاریة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331213', 'صیانة مبانی خدمیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331214', 'صیانة مبانی ترفیهیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331215', 'صیانة مبانی صحیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331292', 'صیانة احواض مائیة', '33129', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331293', 'صیانة بیوت زجاجیة', '33129', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331295', 'خطوط الكهرباء والهاتف', '33129', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331411', 'صیانة وسائط نقل الركاب', '33141', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331412', 'صیانة وسائط نقل البضائع', '33141', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331413', 'صیانة وسائط نقل الاخرى', '33141', 'expense', 'operating_expenses', 'debit', true, 6),
      ('483222', 'ایراد غرامات اخرى', '48322', 'revenue', 'other_revenue', 'credit', true, 6)
  ),
  ids as (
    select c.*, gen_random_uuid() as id from chart c
  )
  insert into public.accounts
    (id, company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance, is_posting, level, created_by)
  select i.id, p_company_id, i.code, i.name_ar, i.name_ar, p.id, i.account_type::public.account_type, i.category_code,
         i.normal_balance::public.balance_side, i.is_posting, i.level, auth.uid()
    from ids i
    left join ids p on p.code = i.parent_code;

  alter table public.accounts enable trigger user;

  update public.company_settings s
     set retained_earnings_account_id = (select a.id from public.accounts a where a.company_id = p_company_id and a.code = '224')
   where s.company_id = p_company_id;
end;
$$;

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
  v_customers text[] := array['شركة النور للتجارة', 'معرض بغداد للأدوات المنزلية', 'أربيل للأثاث', 'السليمانية للمفروشات'];
  v_suppliers text[] := array['سيراميك كردستان', 'نسيج دجلة', 'جملة زاكروس'];
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

  v_company := public.create_company('Vio Demo Company', 'شركة فيو التجريبية', 'IQD', v_year_start, false);
  update public.companies c set is_demo = true where c.id = v_company;
  perform public._seed_demo_chart(v_company);

  -- Opening balances and financing.
  perform public._demo_entry(v_company, v_year_start, 'أرصدة افتتاحية',
    '[{"code":"1811","debit":20000000,"credit":0},{"code":"1832","debit":150000000,"credit":0},{"code":"1371","debit":40000000,"credit":0},
      {"code":"11412","debit":35000000,"credit":0},{"code":"211","debit":0,"credit":245000000}]'::jsonb,
    'post', 'opening');
  perform public._demo_entry(v_company, make_date(v_year, 2, 3), 'قرض طويل الأجل من المصرف',
    '[{"code":"1832","debit":50000000,"credit":0},{"code":"2414","debit":0,"credit":50000000}]'::jsonb);
  perform public._demo_entry(v_company, make_date(v_year, 3, 4), 'شراء أثاث للمعرض بتحويل مصرفي',
    '[{"code":"1161","debit":6000000,"credit":0},{"code":"1832","debit":0,"credit":6000000}]'::jsonb);

  for v_month in 1 .. extract(month from current_date)::int loop
    -- Sales and purchases move a little from month to month.
    v_scale := (100 + (v_month * 37) % 30) / 100.0;
    v_customer := v_customers[1 + v_month % array_length(v_customers, 1)];
    v_supplier := v_suppliers[1 + v_month % array_length(v_suppliers, 1)];

    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 2), 'شركة العقارات', 'إيجار المعرض', 3000000, '1811', '3352');
    perform public._demo_entry(v_company, make_date(v_year, v_month, 5), 'شراء بضائع بالآجل من ' || v_supplier,
      jsonb_build_array(jsonb_build_object('code', '3511', 'debit', round(18000000 * v_scale, -3), 'credit', 0),
                        jsonb_build_object('code', '2614', 'debit', 0, 'credit', round(18000000 * v_scale, -3))));
    perform public._demo_entry(v_company, make_date(v_year, v_month, 10), 'مبيعات آجلة إلى ' || v_customer,
      jsonb_build_array(jsonb_build_object('code', '16141', 'debit', round(32000000 * v_scale, -3), 'credit', 0),
                        jsonb_build_object('code', '42111', 'debit', 0, 'credit', round(32000000 * v_scale, -3))));
    perform public._demo_entry(v_company, make_date(v_year, v_month, 12), 'مبيعات نقدية في المعرض',
      jsonb_build_array(jsonb_build_object('code', '1811', 'debit', round(14000000 * v_scale, -3), 'credit', 0),
                        jsonb_build_object('code', '42111', 'debit', 0, 'credit', round(14000000 * v_scale, -3))));
    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 15), 'دائرة الكهرباء', 'الماء والكهرباء', round(900000 * v_scale, -3), '1811', '3272');
    perform public._demo_voucher(v_company, 'receipt', make_date(v_year, v_month, 18), v_customer, 'تحصيل من حساب الزبون', round(24000000 * v_scale, -3), '1832', '16141');
    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 20), v_supplier, 'تسديد إلى المجهز', round(13000000 * v_scale, -3), '1832', '2614');
    perform public._demo_voucher(v_company, 'transfer', make_date(v_year, v_month, 22), null, 'إيداع نقدية المعرض في المصرف', round(8000000 * v_scale, -3), '1811', '1832');
    perform public._demo_voucher(v_company, 'payment', make_date(v_year, v_month, 25), 'منتسبو الشركة', 'الرواتب الشهرية', 9500000, '1832', '3111');
    if v_month % 3 = 0 then
      perform public._demo_entry(v_company, make_date(v_year, v_month, 28), 'اندثار فصلي للأثاث',
        '[{"code":"376","debit":1200000,"credit":0},{"code":"2316","debit":0,"credit":1200000}]'::jsonb, 'post', 'adjusting');
    end if;
  end loop;

  -- One corrected mistake of each kind, to show how reversal works.
  v_id := public._demo_entry(v_company, v_year_start + 8, 'قرطاسية سُجلت بالخطأ',
    '[{"code":"3252","debit":750000,"credit":0},{"code":"1811","debit":0,"credit":750000}]'::jsonb);
  if v_id is not null then
    perform public.reverse_journal_entry(v_id, v_year_start + 9, 'سُجل بالخطأ');
  end if;
  v_id := public._demo_voucher(v_company, 'receipt', v_year_start + 7, 'شركة النور للتجارة', 'سند قبض مكرر', 2500000, '1811', '16141');
  if v_id is not null then
    perform public.reverse_voucher(v_id, v_year_start + 9, 'سند مكرر');
  end if;

  -- Work still in progress, so the approval queue and drafts are not empty.
  perform public._demo_entry(v_company, current_date, 'بيع آجل بانتظار الاعتماد',
    '[{"code":"16141","debit":4200000,"credit":0},{"code":"42111","debit":0,"credit":4200000}]'::jsonb, 'submit');
  perform public._demo_entry(v_company, current_date, 'فاتورة صيانة - مسودة',
    '[{"code":"331212","debit":650000,"credit":0},{"code":"1811","debit":0,"credit":650000}]'::jsonb, 'draft');
  perform public._demo_voucher(v_company, 'payment', current_date, 'جملة زاكروس', 'تسديد مجهز بانتظار الاعتماد', 3100000, '1832', '2614', 'submit');
  perform public._demo_voucher(v_company, 'receipt', current_date, 'أربيل للأثاث', 'سند قبض - مسودة', 1800000, '1811', '16141', 'draft');

  perform public.save_recurring_template(v_company, null,
    jsonb_build_object('name', 'تأمين شهري', 'description', 'قسط التأمين الشهري', 'frequency', 'monthly', 'start_date', current_date),
    (select jsonb_agg(jsonb_build_object('account_id', a.id,
                                         'debit_amount', case when a.code = '3362' then 400000 else 0 end,
                                         'credit_amount', case when a.code = '1832' then 400000 else 0 end))
       from public.accounts a
      where a.company_id = v_company and a.code in ('3362', '1832')));

  return v_company;
end;
$$;

revoke execute on function public._seed_demo_chart(uuid) from public, anon, authenticated;

-- >>> 20261107000200_demo_chart_english_names.sql
-- =============================================================================
-- Vio Accounting — English names for the demo chart of accounts
-- The client's chart is Arabic only, so 20261107000100 repeated the Arabic in
-- name_en. This adds accounting English for all 731 accounts, for new demo
-- companies and for any demo company that already exists.
-- =============================================================================

alter function public._seed_demo_chart(uuid) rename to _seed_demo_chart_arabic;

-- One update with the triggers off, for the same reason as the chart insert: the
-- API's statement timeout, and 731 audit rows nobody needs. Only rows still
-- repeating the Arabic change, so a name someone edited is left alone.
create or replace function public._apply_demo_chart_english(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  alter table public.accounts disable trigger user;

  update public.accounts a
     set name_en = t.name_en
    from (values
      ('1', 'Assets'),
      ('2', 'Liabilities'),
      ('3', 'Expenses'),
      ('4', 'Revenue'),
      ('11', 'Fixed Assets'),
      ('12', 'Projects Under Construction'),
      ('13', 'Inventory'),
      ('14', 'Loans Granted'),
      ('15', 'Financial Investments'),
      ('16', 'Debtors'),
      ('18', 'Cash'),
      ('19', 'Debit Contra Accounts'),
      ('21', 'Capital'),
      ('22', 'Reserves'),
      ('23', 'Provisions'),
      ('24', 'Loans Received'),
      ('25', 'Bank Creditors'),
      ('26', 'Creditors'),
      ('28', 'Current Operations Accounts'),
      ('29', 'Credit Contra Accounts'),
      ('31', 'Salaries and Wages'),
      ('32', 'Commodity Requirements'),
      ('33', 'Service Requirements'),
      ('34', 'Contracts and Services'),
      ('35', 'Purchases of Goods and Land for Sale'),
      ('36', 'Interest and Land Rent'),
      ('37', 'Depreciation'),
      ('38', 'Transfer Expenses'),
      ('39', 'Other Expenses'),
      ('41', 'Commodity Production Revenue'),
      ('42', 'Trading Revenue'),
      ('43', 'Service Revenue'),
      ('44', 'Operating Revenue'),
      ('45', 'Cost of Locally Manufactured Assets'),
      ('46', 'Interest and Land Rent'),
      ('47', 'Subsidies'),
      ('48', 'Transfer Revenue'),
      ('49', 'Other Revenue'),
      ('111', 'Land'),
      ('112', 'Buildings, Structures and Roads'),
      ('113', 'Machinery and Equipment'),
      ('114', 'Transport and Travel Vehicles'),
      ('115', 'Tools and Moulds'),
      ('116', 'Furniture and Office Equipment'),
      ('117', 'Living Assets for Display and Production'),
      ('118', 'Deferred Revenue Expenditure'),
      ('121', 'Land'),
      ('122', 'Buildings, Structures and Roads'),
      ('123', 'Machinery and Equipment'),
      ('124', 'Transport and Travel Vehicles'),
      ('125', 'Tools and Moulds'),
      ('126', 'Furniture and Office Equipment'),
      ('127', 'Living Assets for Display and Production'),
      ('128', 'Deferred Revenue Expenditure'),
      ('129', 'Capital Expenditure'),
      ('131', 'Raw Materials Store'),
      ('132', 'Fuel and Oil Store'),
      ('133', 'Spare Parts Store'),
      ('134', 'Packing Materials Store'),
      ('135', 'Miscellaneous Store'),
      ('136', 'Production Store'),
      ('137', 'Goods and Land Held for Sale Store'),
      ('138', 'Letters of Credit for Material Purchases'),
      ('139', 'Other Materials Store'),
      ('141', 'Long-term Loans Granted'),
      ('142', 'Short-term Loans Granted'),
      ('151', 'Long-term Financial Investments'),
      ('152', 'Short-term Financial Investments'),
      ('161', 'Trade Debtors (Customers)'),
      ('162', 'Notes Receivable'),
      ('163', 'Debit Current Accounts'),
      ('164', 'Subcontractor Advances'),
      ('165', 'Non-current Activity Debtors'),
      ('166', 'Miscellaneous Debit Accounts'),
      ('167', 'Advances'),
      ('181', 'Cash on Hand'),
      ('182', 'Imprest Funds'),
      ('183', 'Cash at Banks'),
      ('184', 'Cash at Treasuries'),
      ('185', 'Cheques and Remittances'),
      ('191', 'Finished Goods Movement at Selling Price'),
      ('192', 'Debit Commitments Account'),
      ('193', 'Accounts at Nominal Value'),
      ('194', 'Debit Result Accounts'),
      ('195', 'Archaeological and Art Assets'),
      ('211', 'Paid-up Capital'),
      ('212', 'Capital (Net Assets)'),
      ('213', 'Donated Capital'),
      ('221', 'Capital Reserves'),
      ('222', 'General Reserve'),
      ('223', 'Miscellaneous Reserves'),
      ('224', 'Accumulated Surplus'),
      ('225', 'Accumulated Deficit (Debit)'),
      ('231', 'Accumulated Depreciation Provision'),
      ('232', 'Provision for Doubtful Debts'),
      ('234', 'Provision for Purchase Expenses'),
      ('235', 'Provision for Expected Losses on Projects in Progress'),
      ('236', 'Provision for Probable Maintenance Expenses'),
      ('237', 'Provision for Decline in Inventory Prices'),
      ('238', 'Provision for Decline in Financial Investments'),
      ('239', 'Miscellaneous Provisions'),
      ('241', 'Long-term Loans Received'),
      ('242', 'Short-term Loans Received'),
      ('251', 'Bank Overdraft'),
      ('261', 'Trade Suppliers'),
      ('262', 'Notes Payable'),
      ('263', 'Credit Current Accounts'),
      ('264', 'Contract Accounts'),
      ('265', 'Non-current Activity Creditors'),
      ('266', 'Miscellaneous Credit Accounts'),
      ('267', 'Deductions on Behalf of Third Parties'),
      ('268', 'Profit Distribution Creditors'),
      ('281', 'Current Activity Account'),
      ('291', 'Contra Finished Goods Movement at Selling Price'),
      ('292', 'Credit Commitments Accounts'),
      ('293', 'Contra Accounts at Nominal Value'),
      ('294', 'Credit Result Accounts'),
      ('295', 'Contra Archaeological and Art Assets'),
      ('311', 'Cash Salaries for Employees'),
      ('312', 'Cash Wages for Workers'),
      ('313', 'Salaries, Wages and Allowances of Non-Iraqis'),
      ('314', 'Social Security Contribution for Employees'),
      ('315', 'Social Security Contribution for Workers'),
      ('316', 'Social Security Contribution for Non-Iraqis'),
      ('321', 'Raw Materials'),
      ('322', 'Fuel and Oils'),
      ('323', 'Spare Parts'),
      ('324', 'Packing Materials'),
      ('325', 'Miscellaneous Items'),
      ('326', 'Staff Equipment'),
      ('327', 'Water and Electricity'),
      ('329', 'Other Commodity Requirements'),
      ('331', 'Maintenance Services'),
      ('332', 'Research and Consulting Services'),
      ('333', 'Advertising, Printing and Hospitality'),
      ('334', 'Transport, Travel and Communications'),
      ('335', 'Fixed Asset Rental'),
      ('336', 'Miscellaneous Service Expenses'),
      ('337', 'Security Services'),
      ('341', 'Subcontracts'),
      ('342', 'Operating Services'),
      ('351', 'Purchases of Goods for Sale'),
      ('352', 'Purchases of Land for Sale'),
      ('361', 'Interest Expense'),
      ('362', 'Land Rent'),
      ('372', 'Depreciation of Buildings, Structures and Roads'),
      ('373', 'Depreciation of Machinery and Equipment'),
      ('374', 'Depreciation of Transport Vehicles'),
      ('375', 'Depreciation of Tools and Moulds'),
      ('376', 'Depreciation of Furniture and Office Equipment'),
      ('377', 'Depletion of Living Assets for Display and Production'),
      ('378', 'Amortisation of Deferred Expenses'),
      ('381', 'Pension and Social Security Expenses'),
      ('382', 'Contribution to Expenses of Main or Affiliated Units'),
      ('383', 'Miscellaneous Transfer Expenses'),
      ('384', 'Taxes and Fees'),
      ('385', 'Subsidies'),
      ('386', 'Currency Exchange Centre'),
      ('391', 'Prior Years'' Expenses'),
      ('392', 'Incidental Expenses'),
      ('393', 'Capital Losses'),
      ('394', 'Expected Losses on Projects in Progress'),
      ('395', 'Probable Maintenance Expenses'),
      ('396', 'Losses from Decline in Inventory Prices'),
      ('397', 'Losses from Decline in Financial Investment Prices'),
      ('411', 'Extractive Industries Revenue'),
      ('412', 'Manufacturing Industries Revenue'),
      ('413', 'Construction Revenue'),
      ('414', 'Food Production Revenue'),
      ('415', 'Livestock Production Revenue'),
      ('416', 'Water and Electricity Revenue'),
      ('417', 'Scrap Sales Revenue'),
      ('421', 'Net Sales of Goods and Land for Sale'),
      ('422', 'Change in Goods and Land Held for Sale'),
      ('423', 'Commission Received'),
      ('424', 'Hotel and Tourism Revenue'),
      ('425', 'Miscellaneous Revenue'),
      ('431', 'Transport Services Revenue'),
      ('432', 'Communications Services Revenue'),
      ('433', 'Maintenance and Repair Services Revenue'),
      ('434', 'Consulting and Technical Services Revenue'),
      ('435', 'Social Services Revenue'),
      ('436', 'Membership and Subscription Revenue'),
      ('437', 'Miscellaneous Services Revenue'),
      ('438', 'Fixed Asset Rental (Excluding Land)'),
      ('439', 'Fees Revenue'),
      ('441', 'Operating Revenue from Third Parties'),
      ('451', 'Cost of Manufactured Fixed Assets'),
      ('452', 'Cost of Manufactured Spare Parts'),
      ('453', 'Cost of Manufactured Returnable Packing Materials'),
      ('461', 'Interest Income'),
      ('462', 'Land Rent'),
      ('463', 'Financial Investment Income'),
      ('471', 'Imported Goods Subsidies'),
      ('472', 'Local Production Subsidies'),
      ('473', 'Export Subsidies'),
      ('474', 'Other Subsidies'),
      ('481', 'Pension and Social Security Revenue'),
      ('482', 'Financing Grants'),
      ('483', 'Miscellaneous Transfer Revenue'),
      ('486', 'Currency Exchange Centre'),
      ('491', 'Prior Years'' Revenue'),
      ('492', 'Incidental Revenue'),
      ('1111', 'Agricultural Land'),
      ('1112', 'Building Land'),
      ('1113', 'Commercial Land'),
      ('1114', 'Residential Land'),
      ('1116', 'Vacant Land'),
      ('1117', 'Other Land'),
      ('1121', 'Buildings'),
      ('1122', 'Warehouses, Tanks and Silos'),
      ('1123', 'Residential Facilities'),
      ('1124', 'Wells, Mines and Quarries'),
      ('1125', 'Dams'),
      ('1126', 'Floating Facilities'),
      ('1127', 'Roads and Bridges'),
      ('1128', 'Transport Facilities'),
      ('1129', 'Other Facilities'),
      ('1141', 'Road Vehicles'),
      ('1142', 'Rail Transport'),
      ('1143', 'River Transport'),
      ('1144', 'Sea Transport'),
      ('1145', 'Air Transport'),
      ('1146', 'Oil and Gas Pipelines'),
      ('1151', 'Tools'),
      ('1152', 'Moulds'),
      ('1153', 'Tents and Canopies'),
      ('1161', 'Furniture'),
      ('1162', 'Air Conditioning and Cooling Units'),
      ('1163', 'Computers'),
      ('1164', 'Calculators, Typewriters and Copiers'),
      ('1165', 'Office Tools and Equipment'),
      ('1166', 'Curtains and Furnishings'),
      ('1167', 'Books and Scientific References'),
      ('1171', 'Plants for Display and Production'),
      ('1172', 'Animals for Display and Production'),
      ('1181', 'Formation Expenses'),
      ('1182', 'Pre-operating Expenses'),
      ('1183', 'Exploration and Research Expenses'),
      ('1184', 'Research and Experiment Expenses'),
      ('1185', 'Intangible Fixed Assets'),
      ('1186', 'Decorations, Fittings and Partitions'),
      ('1187', 'Miscellaneous Deferred Expenses'),
      ('1188', 'Miscellaneous Deferred Expenses'),
      ('1211', 'Agricultural Land'),
      ('1212', 'Building Land'),
      ('1213', 'Commercial Land'),
      ('1214', 'Residential Land'),
      ('1216', 'Vacant Land'),
      ('1217', 'Other Land'),
      ('1221', 'Buildings'),
      ('1222', 'Warehouses, Tanks and Silos'),
      ('1223', 'Residential Facilities'),
      ('1224', 'Wells, Mines and Quarries'),
      ('1225', 'Dams'),
      ('1226', 'Floating Facilities'),
      ('1227', 'Roads and Bridges'),
      ('1228', 'Transport Facilities'),
      ('1229', 'Other Facilities'),
      ('1241', 'Road Vehicles'),
      ('1242', 'Rail Transport'),
      ('1243', 'River Transport'),
      ('1244', 'Sea Transport'),
      ('1245', 'Air Transport'),
      ('1246', 'Oil and Gas Pipelines'),
      ('1251', 'Tools'),
      ('1252', 'Moulds'),
      ('1253', 'Tents and Canopies'),
      ('1261', 'Furniture'),
      ('1262', 'Air Conditioning and Cooling Units'),
      ('1263', 'Computers'),
      ('1264', 'Calculators, Typewriters and Copiers'),
      ('1265', 'Office Tools and Equipment'),
      ('1266', 'Curtains and Furnishings'),
      ('1267', 'Books and Scientific References'),
      ('1271', 'Plants for Display and Production'),
      ('1272', 'Animals for Display and Production'),
      ('1281', 'Formation Expenses'),
      ('1282', 'Pre-operating Expenses'),
      ('1283', 'Exploration and Research Expenses'),
      ('1284', 'Research and Experiment Expenses'),
      ('1285', 'Intangible Fixed Assets'),
      ('1286', 'Decorations, Fittings and Partitions'),
      ('1287', 'Miscellaneous Deferred Expenses'),
      ('1288', 'Miscellaneous Deferred Expenses'),
      ('1291', 'Advance Payments'),
      ('1292', 'Letters of Credit for Fixed Assets'),
      ('1341', 'Consumable Packing Materials Store'),
      ('1342', 'Returnable Packing Materials Store'),
      ('1351', 'Supplies and Stores'),
      ('1352', 'Stationery Store'),
      ('1353', 'Scientific Books Store'),
      ('1354', 'Scrap and Consumables Store'),
      ('1355', 'Staff Equipment Store'),
      ('1361', 'Finished Goods Store'),
      ('1362', 'Unfinished Goods Store'),
      ('1363', 'Work in Progress'),
      ('1364', 'Crop Inventory, Standing Crops'),
      ('1365', 'Livestock Inventory in Development'),
      ('1371', 'Goods Held for Sale Store'),
      ('1372', 'Land Held for Sale'),
      ('1381', 'Letters of Credit for the Economic Unit'),
      ('1382', 'Goods in Transit for the Economic Unit'),
      ('1383', 'Letters of Credit for Third Parties'),
      ('1384', 'Goods in Transit for Third Parties'),
      ('1385', 'Documentary Remittances'),
      ('1391', 'Goods Held by Third Parties'),
      ('1411', 'Long-term Loans to the Public Sector'),
      ('1412', 'Long-term Loans to the Cooperative Sector'),
      ('1413', 'Long-term Loans to the Mixed Sector'),
      ('1414', 'Long-term Loans to the Private Sector'),
      ('1415', 'Long-term Loans to the Foreign Sector'),
      ('1421', 'Long-term Loans to the Public Sector'),
      ('1422', 'Long-term Loans to the Cooperative Sector'),
      ('1423', 'Long-term Loans to the Mixed Sector'),
      ('1424', 'Long-term Loans to the Private Sector'),
      ('1425', 'Long-term Loans to the Foreign Sector'),
      ('1511', 'Long-term Investments in the Public Sector'),
      ('1512', 'Long-term Investments in the Cooperative Sector'),
      ('1513', 'Long-term Investments in the Mixed Sector'),
      ('1514', 'Long-term Investments in the Private Sector'),
      ('1515', 'Long-term Investments Abroad'),
      ('1521', 'Short-term Investments in the Public Sector'),
      ('1522', 'Short-term Investments in the Cooperative Sector'),
      ('1523', 'Short-term Investments in the Mixed Sector'),
      ('1524', 'Short-term Investments in the Private Sector'),
      ('1525', 'Short-term Investments Abroad'),
      ('1611', 'Debtors, Socialist Sector'),
      ('1612', 'Debtors, Cooperative Sector'),
      ('1613', 'Debtors, Mixed Sector'),
      ('1614', 'Debtors, Private Sector'),
      ('1615', 'Debtors, Foreign'),
      ('1621', 'Notes Receivable, Public Sector'),
      ('1622', 'Notes Receivable, Cooperative Sector'),
      ('1623', 'Notes Receivable, Mixed Sector'),
      ('1624', 'Notes Receivable, Private Sector'),
      ('1625', 'Notes Receivable, Foreign'),
      ('1626', 'Notes Receivable for Collection'),
      ('1631', 'Debit Current Accounts within the Main Economic Unit'),
      ('1632', 'Debit Current Accounts within the Subsidiary Economic Unit'),
      ('1633', 'Debit Current Accounts within the Economic Unit Projects'),
      ('1661', 'Deposits with Third Parties'),
      ('1662', 'Accrued Revenue'),
      ('1663', 'Prepaid Expenses'),
      ('1664', 'Compensation Claims'),
      ('1665', 'Cash, Inventory and Fixed Asset Differences, Normal Conditions'),
      ('1666', 'Cash, Inventory and Fixed Asset Differences, Abnormal Conditions'),
      ('1667', 'Ministry of Finance, Maternity Leave Salaries'),
      ('1668', 'Ministry of Finance, Military Service Salaries'),
      ('1671', 'Advances for Operations'),
      ('1672', 'Staff Advances'),
      ('1673', 'Marriage Advances'),
      ('1811', 'Head Office Cash Box'),
      ('1812', 'Branch Cash Box'),
      ('1813', 'Showroom Cash Box'),
      ('1831', 'Government Banks'),
      ('1832', 'Private Banks'),
      ('1833', 'Exchange Offices'),
      ('1851', 'Cheques and Remittances for Collection'),
      ('1852', 'Remittances in Transit'),
      ('1853', 'Rejected Cheques and Remittances'),
      ('1921', 'Letters of Credit Received'),
      ('1922', 'Contra Letters of Credit Issued'),
      ('1923', 'Letters of Guarantee Received'),
      ('1924', 'Contra Letters of Guarantee Issued'),
      ('1925', 'Contracts'),
      ('1941', 'Imputed Rent Difference'),
      ('1942', 'Imputed Interest Difference'),
      ('1943', 'Finished Goods Inventory Change Valuation Difference'),
      ('1944', 'Goods and Land Held for Sale Valuation Difference'),
      ('2211', 'Expansion Reserve'),
      ('2212', 'Fixed Asset Replacement Reserve'),
      ('2213', 'Capital Gains Reserve'),
      ('2312', 'Depreciation Provision, Buildings, Structures and Roads'),
      ('2313', 'Depreciation Provision, Machinery and Equipment'),
      ('2314', 'Depreciation Provision, Transport Vehicles'),
      ('2315', 'Depreciation Provision, Tools and Moulds'),
      ('2316', 'Depreciation Provision, Furniture and Office Equipment'),
      ('2411', 'Long-term Loans from the Public Sector'),
      ('2412', 'Long-term Loans from the Cooperative Sector'),
      ('2413', 'Long-term Loans from the Mixed Sector'),
      ('2414', 'Long-term Loans from the Private Sector'),
      ('2415', 'Long-term Loans from Abroad'),
      ('2421', 'Short-term Loans from the Public Sector'),
      ('2422', 'Short-term Loans from the Cooperative Sector'),
      ('2423', 'Short-term Loans from the Mixed Sector'),
      ('2424', 'Short-term Loans from the Private Sector'),
      ('2425', 'Short-term Loans from Abroad'),
      ('2611', 'Suppliers, Public Sector'),
      ('2612', 'Suppliers, Cooperative Sector'),
      ('2613', 'Suppliers, Mixed Sector'),
      ('2614', 'Suppliers, Private Sector'),
      ('2615', 'Suppliers, Foreign'),
      ('2616', 'Suppliers, Deferred Payment'),
      ('2621', 'Notes Payable, Public Sector'),
      ('2622', 'Notes Payable, Cooperative Sector'),
      ('2623', 'Notes Payable, Mixed Sector'),
      ('2624', 'Notes Payable, Private Sector'),
      ('2625', 'Notes Payable, Foreign'),
      ('2631', 'Credit Current Accounts within the Main Economic Unit'),
      ('2632', 'Credit Current Accounts within the Subsidiary Economic Unit'),
      ('2641', 'Advances Received'),
      ('2642', 'Completed Work Certificates'),
      ('2651', 'Non-current Activity Creditors'),
      ('2652', 'Staff Deduction Reserves'),
      ('2661', 'Deposits Received and Savings Accounts'),
      ('2662', 'Revenue Received in Advance'),
      ('2663', 'Accrued Expenses'),
      ('2664', 'Accrued Salaries and Wages'),
      ('2665', 'Returned Salaries and Wages'),
      ('2666', 'National Pension Authority'),
      ('2667', 'Pension and Social Security Department'),
      ('2668', 'Cash and Inventory Credit Differences'),
      ('2669', 'Deferred Compensation and Fines'),
      ('2671', 'Staff Deductions for Third Parties'),
      ('2672', 'Non-staff Deductions for Third Parties'),
      ('2681', 'Public Treasury Share'),
      ('2682', 'Employees'' Share'),
      ('2921', 'Contra Letters of Credit Received'),
      ('2922', 'Letters of Credit Issued'),
      ('2923', 'Contra Letters of Guarantee Received'),
      ('2924', 'Letters of Guarantee Issued'),
      ('2925', 'Contra Contracts'),
      ('2941', 'Contra Imputed Rent Difference'),
      ('2942', 'Contra Imputed Interest Difference'),
      ('2943', 'Contra Finished Goods Inventory Change Valuation Difference'),
      ('2944', 'Contra Goods and Land Held for Sale Valuation Difference'),
      ('3111', 'Salaries'),
      ('3112', 'Qualification Allowances'),
      ('3113', 'Position Allowances'),
      ('3114', 'Family Allowances'),
      ('3115', 'Professional and Technical Allowances'),
      ('3116', 'Overtime Pay'),
      ('3117', 'Compensatory Allowances'),
      ('3118', 'Incentive Bonuses'),
      ('3119', 'Other Allowances'),
      ('3121', 'Wages'),
      ('3122', 'Qualification Allowances'),
      ('3123', 'Position Allowances'),
      ('3124', 'Family Allowances'),
      ('3125', 'Professional and Technical Allowances'),
      ('3126', 'Overtime Pay'),
      ('3127', 'Compensatory Allowances'),
      ('3128', 'Incentive Bonuses'),
      ('3129', 'Other Allowances'),
      ('3141', 'Employer''s Social Security Share'),
      ('3142', 'Employee Insurance'),
      ('3143', 'Employee Health Insurance'),
      ('3151', 'Employer''s Social Security Share'),
      ('3152', 'Worker Insurance'),
      ('3153', 'Worker Health Insurance'),
      ('3221', 'Petroleum Products'),
      ('3222', 'Gas'),
      ('3223', 'Oils and Greases'),
      ('3224', 'Coal'),
      ('3225', 'Gasoline'),
      ('3226', 'Kerosene'),
      ('3241', 'Consumable Packing Materials'),
      ('3242', 'Returnable Packing Materials'),
      ('3251', 'Supplies and Stores'),
      ('3252', 'Stationery'),
      ('3253', 'Scientific Books'),
      ('3254', 'Scrap and Consumables'),
      ('3255', 'Discount Allowed'),
      ('3261', 'Uniforms'),
      ('3262', 'Food Supplies'),
      ('3263', 'Medical Supplies'),
      ('3271', 'Water'),
      ('3272', 'Electricity'),
      ('3291', 'Hotel Fragrance Supplies'),
      ('3292', 'Hotel Sanitising Supplies'),
      ('3311', 'Maintenance of Nurseries, Parks and Gardens'),
      ('3312', 'Maintenance of Buildings, Structures and Roads'),
      ('3313', 'Machinery and Equipment Maintenance'),
      ('3314', 'Transport Vehicle Maintenance'),
      ('3315', 'Tools and Moulds Maintenance'),
      ('3316', 'Furniture and Office Equipment Maintenance'),
      ('3331', 'Advertising and Publicity'),
      ('3332', 'Publishing and Printing'),
      ('3333', 'Hospitality'),
      ('3334', 'Exhibition Expenses'),
      ('3335', 'Celebrations'),
      ('3341', 'Staff Transport'),
      ('3342', 'Goods Transport'),
      ('3343', 'Travel and Official Trips'),
      ('3344', 'General Communications'),
      ('3352', 'Rent of Buildings and Structures'),
      ('3353', 'Rent of Machinery and Equipment'),
      ('3354', 'Rent of Transport Vehicles'),
      ('3355', 'Rent of Tools and Moulds'),
      ('3356', 'Rent of Furniture and Office Equipment'),
      ('3361', 'Subscriptions and Memberships'),
      ('3362', 'Insurance Premiums'),
      ('3363', 'Fees to Non-employees for Services'),
      ('3364', 'Taxes and Fees Paid to Foreign Parties'),
      ('3365', 'Legal Services'),
      ('3366', 'Bank Services'),
      ('3367', 'Training and Development'),
      ('3368', 'Organisation and Audit Fees'),
      ('3369', 'Other Service Expenses'),
      ('3411', 'Amounts Paid to Iraqi Contractors'),
      ('3412', 'Amounts Paid to Non-Iraqi Contractors'),
      ('3511', 'Local Purchases of Goods for Sale'),
      ('3512', 'Imported Purchases of Goods for Sale'),
      ('3521', 'Land at Commercial Prices'),
      ('3522', 'Land at Reduced Prices'),
      ('3611', 'Local Interest Expense'),
      ('3612', 'Foreign Interest Expense'),
      ('3811', 'Pension Salaries'),
      ('3812', 'Social Grants'),
      ('3831', 'Donations to Others'),
      ('3832', 'Compensation and Fines'),
      ('3833', 'Bad Debts Written Off'),
      ('3834', 'Special Service Expenses'),
      ('3835', 'Marriage Advance Write-off'),
      ('3836', 'Economic Unit Share in Funding Public Benefit Bodies'),
      ('3837', 'Free Goods and Services'),
      ('3838', 'Cashier Expense Settlement'),
      ('3841', 'Production Fees'),
      ('3842', 'Other Taxes and Fees'),
      ('3851', 'Domestic Subsidies'),
      ('3852', 'Foreign Subsidies'),
      ('4111', 'Net Sales (Extractive Industries)'),
      ('4112', 'Change in Finished Goods Inventory'),
      ('4113', 'Change in Unfinished Goods Inventory'),
      ('4121', 'Net Sales (Manufacturing Industries)'),
      ('4122', 'Change in Finished Goods Inventory'),
      ('4123', 'Change in Unfinished Goods Inventory'),
      ('4131', 'Completed Work Certificates Revenue'),
      ('4132', 'Change in Work in Progress'),
      ('4141', 'Net Sales (Food Production)'),
      ('4142', 'Change in Finished Goods Inventory'),
      ('4143', 'Change in Crop Inventory, Standing Crops'),
      ('4151', 'Net Sales (Livestock Production)'),
      ('4152', 'Change in Finished Goods Inventory'),
      ('4153', 'Change in Livestock Inventory in Development'),
      ('4161', 'Water Revenue'),
      ('4162', 'Electricity Revenue'),
      ('4211', 'Net Sales of Goods for Sale'),
      ('4212', 'Net Sales of Land for Sale'),
      ('4213', 'Net Sales of Apartments for Sale'),
      ('4221', 'Change in Goods Held for Sale'),
      ('4222', 'Change in Land Held for Sale'),
      ('4241', 'Hotel and Tourism Revenue, Credit'),
      ('4251', 'Discount Earned'),
      ('4371', 'Cleaning Services Revenue'),
      ('4372', 'Tiling Services Revenue'),
      ('4382', 'Building Rental'),
      ('4383', 'Machinery and Equipment Rental'),
      ('4384', 'Transport Vehicle Rental'),
      ('4391', 'Business and Profession Fees'),
      ('4392', 'Advertising Fees'),
      ('4393', 'Licence Issue and Renewal Fees'),
      ('4394', 'Other Fees'),
      ('4811', 'Pension and Social Security Contribution'),
      ('4812', 'Security Share of Economic Unit Profits'),
      ('4821', 'Public Treasury Grant'),
      ('4822', 'Grants from Central or Affiliated Units'),
      ('4831', 'Donations Received'),
      ('4832', 'Compensation and Fines'),
      ('4833', 'Recovered Bad Debts'),
      ('11111', 'Purchase Cost'),
      ('11112', 'Reclamation Cost'),
      ('11211', 'Industrial Buildings'),
      ('11212', 'Commercial Buildings'),
      ('11213', 'Service Buildings'),
      ('11214', 'Recreational Buildings'),
      ('11215', 'Health Buildings'),
      ('11241', 'Wells'),
      ('11242', 'Mines'),
      ('11243', 'Quarries'),
      ('11281', 'Railway Lines'),
      ('11282', 'Port Quays and Moorings'),
      ('11283', 'Aircraft Runways'),
      ('11291', 'Sewers'),
      ('11292', 'Water Basins'),
      ('11293', 'Greenhouses'),
      ('11294', 'Water Pipelines'),
      ('11295', 'Electricity and Water Lines'),
      ('11301', 'Sports Devices and Equipment'),
      ('11411', 'Passenger Vehicles'),
      ('11412', 'Goods Vehicles'),
      ('11413', 'Other Vehicles'),
      ('11631', 'Large Computers (Servers)'),
      ('11632', 'Small Computers (Clients)'),
      ('11633', 'Computer Software'),
      ('11641', 'Large Printers (Server)'),
      ('11642', 'Small Printers'),
      ('11711', 'Plants for Display'),
      ('11712', 'Plants for Production'),
      ('11721', 'Animals for Display'),
      ('11722', 'Animals for Production'),
      ('12111', 'Purchase Cost'),
      ('12112', 'Reclamation Cost'),
      ('12211', 'Industrial Buildings'),
      ('12212', 'Commercial Buildings'),
      ('12213', 'Service Buildings'),
      ('12214', 'Recreational Buildings'),
      ('12215', 'Health Buildings'),
      ('12241', 'Wells'),
      ('12242', 'Mines'),
      ('12243', 'Quarries'),
      ('12281', 'Railway Lines'),
      ('12282', 'Port Quays and Moorings'),
      ('12283', 'Aircraft Runways'),
      ('12291', 'Sewers'),
      ('12292', 'Water Basins'),
      ('12293', 'Greenhouses'),
      ('12294', 'Water Pipelines'),
      ('12295', 'Electricity and Water Lines'),
      ('12411', 'Passenger Vehicles'),
      ('12412', 'Goods Vehicles'),
      ('12413', 'Other Vehicles'),
      ('12633', 'Computer Software'),
      ('12711', 'Plants for Display'),
      ('12712', 'Plants for Production'),
      ('12721', 'Animals for Display'),
      ('12722', 'Animals for Production'),
      ('13541', 'Scrap and Consumables Store, Normal Conditions'),
      ('13542', 'Scrap and Consumables Store, Abnormal Conditions'),
      ('13721', 'Land at Commercial Prices'),
      ('13722', 'Land at Discounted Prices'),
      ('16141', 'Debtors, Private Sector, Cash'),
      ('16611', 'Short-term Deposits with Third Parties'),
      ('16612', 'Long-term Deposits with Third Parties'),
      ('16621', 'Accrued Revenue, Apartments'),
      ('16651', 'Cash Differences'),
      ('16652', 'Inventory Differences'),
      ('16653', 'Fixed Asset Differences'),
      ('16661', 'Cash Differences'),
      ('16662', 'Inventory Differences'),
      ('16663', 'Fixed Asset Differences'),
      ('22111', 'Used Expansion Reserve'),
      ('22112', 'Unused Expansion Reserve'),
      ('26611', 'Short-term Deposits Received'),
      ('26612', 'Long-term Deposits Received'),
      ('26613', 'Savings Accounts'),
      ('26621', 'Revenue Received in Advance, Apartments'),
      ('26681', 'Cash Credit Differences'),
      ('26682', 'Inventory Credit Differences'),
      ('32711', 'Drinking Water'),
      ('32712', 'Irrigation Water'),
      ('33111', 'Nursery Maintenance'),
      ('33112', 'Park Maintenance'),
      ('33113', 'Garden Maintenance'),
      ('33121', 'Building Maintenance'),
      ('33122', 'Maintenance of Warehouses, Tanks and Silos'),
      ('33123', 'Residential Facilities Maintenance'),
      ('33124', 'Maintenance of Wells, Mines and Quarries'),
      ('33125', 'Maintenance of Dams and Canals'),
      ('33126', 'Existing Facilities Maintenance'),
      ('33127', 'Road and Bridge Maintenance'),
      ('33128', 'Transport Facilities Maintenance'),
      ('33129', 'Other Facilities Maintenance'),
      ('33141', 'Road Vehicle Maintenance'),
      ('33142', 'Rail Transport Maintenance'),
      ('33143', 'Land Transport Maintenance'),
      ('33144', 'Sea Transport Maintenance'),
      ('33145', 'Air Transport Maintenance'),
      ('33146', 'Oil and Gas Pipeline Maintenance'),
      ('33147', 'Sports Equipment Maintenance'),
      ('33161', 'Furniture Maintenance'),
      ('33162', 'Air Conditioning and Cooling Maintenance'),
      ('33163', 'Computer Maintenance'),
      ('33164', 'Calculator, Typewriter and Copier Maintenance'),
      ('33165', 'Office Tools and Equipment Maintenance'),
      ('33167', 'Books and Scientific References Maintenance'),
      ('33431', 'Travel for Training and Study'),
      ('33432', 'Travel for Business Purposes'),
      ('33611', 'Domestic Subscriptions and Memberships'),
      ('33612', 'Foreign Subscriptions and Memberships'),
      ('33671', 'Student and Trainee Allowances'),
      ('33672', 'Training and Study Fees'),
      ('33681', 'Organisation Fees'),
      ('33682', 'Audit Fees'),
      ('33691', 'Tourism Commission'),
      ('33692', 'Booking Advisers'),
      ('33693', 'Order Percentage Commission'),
      ('33694', 'Ticket Sales Percentage'),
      ('35121', 'Purchases for the Economic Unit'),
      ('35122', 'Purchases for Third Parties'),
      ('35123', 'Purchases of Trade Samples'),
      ('35124', 'Purchases of Damaged Goods for Sale'),
      ('38371', 'Free Goods and Services under Legislation'),
      ('38372', 'Free Goods and Services under Administrative Decisions'),
      ('38381', 'Discounted Goods and Services under Legislation'),
      ('38382', 'Discounted Goods and Services under Administrative Decisions'),
      ('38421', 'Property Tax'),
      ('38422', 'Other Taxes'),
      ('38423', 'Residency Fees'),
      ('41411', 'Net Sales (Food Production), Credit'),
      ('42111', 'Sales'),
      ('42112', 'Sales Discount'),
      ('42113', 'Discount Earned'),
      ('42114', 'Cost of Sales'),
      ('42121', 'Land at Commercial Prices'),
      ('42122', 'Land at Commercial Prices'),
      ('42221', 'Land at Commercial Prices'),
      ('42222', 'Land at Commercial Prices'),
      ('43821', 'Residential Building Rental'),
      ('43822', 'Commercial Building Rental'),
      ('43823', 'Service Building Rental'),
      ('48321', 'Compensation'),
      ('48322', 'Fines'),
      ('111121', 'Gardens and Parks Land'),
      ('111122', 'Nursery Land'),
      ('112621', 'Port Quays'),
      ('112821', 'Moorings'),
      ('112822', 'Moorings'),
      ('121121', 'Gardens and Parks Land'),
      ('121122', 'Nursery Land'),
      ('122821', 'Port Quays'),
      ('122822', 'Moorings'),
      ('122823', 'Airport Runways'),
      ('266131', 'Regular Savings'),
      ('266132', 'School Savings'),
      ('266133', 'Domestic Remittances'),
      ('266134', 'Foreign Remittances'),
      ('266135', 'Postal Transfers'),
      ('331211', 'Industrial Building Maintenance'),
      ('331212', 'Commercial Building Maintenance'),
      ('331213', 'Service Building Maintenance'),
      ('331214', 'Recreational Building Maintenance'),
      ('331215', 'Health Building Maintenance'),
      ('331292', 'Water Basin Maintenance'),
      ('331293', 'Greenhouse Maintenance'),
      ('331295', 'Electricity and Telephone Lines'),
      ('331411', 'Passenger Vehicle Maintenance'),
      ('331412', 'Goods Vehicle Maintenance'),
      ('331413', 'Other Vehicle Maintenance'),
      ('483222', 'Other Fines Revenue')
    ) as t(code, name_en)
   where a.company_id = p_company_id
     and a.code = t.code
     and a.name_en = a.name_ar;

  alter table public.accounts enable trigger user;
end;
$$;

create or replace function public._seed_demo_chart(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._seed_demo_chart_arabic(p_company_id);
  perform public._apply_demo_chart_english(p_company_id);
end;
$$;

revoke execute on function public._seed_demo_chart(uuid) from public, anon, authenticated;
revoke execute on function public._apply_demo_chart_english(uuid) from public, anon, authenticated;

select public._apply_demo_chart_english(c.id) from public.companies c where c.is_demo;

-- >>> 20261107000300_dalil_for_every_company.sql
-- =============================================================================
-- Vio Accounting — the dalil for every company, and no more demo data
-- The demo switch is gone: demo companies are deleted with everything in them,
-- and the demo functions and flag are dropped. New companies now start on the
-- 731-account Kurdistan chart (دلیل الحسابات) with its Arabic and English names,
-- in place of the short standard chart.
--
-- The file stands on its own: it works whether or not the earlier demo files
-- were run, and it can be run again safely.
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
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'is_demo') then
    perform public._clear_company_books(c.id, true) from public.companies c where c.is_demo;
  end if;
end;
$$;

drop function if exists public.create_demo_company();
drop function if exists public.delete_demo_company(uuid);
drop function if exists public._demo_entry(uuid, date, text, jsonb, text, text);
drop function if exists public._demo_voucher(uuid, text, date, text, text, numeric, text, text, text);
drop function if exists public._seed_demo_chart(uuid);
drop function if exists public._seed_demo_chart_arabic(uuid);
drop function if exists public._apply_demo_chart_english(uuid);
drop index if exists public.companies_one_demo_per_user_idx;
alter table public.companies drop column if exists is_demo;

-- ---------------------------------------------------------------------------
-- The dalil: 731 accounts of the client's chart (دلیل الحسابات, Iraqi unified
-- system). Class 2 mixes liabilities with capital and reserves, while this app
-- needs a child account to share its parent's type, so 21 and 22 are equity
-- roots of their own and 231 (accumulated depreciation) is a contra-asset.
-- ---------------------------------------------------------------------------
create or replace function public._seed_dalil_chart(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- One insert, not one per account: the row-by-row guard and audit triggers take
  -- too long for the API's statement timeout and would add 731 audit rows. The
  -- list is fixed, and supabase/tests/dalil.test.ts re-checks what the guard checks.
  alter table public.accounts disable trigger user;

  with chart (code, name_en, name_ar, parent_code, account_type, category_code, normal_balance, is_posting, level) as (
    values
      ('1', 'Assets', 'الموجودات', null, 'asset', null, 'debit', false, 1),
      ('2', 'Liabilities', 'المطلوبات', null, 'liability', null, 'credit', false, 1),
      ('3', 'Expenses', 'المصروفات', null, 'expense', null, 'debit', false, 1),
      ('4', 'Revenue', 'الإیرادات', null, 'revenue', null, 'credit', false, 1),
      ('11', 'Fixed Assets', 'الموجودات الثابتة', '1', 'asset', null, 'debit', false, 2),
      ('12', 'Projects Under Construction', 'مشروعات تحت التنفیذ', '1', 'asset', null, 'debit', false, 2),
      ('13', 'Inventory', 'المخزون', '1', 'asset', null, 'debit', false, 2),
      ('14', 'Loans Granted', 'القروض الممنوحة', '1', 'asset', null, 'debit', false, 2),
      ('15', 'Financial Investments', 'الاستثمارات المالیة', '1', 'asset', null, 'debit', false, 2),
      ('16', 'Debtors', 'المدینون', '1', 'asset', null, 'debit', false, 2),
      ('18', 'Cash', 'النقود', '1', 'asset', null, 'debit', false, 2),
      ('19', 'Debit Contra Accounts', 'الحسابات المتقابلة المدینة', '1', 'asset', null, 'debit', false, 2),
      ('21', 'Capital', 'راس المال', null, 'equity', null, 'credit', false, 1),
      ('22', 'Reserves', 'الاحتیاطیات', null, 'equity', null, 'credit', false, 1),
      ('23', 'Provisions', 'التخصیصات', '2', 'liability', null, 'credit', false, 2),
      ('24', 'Loans Received', 'القروض المستلمة', '2', 'liability', null, 'credit', false, 2),
      ('25', 'Bank Creditors', 'المصارف الدائنة', '2', 'liability', null, 'credit', false, 2),
      ('26', 'Creditors', 'الدائنون', '2', 'liability', null, 'credit', false, 2),
      ('28', 'Current Operations Accounts', 'حسابات العملیات الجاریة', '2', 'liability', null, 'credit', false, 2),
      ('29', 'Credit Contra Accounts', 'الحسابات المتقابلة الدائنة', '2', 'liability', null, 'credit', false, 2),
      ('31', 'Salaries and Wages', 'الرواتب والاجور', '3', 'expense', null, 'debit', false, 2),
      ('32', 'Commodity Requirements', 'المستلزمات السلعیة', '3', 'expense', null, 'debit', false, 2),
      ('33', 'Service Requirements', 'المستلزمات الخدمیة', '3', 'expense', null, 'debit', false, 2),
      ('34', 'Contracts and Services', 'مقاولات وخدمات', '3', 'expense', null, 'debit', false, 2),
      ('35', 'Purchases of Goods and Land for Sale', 'مشتریات بضائع واراضی بغرض البیع', '3', 'expense', null, 'debit', false, 2),
      ('36', 'Interest and Land Rent', 'الفوائد وایجارات الاراضی', '3', 'expense', null, 'debit', false, 2),
      ('37', 'Depreciation', 'اندثارات', '3', 'expense', null, 'debit', false, 2),
      ('38', 'Transfer Expenses', 'المصروفات التحویلیة', '3', 'expense', null, 'debit', false, 2),
      ('39', 'Other Expenses', 'المصروفات الاخرى', '3', 'expense', null, 'debit', false, 2),
      ('41', 'Commodity Production Revenue', 'ایراد نشاط الانتاج السلعی', '4', 'revenue', null, 'credit', false, 2),
      ('42', 'Trading Revenue', 'ایراد النشاط التجاری', '4', 'revenue', null, 'credit', false, 2),
      ('43', 'Service Revenue', 'ایراد النشاط الخدمی', '4', 'revenue', null, 'credit', false, 2),
      ('44', 'Operating Revenue', 'ایراد التشغیل', '4', 'revenue', null, 'credit', false, 2),
      ('45', 'Cost of Locally Manufactured Assets', 'كلفة الموجودات المصنعة محلیا', '4', 'revenue', null, 'credit', false, 2),
      ('46', 'Interest and Land Rent', 'الفوائد وایجارات الاراضی', '4', 'revenue', null, 'credit', false, 2),
      ('47', 'Subsidies', 'اعانات', '4', 'revenue', null, 'credit', false, 2),
      ('48', 'Transfer Revenue', 'الایرادات التحویلیة', '4', 'revenue', null, 'credit', false, 2),
      ('49', 'Other Revenue', 'الایرادات الاخرى', '4', 'revenue', null, 'credit', false, 2),
      ('111', 'Land', 'اراضی', '11', 'asset', null, 'debit', false, 3),
      ('112', 'Buildings, Structures and Roads', 'مبانی وانشاءات وطرق', '11', 'asset', null, 'debit', false, 3),
      ('113', 'Machinery and Equipment', 'الات ومعدات', '11', 'asset', null, 'debit', false, 3),
      ('114', 'Transport and Travel Vehicles', 'وسائط نقل وانتقال', '11', 'asset', null, 'debit', false, 3),
      ('115', 'Tools and Moulds', 'عدد وقوالب', '11', 'asset', null, 'debit', false, 3),
      ('116', 'Furniture and Office Equipment', 'اثاث واجهزة مكاتب', '11', 'asset', null, 'debit', false, 3),
      ('117', 'Living Assets for Display and Production', 'الموجودات الحیة لاغراض العرض والانتاج', '11', 'asset', null, 'debit', false, 3),
      ('118', 'Deferred Revenue Expenditure', 'نفقات ایرادیة مؤجلة', '11', 'asset', null, 'debit', false, 3),
      ('121', 'Land', 'اراضی', '12', 'asset', null, 'debit', false, 3),
      ('122', 'Buildings, Structures and Roads', 'مبانی وانشاءات وطرق', '12', 'asset', null, 'debit', false, 3),
      ('123', 'Machinery and Equipment', 'الات ومعدات', '12', 'asset', 'property_equipment', 'debit', true, 3),
      ('124', 'Transport and Travel Vehicles', 'وسائط نقل وانتقال', '12', 'asset', null, 'debit', false, 3),
      ('125', 'Tools and Moulds', 'عدد وقوالب', '12', 'asset', null, 'debit', false, 3),
      ('126', 'Furniture and Office Equipment', 'اثاث واجهزة مكاتب', '12', 'asset', null, 'debit', false, 3),
      ('127', 'Living Assets for Display and Production', 'الموجودات الحیة لاغراض العرض والانتاج', '12', 'asset', null, 'debit', false, 3),
      ('128', 'Deferred Revenue Expenditure', 'نفقات ایرادیة مؤجلة', '12', 'asset', null, 'debit', false, 3),
      ('129', 'Capital Expenditure', 'انفاق استثماری', '12', 'asset', null, 'debit', false, 3),
      ('131', 'Raw Materials Store', 'مخزن الخامات والمواد الاولیة', '13', 'asset', 'inventory', 'debit', true, 3),
      ('132', 'Fuel and Oil Store', 'مخزن الوقود والزیوت', '13', 'asset', 'inventory', 'debit', true, 3),
      ('133', 'Spare Parts Store', 'مخزن الادوات الاحتیاطیة', '13', 'asset', 'inventory', 'debit', true, 3),
      ('134', 'Packing Materials Store', 'مخزن مواد التعبئة والتغلیف', '13', 'asset', null, 'debit', false, 3),
      ('135', 'Miscellaneous Store', 'مخزن المتنوعات', '13', 'asset', null, 'debit', false, 3),
      ('136', 'Production Store', 'مخزن الانتاج', '13', 'asset', null, 'debit', false, 3),
      ('137', 'Goods and Land Held for Sale Store', 'مخزن البضائع والاراضی بغرض البیع', '13', 'asset', null, 'debit', false, 3),
      ('138', 'Letters of Credit for Material Purchases', 'اعتمادات مستندیة لشراء المواد', '13', 'asset', null, 'debit', false, 3),
      ('139', 'Other Materials Store', 'مخزن المواد الاخرى', '13', 'asset', null, 'debit', false, 3),
      ('141', 'Long-term Loans Granted', 'قروض ممنوحة طویلة الاجل', '14', 'asset', null, 'debit', false, 3),
      ('142', 'Short-term Loans Granted', 'قروض ممنوحة قصیرة الاجل', '14', 'asset', null, 'debit', false, 3),
      ('151', 'Long-term Financial Investments', 'استثمارات مالیة طویلة الاجل', '15', 'asset', null, 'debit', false, 3),
      ('152', 'Short-term Financial Investments', 'استثمارات مالیة قصیرة الاجل', '15', 'asset', null, 'debit', false, 3),
      ('161', 'Trade Debtors (Customers)', 'مدینون تجاریون (عملاء)', '16', 'asset', null, 'debit', false, 3),
      ('162', 'Notes Receivable', 'اوراق قبض', '16', 'asset', null, 'debit', false, 3),
      ('163', 'Debit Current Accounts', 'حسابات جاریة مدینة', '16', 'asset', null, 'debit', false, 3),
      ('164', 'Subcontractor Advances', 'سلف التعهدات الثانویة', '16', 'asset', 'receivables', 'debit', true, 3),
      ('165', 'Non-current Activity Debtors', 'مدینو نشاط غیر جاری', '16', 'asset', 'receivables', 'debit', true, 3),
      ('166', 'Miscellaneous Debit Accounts', 'حسابات مدینة متنوعة', '16', 'asset', null, 'debit', false, 3),
      ('167', 'Advances', 'سلف', '16', 'asset', null, 'debit', false, 3),
      ('181', 'Cash on Hand', 'نقدیة بالصندوق', '18', 'asset', null, 'debit', false, 3),
      ('182', 'Imprest Funds', 'سلف مستدیمة', '18', 'asset', 'cash', 'debit', true, 3),
      ('183', 'Cash at Banks', 'نقدیة لدى المصارف', '18', 'asset', null, 'debit', false, 3),
      ('184', 'Cash at Treasuries', 'نقدیة لدى الخزائن', '18', 'asset', 'cash', 'debit', true, 3),
      ('185', 'Cheques and Remittances', 'صكوك وحوالات', '18', 'asset', null, 'debit', false, 3),
      ('191', 'Finished Goods Movement at Selling Price', 'حركة الانتاج التام بسعر البیع', '19', 'asset', 'other_non_current_assets', 'debit', true, 3),
      ('192', 'Debit Commitments Account', 'حساب الالتزامات المدینة', '19', 'asset', null, 'debit', false, 3),
      ('193', 'Accounts at Nominal Value', 'حسابات بالقیمة الرمزیة', '19', 'asset', 'other_non_current_assets', 'debit', true, 3),
      ('194', 'Debit Result Accounts', 'حسابات النتیجة المدینة', '19', 'asset', null, 'debit', false, 3),
      ('195', 'Archaeological and Art Assets', 'موجودات اثریة وفنیة', '19', 'asset', 'other_non_current_assets', 'debit', true, 3),
      ('211', 'Paid-up Capital', 'راس المال المدفوع', '21', 'equity', 'capital', 'credit', true, 2),
      ('212', 'Capital (Net Assets)', 'راس المال (صافی الموجودات)', '21', 'equity', 'capital', 'credit', true, 2),
      ('213', 'Donated Capital', 'راس المال المتبرع به', '21', 'equity', 'capital', 'credit', true, 2),
      ('221', 'Capital Reserves', 'احتیاطیات راسمالیة', '22', 'equity', null, 'credit', false, 2),
      ('222', 'General Reserve', 'احتیاطی عام', '22', 'equity', 'reserves', 'credit', true, 2),
      ('223', 'Miscellaneous Reserves', 'احتیاطیات متنوعة', '22', 'equity', 'reserves', 'credit', true, 2),
      ('224', 'Accumulated Surplus', 'الفائض المتراكم', '22', 'equity', 'retained_earnings', 'credit', true, 2),
      ('225', 'Accumulated Deficit (Debit)', 'العجز المتراكم (مدین)', '22', 'equity', 'retained_earnings', 'debit', true, 2),
      ('231', 'Accumulated Depreciation Provision', 'مخصص الاندثار المتراكم', null, 'asset', null, 'credit', false, 1),
      ('232', 'Provision for Doubtful Debts', 'مخصص الدیون المشكوك فی تحصیلها', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('234', 'Provision for Purchase Expenses', 'مخصص مصروفات الشراء', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('235', 'Provision for Expected Losses on Projects in Progress', 'مخصص خسائر متوقعة لمشاریع قید الانجاز', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('236', 'Provision for Probable Maintenance Expenses', 'مخصص مصاریف الصیانة المحتملة', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('237', 'Provision for Decline in Inventory Prices', 'مخصص هبوط اسعار المخزون السلعی', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('238', 'Provision for Decline in Financial Investments', 'مخصص هبوط الإستثمارات المالیة', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('239', 'Miscellaneous Provisions', 'تخصیصات متنوعة', '23', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('241', 'Long-term Loans Received', 'قروض مستلمة طویلة الاجل', '24', 'liability', null, 'credit', false, 3),
      ('242', 'Short-term Loans Received', 'قروض مستلمة قصیرة الاجل', '24', 'liability', null, 'credit', false, 3),
      ('251', 'Bank Overdraft', 'جاری مكشوف', '25', 'liability', 'short_term_loans', 'credit', true, 3),
      ('261', 'Trade Suppliers', 'مجهزون تجاریون', '26', 'liability', null, 'credit', false, 3),
      ('262', 'Notes Payable', 'اوراق دفع', '26', 'liability', null, 'credit', false, 3),
      ('263', 'Credit Current Accounts', 'حسابات جاریة دائنة', '26', 'liability', null, 'credit', false, 3),
      ('264', 'Contract Accounts', 'حسابات التعهدات', '26', 'liability', null, 'credit', false, 3),
      ('265', 'Non-current Activity Creditors', 'دائنو نشاط غیر جاری', '26', 'liability', null, 'credit', false, 3),
      ('266', 'Miscellaneous Credit Accounts', 'حسابات دائنة متنوعة', '26', 'liability', null, 'credit', false, 3),
      ('267', 'Deductions on Behalf of Third Parties', 'استقطاعات لحساب الغیر', '26', 'liability', null, 'credit', false, 3),
      ('268', 'Profit Distribution Creditors', 'دائنو توزیع الارباح', '26', 'liability', null, 'credit', false, 3),
      ('281', 'Current Activity Account', 'حساب النشاط الجاری', '28', 'liability', 'accrued_liabilities', 'credit', true, 3),
      ('291', 'Contra Finished Goods Movement at Selling Price', 'مقابل حركة الانتاج التام بسعر البیع', '29', 'liability', 'other_non_current_liabilities', 'credit', true, 3),
      ('292', 'Credit Commitments Accounts', 'حسابات الالتزامات الدائنة', '29', 'liability', null, 'credit', false, 3),
      ('293', 'Contra Accounts at Nominal Value', 'مقابل الحسابات بالقیمة الرمزیة', '29', 'liability', 'other_non_current_liabilities', 'credit', true, 3),
      ('294', 'Credit Result Accounts', 'حسابات النتیجة الدائنة', '29', 'liability', null, 'credit', false, 3),
      ('295', 'Contra Archaeological and Art Assets', 'مقابل موجودات اثریة وفنیة', '29', 'liability', 'other_non_current_liabilities', 'credit', true, 3),
      ('311', 'Cash Salaries for Employees', 'الرواتب النقدیة للموظفین', '31', 'expense', null, 'debit', false, 3),
      ('312', 'Cash Wages for Workers', 'الاجور النقدیة للعمال', '31', 'expense', null, 'debit', false, 3),
      ('313', 'Salaries, Wages and Allowances of Non-Iraqis', 'رواتب واجور ومخصصات غیر العراقیین', '31', 'expense', 'operating_expenses', 'debit', true, 3),
      ('314', 'Social Security Contribution for Employees', 'المساهمة فی الضمان الاجتماعی للموظفین', '31', 'expense', null, 'debit', false, 3),
      ('315', 'Social Security Contribution for Workers', 'المساهمة للضمان الاجتماعی للعمال', '31', 'expense', null, 'debit', false, 3),
      ('316', 'Social Security Contribution for Non-Iraqis', 'المساهمة فی الضمان الاجتماعی لغیر العراقیین', '31', 'expense', 'operating_expenses', 'debit', true, 3),
      ('321', 'Raw Materials', 'الخامات والمواد الاولیة', '32', 'expense', 'operating_expenses', 'debit', true, 3),
      ('322', 'Fuel and Oils', 'الوقود والزیوت', '32', 'expense', null, 'debit', false, 3),
      ('323', 'Spare Parts', 'الادوات الااحتیاطیة', '32', 'expense', 'operating_expenses', 'debit', true, 3),
      ('324', 'Packing Materials', 'مواد تعبئة وتغلیف', '32', 'expense', null, 'debit', false, 3),
      ('325', 'Miscellaneous Items', 'المتنوعات', '32', 'expense', null, 'debit', false, 3),
      ('326', 'Staff Equipment', 'تجهیزات العاملین', '32', 'expense', null, 'debit', false, 3),
      ('327', 'Water and Electricity', 'المیاه والكهرباء', '32', 'expense', null, 'debit', false, 3),
      ('329', 'Other Commodity Requirements', 'مستلزمات سلعیة اخرى', '32', 'expense', null, 'debit', false, 3),
      ('331', 'Maintenance Services', 'خدمات الصیانة', '33', 'expense', null, 'debit', false, 3),
      ('332', 'Research and Consulting Services', 'خدمات ابحاث واستشارات', '33', 'expense', 'operating_expenses', 'debit', true, 3),
      ('333', 'Advertising, Printing and Hospitality', 'دعایة وطبع وضیافة', '33', 'expense', null, 'debit', false, 3),
      ('334', 'Transport, Travel and Communications', 'نقل وایفاد واتصالات', '33', 'expense', null, 'debit', false, 3),
      ('335', 'Fixed Asset Rental', 'استئجار موجودات ثابتة', '33', 'expense', null, 'debit', false, 3),
      ('336', 'Miscellaneous Service Expenses', 'مصروفات خدمیة متنوعة', '33', 'expense', null, 'debit', false, 3),
      ('337', 'Security Services', 'خدمات الحراسة', '33', 'expense', 'operating_expenses', 'debit', true, 3),
      ('341', 'Subcontracts', 'مقاولات ثانویة', '34', 'expense', null, 'debit', false, 3),
      ('342', 'Operating Services', 'خدمات التشغیل', '34', 'expense', 'operating_expenses', 'debit', true, 3),
      ('351', 'Purchases of Goods for Sale', 'مشتریات بضائع بغرض البیع', '35', 'expense', null, 'debit', false, 3),
      ('352', 'Purchases of Land for Sale', 'مشتریات اراضی بغرض البیع', '35', 'expense', null, 'debit', false, 3),
      ('361', 'Interest Expense', 'فوائد مدینة', '36', 'expense', null, 'debit', false, 3),
      ('362', 'Land Rent', 'ایجارات الاراضی', '36', 'expense', 'other_expenses', 'debit', true, 3),
      ('372', 'Depreciation of Buildings, Structures and Roads', 'اندثار مبانی وانشاءات وطرق', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('373', 'Depreciation of Machinery and Equipment', 'اندثار الات ومعدات', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('374', 'Depreciation of Transport Vehicles', 'اندثار وسائط نقل وانتقال', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('375', 'Depreciation of Tools and Moulds', 'اندثار عدد وقوالب', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('376', 'Depreciation of Furniture and Office Equipment', 'اندثار اثاث واجهزة ومكاتب', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('377', 'Depletion of Living Assets for Display and Production', 'اهلاك موجودات جیة لاغراض العرض والانتاج', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('378', 'Amortisation of Deferred Expenses', 'اطفاء نفقات مؤجلة', '37', 'expense', 'operating_expenses', 'debit', true, 3),
      ('381', 'Pension and Social Security Expenses', 'نفقات التقاعد والضمان الاجتماعی', '38', 'expense', null, 'debit', false, 3),
      ('382', 'Contribution to Expenses of Main or Affiliated Units', 'المساهمة فی نفقات الوحدات الرئیسیة او التابعة', '38', 'expense', 'other_expenses', 'debit', true, 3),
      ('383', 'Miscellaneous Transfer Expenses', 'مصروفات تحویلیة متنوعة', '38', 'expense', null, 'debit', false, 3),
      ('384', 'Taxes and Fees', 'ضرائب ورسوم', '38', 'expense', null, 'debit', false, 3),
      ('385', 'Subsidies', 'اعانات', '38', 'expense', null, 'debit', false, 3),
      ('386', 'Currency Exchange Centre', 'مرکز تبدیل عمله', '38', 'expense', 'other_expenses', 'debit', true, 3),
      ('391', 'Prior Years'' Expenses', 'مصروفات سنوات سابقة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('392', 'Incidental Expenses', 'مصروفات عرضیة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('393', 'Capital Losses', 'خسائر راسمالیة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('394', 'Expected Losses on Projects in Progress', 'خسائر متوقعة لمشاریع قید الانجاز', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('395', 'Probable Maintenance Expenses', 'مصاریف الصیانة المحتملة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('396', 'Losses from Decline in Inventory Prices', 'خسائر هبوط اسعار المخزون السلعی', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('397', 'Losses from Decline in Financial Investment Prices', 'خسائر هبوط اسعار الاستثمارات المالیة', '39', 'expense', 'other_expenses', 'debit', true, 3),
      ('411', 'Extractive Industries Revenue', 'ایراد نشاط الصناعات الاستخراجیة', '41', 'revenue', null, 'credit', false, 3),
      ('412', 'Manufacturing Industries Revenue', 'ایراد نشاط الصناعات التحویلیة', '41', 'revenue', null, 'credit', false, 3),
      ('413', 'Construction Revenue', 'ایراد نشاط التشیید', '41', 'revenue', null, 'credit', false, 3),
      ('414', 'Food Production Revenue', 'ایراد نشاط الانتاج الغذائی', '41', 'revenue', null, 'credit', false, 3),
      ('415', 'Livestock Production Revenue', 'ایراد نشاط الانتاج الحیوانی', '41', 'revenue', null, 'credit', false, 3),
      ('416', 'Water and Electricity Revenue', 'ایراد ماء وكهرباء', '41', 'revenue', null, 'credit', false, 3),
      ('417', 'Scrap Sales Revenue', 'ایراد بیع مخلفات', '41', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('421', 'Net Sales of Goods and Land for Sale', 'صافی مبیعات بضائع واراضی بغرض البیع', '42', 'revenue', null, 'credit', false, 3),
      ('422', 'Change in Goods and Land Held for Sale', 'تغیر مخزون بضائع واراضی بغرض البیع', '42', 'revenue', null, 'credit', false, 3),
      ('423', 'Commission Received', 'عمولة مستلمة', '42', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('424', 'Hotel and Tourism Revenue', 'ایراد الفندقة والسیاحة', '42', 'revenue', null, 'credit', false, 3),
      ('425', 'Miscellaneous Revenue', 'ایرادات متنوعة', '42', 'revenue', null, 'credit', false, 3),
      ('431', 'Transport Services Revenue', 'ایراد خدمات النقل', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('432', 'Communications Services Revenue', 'ایراد خدمات الاتصالات', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('433', 'Maintenance and Repair Services Revenue', 'ایراد خدمات الصیانة والتصلیح', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('434', 'Consulting and Technical Services Revenue', 'ایراد خدمات استشاریة وفنیة', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('435', 'Social Services Revenue', 'ایراد خدمات اجتماعیة', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('436', 'Membership and Subscription Revenue', 'ایراد انتساب واشتراك', '43', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('437', 'Miscellaneous Services Revenue', 'ایراد خدمات متنوعة', '43', 'revenue', null, 'credit', false, 3),
      ('438', 'Fixed Asset Rental (Excluding Land)', 'ایجار موجودات ثابتة (عدا الاراضی)', '43', 'revenue', null, 'credit', false, 3),
      ('439', 'Fees Revenue', 'ایراد الرسوم', '43', 'revenue', null, 'credit', false, 3),
      ('441', 'Operating Revenue from Third Parties', 'ایراد التشغیل للغیر', '44', 'revenue', 'operating_revenue', 'credit', true, 3),
      ('451', 'Cost of Manufactured Fixed Assets', 'كلفة الموجودات الثابتة المصنعة', '45', 'revenue', 'other_revenue', 'credit', true, 3),
      ('452', 'Cost of Manufactured Spare Parts', 'كلفة الادوات الاحتیاطیة المصنعة', '45', 'revenue', 'other_revenue', 'credit', true, 3),
      ('453', 'Cost of Manufactured Returnable Packing Materials', 'كلفة مواد التعبئة المتداولة المصنعة', '45', 'revenue', 'other_revenue', 'credit', true, 3),
      ('461', 'Interest Income', 'فوائد دائنة', '46', 'revenue', 'other_revenue', 'credit', true, 3),
      ('462', 'Land Rent', 'ایجارات الاراضی', '46', 'revenue', 'other_revenue', 'credit', true, 3),
      ('463', 'Financial Investment Income', 'ایرادات الاستثمارات المالیة', '46', 'revenue', 'other_revenue', 'credit', true, 3),
      ('471', 'Imported Goods Subsidies', 'اعانات سلع مستوردة', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('472', 'Local Production Subsidies', 'اعانات انتاج محلی', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('473', 'Export Subsidies', 'اعانات تصدیر', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('474', 'Other Subsidies', 'اعانات اخرى', '47', 'revenue', 'other_revenue', 'credit', true, 3),
      ('481', 'Pension and Social Security Revenue', 'ایرادات التقاعد والضمان الاجتماعی', '48', 'revenue', null, 'credit', false, 3),
      ('482', 'Financing Grants', 'منح تمویلیة', '48', 'revenue', null, 'credit', false, 3),
      ('483', 'Miscellaneous Transfer Revenue', 'ایرادات تحویلیة متنوعة', '48', 'revenue', null, 'credit', false, 3),
      ('486', 'Currency Exchange Centre', 'مرکز تبدیل عمله', '48', 'revenue', 'other_revenue', 'credit', true, 3),
      ('491', 'Prior Years'' Revenue', 'ایرادات سنوات سابقة', '49', 'revenue', 'other_revenue', 'credit', true, 3),
      ('492', 'Incidental Revenue', 'ایرادات عرضیة', '49', 'revenue', 'other_revenue', 'credit', true, 3),
      ('1111', 'Agricultural Land', 'اراضى زراعیة', '111', 'asset', null, 'debit', false, 4),
      ('1112', 'Building Land', 'اراضی بناء', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1113', 'Commercial Land', 'اراضی التجاریة', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1114', 'Residential Land', 'اراضی السكنیة', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1116', 'Vacant Land', 'اراضی الفضاء', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1117', 'Other Land', 'اراضی اخرى', '111', 'asset', 'property_equipment', 'debit', true, 4),
      ('1121', 'Buildings', 'مبانی', '112', 'asset', null, 'debit', false, 4),
      ('1122', 'Warehouses, Tanks and Silos', 'مخازن وخزانات وسایلوات', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1123', 'Residential Facilities', 'منشات سكنیة', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1124', 'Wells, Mines and Quarries', 'ابار ومناجم ومقالع', '112', 'asset', null, 'debit', false, 4),
      ('1125', 'Dams', 'سدود', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1126', 'Floating Facilities', 'منشات عائمة', '112', 'asset', null, 'debit', false, 4),
      ('1127', 'Roads and Bridges', 'طرق وجسور', '112', 'asset', 'property_equipment', 'debit', true, 4),
      ('1128', 'Transport Facilities', 'منشات نقل', '112', 'asset', null, 'debit', false, 4),
      ('1129', 'Other Facilities', 'منشات اخرى', '112', 'asset', null, 'debit', false, 4),
      ('1141', 'Road Vehicles', 'وسائط نقل بالسیارات', '114', 'asset', null, 'debit', false, 4),
      ('1142', 'Rail Transport', 'وسائط نقل بالسكك الحدیدیة', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1143', 'River Transport', 'وسائط النقل النهری', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1144', 'Sea Transport', 'وسائط النقل البحری', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1145', 'Air Transport', 'وسائط النقل الجوی', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1146', 'Oil and Gas Pipelines', 'خطوط انابیب النفط والغاز', '114', 'asset', 'property_equipment', 'debit', true, 4),
      ('1151', 'Tools', 'عدد', '115', 'asset', 'property_equipment', 'debit', true, 4),
      ('1152', 'Moulds', 'قوالب', '115', 'asset', 'property_equipment', 'debit', true, 4),
      ('1153', 'Tents and Canopies', 'خیم وجوادر', '115', 'asset', 'property_equipment', 'debit', true, 4),
      ('1161', 'Furniture', 'اثاث', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1162', 'Air Conditioning and Cooling Units', 'اجهزة تكییف وتبرید', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1163', 'Computers', 'حاسبات الكترونیة', '116', 'asset', null, 'debit', false, 4),
      ('1164', 'Calculators, Typewriters and Copiers', 'الات حاسبة وكاتبة استنساخ', '116', 'asset', null, 'debit', false, 4),
      ('1165', 'Office Tools and Equipment', 'ادوات واجهزة مكاتب', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1166', 'Curtains and Furnishings', 'ستائر ومفروشات', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1167', 'Books and Scientific References', 'كتب ومراجع علمیة', '116', 'asset', 'property_equipment', 'debit', true, 4),
      ('1171', 'Plants for Display and Production', 'نباتات لاغراض العرض والانتاج', '117', 'asset', null, 'debit', false, 4),
      ('1172', 'Animals for Display and Production', 'حیوانات لاغراض العرض والانتاج', '117', 'asset', null, 'debit', false, 4),
      ('1181', 'Formation Expenses', 'نفقات التاسیس', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1182', 'Pre-operating Expenses', 'نفقات قبل التشغیل', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1183', 'Exploration and Research Expenses', 'نفقات استكشاف وبحث', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1184', 'Research and Experiment Expenses', 'نفقات ابحاث وتجارب', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1185', 'Intangible Fixed Assets', 'موجودات ثابتة معنویة', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1186', 'Decorations, Fittings and Partitions', 'دیكورات وتركیبات وقواطع', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1187', 'Miscellaneous Deferred Expenses', 'نفقات مؤجلة متنوعة', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1188', 'Miscellaneous Deferred Expenses', 'نفقات مؤجلة متنوعة', '118', 'asset', 'intangible_assets', 'debit', true, 4),
      ('1211', 'Agricultural Land', 'اراضی زراعیة', '121', 'asset', null, 'debit', false, 4),
      ('1212', 'Building Land', 'اراضی بناء', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1213', 'Commercial Land', 'اراضی التجاریة', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1214', 'Residential Land', 'اراضی السكنیة', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1216', 'Vacant Land', 'اراضی الفضاء', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1217', 'Other Land', 'اراضی اخرى', '121', 'asset', 'property_equipment', 'debit', true, 4),
      ('1221', 'Buildings', 'مبانی', '122', 'asset', null, 'debit', false, 4),
      ('1222', 'Warehouses, Tanks and Silos', 'مخازن وخزانات وسایلوات', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1223', 'Residential Facilities', 'منشات سكنیة', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1224', 'Wells, Mines and Quarries', 'ابار ومناجم ومقالع', '122', 'asset', null, 'debit', false, 4),
      ('1225', 'Dams', 'سدود', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1226', 'Floating Facilities', 'منشات عائمة', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1227', 'Roads and Bridges', 'طرق وجسور', '122', 'asset', 'property_equipment', 'debit', true, 4),
      ('1228', 'Transport Facilities', 'منشات نقل', '122', 'asset', null, 'debit', false, 4),
      ('1229', 'Other Facilities', 'منشات اخرى', '122', 'asset', null, 'debit', false, 4),
      ('1241', 'Road Vehicles', 'وسائط نقل بالسیارات', '124', 'asset', null, 'debit', false, 4),
      ('1242', 'Rail Transport', 'وسائط نقل بالسكك الحدیدیة', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1243', 'River Transport', 'وسائط النقل النهری', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1244', 'Sea Transport', 'وسائط النقل البحری', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1245', 'Air Transport', 'وسائط النقل الجوی', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1246', 'Oil and Gas Pipelines', 'خطوط انابیب النفط والغاز', '124', 'asset', 'property_equipment', 'debit', true, 4),
      ('1251', 'Tools', 'عدد', '125', 'asset', 'property_equipment', 'debit', true, 4),
      ('1252', 'Moulds', 'قوالب', '125', 'asset', 'property_equipment', 'debit', true, 4),
      ('1253', 'Tents and Canopies', 'خیم وجوادر', '125', 'asset', 'property_equipment', 'debit', true, 4),
      ('1261', 'Furniture', 'اثاث', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1262', 'Air Conditioning and Cooling Units', 'اجهزة تكییف وتبرید', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1263', 'Computers', 'حاسبات الكترونیة', '126', 'asset', null, 'debit', false, 4),
      ('1264', 'Calculators, Typewriters and Copiers', 'الات حاسبة وكاتبة استنساخ', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1265', 'Office Tools and Equipment', 'ادوات واجهزة مكاتب', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1266', 'Curtains and Furnishings', 'ستائر ومفروشات', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1267', 'Books and Scientific References', 'كتب ومراجع علمیة', '126', 'asset', 'property_equipment', 'debit', true, 4),
      ('1271', 'Plants for Display and Production', 'نباتات لاغراض العرض والانتاج', '127', 'asset', null, 'debit', false, 4),
      ('1272', 'Animals for Display and Production', 'حیوانات لاغراض العرض والانتاج', '127', 'asset', null, 'debit', false, 4),
      ('1281', 'Formation Expenses', 'نفقات التاسیس', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1282', 'Pre-operating Expenses', 'نفقات قبل التشغیل', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1283', 'Exploration and Research Expenses', 'نفقات استكشاف وبحث', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1284', 'Research and Experiment Expenses', 'نفقات ابحاث وتجارب', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1285', 'Intangible Fixed Assets', 'موجودات ثابتة معنویة', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1286', 'Decorations, Fittings and Partitions', 'دیكورات وتركیبات وقواطع', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1287', 'Miscellaneous Deferred Expenses', 'نفقات مؤجلة متنوعة', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1288', 'Miscellaneous Deferred Expenses', 'نفقات مؤجلة متنوعة', '128', 'asset', 'property_equipment', 'debit', true, 4),
      ('1291', 'Advance Payments', 'دفعات مقدمة', '129', 'asset', 'property_equipment', 'debit', true, 4),
      ('1292', 'Letters of Credit for Fixed Assets', 'اعتمادات مستندیة لموجودات ثابتة', '129', 'asset', 'property_equipment', 'debit', true, 4),
      ('1341', 'Consumable Packing Materials Store', 'مخزن مواد التعبئة والتغلیف المستهلكة', '134', 'asset', 'inventory', 'debit', true, 4),
      ('1342', 'Returnable Packing Materials Store', 'مخزن مواد التعبئة والتغلیف المتداولة', '134', 'asset', 'inventory', 'debit', true, 4),
      ('1351', 'Supplies and Stores', 'مخزن اللوازم والمهمات', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1352', 'Stationery Store', 'مخزن القرطاسیة', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1353', 'Scientific Books Store', 'مخزن الكتب العلمیة', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1354', 'Scrap and Consumables Store', 'مخزن المخلفات والمستهلكات', '135', 'asset', null, 'debit', false, 4),
      ('1355', 'Staff Equipment Store', 'مخزن تجهیزات العاملین', '135', 'asset', 'inventory', 'debit', true, 4),
      ('1361', 'Finished Goods Store', 'مخزن الانتاج التام', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1362', 'Unfinished Goods Store', 'مخزن الانتاج غیر التام', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1363', 'Work in Progress', 'اعمال تحت التنفیذ', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1364', 'Crop Inventory, Standing Crops', 'المخزون النباتی زراعة قائمة', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1365', 'Livestock Inventory in Development', 'المخزون الحیوانی تحت التكوین', '136', 'asset', 'inventory', 'debit', true, 4),
      ('1371', 'Goods Held for Sale Store', 'مخزن البضائع بغرض البیع', '137', 'asset', 'inventory', 'debit', true, 4),
      ('1372', 'Land Held for Sale', 'الاراضی یغرض البیع', '137', 'asset', null, 'debit', false, 4),
      ('1381', 'Letters of Credit for the Economic Unit', 'اعتمادات مستندیة لحساب الوحدة الاقتصادیة', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1382', 'Goods in Transit for the Economic Unit', 'بضائع بطریق الشحن لحساب الوحدة الاقتصادیة', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1383', 'Letters of Credit for Third Parties', 'اعتمادات مستندیة لحساب الغیر', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1384', 'Goods in Transit for Third Parties', 'بضائع بطریق الشحن لحساب الغیر', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1385', 'Documentary Remittances', 'حوالات مستندیة', '138', 'asset', 'inventory', 'debit', true, 4),
      ('1391', 'Goods Held by Third Parties', 'بضائع لدى الغیر', '139', 'asset', 'inventory', 'debit', true, 4),
      ('1411', 'Long-term Loans to the Public Sector', 'قروض طویلة للقطاع العام', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1412', 'Long-term Loans to the Cooperative Sector', 'قروض طویلة للقطاع التعاونیی', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1413', 'Long-term Loans to the Mixed Sector', 'قروض طویلة للقطاع المختلط', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1414', 'Long-term Loans to the Private Sector', 'قروض طویلة للقطاع الخاص', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1415', 'Long-term Loans to the Foreign Sector', 'قروض طویلة للعالم الخارجی', '141', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1421', 'Long-term Loans to the Public Sector', 'قروض طویلة للقطاع العام', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1422', 'Long-term Loans to the Cooperative Sector', 'قروض طویلة للقطاع التعاوني', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1423', 'Long-term Loans to the Mixed Sector', 'قروض طویلة للقطاع المختلط', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1424', 'Long-term Loans to the Private Sector', 'قروض طویلة للقطاع الخاص', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1425', 'Long-term Loans to the Foreign Sector', 'قروض طویلة للعالم الخارجی', '142', 'asset', 'receivables', 'debit', true, 4),
      ('1511', 'Long-term Investments in the Public Sector', 'استثمارات مالیة طویلة فی القطاع العام', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1512', 'Long-term Investments in the Cooperative Sector', 'استثمارات مالیة طویلة فی القطاع التعاونی', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1513', 'Long-term Investments in the Mixed Sector', 'استثمارات مالیة طویلة فی القطاع المختلط', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1514', 'Long-term Investments in the Private Sector', 'استثمارات مالیة طویلة فی القطاع الخاص', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1515', 'Long-term Investments Abroad', 'استثمارات مالیة طویلة فی ا لعالم الخارجی', '151', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1521', 'Short-term Investments in the Public Sector', 'استثمارات قصیرة فی القطاع العام', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1522', 'Short-term Investments in the Cooperative Sector', 'استثمارات قصیرة فی القطاع التعاونی', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1523', 'Short-term Investments in the Mixed Sector', 'استثمارات قصیرة فی القطاع المختلط', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1524', 'Short-term Investments in the Private Sector', 'استثمارات قصیرة فی القطاع الخاص', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1525', 'Short-term Investments Abroad', 'استثمارات قصیرة فی العالم الخارجی', '152', 'asset', 'prepayments', 'debit', true, 4),
      ('1611', 'Debtors, Socialist Sector', 'مدینون قطاع اشتراكی', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1612', 'Debtors, Cooperative Sector', 'مدینون قطاع تعاونی', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1613', 'Debtors, Mixed Sector', 'مدینون قطاع مختلط', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1614', 'Debtors, Private Sector', 'مدینون قطاع خاص', '161', 'asset', null, 'debit', false, 4),
      ('1615', 'Debtors, Foreign', 'مدینون عالم خارجی', '161', 'asset', 'receivables', 'debit', true, 4),
      ('1621', 'Notes Receivable, Public Sector', 'اوراق قبض قطاع عام', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1622', 'Notes Receivable, Cooperative Sector', 'اوراق قبض قطاع تعاونی', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1623', 'Notes Receivable, Mixed Sector', 'اوراق قبض قطاع مختلط', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1624', 'Notes Receivable, Private Sector', 'اوراق قبض قطاع خاص', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1625', 'Notes Receivable, Foreign', 'اوراق قبض عالم خارجی', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1626', 'Notes Receivable for Collection', 'اوراق قبض برسم التحصیل', '162', 'asset', 'receivables', 'debit', true, 4),
      ('1631', 'Debit Current Accounts within the Main Economic Unit', 'حسابات جاریة مدینة داخل الوحدة الاقتصادیة الرئیسیة', '163', 'asset', 'receivables', 'debit', true, 4),
      ('1632', 'Debit Current Accounts within the Subsidiary Economic Unit', 'حسابات جاریة مدینة داخل الوحدة الاقتصادیة الفرعیة', '163', 'asset', 'receivables', 'debit', true, 4),
      ('1633', 'Debit Current Accounts within the Economic Unit Projects', 'حسابات جاریة مدینة داخل الوحدة الاقتصادیة المشاریع', '163', 'asset', 'receivables', 'debit', true, 4),
      ('1661', 'Deposits with Third Parties', 'تامینات لدى الغیر', '166', 'asset', null, 'debit', false, 4),
      ('1662', 'Accrued Revenue', 'ایرادات مستحقة', '166', 'asset', null, 'debit', false, 4),
      ('1663', 'Prepaid Expenses', 'مصاریف مدفوعة مقدما', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1664', 'Compensation Claims', 'طلبات التعویض', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1665', 'Cash, Inventory and Fixed Asset Differences, Normal Conditions', 'فروقات موجودات نقدیة ومخزنیة وثابتة لظروف اعتیادیة', '166', 'asset', null, 'debit', false, 4),
      ('1666', 'Cash, Inventory and Fixed Asset Differences, Abnormal Conditions', 'فروقات موجودات نقدیة ومخزنیة وثابتة لظروف غیر اعتیادیة', '166', 'asset', null, 'debit', false, 4),
      ('1667', 'Ministry of Finance, Maternity Leave Salaries', 'وزارة المالیة -رواتب اجازات الامومة', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1668', 'Ministry of Finance, Military Service Salaries', 'وزارة المالیة-رواتب الملتحقین بالخدمة العسكریة', '166', 'asset', 'prepayments', 'debit', true, 4),
      ('1671', 'Advances for Operations', 'سلف لاغراض النشاط', '167', 'asset', 'prepayments', 'debit', true, 4),
      ('1672', 'Staff Advances', 'سلف المنتسبین', '167', 'asset', 'prepayments', 'debit', true, 4),
      ('1673', 'Marriage Advances', 'سلف الزواج', '167', 'asset', 'prepayments', 'debit', true, 4),
      ('1811', 'Head Office Cash Box', 'صندوق المركز', '181', 'asset', 'cash', 'debit', true, 4),
      ('1812', 'Branch Cash Box', 'صندوق الفرع', '181', 'asset', 'cash', 'debit', true, 4),
      ('1813', 'Showroom Cash Box', 'صندوق المعارض', '181', 'asset', 'cash', 'debit', true, 4),
      ('1831', 'Government Banks', 'مصارف حكومیة', '183', 'asset', 'bank', 'debit', true, 4),
      ('1832', 'Private Banks', 'مصارف اهلیة', '183', 'asset', 'bank', 'debit', true, 4),
      ('1833', 'Exchange Offices', 'الصیرفة', '183', 'asset', 'bank', 'debit', true, 4),
      ('1851', 'Cheques and Remittances for Collection', 'صكوك وحوالات قید النحصیل', '185', 'asset', 'bank', 'debit', true, 4),
      ('1852', 'Remittances in Transit', 'حوالات بالطریق', '185', 'asset', 'bank', 'debit', true, 4),
      ('1853', 'Rejected Cheques and Remittances', 'شیكات وحوالات مرفوضة', '185', 'asset', 'bank', 'debit', true, 4),
      ('1921', 'Letters of Credit Received', 'الاعتمادات المستندیة المستلمة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1922', 'Contra Letters of Credit Issued', 'مقابل الاعتمادات المستندیة الصادرة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1923', 'Letters of Guarantee Received', 'خطابات الضمن المستلمة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1924', 'Contra Letters of Guarantee Issued', 'مقابل الخطابات الضمان الصادرة', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1925', 'Contracts', 'العقود', '192', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1941', 'Imputed Rent Difference', 'فرق الایجار المحتسب', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1942', 'Imputed Interest Difference', 'فرق الفوائد المحتسبة', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1943', 'Finished Goods Inventory Change Valuation Difference', 'فرق تقویم تغیر مخزون الانتاج التام', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('1944', 'Goods and Land Held for Sale Valuation Difference', 'فرق تقویم مخزون بضائع واراضی بغرض البیع', '194', 'asset', 'other_non_current_assets', 'debit', true, 4),
      ('2211', 'Expansion Reserve', 'احتیاطی التوسعات', '221', 'equity', null, 'credit', false, 3),
      ('2212', 'Fixed Asset Replacement Reserve', 'احتیاطی استبدال الموجودات الثابتة', '221', 'equity', 'reserves', 'credit', true, 3),
      ('2213', 'Capital Gains Reserve', 'احتیاطی مكاسب راسمالیة', '221', 'equity', 'reserves', 'credit', true, 3),
      ('2312', 'Depreciation Provision, Buildings, Structures and Roads', 'مخصص اندثار مبانی وانشاءات وطرق', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2313', 'Depreciation Provision, Machinery and Equipment', 'مخصص اندثار الات ومعدات', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2314', 'Depreciation Provision, Transport Vehicles', 'مخصص اندثار وسائط نقل وانتقال', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2315', 'Depreciation Provision, Tools and Moulds', 'مخصص اندثار عدد وقوالب', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2316', 'Depreciation Provision, Furniture and Office Equipment', 'مخصص اندثار اثاث واجهزة مكاتب', '231', 'asset', 'accumulated_depreciation', 'credit', true, 2),
      ('2411', 'Long-term Loans from the Public Sector', 'قروض مستلمة طویلة من القطاع العام', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2412', 'Long-term Loans from the Cooperative Sector', 'قروض مستلمة طویلة من القطاع التعاونی', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2413', 'Long-term Loans from the Mixed Sector', 'قروض مستلمة طویلة من القطاع المختلط', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2414', 'Long-term Loans from the Private Sector', 'قروض مستلمة طویلة من القطاع الخاص', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2415', 'Long-term Loans from Abroad', 'قروض مستلمة طویلة من العالم الخارجی', '241', 'liability', 'long_term_loans', 'credit', true, 4),
      ('2421', 'Short-term Loans from the Public Sector', 'قروض مستلمة قصیرة من القطاع العام', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2422', 'Short-term Loans from the Cooperative Sector', 'قروض مستلمة قصیرة من القطاع التعاونی', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2423', 'Short-term Loans from the Mixed Sector', 'قروض مستلمة قصیرة من القطاع المختلط', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2424', 'Short-term Loans from the Private Sector', 'قروض مستلمة قصیرة من القطاع الخاص', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2425', 'Short-term Loans from Abroad', 'قروض مستلمة قصیرة من العالم الخارجی', '242', 'liability', 'short_term_loans', 'credit', true, 4),
      ('2611', 'Suppliers, Public Sector', 'مجهزون قطاع عام', '261', 'liability', 'payables', 'credit', true, 4),
      ('2612', 'Suppliers, Cooperative Sector', 'مجهزون قطاع تعاونی', '261', 'liability', 'payables', 'credit', true, 4),
      ('2613', 'Suppliers, Mixed Sector', 'مجهزون قطاع مختلط', '261', 'liability', 'payables', 'credit', true, 4),
      ('2614', 'Suppliers, Private Sector', 'مجهزون قطاع خاص', '261', 'liability', 'payables', 'credit', true, 4),
      ('2615', 'Suppliers, Foreign', 'مجهزون عالم خارجی', '261', 'liability', 'payables', 'credit', true, 4),
      ('2616', 'Suppliers, Deferred Payment', 'مجهزون الدفع بالاجل', '261', 'liability', 'payables', 'credit', true, 4),
      ('2621', 'Notes Payable, Public Sector', 'اوراق دفع قطاع عام', '262', 'liability', 'payables', 'credit', true, 4),
      ('2622', 'Notes Payable, Cooperative Sector', 'اوراق دفع قطاع تعاونی', '262', 'liability', 'payables', 'credit', true, 4),
      ('2623', 'Notes Payable, Mixed Sector', 'اوراق دفع قطاع مختلط', '262', 'liability', 'payables', 'credit', true, 4),
      ('2624', 'Notes Payable, Private Sector', 'اوراق دفع قطاع خاص', '262', 'liability', 'payables', 'credit', true, 4),
      ('2625', 'Notes Payable, Foreign', 'اوراق دفع عالم خارجی', '262', 'liability', 'payables', 'credit', true, 4),
      ('2631', 'Credit Current Accounts within the Main Economic Unit', 'حسابات جاریة دائنة داخل الوحدة الاقتصادیة الرئیسیة', '263', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2632', 'Credit Current Accounts within the Subsidiary Economic Unit', 'حسابات جاریة دائنة داخل الوحدة الاقتصادیة الفرعیة', '263', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2641', 'Advances Received', 'سلف مستلمة مقدما', '264', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2642', 'Completed Work Certificates', 'الذرعات المنجزة', '264', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2651', 'Non-current Activity Creditors', 'دائنو نشاط غیر جاری', '265', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2652', 'Staff Deduction Reserves', 'احطیاطات اسطقطاعات من المنتسبین', '265', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2661', 'Deposits Received and Savings Accounts', 'تامینات مستلمة وحسابات التوفیر', '266', 'liability', null, 'credit', false, 4),
      ('2662', 'Revenue Received in Advance', 'ایرادات مستلمة مقدما', '266', 'liability', null, 'credit', false, 4),
      ('2663', 'Accrued Expenses', 'مصاریف مستحقة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2664', 'Accrued Salaries and Wages', 'رواتب واجور مستحقة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2665', 'Returned Salaries and Wages', 'رواتب واجور معادة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2666', 'National Pension Authority', 'هیئة التقاعد الوطنیة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2667', 'Pension and Social Security Department', 'دائرة التقاعد والضمان الاجتماعی', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2668', 'Cash and Inventory Credit Differences', 'فروقات نقدیة ومخزنیة دائنة', '266', 'liability', null, 'credit', false, 4),
      ('2669', 'Deferred Compensation and Fines', 'تعویضات وغرامات مؤجلة', '266', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2671', 'Staff Deductions for Third Parties', 'استقطاعات من المنتسبین لحساب الغیر', '267', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2672', 'Non-staff Deductions for Third Parties', 'استقطاعات من غیر المنتسبین لحساب الغیر', '267', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2681', 'Public Treasury Share', 'حصة الخزینة العامة', '268', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2682', 'Employees'' Share', 'حصة العاملین', '268', 'liability', 'accrued_liabilities', 'credit', true, 4),
      ('2921', 'Contra Letters of Credit Received', 'مقابل الاعتمادات المستندیة المستلمة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2922', 'Letters of Credit Issued', 'الاعتمادات المستندیة الصادرة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2923', 'Contra Letters of Guarantee Received', 'مقابل خطابات الضمان المستلمة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2924', 'Letters of Guarantee Issued', 'خطابات الضمان الصادرة', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2925', 'Contra Contracts', 'مقابل العقود', '292', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2941', 'Contra Imputed Rent Difference', 'مقابل فرق الایجار المحتسب', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2942', 'Contra Imputed Interest Difference', 'مقابل فرق الفوائد المحتسبة', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2943', 'Contra Finished Goods Inventory Change Valuation Difference', 'مقابل فرق تقویم تغیر مخزون الانتاج التام', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('2944', 'Contra Goods and Land Held for Sale Valuation Difference', 'مقابل فرق تقویم تغیر مخزون بضائع واراضی بغرض البیع', '294', 'liability', 'other_non_current_liabilities', 'credit', true, 4),
      ('3111', 'Salaries', 'رواتب', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3112', 'Qualification Allowances', 'مخصصات الشهادة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3113', 'Position Allowances', 'مخصصات المنصب', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3114', 'Family Allowances', 'مخصصات عائلیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3115', 'Professional and Technical Allowances', 'مخصصات مهنیة وفنیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3116', 'Overtime Pay', 'اجور اعمال اضافیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3117', 'Compensatory Allowances', 'مخصصات تعویضیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3118', 'Incentive Bonuses', 'مكافئات تشجیعیة', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3119', 'Other Allowances', 'مخصصات اخرى', '311', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3121', 'Wages', 'اجور', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3122', 'Qualification Allowances', 'مخصصات الشهادة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3123', 'Position Allowances', 'مخصصات المنصب', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3124', 'Family Allowances', 'مخصصات عائلیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3125', 'Professional and Technical Allowances', 'مخصصات مهنیة وفنیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3126', 'Overtime Pay', 'اجور اعمال اضافیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3127', 'Compensatory Allowances', 'مخصصات تعویضیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3128', 'Incentive Bonuses', 'مكافئات تشجیعیة', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3129', 'Other Allowances', 'مخصصات اخرى', '312', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3141', 'Employer''s Social Security Share', 'حصة المنشاة فی الضمان', '314', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3142', 'Employee Insurance', 'التامین على الموظفین', '314', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3143', 'Employee Health Insurance', 'الضمان الصحی للموظفین', '314', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3151', 'Employer''s Social Security Share', 'حصة المنشاة فی الضمان', '315', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3152', 'Worker Insurance', 'التامین على العمال', '315', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3153', 'Worker Health Insurance', 'الضمان الصحی للعمال', '315', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3221', 'Petroleum Products', 'مواد نفطیة', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3222', 'Gas', 'غاز', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3223', 'Oils and Greases', 'زیوت وشحوم', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3224', 'Coal', 'فحم', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3225', 'Gasoline', 'بنزین', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3226', 'Kerosene', 'كاز', '322', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3241', 'Consumable Packing Materials', 'مواد تعبئة وتغلیف مستهلكة', '324', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3242', 'Returnable Packing Materials', 'مواد تعبئة وتغلیف متداولة', '324', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3251', 'Supplies and Stores', 'اللوازم والمهمات', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3252', 'Stationery', 'القرطاسیة', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3253', 'Scientific Books', 'الكتب العلمیة', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3254', 'Scrap and Consumables', 'المخلفات والمستهلكات', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3255', 'Discount Allowed', 'خصم مسموح به', '325', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3261', 'Uniforms', 'كساوی', '326', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3262', 'Food Supplies', 'مواد غذائیة', '326', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3263', 'Medical Supplies', 'مواد طبیة', '326', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3271', 'Water', 'المیاه', '327', 'expense', null, 'debit', false, 4),
      ('3272', 'Electricity', 'الكهرباء', '327', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3291', 'Hotel Fragrance Supplies', 'مستلزمات تعطیر الفندق', '329', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3292', 'Hotel Sanitising Supplies', 'مستلزمات تعقیم الفندق', '329', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3311', 'Maintenance of Nurseries, Parks and Gardens', 'صیانة مشاتل ومنتزهات وحدائق', '331', 'expense', null, 'debit', false, 4),
      ('3312', 'Maintenance of Buildings, Structures and Roads', 'صیانة مبانی وانشاءات وطرق', '331', 'expense', null, 'debit', false, 4),
      ('3313', 'Machinery and Equipment Maintenance', 'صیانة الات ومعدات', '331', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3314', 'Transport Vehicle Maintenance', 'صیانة وسائط نقل وانتقال', '331', 'expense', null, 'debit', false, 4),
      ('3315', 'Tools and Moulds Maintenance', 'صیانة عدد وقوالب', '331', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3316', 'Furniture and Office Equipment Maintenance', 'صیانة اثاث واجهزة مكاتب', '331', 'expense', null, 'debit', false, 4),
      ('3331', 'Advertising and Publicity', 'دعایة واعلان', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3332', 'Publishing and Printing', 'نشر وطبع', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3333', 'Hospitality', 'ضیافة', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3334', 'Exhibition Expenses', 'مصاریف المعارض', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3335', 'Celebrations', 'احتفالات', '333', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3341', 'Staff Transport', 'نقل العاملین', '334', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3342', 'Goods Transport', 'نقل السلع والبضائع', '334', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3343', 'Travel and Official Trips', 'السفر والایفاد', '334', 'expense', null, 'debit', false, 4),
      ('3344', 'General Communications', 'اتصالات عامة', '334', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3352', 'Rent of Buildings and Structures', 'استئجار مبانی وانشاءات', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3353', 'Rent of Machinery and Equipment', 'استئجار الات ومعدات', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3354', 'Rent of Transport Vehicles', 'استئجار وسائط نقل ولنتقال', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3355', 'Rent of Tools and Moulds', 'استئجار عدد وقوالب', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3356', 'Rent of Furniture and Office Equipment', 'استئجار اثاث واجهزة مكاتب', '335', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3361', 'Subscriptions and Memberships', 'اشتراكات وانتماءات', '336', 'expense', null, 'debit', false, 4),
      ('3362', 'Insurance Premiums', 'اقساط التامین', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3363', 'Fees to Non-employees for Services', 'مكافئات لغیر العاملین عن خدمات مؤداة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3364', 'Taxes and Fees Paid to Foreign Parties', 'ضرائب ورسوم مدفوعة لجهات اجنبیة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3365', 'Legal Services', 'خدمات قانونیة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3366', 'Bank Services', 'خدمات مصرفیة', '336', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3367', 'Training and Development', 'تدریب وتاهیل', '336', 'expense', null, 'debit', false, 4),
      ('3368', 'Organisation and Audit Fees', 'اجور تنظیم وتدقیق', '336', 'expense', null, 'debit', false, 4),
      ('3369', 'Other Service Expenses', 'مصروفات خدمیة اخرى', '336', 'expense', null, 'debit', false, 4),
      ('3411', 'Amounts Paid to Iraqi Contractors', 'مبالغ مدفوعة لمقاولین عراقیین', '341', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3412', 'Amounts Paid to Non-Iraqi Contractors', 'مبالغ مدفوعة لمقاولین غیر عراقیین', '341', 'expense', 'operating_expenses', 'debit', true, 4),
      ('3511', 'Local Purchases of Goods for Sale', 'مشتریات بضائع بغرض البیع محلیة', '351', 'expense', 'cost_of_sales', 'debit', true, 4),
      ('3512', 'Imported Purchases of Goods for Sale', 'مشتریات بضائع بغرض البیع مستوردة', '351', 'expense', null, 'debit', false, 4),
      ('3521', 'Land at Commercial Prices', 'الاراضی بالاسعار التجاریة', '352', 'expense', 'cost_of_sales', 'debit', true, 4),
      ('3522', 'Land at Reduced Prices', 'الاراضی بالاسعار المنخفضة', '352', 'expense', 'cost_of_sales', 'debit', true, 4),
      ('3611', 'Local Interest Expense', 'فوائد مدینة محلیة', '361', 'expense', 'other_expenses', 'debit', true, 4),
      ('3612', 'Foreign Interest Expense', 'فوائد مدینة خارجیة', '361', 'expense', 'other_expenses', 'debit', true, 4),
      ('3811', 'Pension Salaries', 'رواتب تقاعدیة', '381', 'expense', 'other_expenses', 'debit', true, 4),
      ('3812', 'Social Grants', 'مكافئات اجتماعیة', '381', 'expense', 'other_expenses', 'debit', true, 4),
      ('3831', 'Donations to Others', 'تبرعات للغیر', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3832', 'Compensation and Fines', 'تعویضات وغرامات', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3833', 'Bad Debts Written Off', 'دیون مشطوبة', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3834', 'Special Service Expenses', 'نفقات خدمات خاصة', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3835', 'Marriage Advance Write-off', 'اطفاء سلف زواج', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3836', 'Economic Unit Share in Funding Public Benefit Bodies', 'حصة الوحدة الاقتصادیةفی تمویل الجهات ذات النفع العام', '383', 'expense', 'other_expenses', 'debit', true, 4),
      ('3837', 'Free Goods and Services', 'سلع وخدمات مجانیة', '383', 'expense', null, 'debit', false, 4),
      ('3838', 'Cashier Expense Settlement', 'تسویة مصروفات الکاشیر', '383', 'expense', null, 'debit', false, 4),
      ('3841', 'Production Fees', 'رسوم انتاج', '384', 'expense', 'other_expenses', 'debit', true, 4),
      ('3842', 'Other Taxes and Fees', 'ضرائب ورسوم اخرى', '384', 'expense', null, 'debit', false, 4),
      ('3851', 'Domestic Subsidies', 'اعانات داخلیة', '385', 'expense', 'other_expenses', 'debit', true, 4),
      ('3852', 'Foreign Subsidies', 'اعانات خارجیة', '385', 'expense', 'other_expenses', 'debit', true, 4),
      ('4111', 'Net Sales (Extractive Industries)', 'صافی المبیعات ( نشاط الصناعات الاستخراجیة )', '411', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4112', 'Change in Finished Goods Inventory', 'تغیر مخزون انتاج تام', '411', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4113', 'Change in Unfinished Goods Inventory', 'تغیر مخزون انتاج غیر تام', '411', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4121', 'Net Sales (Manufacturing Industries)', 'صافی المبیعات (نشاط الصناعات التحویلیة )', '412', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4122', 'Change in Finished Goods Inventory', 'تغیر مخزون انتاج تام', '412', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4123', 'Change in Unfinished Goods Inventory', 'تغیر مخزون انتاج غیر تام', '412', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4131', 'Completed Work Certificates Revenue', 'ایراد ذرعات منجزة', '413', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4132', 'Change in Work in Progress', 'تغیر اعمال تحت التنفیذ', '413', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4141', 'Net Sales (Food Production)', 'صافی المبیعات (انتاج الماکولات)', '414', 'revenue', null, 'credit', false, 4),
      ('4142', 'Change in Finished Goods Inventory', 'تغیر مخزون انتاج تام', '414', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4143', 'Change in Crop Inventory, Standing Crops', 'تغیر مخزون الانتاج النباتی زراعة قائمة', '414', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4151', 'Net Sales (Livestock Production)', 'صافی المبیعات (انتاج حیواني)', '415', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4152', 'Change in Finished Goods Inventory', 'تغیر مخزون انتاج تام', '415', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4153', 'Change in Livestock Inventory in Development', 'تغیر مخزون الانتاج الحیوانی تحت التكوین', '415', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4161', 'Water Revenue', 'ایراد ماء', '416', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4162', 'Electricity Revenue', 'ایراد كهرباء', '416', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4211', 'Net Sales of Goods for Sale', 'صافی مبیعات بضائع بغرض البیع', '421', 'revenue', null, 'credit', false, 4),
      ('4212', 'Net Sales of Land for Sale', 'صافی مبیعات اراضی بغرض البیع', '421', 'revenue', null, 'credit', false, 4),
      ('4213', 'Net Sales of Apartments for Sale', 'صافی مبیعات شقق بغرض البیع', '421', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4221', 'Change in Goods Held for Sale', 'تغیر مخزون بضائع بغرض البیع', '422', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4222', 'Change in Land Held for Sale', 'تغیر اراضی بغرض البیع', '422', 'revenue', null, 'credit', false, 4),
      ('4241', 'Hotel and Tourism Revenue, Credit', 'ایراد الفندقة والسیاحة قرض', '424', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4251', 'Discount Earned', 'خصم مكتسب', '425', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4371', 'Cleaning Services Revenue', 'ایراد خدمات التنظیف', '437', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4372', 'Tiling Services Revenue', 'ایراد خدمات التبلیط', '437', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4382', 'Building Rental', 'ایجار مبانی', '438', 'revenue', null, 'credit', false, 4),
      ('4383', 'Machinery and Equipment Rental', 'ایجار الات ومعدات', '438', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4384', 'Transport Vehicle Rental', 'ایجار وسائط نقل', '438', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4391', 'Business and Profession Fees', 'رسوم الاعمال والمهن', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4392', 'Advertising Fees', 'رسوم الاعلان', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4393', 'Licence Issue and Renewal Fees', 'رسوم منح وتجدید الاجازات', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4394', 'Other Fees', 'رسوم اخرى', '439', 'revenue', 'operating_revenue', 'credit', true, 4),
      ('4811', 'Pension and Social Security Contribution', 'مساهمة التقاعد والضمان الاجتماعی', '481', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4812', 'Security Share of Economic Unit Profits', 'حصة الضمان من ارباح الوحدات الاقتصادیة', '481', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4821', 'Public Treasury Grant', 'منحة الخزینة العامة', '482', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4822', 'Grants from Central or Affiliated Units', 'منح الوحدات المركزیة او التابعة', '482', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4831', 'Donations Received', 'تبرعات مستلمة', '483', 'revenue', 'other_revenue', 'credit', true, 4),
      ('4832', 'Compensation and Fines', 'تعویضات وغرامات', '483', 'revenue', null, 'credit', false, 4),
      ('4833', 'Recovered Bad Debts', 'دیون سبق شطبها', '483', 'revenue', 'other_revenue', 'credit', true, 4),
      ('11111', 'Purchase Cost', 'كلفة شراء', '1111', 'asset', 'property_equipment', 'debit', true, 5),
      ('11112', 'Reclamation Cost', 'كلفة الاستصلاح', '1111', 'asset', null, 'debit', false, 5),
      ('11211', 'Industrial Buildings', 'مبانی صناعیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11212', 'Commercial Buildings', 'مبانی تجاریة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11213', 'Service Buildings', 'مبانی خدمیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11214', 'Recreational Buildings', 'مبانی ترفیهیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11215', 'Health Buildings', 'مبانی صحیة', '1121', 'asset', 'property_equipment', 'debit', true, 5),
      ('11241', 'Wells', 'ابار', '1124', 'asset', 'property_equipment', 'debit', true, 5),
      ('11242', 'Mines', 'مناجم', '1124', 'asset', 'property_equipment', 'debit', true, 5),
      ('11243', 'Quarries', 'مقالع', '1124', 'asset', 'property_equipment', 'debit', true, 5),
      ('11281', 'Railway Lines', 'خطوط السكك الحدیدیة', '1128', 'asset', 'property_equipment', 'debit', true, 5),
      ('11282', 'Port Quays and Moorings', 'ارصفة الموانیء والمراسی', '1128', 'asset', null, 'debit', false, 5),
      ('11283', 'Aircraft Runways', 'مدارج طائرات', '1128', 'asset', 'property_equipment', 'debit', true, 5),
      ('11291', 'Sewers', 'مجاری المیاه الثقیلة', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11292', 'Water Basins', 'احواض مائیة', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11293', 'Greenhouses', 'بیوت زجاجیة', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11294', 'Water Pipelines', 'خطوط انابیب ماء', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11295', 'Electricity and Water Lines', 'خطوط الكهرباء والماء', '1129', 'asset', 'property_equipment', 'debit', true, 5),
      ('11301', 'Sports Devices and Equipment', 'الأجهزة والمعدات الریاضیة', '113', 'asset', 'property_equipment', 'debit', true, 4),
      ('11411', 'Passenger Vehicles', 'وسائط نقل الركاب', '1141', 'asset', 'property_equipment', 'debit', true, 5),
      ('11412', 'Goods Vehicles', 'وسائط نقل البضائع', '1141', 'asset', 'property_equipment', 'debit', true, 5),
      ('11413', 'Other Vehicles', 'عربات اخرى', '1141', 'asset', 'property_equipment', 'debit', true, 5),
      ('11631', 'Large Computers (Servers)', 'كومبیوترات كبیرة -سیرفر', '1163', 'asset', 'property_equipment', 'debit', true, 5),
      ('11632', 'Small Computers (Clients)', 'كومبیوترات صغیرة -كلاینت', '1163', 'asset', 'property_equipment', 'debit', true, 5),
      ('11633', 'Computer Software', 'برامج حاسبات', '1163', 'asset', 'property_equipment', 'debit', true, 5),
      ('11641', 'Large Printers (Server)', 'برنتر حجم كبیر -سیرفر', '1164', 'asset', 'property_equipment', 'debit', true, 5),
      ('11642', 'Small Printers', 'برنتر حجم صغیر', '1164', 'asset', 'property_equipment', 'debit', true, 5),
      ('11711', 'Plants for Display', 'نباتات لاغراض العرض', '1171', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('11712', 'Plants for Production', 'نباتات لاغراض الانتاج', '1171', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('11721', 'Animals for Display', 'حیوانات لاغراض العرض', '1172', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('11722', 'Animals for Production', 'حیوانات لاغراض الانتاج', '1172', 'asset', 'other_non_current_assets', 'debit', true, 5),
      ('12111', 'Purchase Cost', 'كلفة شراء', '1211', 'asset', 'property_equipment', 'debit', true, 5),
      ('12112', 'Reclamation Cost', 'كلفة الاستصلاح', '1211', 'asset', null, 'debit', false, 5),
      ('12211', 'Industrial Buildings', 'مبانی صناعیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12212', 'Commercial Buildings', 'مبانی تجاریة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12213', 'Service Buildings', 'مبانی خدمیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12214', 'Recreational Buildings', 'مبانی ترفیهیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12215', 'Health Buildings', 'مبانی صحیة', '1221', 'asset', 'property_equipment', 'debit', true, 5),
      ('12241', 'Wells', 'ابار', '1224', 'asset', 'property_equipment', 'debit', true, 5),
      ('12242', 'Mines', 'مناجم', '1224', 'asset', 'property_equipment', 'debit', true, 5),
      ('12243', 'Quarries', 'مقالع', '1224', 'asset', 'property_equipment', 'debit', true, 5),
      ('12281', 'Railway Lines', 'خطوط السكك الحدیدیة', '1228', 'asset', 'property_equipment', 'debit', true, 5),
      ('12282', 'Port Quays and Moorings', 'ارصفة الموانیء والمراسی', '1228', 'asset', null, 'debit', false, 5),
      ('12283', 'Aircraft Runways', 'مدارج طائرات', '1228', 'asset', 'property_equipment', 'debit', true, 5),
      ('12291', 'Sewers', 'مجاری المیاه الثقیلة', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12292', 'Water Basins', 'احواض مائیة', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12293', 'Greenhouses', 'بیوت زجاجیة', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12294', 'Water Pipelines', 'خطوط انابیب ماء', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12295', 'Electricity and Water Lines', 'خطوط الكهرباء والماء', '1229', 'asset', 'property_equipment', 'debit', true, 5),
      ('12411', 'Passenger Vehicles', 'وسائط نقل الركاب', '1241', 'asset', 'property_equipment', 'debit', true, 5),
      ('12412', 'Goods Vehicles', 'وسائط نقل البضائع', '1241', 'asset', 'property_equipment', 'debit', true, 5),
      ('12413', 'Other Vehicles', 'عربات اخرى', '1241', 'asset', 'property_equipment', 'debit', true, 5),
      ('12633', 'Computer Software', 'برنامج حاسبات', '1263', 'asset', 'property_equipment', 'debit', true, 5),
      ('12711', 'Plants for Display', 'نباتات لاغراض العرض', '1271', 'asset', 'property_equipment', 'debit', true, 5),
      ('12712', 'Plants for Production', 'نباتات لاغراض الانتاج', '1271', 'asset', 'property_equipment', 'debit', true, 5),
      ('12721', 'Animals for Display', 'حیوانات لاغراض العرض', '1272', 'asset', 'property_equipment', 'debit', true, 5),
      ('12722', 'Animals for Production', 'حیوانات لاغراض الانتاج', '1272', 'asset', 'property_equipment', 'debit', true, 5),
      ('13541', 'Scrap and Consumables Store, Normal Conditions', 'مخزن المخلفات والمستهلكات لظروف اعتیادیة', '1354', 'asset', 'inventory', 'debit', true, 5),
      ('13542', 'Scrap and Consumables Store, Abnormal Conditions', 'مخزن المخلفات والمستهلكات لظروف غیراعتیادیة', '1354', 'asset', 'inventory', 'debit', true, 5),
      ('13721', 'Land at Commercial Prices', 'الاراضی بالاسعار التجاریة', '1372', 'asset', 'inventory', 'debit', true, 5),
      ('13722', 'Land at Discounted Prices', 'الاراضی یالاسعار المخفضة', '1372', 'asset', 'inventory', 'debit', true, 5),
      ('16141', 'Debtors, Private Sector, Cash', 'مدینون قطاع خاص کاش', '1614', 'asset', 'receivables', 'debit', true, 5),
      ('16611', 'Short-term Deposits with Third Parties', 'تامینات لدى الغیر قصیرة الاجل', '1661', 'asset', 'prepayments', 'debit', true, 5),
      ('16612', 'Long-term Deposits with Third Parties', 'تامینات لدى الغیر طویلة الاجل', '1661', 'asset', 'prepayments', 'debit', true, 5),
      ('16621', 'Accrued Revenue, Apartments', 'ایرادات مستحقة -شقق', '1662', 'asset', 'prepayments', 'debit', true, 5),
      ('16651', 'Cash Differences', 'فروقات نقدیة', '1665', 'asset', 'prepayments', 'debit', true, 5),
      ('16652', 'Inventory Differences', 'فروقات ومخزنیة', '1665', 'asset', 'prepayments', 'debit', true, 5),
      ('16653', 'Fixed Asset Differences', 'فروقات موجودات ثابتة', '1665', 'asset', 'prepayments', 'debit', true, 5),
      ('16661', 'Cash Differences', 'فروقات نقدیة', '1666', 'asset', 'prepayments', 'debit', true, 5),
      ('16662', 'Inventory Differences', 'فروقات ومخزنیة', '1666', 'asset', 'prepayments', 'debit', true, 5),
      ('16663', 'Fixed Asset Differences', 'فروقات موجودات ثابتة', '1666', 'asset', 'prepayments', 'debit', true, 5),
      ('22111', 'Used Expansion Reserve', 'احتیاطی توسعات مستخدم', '2211', 'equity', 'reserves', 'credit', true, 4),
      ('22112', 'Unused Expansion Reserve', 'احتیاطی توسعات غیر مستخدم', '2211', 'equity', 'reserves', 'credit', true, 4),
      ('26611', 'Short-term Deposits Received', 'تامینات مستلمة قصیرة الاجل', '2661', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26612', 'Long-term Deposits Received', 'تامینات مستلمة طویلة الاجل', '2661', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26613', 'Savings Accounts', 'حسابات التوفیر', '2661', 'liability', null, 'credit', false, 5),
      ('26621', 'Revenue Received in Advance, Apartments', 'ایرادات مستلمة مقدما -شقق', '2662', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26681', 'Cash Credit Differences', 'فروقات نقدیة دائنة', '2668', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('26682', 'Inventory Credit Differences', 'فروقات مخزنیة دائنة', '2668', 'liability', 'accrued_liabilities', 'credit', true, 5),
      ('32711', 'Drinking Water', 'میاه شرب', '3271', 'expense', 'operating_expenses', 'debit', true, 5),
      ('32712', 'Irrigation Water', 'میاه سقی', '3271', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33111', 'Nursery Maintenance', 'صیانة مشاتل', '3311', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33112', 'Park Maintenance', 'صیانة منتزهات', '3311', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33113', 'Garden Maintenance', 'صیانة حدائق', '3311', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33121', 'Building Maintenance', 'صیانة مبانی', '3312', 'expense', null, 'debit', false, 5),
      ('33122', 'Maintenance of Warehouses, Tanks and Silos', 'صیانة مخازن وخزانات وسایلوات', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33123', 'Residential Facilities Maintenance', 'صیانة منشات سكنیة', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33124', 'Maintenance of Wells, Mines and Quarries', 'صیانة ابار ومناجم ومقالع', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33125', 'Maintenance of Dams and Canals', 'صیانة سدود وقنوات', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33126', 'Existing Facilities Maintenance', 'صیانة منشات قائمة', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33127', 'Road and Bridge Maintenance', 'صیانة طرق وجسور', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33128', 'Transport Facilities Maintenance', 'صیانة منشات نقل', '3312', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33129', 'Other Facilities Maintenance', 'صیانة منشات اخرى', '3312', 'expense', null, 'debit', false, 5),
      ('33141', 'Road Vehicle Maintenance', 'صیانة وسائط نقل بالسیارات', '3314', 'expense', null, 'debit', false, 5),
      ('33142', 'Rail Transport Maintenance', 'صیانة نقل بالسكك الحدیدیة', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33143', 'Land Transport Maintenance', 'صیانة وسائط النقل البری', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33144', 'Sea Transport Maintenance', 'صیانة وسائط النقل البحری', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33145', 'Air Transport Maintenance', 'صیانة وسائط النقل الجوی', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33146', 'Oil and Gas Pipeline Maintenance', 'صیانة خطوط انابیب النفط والغاز', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33147', 'Sports Equipment Maintenance', 'صیانة لأجهزة والمعدات الریاضیة', '3314', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33161', 'Furniture Maintenance', 'صیانة اثاث', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33162', 'Air Conditioning and Cooling Maintenance', 'صیانة اجهزة تكییف وتبرید', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33163', 'Computer Maintenance', 'صیانة حاسبات الكترونیة', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33164', 'Calculator, Typewriter and Copier Maintenance', 'صیانة الات حاسبة وكاتبة استنساخ', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33165', 'Office Tools and Equipment Maintenance', 'صیانة ادوات واجهزة مكاتب', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33167', 'Books and Scientific References Maintenance', 'صیانة كتب ومراجع علمیة', '3316', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33431', 'Travel for Training and Study', 'السفر والایفاد لغرض التدریب والدراسة', '3343', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33432', 'Travel for Business Purposes', 'السفر والایفاد لاغراض النشاط', '3343', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33611', 'Domestic Subscriptions and Memberships', 'اشتراكات وانتماءات داخلیة', '3361', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33612', 'Foreign Subscriptions and Memberships', 'اشتراكات وانتماءات خارجیة', '3361', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33671', 'Student and Trainee Allowances', 'مخصصات الطلبة والمتدربین', '3367', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33672', 'Training and Study Fees', 'اجور تدریب ودراسة', '3367', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33681', 'Organisation Fees', 'اجور تنظیم', '3368', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33682', 'Audit Fees', 'اجور تدقیق', '3368', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33691', 'Tourism Commission', 'عموله سیاحیه', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33692', 'Booking Advisers', 'بوکین ئهدڤایسرس', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33693', 'Order Percentage Commission', 'عموله نسبة طلبات', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('33694', 'Ticket Sales Percentage', 'نسبة مبیعات تکت', '3369', 'expense', 'operating_expenses', 'debit', true, 5),
      ('35121', 'Purchases for the Economic Unit', 'مشتریات لحساب الوحدة الاقتصادیة', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('35122', 'Purchases for Third Parties', 'مشتریات لحساب الغیر', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('35123', 'Purchases of Trade Samples', 'مشتریات نماذج تجاریة', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('35124', 'Purchases of Damaged Goods for Sale', 'مشتریات بغرض البیع متضررة', '3512', 'expense', 'cost_of_sales', 'debit', true, 5),
      ('38371', 'Free Goods and Services under Legislation', 'سلع وخدمات مجانیة مقدمة بموجب التشریعات', '3837', 'expense', 'other_expenses', 'debit', true, 5),
      ('38372', 'Free Goods and Services under Administrative Decisions', 'سلع وخدمات مجانیة مقدمة بموجب قرارات اداریة', '3837', 'expense', 'other_expenses', 'debit', true, 5),
      ('38381', 'Discounted Goods and Services under Legislation', 'سلع وخدمات مخفضة مقدمة بموجب التشریعات', '3838', 'expense', 'other_expenses', 'debit', true, 5),
      ('38382', 'Discounted Goods and Services under Administrative Decisions', 'سلع وخدمات مخفضة مقدمة بموجب قرارات اداریة', '3838', 'expense', 'other_expenses', 'debit', true, 5),
      ('38421', 'Property Tax', 'ضریبه عقار', '3842', 'expense', 'other_expenses', 'debit', true, 5),
      ('38422', 'Other Taxes', 'ضرائب اخری', '3842', 'expense', 'other_expenses', 'debit', true, 5),
      ('38423', 'Residency Fees', 'رسوم اقامه', '3842', 'expense', 'other_expenses', 'debit', true, 5),
      ('41411', 'Net Sales (Food Production), Credit', 'صافی المبیعات (انتاج الماکولات) قرض', '4141', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42111', 'Sales', 'المبیعات', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42112', 'Sales Discount', 'خصم المبیعات', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42113', 'Discount Earned', 'خصم مكتسب', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42114', 'Cost of Sales', 'كلفة المبیعات', '4211', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42121', 'Land at Commercial Prices', 'الاراضی بالاسعار التجاریة', '4212', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42122', 'Land at Commercial Prices', 'الاراضی بالاسعار التجاریة', '4212', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42221', 'Land at Commercial Prices', 'الاراضی بالاسعار التجاریة', '4222', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('42222', 'Land at Commercial Prices', 'الاراضی بالاسعار التجاریة', '4222', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('43821', 'Residential Building Rental', 'ایجار مبانی سكنیة', '4382', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('43822', 'Commercial Building Rental', 'ایجار مبانی تجاریة', '4382', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('43823', 'Service Building Rental', 'ایجار مبانی خدمیة', '4382', 'revenue', 'operating_revenue', 'credit', true, 5),
      ('48321', 'Compensation', 'تعویضات', '4832', 'revenue', 'other_revenue', 'credit', true, 5),
      ('48322', 'Fines', 'غرامات', '4832', 'revenue', null, 'credit', false, 5),
      ('111121', 'Gardens and Parks Land', 'اراضی الحدائق والمنتزهات', '11112', 'asset', 'property_equipment', 'debit', true, 6),
      ('111122', 'Nursery Land', 'اراضی المشاتل', '11112', 'asset', 'property_equipment', 'debit', true, 6),
      ('112621', 'Port Quays', 'ارصفة الموانیء', '1126', 'asset', 'property_equipment', 'debit', true, 5),
      ('112821', 'Moorings', 'المراسی', '11282', 'asset', 'property_equipment', 'debit', true, 6),
      ('112822', 'Moorings', 'المراسی', '11282', 'asset', 'property_equipment', 'debit', true, 6),
      ('121121', 'Gardens and Parks Land', 'اراضی الحدائق والمنتزهات', '12112', 'asset', 'property_equipment', 'debit', true, 6),
      ('121122', 'Nursery Land', 'اراضی المشاتل', '12112', 'asset', 'property_equipment', 'debit', true, 6),
      ('122821', 'Port Quays', 'ارصفة الموانیء', '12282', 'asset', 'property_equipment', 'debit', true, 6),
      ('122822', 'Moorings', 'المراسی', '12282', 'asset', 'property_equipment', 'debit', true, 6),
      ('122823', 'Airport Runways', 'مدارج المطارات', '12282', 'asset', 'property_equipment', 'debit', true, 6),
      ('266131', 'Regular Savings', 'توفیر عادی', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266132', 'School Savings', 'توفیر مدرسی', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266133', 'Domestic Remittances', 'حوالات داخلیة', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266134', 'Foreign Remittances', 'حوالات خارجیة', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('266135', 'Postal Transfers', 'تحاویل بریدیة', '26613', 'liability', 'accrued_liabilities', 'credit', true, 6),
      ('331211', 'Industrial Building Maintenance', 'صیانة مبانی صناعیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331212', 'Commercial Building Maintenance', 'صیانة مبانی تجاریة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331213', 'Service Building Maintenance', 'صیانة مبانی خدمیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331214', 'Recreational Building Maintenance', 'صیانة مبانی ترفیهیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331215', 'Health Building Maintenance', 'صیانة مبانی صحیة', '33121', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331292', 'Water Basin Maintenance', 'صیانة احواض مائیة', '33129', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331293', 'Greenhouse Maintenance', 'صیانة بیوت زجاجیة', '33129', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331295', 'Electricity and Telephone Lines', 'خطوط الكهرباء والهاتف', '33129', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331411', 'Passenger Vehicle Maintenance', 'صیانة وسائط نقل الركاب', '33141', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331412', 'Goods Vehicle Maintenance', 'صیانة وسائط نقل البضائع', '33141', 'expense', 'operating_expenses', 'debit', true, 6),
      ('331413', 'Other Vehicle Maintenance', 'صیانة وسائط نقل الاخرى', '33141', 'expense', 'operating_expenses', 'debit', true, 6),
      ('483222', 'Other Fines Revenue', 'ایراد غرامات اخرى', '48322', 'revenue', 'other_revenue', 'credit', true, 6)
  ),
  ids as (
    select c.*, gen_random_uuid() as id from chart c
  )
  insert into public.accounts
    (id, company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance, is_posting, level, created_by)
  select i.id, p_company_id, i.code, i.name_en, i.name_ar, p.id, i.account_type::public.account_type, i.category_code,
         i.normal_balance::public.balance_side, i.is_posting, i.level, auth.uid()
    from ids i
    left join ids p on p.code = i.parent_code;

  alter table public.accounts enable trigger user;

  update public.company_settings s
     set retained_earnings_account_id = (select a.id from public.accounts a where a.company_id = p_company_id and a.code = '224')
   where s.company_id = p_company_id;
end;
$$;

-- create_company calls this when asked for a chart.
create or replace function public._seed_default_chart(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._seed_dalil_chart(p_company_id);
end;
$$;

revoke execute on function public._seed_default_chart(uuid) from public, anon, authenticated;
revoke execute on function public._seed_dalil_chart(uuid) from public, anon, authenticated;

-- >>> 20261108000100_edit_posted_dollars_and_periods.sql
-- =============================================================================
-- Vio Accounting — edit and delete posted entries, dollars, earlier dates
--
-- 1. A posted journal entry can now be edited or deleted by a user who may both
--    edit drafts and reverse entries, while its period is open. The change hits
--    the ledger at once and the previous figures are kept in the audit log.
--    Entries owned by a voucher, a reversal or a year-end close stay locked.
-- 2. An entry can be typed in US dollars with the day's rate. The books stay in
--    the company's base currency: each line is converted when it is saved, and
--    the typed dollars and the rate are kept beside it. exchange_rate means
--    "base currency per 1 unit of foreign_currency".
-- 3. An entry dated outside every fiscal year no longer fails: the missing year
--    and its monthly periods are opened automatically when it is posted.
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
-- Stops a posted entry being changed unless this user may and the entry is free
-- to change. Rejects a closed period.
create or replace function public._assert_posted_changeable(p_entry public.journal_entries)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_permission(p_entry.company_id, 'entries.reverse');
  if p_entry.source not in ('manual', 'recurring') or p_entry.entry_type = 'closing'
     or p_entry.voucher_id is not null or p_entry.reversal_of_id is not null or p_entry.reversed_entry_id is not null then
    perform public._raise('ENTRY_NOT_EDITABLE', p_entry.entry_number);
  end if;
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
    if v_entry.status = 'posted' then
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

create or replace function public.delete_journal_entry(p_entry_id uuid)
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_paths text[];
  v_before jsonb;
begin
  v_entry := public._load_entry_for_action(p_entry_id, 'entries.edit_draft');
  if v_entry.status = 'posted' then
    perform public._assert_posted_changeable(v_entry);
    perform set_config('vio.posted_edit', v_entry.id::text, true);
  elsif v_entry.status <> 'draft' then
    perform public._raise('ENTRY_NOT_EDITABLE', v_entry.entry_number);
  end if;
  v_before := public._entry_snapshot(v_entry.id);
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = p_entry_id;
  delete from public.attachments a where a.entity_type = 'journal_entry' and a.entity_id = p_entry_id;
  delete from public.journal_entries e where e.id = p_entry_id;
  perform set_config('vio.posted_edit', '', true);
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
