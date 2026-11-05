import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { unwrap } from '@/lib/supabase/errors';
import type { AppRole, Company, CompanySettings, Currency, Permission, Profile } from '@/types/database';
import { useAuth } from './AuthProvider';

interface Workspace {
  profile: Profile | null;
  companies: Array<Company & { role: AppRole }>;
  company: Company | null;
  role: AppRole | null;
  settings: CompanySettings | null;
  currency: Currency;
  can: (permission: Permission) => boolean;
  switchCompany: (companyId: string) => Promise<void>;
  loading: boolean;
  error: unknown;
}

const WorkspaceContext = createContext<Workspace | null>(null);
const COMPANY_KEY = 'vio.company';

const FALLBACK_CURRENCY: Currency = { code: 'IQD', name_en: 'Iraqi Dinar', name_ar: 'دينار عراقي', symbol: 'IQD', decimals: 0 };

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(COMPANY_KEY);
    } catch {
      return null;
    }
  });

  const profileQuery = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: async () => unwrap(await supabase.from('profiles').select('*').eq('id', user!.id).maybeSingle()) as Profile | null,
  });

  const membershipsQuery = useQuery({
    queryKey: ['memberships', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const roles = unwrap(await supabase.from('user_roles').select('company_id, role').eq('user_id', user!.id)) as Array<{
        company_id: string;
        role: AppRole;
      }>;
      if (roles.length === 0) return [];
      const companies = unwrap(
        await supabase
          .from('companies')
          .select('*')
          .in('id', roles.map((r) => r.company_id)),
      ) as Company[];
      return companies
        .map((c) => ({ ...c, role: roles.find((r) => r.company_id === c.id)!.role }))
        .sort((a, b) => a.name_en.localeCompare(b.name_en));
    },
  });

  const referenceQuery = useQuery({
    queryKey: ['reference-data'],
    enabled: Boolean(user),
    staleTime: Infinity,
    queryFn: async () => {
      const [permissions, currencies] = await Promise.all([
        supabase.from('role_permissions').select('role, permission'),
        supabase.from('currencies').select('*'),
      ]);
      return {
        permissions: unwrap(permissions) as Array<{ role: AppRole; permission: Permission }>,
        currencies: unwrap(currencies) as Currency[],
      };
    },
  });

  const companies = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data]);
  const company = useMemo(() => {
    if (companies.length === 0) return null;
    return (
      companies.find((c) => c.id === selectedId) ??
      companies.find((c) => c.id === profileQuery.data?.default_company_id) ??
      companies[0]
    );
  }, [companies, selectedId, profileQuery.data?.default_company_id]);

  const settingsQuery = useQuery({
    queryKey: ['company-settings', company?.id],
    enabled: Boolean(company),
    queryFn: async () =>
      unwrap(await supabase.from('company_settings').select('*').eq('company_id', company!.id).single()) as CompanySettings,
  });

  useEffect(() => {
    if (!company) return;
    try {
      localStorage.setItem(COMPANY_KEY, company.id);
    } catch {
      /* storage unavailable */
    }
  }, [company]);

  const role = company ? (companies.find((c) => c.id === company.id)?.role ?? null) : null;
  const permissionSet = useMemo(() => {
    const set = new Set<Permission>();
    for (const p of referenceQuery.data?.permissions ?? []) if (p.role === role) set.add(p.permission);
    return set;
  }, [referenceQuery.data, role]);

  const currency =
    referenceQuery.data?.currencies.find((c) => c.code === company?.base_currency) ?? FALLBACK_CURRENCY;

  const switchCompany = useCallback(
    async (companyId: string) => {
      setSelectedId(companyId);
      if (user) await supabase.from('profiles').update({ default_company_id: companyId }).eq('id', user.id);
      await queryClient.invalidateQueries();
    },
    [user, queryClient],
  );

  const value: Workspace = {
    profile: profileQuery.data ?? null,
    companies,
    company,
    role,
    settings: settingsQuery.data ?? null,
    currency: { ...currency, decimals: Number(currency.decimals) },
    can: (permission) => permissionSet.has(permission),
    switchCompany,
    loading: profileQuery.isLoading || membershipsQuery.isLoading || referenceQuery.isLoading || (Boolean(company) && settingsQuery.isLoading),
    error: profileQuery.error ?? membershipsQuery.error ?? referenceQuery.error ?? settingsQuery.error,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}

/** Workspace with a guaranteed company (inside the authenticated app shell). */
export function useCompany() {
  const ws = useWorkspace();
  if (!ws.company) throw new Error('No active company');
  return { ...ws, company: ws.company, companyId: ws.company.id };
}
