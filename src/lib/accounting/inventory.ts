/**
 * Inventory report — تقرير المخزون.
 *
 * Periodic method, as in the Iraqi unified system the chart follows:
 *  - goods bought are debited to purchases (35121) and never to stock;
 *  - stock (1371) holds only the value of counted goods;
 *  - a stock count moves 1371 against the change-in-stock account (4221).
 *
 * The same goods are therefore never in purchases and in stock at once, and
 *
 *   cost of goods sold = opening stock + net purchases - closing stock
 *
 * equals what the income accounts show (35121 less 4221). Every figure here is
 * an account balance; entries that break the method are listed, not corrected.
 */
import { postingAccountsUnder } from './hierarchy';
import type { LedgerLineRow } from './ledger';
import { absUnits, toUnits, type Units } from './money';
import type { Account, AccountBalanceRow, EntryType } from './types';

export const INVENTORY_CODES = { stock: '1371', purchases: '35121', change: '4221' } as const;
export type InventoryRole = keyof typeof INVENTORY_CODES;
export const INVENTORY_ROLES = Object.keys(INVENTORY_CODES) as InventoryRole[];

type ByRole<T> = Record<InventoryRole, T>;

export interface InventoryChart {
  accounts: ByRole<Account | null>;
  /** Posting accounts of each role: the account itself, or its sub-accounts. */
  postingIds: ByRole<string[]>;
  /** Codes that are not in the company's chart. */
  missing: string[];
}

/** Finds the three accounts the report reads in a company's chart. */
export function resolveInventoryChart(accounts: readonly Account[]): InventoryChart {
  const chart: InventoryChart = {
    accounts: { stock: null, purchases: null, change: null },
    postingIds: { stock: [], purchases: [], change: [] },
    missing: [],
  };
  for (const role of INVENTORY_ROLES) {
    const account = accounts.find((a) => a.code === INVENTORY_CODES[role]) ?? null;
    chart.accounts[role] = account;
    if (account) chart.postingIds[role] = postingAccountsUnder(accounts, account.id).map((a) => a.id);
    else chart.missing.push(INVENTORY_CODES[role]);
  }
  return chart;
}

/** The account a prepared entry uses for a role: only when there is exactly one to choose. */
export function inventoryEntryAccount(chart: InventoryChart, accounts: readonly Account[], role: InventoryRole): Account | null {
  const usable = accounts.filter((a) => a.is_active && chart.postingIds[role].includes(a.id));
  return usable.length === 1 ? usable[0] : null;
}

export type InventoryMovementKind = 'purchase' | 'reduction' | 'reversal' | 'opening' | 'count' | 'direct';

export interface InventoryMovement {
  lineId: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  counterAccountId: string | null;
  counterLineCount: number;
  kind: InventoryMovementKind;
  debit: Units;
  credit: Units;
  /** Running balance after this line, debit-positive. */
  runningNet: Units;
}

/**
 * counted_twice: one entry debits both purchases and stock for the same goods.
 * direct_stock:  stock moved without the change-in-stock account.
 * change_only:   the change-in-stock account moved without stock.
 */
export type InventoryIssueKind = 'counted_twice' | 'direct_stock' | 'change_only';

export interface InventoryIssue {
  kind: InventoryIssueKind;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  amount: Units;
}

/** Purchases alike in date, amount and other account: perhaps one purchase typed twice. */
export interface InventoryDuplicate {
  entryDate: string;
  amount: Units;
  entries: Array<{ entryId: string; entryNumber: string }>;
}

