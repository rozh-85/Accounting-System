import { fitsCurrencyPrecision, sumUnits, unitsToDecimalString, type Units } from './money';
import type { Account, PaymentMethod, VoucherType } from './types';

export interface JournalLineDraft {
  accountId: string | null;
  debit: Units;
  credit: Units;
  description?: string | null;
}

/** Error codes shared with the database (see supabase/migrations). */
export type JournalIssue =
  | { code: 'ENTRY_MIN_LINES' }
  | { code: 'ENTRY_ZERO_TOTAL' }
  | { code: 'ENTRY_UNBALANCED'; difference: Units }
  | { code: 'LINE_ACCOUNT_REQUIRED'; line: number }
  | { code: 'LINE_INVALID_AMOUNT'; line: number }
  | { code: 'AMOUNT_PRECISION'; line: number }
  | { code: 'ACCOUNT_NOT_POSTABLE'; line: number }
  | { code: 'ACCOUNT_INACTIVE'; line: number };

export interface JournalSummary {
  totalDebit: Units;
  totalCredit: Units;
  /** totalDebit - totalCredit */
  difference: Units;
  isBalanced: boolean;
  debitLines: number;
  creditLines: number;
}

export function summarizeLines(lines: readonly JournalLineDraft[]): JournalSummary {
  const totalDebit = sumUnits(lines.map((l) => l.debit));
  const totalCredit = sumUnits(lines.map((l) => l.credit));
  return {
    totalDebit,
    totalCredit,
    difference: totalDebit - totalCredit,
    isBalanced: totalDebit === totalCredit && totalDebit > 0n,
    debitLines: lines.filter((l) => l.debit > 0n).length,
    creditLines: lines.filter((l) => l.credit > 0n).length,
  };
}

/** A line that the user has not started filling in is ignored. */
export function isBlankLine(line: JournalLineDraft): boolean {
  return !line.accountId && line.debit === 0n && line.credit === 0n && !line.description?.trim();
}

/**
 * Validates lines the way the database does before an entry may be saved.
 * Drafts may be unbalanced, so balance checks are only applied when
 * `forPosting` is true.
 */
export function validateLines(
  lines: readonly JournalLineDraft[],
  options: { forPosting: boolean; decimals: number; accounts?: ReadonlyMap<string, Account> },
): JournalIssue[] {
  const issues: JournalIssue[] = [];
  const meaningful = lines.filter((l) => !isBlankLine(l));

  meaningful.forEach((line, index) => {
    const lineNo = index + 1;
    if (!line.accountId) issues.push({ code: 'LINE_ACCOUNT_REQUIRED', line: lineNo });
    if (line.debit < 0n || line.credit < 0n || (line.debit > 0n) === (line.credit > 0n)) {
      issues.push({ code: 'LINE_INVALID_AMOUNT', line: lineNo });
    } else if (!fitsCurrencyPrecision(line.debit, options.decimals) || !fitsCurrencyPrecision(line.credit, options.decimals)) {
      issues.push({ code: 'AMOUNT_PRECISION', line: lineNo });
    }
    const account = line.accountId ? options.accounts?.get(line.accountId) : undefined;
    if (account && !account.is_posting) issues.push({ code: 'ACCOUNT_NOT_POSTABLE', line: lineNo });
    if (account && !account.is_active) issues.push({ code: 'ACCOUNT_INACTIVE', line: lineNo });
  });

  if (options.forPosting || meaningful.length < 2) {
    const summary = summarizeLines(meaningful);
    if (meaningful.length < 2 || summary.debitLines < 1 || summary.creditLines < 1) {
      issues.push({ code: 'ENTRY_MIN_LINES' });
    }
    if (options.forPosting) {
      if (summary.totalDebit <= 0n) issues.push({ code: 'ENTRY_ZERO_TOTAL' });
      else if (summary.difference !== 0n) issues.push({ code: 'ENTRY_UNBALANCED', difference: summary.difference });
    }
  }
  return issues;
}

/** Simple entry: من حـ (debit account) / إلى حـ (credit account). */
export function buildSimpleEntryLines(
  debitAccountId: string | null,
  creditAccountId: string | null,
  amount: Units,
  description?: string | null,
): JournalLineDraft[] {
  return [
    { accountId: debitAccountId, debit: amount, credit: 0n, description: description ?? null },
    { accountId: creditAccountId, debit: 0n, credit: amount, description: description ?? null },
  ];
}

