import type { Units } from './money';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type BalanceSide = 'debit' | 'credit';
export type StatementSection =
  | 'current_assets'
  | 'non_current_assets'
  | 'current_liabilities'
  | 'non_current_liabilities'
  | 'equity'
  | 'revenue'
  | 'expenses';

export type EntryType = 'standard' | 'opening' | 'adjusting' | 'closing' | 'reversing' | 'recurring';
export type EntryStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed';
export type VoucherType = 'receipt' | 'payment' | 'journal' | 'transfer';
export type VoucherStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'other';
export type TrialBalanceMode = 'unadjusted' | 'adjusted' | 'post_closing';

export interface Account {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  parent_id: string | null;
  account_type: AccountType;
  category_code: string | null;
  normal_balance: BalanceSide;
  is_posting: boolean;
  is_active: boolean;
  description: string | null;
  level: number;
}

export interface AccountCategory {
  code: string;
  account_type: AccountType;
  statement_section: StatementSection;
  name_en: string;
  name_ar: string;
  is_cash_equivalent: boolean;
  is_contra: boolean;
  sort_order: number;
}

/** Raw sums returned by the account_balances database function. */
export interface AccountBalanceRow {
  account_id: string;
  opening_debit: number | string;
  opening_credit: number | string;
  period_debit: number | string;
  period_credit: number | string;
}

/** Account balance sums converted to exact units. */
export interface AccountSums {
  openingDebit: Units;
  openingCredit: Units;
  periodDebit: Units;
  periodCredit: Units;
}

export interface Localised {
  name_en: string;
  name_ar: string;
}
