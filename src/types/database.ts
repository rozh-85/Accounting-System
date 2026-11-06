import type {
  Account,
  AccountCategory,
  EntryStatus,
  EntryType,
  PaymentMethod,
  VoucherStatus,
  VoucherType,
} from '@/lib/accounting';

export type { Account, AccountCategory };

export type AppRole = 'admin' | 'accountant' | 'reviewer' | 'viewer';
export type Permission =
  | 'entries.create'
  | 'entries.edit_draft'
  | 'entries.submit'
  | 'entries.approve'
  | 'entries.post'
  | 'entries.reverse'
  | 'accounts.manage'
  | 'reports.export'
  | 'audit.view'
  | 'users.manage'
  | 'periods.manage'
  | 'settings.manage';

export type Numeric = number | string;

export interface Currency {
  code: string;
  name_en: string;
  name_ar: string;
  symbol: string | null;
  decimals: number;
}

export interface Company {
  id: string;
  /** Sandbox company of sample data; see the demo switch. */
  is_demo?: boolean;
  name_en: string;
  name_ar: string;
  legal_name: string | null;
  tax_number: string | null;
  registration_number: string | null;
  address_en: string | null;
  address_ar: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  base_currency: string;
  logo_path: string | null;
}

export interface CompanySettings {
  company_id: string;
  require_approval: boolean;
  fiscal_year_start_month: number;
  retained_earnings_account_id: string | null;
  default_language: 'en' | 'ar';
  report_show_signatures: boolean;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  preferred_language: 'en' | 'ar';
  default_company_id: string | null;
}

export interface Membership {
  company_id: string;
  role: AppRole;
  companies: Company;
}

export interface Member {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  joined_at: string;
}

export interface FiscalYear {
  id: string;
  company_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_at: string | null;
}

export interface AccountingPeriod {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  period_number: number;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_at: string | null;
  reopened_at: string | null;
}

export interface JournalListRow {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: EntryType;
  status: EntryStatus;
  voucher_id: string | null;
  voucher_type: VoucherType | null;
  voucher_number: string | null;
  description: string;
  reference_number: string | null;
  total_debit: Numeric;
  total_credit: Numeric;
  currency_code: string;
  source: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  posted_at: string | null;
  reversal_of_id: string | null;
  attachment_count: number;
  total_count: number;
}

export interface DocumentLine {
  id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name_en: string;
  account_name_ar: string;
  debit_amount: Numeric;
  credit_amount: Numeric;
  description: string | null;
}

export interface Attachment {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface HistoryItem {
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
  details: Record<string, unknown>;
}

export interface JournalEntryDetail {
  id: string;
  company_id: string;
  entry_number: string;
  entry_date: string;
  entry_type: EntryType;
  status: EntryStatus;
  voucher_id: string | null;
  voucher_type: VoucherType | null;
  voucher_number: string | null;
  description: string;
  notes: string | null;
  reference_number: string | null;
  currency_code: string;
  total_debit: Numeric;
  total_credit: Numeric;
  source: 'manual' | 'voucher' | 'reversal' | 'recurring' | 'closing';
  reversal_of_id: string | null;
  reversed_entry_id: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  posted_at: string | null;
  reversed_at: string | null;
  created_by_name: string | null;
  submitted_by_name: string | null;
  approved_by_name: string | null;
  posted_by_name: string | null;
  reversed_by_name: string | null;
  reversal_of_number: string | null;
  reversed_entry_number: string | null;
  period_name: string | null;
  lines: DocumentLine[];
  attachments: Attachment[];
  history: HistoryItem[];
}

export interface VoucherListRow {
  id: string;
  voucher_type: VoucherType;
  voucher_number: string;
  voucher_date: string;
  status: VoucherStatus;
  party_name: string | null;
  payment_method: PaymentMethod | null;
  amount: Numeric;
  currency_code: string;
  description: string;
  reference_number: string | null;
  journal_entry_id: string | null;
  journal_entry_number: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  total_count: number;
}

export interface VoucherDetail {
  id: string;
  company_id: string;
  voucher_type: VoucherType;
  voucher_number: string;
  voucher_date: string;
  status: VoucherStatus;
  party_name: string | null;
  payment_method: PaymentMethod | null;
  cheque_number: string | null;
  cash_account_id: string | null;
  counter_account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  amount: Numeric;
  currency_code: string;
  description: string;
  notes: string | null;
  reference_number: string | null;
  journal_entry_id: string | null;
  journal_entry_number: string | null;
  journal_entry_status: EntryStatus | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  posted_at: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  posted_by_name: string | null;
  reversed_by_name: string | null;
  lines: DocumentLine[];
  accounts: Record<string, { code: string; name_en: string; name_ar: string }>;
  attachments: Attachment[];
  history: HistoryItem[];
}

export interface RecurringTemplate {
  id: string;
  company_id: string;
  name: string;
  description: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  generated_count: number;
  is_active: boolean;
  last_generated_at: string | null;
  recurring_template_lines: Array<{
    id: string;
    line_number: number;
    account_id: string;
    debit_amount: Numeric;
    credit_amount: Numeric;
    description: string | null;
  }>;
}

export interface DashboardSummary {
  entries: Record<EntryStatus, number>;
  vouchers: Record<VoucherStatus, number>;
  current_period: {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    status: 'open' | 'closed';
    fiscal_year_id: string;
    fiscal_year_name: string;
    fiscal_year_start: string;
    fiscal_year_end: string;
    fiscal_year_status: 'open' | 'closed';
  } | null;
  last_posted_at: string | null;
  posting_accounts: number;
  open_periods: number;
}

export interface AuditLogRow {
  id: number;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
  total_count: number;
}