export interface InventoryReport {
  /** Stock before the period. */
  broughtForward: Units;
  /** broughtForward plus opening entries dated inside the period. */
  openingStock: Units;
  purchases: Units;
  purchaseReductions: Units;
  netPurchases: Units;
  goodsAvailable: Units;
  /** Movement of stock through the change-in-stock account. */
  stockChange: Units;
  /** Movement of stock through any other account; zero when the method is followed. */
  otherStock: Units;
  closingStock: Units;
  costOfGoods: Units;
  purchaseMovements: InventoryMovement[];
  stockMovements: InventoryMovement[];
  issues: InventoryIssue[];
  duplicates: InventoryDuplicate[];
  lastCountDate: string | null;
  lastPurchaseDate: string | null;
  /** Goods were bought after the last count, so closing stock is behind. */
  countOutdated: boolean;
  /** Debit-positive balance of every line read, for checking against the ledger. */
  ledgerNet: ByRole<Units>;
}

interface EntrySums {
  id: string;
  number: string;
  date: string;
  type: EntryType;
  status: LedgerLineRow['entry_status'];
  reversalOfId: string | null;
  description: string;
  stock: Units;
  purchases: Units;
  /** Credit-positive. */
  change: Units;
  hasChangeLine: boolean;
  /** Stock moved outside the change-in-stock account. */
  direct: Units;
}

function inLedgerOrder(a: LedgerLineRow, b: LedgerLineRow): number {
  if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
  if (a.entry_number !== b.entry_number) return a.entry_number.localeCompare(b.entry_number, 'en', { numeric: true });
  return a.line_number - b.line_number;
}

/**
 * Builds the report from every posted line of the three accounts up to `to`.
 * Lines before `from` give the stock brought forward.
 */
