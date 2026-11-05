import { toUnits, type Units } from './money';
import type { AccountBalanceRow, AccountSums, BalanceSide } from './types';

export const ZERO_SUMS: AccountSums = { openingDebit: 0n, openingCredit: 0n, periodDebit: 0n, periodCredit: 0n };

export function toAccountSums(row: AccountBalanceRow): AccountSums {
  return {
    openingDebit: toUnits(row.opening_debit),
    openingCredit: toUnits(row.opening_credit),
    periodDebit: toUnits(row.period_debit),
    periodCredit: toUnits(row.period_credit),
  };
}

export function sumsByAccount(rows: readonly AccountBalanceRow[]): Map<string, AccountSums> {
  const map = new Map<string, AccountSums>();
  for (const row of rows) map.set(row.account_id, toAccountSums(row));
  return map;
}

export function addSums(a: AccountSums, b: AccountSums): AccountSums {
  return {
    openingDebit: a.openingDebit + b.openingDebit,
    openingCredit: a.openingCredit + b.openingCredit,
    periodDebit: a.periodDebit + b.periodDebit,
    periodCredit: a.periodCredit + b.periodCredit,
  };
}

/** Net balance in debit terms: positive = debit balance, negative = credit balance. */
export function openingNet(s: AccountSums): Units {
  return s.openingDebit - s.openingCredit;
}

export function closingNet(s: AccountSums): Units {
  return s.openingDebit + s.periodDebit - s.openingCredit - s.periodCredit;
}

/** Splits a debit-positive net balance into the debit and credit columns. */
export function splitNet(net: Units): { debit: Units; credit: Units } {
  return net >= 0n ? { debit: net, credit: 0n } : { debit: 0n, credit: -net };
}

export function balanceSideOf(net: Units): BalanceSide | null {
  if (net > 0n) return 'debit';
  if (net < 0n) return 'credit';
  return null;
}

/**
 * Balance expressed in the account's normal direction: positive when the
 * balance is on the normal side (e.g. a debit balance on an asset), negative
 * when it is abnormal.
 */
export function normalisedBalance(net: Units, normal: BalanceSide): Units {
  return normal === 'debit' ? net : -net;
}
