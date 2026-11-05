import { useQuery } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import {
  buildLedgerStatement,
  postingAccountsInRange,
  postingAccountsUnder,
  toUnits,
  type Account,
  type AccountBalanceRow,
  type LedgerLineRow,
  type LedgerStatement,
} from '@/lib/accounting';
import { addDays } from '@/lib/formatting';
import { rpc } from '@/lib/supabase/rpc';

export interface LedgerSelection {
  mode: 'single' | 'range';
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  from: string;
  to: string;
}

export interface LedgerSection {
  key: string;
  account: Account;
  /** Posting accounts included (more than one when a parent account is selected). */
  postingIds: string[];
  aggregated: boolean;
  statement: LedgerStatement;
}

/** Resolves the selection into posting accounts, one statement per section. */
export function resolveSections(accounts: readonly Account[], selection: LedgerSelection): Array<{ account: Account; postingIds: string[]; aggregated: boolean }> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (selection.mode === 'single') {
    const account = selection.accountId ? byId.get(selection.accountId) : undefined;
    if (!account) return [];
    const posting = postingAccountsUnder(accounts, account.id).map((a) => a.id);
    return [{ account, postingIds: posting, aggregated: !account.is_posting }];
  }
  const from = selection.fromAccountId ? byId.get(selection.fromAccountId) : undefined;
  const to = selection.toAccountId ? byId.get(selection.toAccountId) : undefined;
  if (!from || !to) return [];
  return postingAccountsInRange(accounts, from.code, to.code).map((a) => ({ account: a, postingIds: [a.id], aggregated: false }));
}

/** Loads balances and movements for the selection from the posted ledger. */
export async function loadLedger(companyId: string, accounts: readonly Account[], selection: LedgerSelection): Promise<LedgerSection[]> {
  const sections = resolveSections(accounts, selection);
  const ids = [...new Set(sections.flatMap((s) => s.postingIds))];
  if (ids.length === 0) return sections.map((s) => ({ ...s, key: s.account.id, statement: buildLedgerStatement([], { debit: 0n, credit: 0n }, []) }));

  const [balances, lines] = await Promise.all([
    // Opening balance = all posted lines dated before the start date.
    selection.from
      ? rpc<AccountBalanceRow[]>('account_balances', { p_company_id: companyId, p_from: null, p_to: addDays(selection.from, -1), p_mode: 'all' })
      : Promise.resolve([] as AccountBalanceRow[]),
    rpc<LedgerLineRow[]>('ledger_lines', { p_company_id: companyId, p_account_ids: ids, p_from: selection.from || null, p_to: selection.to || null }),
  ]);
  const balanceById = new Map(balances.map((b) => [b.account_id, b]));

  return sections.map((section) => {
    let debit = 0n;
    let credit = 0n;
    for (const id of section.postingIds) {
      const b = balanceById.get(id);
      if (!b) continue;
      debit += toUnits(b.period_debit) + toUnits(b.opening_debit);
      credit += toUnits(b.period_credit) + toUnits(b.opening_credit);
    }
    return {
      ...section,
      key: section.account.id,
      statement: buildLedgerStatement(section.postingIds, { debit, credit }, lines),
    };
  });
}

export function useLedger(accounts: readonly Account[], selection: LedgerSelection, enabled: boolean) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ['ledger', companyId, selection, accounts.length],
    enabled: enabled && accounts.length > 0,
    queryFn: () => loadLedger(companyId, accounts, selection),
  });
}