/** An entry is "simple" when it has exactly one debit line and one credit line. */
export function isSimpleEntry(lines: readonly JournalLineDraft[]): boolean {
  const meaningful = lines.filter((l) => !isBlankLine(l));
  return (
    meaningful.length === 2 &&
    meaningful.filter((l) => l.debit > 0n).length === 1 &&
    meaningful.filter((l) => l.credit > 0n).length === 1
  );
}

/** Debit lines first, then credit lines — the order used in formal journal presentation. */
export function orderForPresentation<T extends { debit: Units; credit: Units }>(lines: readonly T[]): T[] {
  return [...lines.filter((l) => l.debit > 0n), ...lines.filter((l) => l.debit === 0n)];
}

export function linesToPayload(lines: readonly JournalLineDraft[]) {
  return lines
    .filter((l) => !isBlankLine(l))
    .map((l) => ({
      account_id: l.accountId,
      debit_amount: unitsToDecimalString(l.debit),
      credit_amount: unitsToDecimalString(l.credit),
      description: l.description?.trim() || null,
    }));
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------
export interface VoucherDraft {
  voucherType: VoucherType;
  amount: Units;
  cashAccountId?: string | null;
  counterAccountId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  partyName?: string | null;
  paymentMethod?: PaymentMethod;
  lines?: JournalLineDraft[];
}

/**
 * The journal lines a voucher produces when it is posted. Mirrors
 * public._voucher_journal_lines in the database:
 *   receipt  : Dr cash/bank        Cr counterparty
 *   payment  : Dr expense/debit    Cr cash/bank
 *   transfer : Dr destination      Cr source
 *   journal  : the voucher's own lines
 */
export function voucherJournalLines(voucher: VoucherDraft): JournalLineDraft[] {
  const party = voucher.partyName?.trim() || null;
  switch (voucher.voucherType) {
    case 'receipt':
      return [
        { accountId: voucher.cashAccountId ?? null, debit: voucher.amount, credit: 0n, description: party },
        { accountId: voucher.counterAccountId ?? null, debit: 0n, credit: voucher.amount, description: party },
      ];
    case 'payment':
      return [
        { accountId: voucher.counterAccountId ?? null, debit: voucher.amount, credit: 0n, description: party },
        { accountId: voucher.cashAccountId ?? null, debit: 0n, credit: voucher.amount, description: party },
      ];
    case 'transfer':
      return [
        { accountId: voucher.toAccountId ?? null, debit: voucher.amount, credit: 0n },
        { accountId: voucher.fromAccountId ?? null, debit: 0n, credit: voucher.amount },
      ];
    case 'journal':
      return [...(voucher.lines ?? [])];
  }
}

export type VoucherIssue =
  | JournalIssue
  | { code: 'VOUCHER_AMOUNT_REQUIRED' }
  | { code: 'VOUCHER_ACCOUNT_REQUIRED' }
  | { code: 'VOUCHER_SAME_ACCOUNTS' }
  | { code: 'VOUCHER_PARTY_REQUIRED' };

export function validateVoucher(voucher: VoucherDraft, decimals: number): VoucherIssue[] {
  const issues: VoucherIssue[] = [];
  if (voucher.voucherType === 'journal') {
    return validateLines(voucher.lines ?? [], { forPosting: true, decimals });
  }
  if (voucher.amount <= 0n) issues.push({ code: 'VOUCHER_AMOUNT_REQUIRED' });
  if (voucher.amount > 0n && !fitsCurrencyPrecision(voucher.amount, decimals)) {
    issues.push({ code: 'AMOUNT_PRECISION', line: 0 });
  }
  const [a, b] =
    voucher.voucherType === 'transfer'
      ? [voucher.fromAccountId, voucher.toAccountId]
      : [voucher.cashAccountId, voucher.counterAccountId];
  if (!a || !b) issues.push({ code: 'VOUCHER_ACCOUNT_REQUIRED' });
  else if (a === b) issues.push({ code: 'VOUCHER_SAME_ACCOUNTS' });
  if ((voucher.voucherType === 'receipt' || voucher.voucherType === 'payment') && !voucher.partyName?.trim()) {
    issues.push({ code: 'VOUCHER_PARTY_REQUIRED' });
  }
  return issues;
}
