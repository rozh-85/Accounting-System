import { balanceSideOf } from './balances';
import { absUnits, maxUnits, sumUnits, toUnits, type Units } from './money';
import type { BalanceSide, EntryStatus, EntryType, VoucherType } from './types';

/** Row shape returned by the ledger_lines database function. */
export interface LedgerLineRow {
  line_id: string;
  account_id: string;
  entry_id: string;
  entry_number: string;
  entry_date: string;
  entry_type: EntryType;
  entry_status: EntryStatus;
  voucher_id: string | null;
  voucher_type: VoucherType | null;
  voucher_number: string | null;
  entry_description: string;
  line_description: string | null;
  debit_amount: number | string;
  credit_amount: number | string;
  line_number: number;
  counter_account_id: string | null;
  counter_line_count: number | null;
  reversal_of_id: string | null;
}

export interface LedgerMovement {
  lineId: string;
  accountId: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  entryType: EntryType;
  entryStatus: EntryStatus;
  voucherNumber: string | null;
  voucherType: VoucherType | null;
  description: string;
  counterAccountId: string | null;
  counterLineCount: number;
  debit: Units;
  credit: Units;
  /** Running balance after this movement, debit-positive. */
  runningNet: Units;
}

export interface LedgerStatement {
  accountIds: string[];
  openingNet: Units;
  movements: LedgerMovement[];
  periodDebit: Units;
  periodCredit: Units;
  closingNet: Units;
}

export function buildLedgerStatement(
  accountIds: readonly string[],
  opening: { debit: Units; credit: Units },
  rows: readonly LedgerLineRow[],
): LedgerStatement {
  const idSet = new Set(accountIds);
  const openingNet = opening.debit - opening.credit;
  let running = openingNet;
  const movements: LedgerMovement[] = [];

  const ordered = rows
    .filter((r) => idSet.has(r.account_id))
    .sort((a, b) =>
      a.entry_date === b.entry_date
        ? a.entry_number === b.entry_number
          ? a.line_number - b.line_number
          : a.entry_number.localeCompare(b.entry_number, 'en', { numeric: true })
        : a.entry_date.localeCompare(b.entry_date),
    );

  for (const row of ordered) {
    const debit = toUnits(row.debit_amount);
    const credit = toUnits(row.credit_amount);
    running += debit - credit;
    movements.push({
      lineId: row.line_id,
      accountId: row.account_id,
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      entryDate: row.entry_date,
      entryType: row.entry_type,
      entryStatus: row.entry_status,
      voucherNumber: row.voucher_number,
      voucherType: row.voucher_type,
      description: row.line_description?.trim() || row.entry_description,
      counterAccountId: row.counter_account_id,
      counterLineCount: Number(row.counter_line_count ?? 0),
      debit,
      credit,
      runningNet: running,
    });
  }

  const periodDebit = sumUnits(movements.map((m) => m.debit));
  const periodCredit = sumUnits(movements.map((m) => m.credit));
  return {
    accountIds: [...accountIds],
    openingNet,
    movements,
    periodDebit,
    periodCredit,
    closingNet: openingNet + periodDebit - periodCredit,
  };
}

export interface TAccountItem {
  key: string;
  kind: 'opening' | 'movement' | 'balance_cd';
  date: string | null;
  entryId: string | null;
  entryNumber: string | null;
  description: string;
  counterAccountId: string | null;
  counterLineCount: number;
  amount: Units;
}

export interface TAccount {
  debitItems: TAccountItem[];
  creditItems: TAccountItem[];
  /** Totals of each side before balancing. */
  debitTotal: Units;
  creditTotal: Units;
  /** Absolute closing balance and the side it falls on. */
  balance: Units;
  balanceSide: BalanceSide | null;
  /** Equal footing of both sides after the balance c/d is placed on the lighter side. */
  footing: Units;
  /** The lighter side's balancing item ("balance c/d"), if any. */
  balanceCarriedDown: TAccountItem | null;
}

/**
 * Lays a ledger statement out as a traditional T-account:
 * Debit (مدين) on the left, Credit (دائن) on the right.
 */
export function buildTAccount(statement: LedgerStatement, labels: { opening: string; balanceCd: string }): TAccount {
  const debitItems: TAccountItem[] = [];
  const creditItems: TAccountItem[] = [];

  if (statement.openingNet !== 0n) {
    const item: TAccountItem = {
      key: 'opening',
      kind: 'opening',
      date: null,
      entryId: null,
      entryNumber: null,
      description: labels.opening,
      counterAccountId: null,
      counterLineCount: 0,
      amount: absUnits(statement.openingNet),
    };
    (statement.openingNet > 0n ? debitItems : creditItems).push(item);
  }

  for (const m of statement.movements) {
    const item: TAccountItem = {
      key: m.lineId,
      kind: 'movement',
      date: m.entryDate,
      entryId: m.entryId,
      entryNumber: m.entryNumber,
      description: m.description,
      counterAccountId: m.counterAccountId,
      counterLineCount: m.counterLineCount,
      amount: m.debit > 0n ? m.debit : m.credit,
    };
    (m.debit > 0n ? debitItems : creditItems).push(item);
  }

  const debitTotal = sumUnits(debitItems.map((i) => i.amount));
  const creditTotal = sumUnits(creditItems.map((i) => i.amount));
  const net = debitTotal - creditTotal;
  const balanceSide = balanceSideOf(net);
  const balance = absUnits(net);

  let balanceCarriedDown: TAccountItem | null = null;
  if (balance !== 0n) {
    balanceCarriedDown = {
      key: 'balance_cd',
      kind: 'balance_cd',
      date: null,
      entryId: null,
      entryNumber: null,
      description: labels.balanceCd,
      counterAccountId: null,
      counterLineCount: 0,
      amount: balance,
    };
  }

  return {
    debitItems,
    creditItems,
    debitTotal,
    creditTotal,
    balance,
    balanceSide,
    footing: maxUnits(debitTotal, creditTotal),
    balanceCarriedDown,
  };
}
