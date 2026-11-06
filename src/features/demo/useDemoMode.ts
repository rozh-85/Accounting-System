import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';

/**
 * The demo switch. Sample data lives in its own company, never in a real one:
 * turning on creates that company and opens it, turning off opens the real
 * company again and deletes the demo company with everything in it.
 */
export function useDemoMode() {
  const { t } = useTranslation();
  const { companies, company, switchCompany } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const demo = companies.find((c) => c.is_demo);

  const report = (e: unknown) => {
    const missing = /could not find the function/i.test((e as Error)?.message ?? '');
    toast.error(missing ? t('demo.notInstalled') : errorMessage(e, t));
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const id = await rpc<string>('create_demo_company');
      await queryClient.invalidateQueries({ queryKey: ['memberships'] });
      await switchCompany(id);
      navigate('/');
      toast.success(t('demo.onToast'));
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!demo) return;
    setBusy(true);
    try {
      const real = companies.find((c) => !c.is_demo);
      if (real) await switchCompany(real.id);
      await rpc('delete_demo_company', { p_company_id: demo.id });
      await queryClient.invalidateQueries();
      navigate('/');
      toast.success(t('demo.offToast'));
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  return {
    enabled: Boolean(demo),
    viewing: Boolean(company?.is_demo),
    busy,
    toggle: () => void (demo ? turnOff() : turnOn()),
    turnOff: () => void turnOff(),
  };
}
