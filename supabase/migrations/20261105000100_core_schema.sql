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
