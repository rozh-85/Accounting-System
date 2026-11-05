import { addSums, closingNet, openingNet, splitNet, ZERO_SUMS } from './balances';
import { buildAccountTree, type AccountNode } from './hierarchy';
import type { Units } from './money';
import type { Account, AccountSums } from './types';

export type TrialBalanceView = 'detailed' | 'summary';

export interface TrialBalanceRow {
  account: Account;
  depth: number;
  /** Group rows aggregate their descendants and are excluded from totals. */
  isGroup: boolean;
  /** Rows whose amounts are included in the grand totals. */
  countsInTotals: boolean;
  openingDebit: Units;
  openingCredit: Units;
  periodDebit: Units;
  periodCredit: Units;
  closingDebit: Units;
  closingCredit: Units;
}

export interface TrialBalanceTotals {
  openingDebit: Units;
  openingCredit: Units;
  periodDebit: Units;
  periodCredit: Units;
  closingDebit: Units;
  closingCredit: Units;
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totals: TrialBalanceTotals;
  /** Debit minus credit for each column pair; zero when balanced. */
  differences: { opening: Units; period: Units; closing: Units };
  isBalanced: boolean;
}

export interface TrialBalanceOptions {
  view: TrialBalanceView;
  /** Deepest account level shown in the summary view (1 = top-level groups). */
  summaryLevel?: number;
  includeZero: boolean;
}

function rowFromSums(account: Account, depth: number, sums: AccountSums, isGroup: boolean, countsInTotals: boolean): TrialBalanceRow {
  const opening = splitNet(openingNet(sums));
  const closing = splitNet(closingNet(sums));
  return {
    account,
    depth,
    isGroup,
    countsInTotals,
    openingDebit: opening.debit,
    openingCredit: opening.credit,
    periodDebit: sums.periodDebit,
    periodCredit: sums.periodCredit,
    closingDebit: closing.debit,
    closingCredit: closing.credit,
  };
}

function isZeroRow(row: TrialBalanceRow): boolean {
  return (
    row.openingDebit === 0n &&
    row.openingCredit === 0n &&
    row.periodDebit === 0n &&
    row.periodCredit === 0n &&
    row.closingDebit === 0n &&
    row.closingCredit === 0n
  );
}

/**
 * Builds a trial balance from posted ledger sums.
 *
 * Balances are always computed per posting account first; parent accounts are
 * roll-ups of their descendants (balances netted, movements summed). Grand
 * totals only count one level of rows (posting accounts in the detailed view,
 * the deepest visible rows in the summary view), so nothing is double counted.
 */
export function buildTrialBalance(
  accounts: readonly Account[],
  sumsByAccount: ReadonlyMap<string, AccountSums>,
  options: TrialBalanceOptions,
): TrialBalanceResult {
  const tree = buildAccountTree(accounts);
  const aggregate = new Map<string, AccountSums>();

  const computeAggregate = (node: AccountNode): AccountSums => {
    let sums = node.account.is_posting ? (sumsByAccount.get(node.account.id) ?? ZERO_SUMS) : ZERO_SUMS;
    for (const child of node.children) sums = addSums(sums, computeAggregate(child));
    aggregate.set(node.account.id, sums);
    return sums;
  };
  tree.forEach(computeAggregate);

  const rows: TrialBalanceRow[] = [];
  const summaryLevel = Math.max(1, options.summaryLevel ?? 2);

  const walk = (nodes: readonly AccountNode[]) => {
    for (const node of nodes) {
      const sums = aggregate.get(node.account.id) ?? ZERO_SUMS;
      if (options.view === 'detailed') {
        const isGroup = !node.account.is_posting;
        rows.push(rowFromSums(node.account, node.depth, sums, isGroup, !isGroup));
        walk(node.children);
      } else {
        const level = node.depth + 1;
        const isFrontier = level >= summaryLevel || node.children.length === 0;
        rows.push(rowFromSums(node.account, node.depth, sums, !isFrontier, isFrontier));
        if (!isFrontier) walk(node.children);
      }
    }
  };
  walk(tree);

  let visible = rows;
  if (!options.includeZero) {
    visible = rows.filter((row) => !isZeroRow(row));
  }
  // Group rows with no visible content are dropped as well.
  if (options.view === 'detailed') {
    visible = visible.filter((row) => !row.isGroup || !isZeroRow(row) || options.includeZero);
  }

  const totals: TrialBalanceTotals = {
    openingDebit: 0n,
    openingCredit: 0n,
    periodDebit: 0n,
    periodCredit: 0n,
    closingDebit: 0n,
    closingCredit: 0n,
  };
  for (const row of rows) {
    if (!row.countsInTotals) continue;
    totals.openingDebit += row.openingDebit;
    totals.openingCredit += row.openingCredit;
    totals.periodDebit += row.periodDebit;
    totals.periodCredit += row.periodCredit;
    totals.closingDebit += row.closingDebit;
    totals.closingCredit += row.closingCredit;
  }

  const differences = {
    opening: totals.openingDebit - totals.openingCredit,
    period: totals.periodDebit - totals.periodCredit,
    closing: totals.closingDebit - totals.closingCredit,
  };

  return {
    rows: visible,
    totals,
    differences,
    isBalanced: differences.opening === 0n && differences.period === 0n && differences.closing === 0n,
  };
}

/**
 * Sums for posting accounts that are not part of the chart passed in (should
 * never happen, but a trial balance must never silently drop ledger amounts).
 */
export function orphanBalances(accounts: readonly Account[], sumsByAccount: ReadonlyMap<string, AccountSums>): string[] {
  const posting = new Set(accounts.filter((a) => a.is_posting).map((a) => a.id));
  return [...sumsByAccount.keys()].filter((id) => !posting.has(id));
}