export function buildInventoryReport(
  rows: readonly LedgerLineRow[],
  postingIds: ByRole<string[]>,
  period: { from: string | null; to: string },
): InventoryReport {
  const roleOf = new Map<string, InventoryRole>();
  for (const role of INVENTORY_ROLES) for (const id of postingIds[role]) roleOf.set(id, role);
  const ordered = rows.filter((r) => roleOf.has(r.account_id) && r.entry_date <= period.to).sort(inLedgerOrder);

  // A reversal counts like the entry it undoes: reversing a closing entry must not look like a new purchase.
  const typeById = new Map(ordered.map((r) => [r.entry_id, r.entry_type]));
  const effectiveType = (r: LedgerLineRow): EntryType => (r.reversal_of_id ? (typeById.get(r.reversal_of_id) ?? r.entry_type) : r.entry_type);

  const ledgerNet: ByRole<Units> = { stock: 0n, purchases: 0n, change: 0n };
  const inPeriod: LedgerLineRow[] = [];
  const entries = new Map<string, EntrySums>();
  let broughtForward = 0n;

  for (const row of ordered) {
    const role = roleOf.get(row.account_id)!;
    const net = toUnits(row.debit_amount) - toUnits(row.credit_amount);
    ledgerNet[role] += net;
    if (period.from && row.entry_date < period.from) {
      if (role === 'stock') broughtForward += net;
      continue;
    }
    inPeriod.push(row);
    const entry = entries.get(row.entry_id) ?? {
      id: row.entry_id,
      number: row.entry_number,
      date: row.entry_date,
      type: effectiveType(row),
      status: row.entry_status,
      reversalOfId: row.reversal_of_id,
      description: row.entry_description,
      stock: 0n,
      purchases: 0n,
      change: 0n,
      hasChangeLine: false,
      direct: 0n,
    };
    if (role === 'stock') entry.stock += net;
    else if (role === 'purchases') entry.purchases += net;
    else {
      entry.change -= net;
      entry.hasChangeLine = true;
    }
    entries.set(row.entry_id, entry);
  }

  let openingEntries = 0n;
  let netPurchases = 0n;
  let stockChange = 0n;
  let otherStock = 0n;
  for (const entry of entries.values()) {
    if (entry.type === 'closing') {
      // Year-end closing empties 35121 and 4221 into retained earnings: no purchase, and no change in stock
      // unless the entry moves stock as well.
      entry.purchases = 0n;
      entry.change = entry.hasChangeLine ? entry.stock : 0n;
    }
    entry.direct = entry.stock - entry.change;
    netPurchases += entry.purchases;
    stockChange += entry.change;
    if (entry.type === 'opening') openingEntries += entry.direct;
    else otherStock += entry.direct;
  }

  // An entry and its reversal in the same period cancel out, so neither needs review.
  const cancelled = new Set<string>();
  for (const entry of entries.values()) {
    if (entry.reversalOfId && entries.has(entry.reversalOfId)) {
      cancelled.add(entry.id);
      cancelled.add(entry.reversalOfId);
    }
  }

  const issues: InventoryIssue[] = [];
  let lastCountDate: string | null = null;
  let lastPurchaseDate: string | null = null;
  for (const entry of entries.values()) {
    if (cancelled.has(entry.id) || entry.type === 'opening') continue;
    if (entry.purchases > 0n) lastPurchaseDate = entry.date;
    if (entry.direct === 0n) {
      if (entry.stock !== 0n) lastCountDate = entry.date;
      continue;
    }
    const kind: InventoryIssueKind =
      entry.stock === 0n ? 'change_only' : entry.purchases > 0n && entry.direct > 0n ? 'counted_twice' : 'direct_stock';
    const amount = kind === 'counted_twice' && entry.purchases < entry.direct ? entry.purchases : absUnits(entry.direct);
    issues.push({ kind, entryId: entry.id, entryNumber: entry.number, entryDate: entry.date, description: entry.description, amount });
  }

  let purchases = 0n;
  let purchaseReductions = 0n;
  let runningPurchases = 0n;
  let runningStock = broughtForward;
  const purchaseMovements: InventoryMovement[] = [];
  const stockMovements: InventoryMovement[] = [];
  const alike = new Map<string, InventoryDuplicate>();

  for (const row of inPeriod) {
    const role = roleOf.get(row.account_id)!;
    const entry = entries.get(row.entry_id)!;
    if (role === 'change' || (role === 'purchases' && entry.type === 'closing')) continue;
    const debit = toUnits(row.debit_amount);
    const credit = toUnits(row.credit_amount);
    const movement: Omit<InventoryMovement, 'kind' | 'runningNet'> = {
      lineId: row.line_id,
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      entryDate: row.entry_date,
      description: row.line_description?.trim() || row.entry_description,
      counterAccountId: row.counter_account_id,
      counterLineCount: Number(row.counter_line_count ?? 0),
      debit,
      credit,
    };

    if (role === 'stock') {
      runningStock += debit - credit;
      const kind = row.reversal_of_id ? 'reversal' : entry.type === 'opening' ? 'opening' : entry.direct === 0n ? 'count' : 'direct';
      stockMovements.push({ ...movement, kind, runningNet: runningStock });
      continue;
    }

    // A reversal takes back the side it undoes instead of counting as the opposite.
    purchases += row.reversal_of_id ? -credit : debit;
    purchaseReductions += row.reversal_of_id ? -debit : credit;
    runningPurchases += debit - credit;
    const kind = row.reversal_of_id ? 'reversal' : entry.type === 'opening' ? 'opening' : debit > 0n ? 'purchase' : 'reduction';
    purchaseMovements.push({ ...movement, kind, runningNet: runningPurchases });

    if (kind === 'purchase' && !cancelled.has(entry.id) && entry.status !== 'reversed') {
      const key = [row.entry_date, debit, row.counter_account_id ?? ''].join('|');
      const group = alike.get(key) ?? { entryDate: row.entry_date, amount: debit, entries: [] };
      if (!group.entries.some((e) => e.entryId === entry.id)) group.entries.push({ entryId: entry.id, entryNumber: entry.number });
      alike.set(key, group);
    }
  }

  const openingStock = broughtForward + openingEntries;
  const closingStock = openingStock + stockChange + otherStock;
  return {
    broughtForward,
    openingStock,
    purchases,
    purchaseReductions,
    netPurchases,
    goodsAvailable: openingStock + netPurchases,
    stockChange,
    otherStock,
    closingStock,
    costOfGoods: openingStock + netPurchases + otherStock - closingStock,
    purchaseMovements,
    stockMovements,
    issues,
    duplicates: [...alike.values()].filter((group) => group.entries.length > 1),
    lastCountDate,
    lastPurchaseDate,
    countOutdated: lastPurchaseDate !== null && (lastCountDate === null || lastCountDate < lastPurchaseDate),
    ledgerNet,
  };
}

