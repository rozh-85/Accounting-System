import { useQuery } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import {
  buildInventoryReport,
  INVENTORY_ROLES,
  reconcileInventory,
  type AccountBalanceRow,
  type InventoryChart,
  type LedgerLineRow,
} from '@/lib/accounting';
import { rpc, rpcAll } from '@/lib/supabase/rpc';
import type { JournalListRow } from '@/types/database';

/**
 * Loads every posted line of the three accounts up to the report date, and the
 * balances the database adds up itself to check them against.
 */
export function useInventory(chart: InventoryChart, from: string, to: string, enabled: boolean) {
  const { companyId } = useCompany();
  const ids = INVENTORY_ROLES.flatMap((role) => chart.postingIds[role]);
  return useQuery({
    queryKey: ['inventory', companyId, from, to, ids],
    enabled,
    queryFn: async () => {
      const [lines, balances] = await Promise.all([
        rpcAll<LedgerLineRow>(
          'ledger_lines',
          { p_company_id: companyId, p_account_ids: ids, p_from: null, p_to: to },
          ['entry_date', 'entry_number', 'line_number', 'line_id'],
        ),
        rpc<AccountBalanceRow[]>('account_balances', { p_company_id: companyId, p_from: null, p_to: to, p_mode: 'all' }),
      ]);
      const report = buildInventoryReport(lines, chart.postingIds, { from: from || null, to });
      return { report, differences: reconcileInventory(report, balances, chart.postingIds) };
    },
  });
}

/** Entries on the stock account still waiting to be posted: a second count would then be recorded twice. */
export function useUnpostedStockEntries(stockIds: string[], enabled: boolean) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ['inventory', companyId, 'unposted', stockIds],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const lists = await Promise.all(
        stockIds.map((id) =>
          rpc<JournalListRow[]>('search_journal_entries', { p_company_id: companyId, p_account_id: id, p_statuses: ['draft', 'pending_approval'], p_limit: 50, p_offset: 0 }),
        ),
      );
      return [...new Map(lists.flat().map((entry) => [entry.id, entry])).values()];
    },
  });
}
