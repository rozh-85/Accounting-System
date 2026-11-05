import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { AuthLayout } from '@/app/layouts/AuthLayout';
import { useAuth } from '@/app/providers/AuthProvider';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Card';
import { Checkbox, Field, Input, Select } from '@/components/ui/Field';
import { startOfYear, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';

const schema = z.object({
  nameEn: z.string().trim().min(2, 'validation.required'),
  nameAr: z.string().trim().min(2, 'validation.required'),
  currency: z.enum(['IQD', 'USD', 'EUR']),
  fiscalYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
  seedChart: z.boolean(),
});

export function CreateCompanyPage() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { companies } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { nameEn: 'Vio', nameAr: 'فيو', currency: 'IQD', fiscalYearStart: startOfYear(todayIso()), seedChart: true },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const companyId = await rpc<string>('create_company', {
        p_name_en: values.nameEn,
        p_name_ar: values.nameAr,
        p_base_currency: values.currency,
        p_fiscal_year_start: values.fiscalYearStart,
        p_seed_chart: values.seedChart,
      });
      try {
        localStorage.setItem('vio.company', companyId);
      } catch {
        /* ignore */
      }
      await queryClient.invalidateQueries();
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  });

  const err = (name: keyof z.infer<typeof schema>) => {
    const m = form.formState.errors[name]?.message;
    return m ? t(String(m)) : null;
  };

  return (
    <AuthLayout
      title={t('onboarding.title')}
      subtitle={t('onboarding.subtitle')}
      footer={
        <div className="flex flex-col gap-2">
          <p>{t('onboarding.invitedHint', { email: user?.email ?? '' })}</p>
          <div className="flex gap-4">
            {companies.length > 0 && (
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => navigate('/')}>
                {t('common.back')}
              </button>
            )}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => void signOut().then(() => navigate('/login'))}>
              {t('auth.signOut')}
            </button>
          </div>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('onboarding.nameEn')} error={err('nameEn')} required>
          {(p) => <Input {...p} dir="ltr" {...form.register('nameEn')} />}
        </Field>
        <Field label={t('onboarding.nameAr')} error={err('nameAr')} required>
          {(p) => <Input {...p} dir="rtl" className="font-ar" {...form.register('nameAr')} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('onboarding.baseCurrency')} hint={t('onboarding.baseCurrencyHint')}>
            {(p) => (
              <Select {...p} {...form.register('currency')}>
                <option value="IQD">IQD — {t('currencies.IQD')}</option>
                <option value="USD">USD — {t('currencies.USD')}</option>
                <option value="EUR">EUR — {t('currencies.EUR')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('onboarding.fiscalYearStart')} error={err('fiscalYearStart')}>
            {(p) => <Input {...p} type="date" className="num" {...form.register('fiscalYearStart')} />}
          </Field>
        </div>
        <Checkbox label={t('onboarding.seedChart')} {...form.register('seedChart')} />
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="mt-1 w-full">
          {t('onboarding.create')}
        </Button>
      </form>
    </AuthLayout>
  );
}