/**
 * Compares the lines read with the balances the database adds up itself, the
 * ones behind the trial balance. Any difference means a line is missing or
 * counted more than once. `balances` covers everything up to the report date.
 */
export function reconcileInventory(report: InventoryReport, balances: readonly AccountBalanceRow[], postingIds: ByRole<string[]>): ByRole<Units> {
  const byId = new Map(balances.map((b) => [b.account_id, b]));
  const result: ByRole<Units> = { stock: 0n, purchases: 0n, change: 0n };
  for (const role of INVENTORY_ROLES) {
    let net = 0n;
    for (const id of postingIds[role]) {
      const b = byId.get(id);
      if (b) net += toUnits(b.opening_debit) + toUnits(b.period_debit) - toUnits(b.opening_credit) - toUnits(b.period_credit);
    }
    result[role] = report.ledgerNet[role] - net;
  }
  return result;
}

/** Message of one check, looked up as inventory.check.<message>. */
export type InventoryCheckMessage =
  | 'ledger_ok'
  | 'ledger_differs'
  | 'once_ok'
  | 'once_twice'
  | 'method_ok'
  | 'method_direct'
  | 'duplicates_ok'
  | 'duplicates_found'
  | 'count_ok'
  | 'count_none'
  | 'count_outdated'
  | 'negative';

export interface InventoryCheck {
  message: InventoryCheckMessage;
  status: 'ok' | 'warning' | 'danger';
  /** Number of entries, or groups of entries, the message is about. */
  n: number;
}

/** What the screen and the PDF both say about how far the report can be relied on. */
export function inventoryChecks(report: InventoryReport, differences: ByRole<Units>): InventoryCheck[] {
  const agrees = INVENTORY_ROLES.every((role) => differences[role] === 0n);
  const twice = report.issues.filter((i) => i.kind === 'counted_twice').length;
  const outside = report.issues.length - twice;
  const alike = report.duplicates.length;
  const checks: InventoryCheck[] = [
    { message: agrees ? 'ledger_ok' : 'ledger_differs', status: agrees ? 'ok' : 'danger', n: 0 },
    { message: twice ? 'once_twice' : 'once_ok', status: twice ? 'danger' : 'ok', n: twice },
    { message: outside ? 'method_direct' : 'method_ok', status: outside ? 'danger' : 'ok', n: outside },
    { message: alike ? 'duplicates_found' : 'duplicates_ok', status: alike ? 'warning' : 'ok', n: alike },
  ];
  if (report.closingStock < 0n) checks.push({ message: 'negative', status: 'danger', n: 0 });
  if (report.countOutdated) checks.push({ message: report.lastCountDate ? 'count_outdated' : 'count_none', status: 'warning', n: 0 });
  else if (report.lastCountDate) checks.push({ message: 'count_ok', status: 'ok', n: 0 });
  return checks;
}

/** The single entry that brings stock in the books to the counted value; null when they already agree. */
export function stockCountAdjustment(bookStock: Units, countedStock: Units): { debit: InventoryRole; credit: InventoryRole; amount: Units } | null {
  const difference = countedStock - bookStock;
  if (difference === 0n) return null;
  return difference > 0n
    ? { debit: 'stock', credit: 'change', amount: difference }
    : { debit: 'change', credit: 'stock', amount: -difference };
}
