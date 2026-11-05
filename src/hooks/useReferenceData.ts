import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { compareCodes, type Account, type AccountCategory } from '@/lib/accounting';
import { supabase } from '@/lib/supabase/client';
import { unwrap } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { AccountingPeriod, DashboardSummary, FiscalYear, Member } from '@/types/database';

export const queryKeys = {
  accounts: (companyId: string) => ['accounts', companyId] as const,
  categories: ['account-categories'] as const,
  fiscalYears: (companyId: string) => ['fiscal-years', companyId] as const,
  periods: (companyId: string) => ['periods', companyId] as const,
  members: (companyId: string) => ['members', companyId] as const,
  dashboard: (companyId: string) => ['dashboard', companyId] as const,
};

export function useAccounts() {
  const { companyId } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.accounts(companyId),
    queryFn: async () => {
      const rows = unwrap(await supabase.from('accounts').select('*').eq('company_id', companyId)) as Account[];
      return rows.sort((a, b) => compareCodes(a.code, b.code));
    },
  });
  const byId = useMemo(() => new Map((query.data ?? []).map((a) => [a.id, a])), [query.data]);
  return { ...query, accounts: query.data ?? [], byId };
}

export function useAccountCategories() {
  const query = useQuery({
    queryKey: queryKeys.categories,
    staleTime: Infinity,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('account_categories').select('*')) as AccountCategory[];
      return rows.sort((a, b) => a.sort_order - b.sort_order);
    },
  });
  return { ...query, categories: query.data ?? [] };
}

export function useFiscalYears() {
  const { companyId } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.fiscalYears(companyId),
    queryFn: async () =>
      unwrap(await supabase.from('fiscal_years').select('*').eq('company_id', companyId).order('start_date', { ascending: false })) as FiscalYear[],
  });
  return { ...query, fiscalYears: query.data ?? [] };
}

export function usePeriods() {
  const { companyId } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.periods(companyId),
    queryFn: async () =>
      unwrap(await supabase.from('accounting_periods').select('*').eq('company_id', companyId).order('start_date')) as AccountingPeriod[],
  });
  return { ...query, periods: query.data ?? [] };
}

export function useMembers() {
  const { companyId } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.members(companyId),
    queryFn: () => rpc<Member[]>('list_company_members', { p_company_id: companyId }),
  });
  return { ...query, members: query.data ?? [] };
}

export function useDashboardSummary() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: queryKeys.dashboard(companyId),
    queryFn: () => rpc<DashboardSummary>('dashboard_summary', { p_company_id: companyId, p_today: null }),
  });
}

/** Fiscal year containing a date, if any. */
export function fiscalYearFor(fiscalYears: readonly FiscalYear[], date: string): FiscalYear | undefined {
  return fiscalYears.find((fy) => fy.start_date <= date && date <= fy.end_date);
}

export function periodFor(periods: readonly AccountingPeriod[], date: string): AccountingPeriod | undefined {
  return periods.find((p) => p.start_date <= date && date <= p.end_date);
}
