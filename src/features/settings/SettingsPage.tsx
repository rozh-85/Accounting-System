import { useQueryClient } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Checkbox, Field, Input, Select, StaticField } from '@/components/ui/Field';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useAccounts, useMembers } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { supabase } from '@/lib/supabase/client';
import { errorMessage, toAppError } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { AppRole, Company } from '@/types/database';
import { LayoutTab } from './LayoutTab';

const ROLES: AppRole[] = ['admin', 'accountant', 'reviewer', 'viewer'];
const TABS = ['company', 'accounting', 'users', 'layout', 'profile'] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);

function Section({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="p-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line bg-subtle px-5 py-3">{footer}</div>}
    </Card>
  );
}

function CompanyTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { company, can, currency } = useCompany();
  const { name } = useLanguage();
  const editable = can('settings.manage');
  const form = useForm<Company>({ defaultValues: company });
  useEffect(() => form.reset(company), [company, form]);

  const fields: Array<{ key: keyof Company; label: string; dir?: 'ltr' | 'rtl' }> = [
    { key: 'name_en', label: t('settings.company.nameEn'), dir: 'ltr' },
    { key: 'name_ar', label: t('settings.company.nameAr'), dir: 'rtl' },
    { key: 'legal_name', label: t('settings.company.legalName') },
    { key: 'tax_number', label: t('settings.company.taxNumber'), dir: 'ltr' },
    { key: 'registration_number', label: t('settings.company.registrationNumber'), dir: 'ltr' },
    { key: 'phone', label: t('settings.company.phone'), dir: 'ltr' },
    { key: 'email', label: t('settings.company.email'), dir: 'ltr' },
    { key: 'website', label: t('settings.company.website'), dir: 'ltr' },
    { key: 'address_en', label: t('settings.company.addressEn'), dir: 'ltr' },
    { key: 'address_ar', label: t('settings.company.addressAr'), dir: 'rtl' },
  ];

  return (
    <Section
      title={t('settings.company.title')}
      description={t('settings.company.hint')}
      footer={
        editable && (
          <Button
            variant="primary"
            loading={form.formState.isSubmitting}
            onClick={form.handleSubmit(async (values) => {
              const patch = Object.fromEntries(fields.map((f) => [f.key, (values[f.key] as string | null)?.toString().trim() || null]));
              if (!patch.name_en || !patch.name_ar) return toast.error(t('errors.COMPANY_NAME_REQUIRED'));
              const { error } = await supabase.from('companies').update(patch).eq('id', company.id);
              if (error) return toast.error(errorMessage(toAppError(error), t));
              await queryClient.invalidateQueries({ queryKey: ['memberships'] });
              toast.success(t('settings.savedToast'));
            })}
          >
            {t('common.save')}
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.key === 'name_en' || f.key === 'name_ar'}>
            {(p) => <Input {...p} dir={f.dir} className={f.dir === 'rtl' ? 'font-ar' : undefined} disabled={!editable} {...form.register(f.key)} />}
          </Field>
        ))}
        <StaticField label={t('settings.company.baseCurrency')}>
          <span className="num">{currency.code}</span>
          <span className="ms-2 text-muted">{name(currency)}</span>
        </StaticField>
      </div>
    </Section>
  );
}

function AccountingTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { name } = useLanguage();
  const { settings, can, companyId } = useCompany();
  const { accounts } = useAccounts();
  const editable = can('settings.manage');
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;
  const equityAccounts = accounts.filter((a) => a.account_type === 'equity' && a.is_posting);

  return (
    <Section
      title={t('settings.accounting.title')}
      description={t('settings.accounting.hint')}
      footer={
        editable && (
          <Button
            variant="primary"
            onClick={async () => {
              const { error } = await supabase
                .from('company_settings')
                .update({
                  require_approval: draft.require_approval,
                  retained_earnings_account_id: draft.retained_earnings_account_id,
                  report_show_signatures: draft.report_show_signatures,
                  default_language: draft.default_language,
                })
                .eq('company_id', companyId);
              if (error) return toast.error(errorMessage(toAppError(error), t));
              await queryClient.invalidateQueries({ queryKey: ['company-settings'] });
              toast.success(t('settings.savedToast'));
            }}
          >
            {t('common.save')}
          </Button>
        )
      }
    >
      <div className="flex max-w-2xl flex-col gap-5">
        <div>
          <Checkbox label={t('settings.accounting.requireApproval')} disabled={!editable} checked={draft.require_approval} onChange={(e) => setDraft({ ...draft, require_approval: e.target.checked })} />
          <p className="ms-6 mt-1 text-[12.5px] text-muted">{t('settings.accounting.requireApprovalHint')}</p>
        </div>
        <Field label={t('settings.accounting.retainedEarnings')} hint={t('settings.accounting.retainedEarningsHint')}>
          {(p) => (
            <Select {...p} disabled={!editable} value={draft.retained_earnings_account_id ?? ''} onChange={(e) => setDraft({ ...draft, retained_earnings_account_id: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {equityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {name(a)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('settings.accounting.defaultLanguage')}>
          {(p) => (
            <Select {...p} disabled={!editable} value={draft.default_language} onChange={(e) => setDraft({ ...draft, default_language: e.target.value as 'en' | 'ar' })}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          )}
        </Field>
        <Checkbox label={t('settings.accounting.signatures')} disabled={!editable} checked={draft.report_show_signatures} onChange={(e) => setDraft({ ...draft, report_show_signatures: e.target.checked })} />
      </div>
    </Section>
  );
}

function UsersTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { companyId, can } = useCompany();
  const { members } = useMembers();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('accountant');
  const [busy, setBusy] = useState(false);
  const manage = can('users.manage');
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['members'] }), queryClient.invalidateQueries({ queryKey: ['memberships'] })]);

  const call = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      await refresh();
      toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('settings.users.title')} description={t('settings.users.hint')}>
        <div className="-mx-5 -my-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead className="bg-subtle text-[12px] text-muted">
              <tr>
                <th className="h-9 border-b border-line ps-5 text-start font-medium">{t('settings.users.name')}</th>
                <th className="h-9 border-b border-line px-3 text-start font-medium">{t('auth.email')}</th>
                <th className="h-9 border-b border-line px-3 text-start font-medium">{t('settings.users.role')}</th>
                <th className="h-9 border-b border-line pe-5"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td className="border-b border-line py-2 ps-5 font-medium">
                    {m.full_name || '—'}
                    {m.user_id === user?.id && <span className="ms-2"><Badge dot={false}>{t('settings.users.you')}</Badge></span>}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-ink-soft" dir="ltr">{m.email}</td>
                  <td className="border-b border-line px-3 py-2">
                    {manage ? (
                      <Select className="h-8 w-[170px]" value={m.role} onChange={(e) => void call(() => rpc('update_member_role', { p_company_id: companyId, p_user_id: m.user_id, p_role: e.target.value }), t('settings.users.roleUpdated'))}>
                        {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                      </Select>
                    ) : (
                      t(`roles.${m.role}`)
                    )}
                  </td>
                  <td className="border-b border-line py-1.5 pe-5 text-end">
                    {manage && (
                      <IconButton
                        label={t('settings.users.remove')}
                        onClick={() => window.confirm(t('settings.users.removeConfirm', { name: m.full_name || m.email })) && void call(() => rpc('remove_company_member', { p_company_id: companyId, p_user_id: m.user_id }), t('settings.users.removed'))}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {manage && (
        <Section title={t('settings.users.addTitle')} description={t('settings.users.addHint')}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!email.trim()) return;
              setBusy(true);
              await call(() => rpc('add_company_member', { p_company_id: companyId, p_email: email.trim(), p_role: role }), t('settings.users.added'));
              setEmail('');
              setBusy(false);
            }}
          >
            <Field label={t('auth.email')} className="min-w-[260px] flex-1">
              {(p) => <Input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label={t('settings.users.role')}>
              {(p) => (
                <Select {...p} className="w-[180px]" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                </Select>
              )}
            </Field>
            <Button type="submit" variant="primary" icon={<UserPlus size={15} />} loading={busy}>{t('settings.users.add')}</Button>
          </form>
        </Section>
      )}

      <Section title={t('settings.users.permissionsTitle')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <thead className="text-muted">
              <tr>
                <th className="border-b border-line py-2 text-start font-medium">{t('settings.users.permission')}</th>
                {ROLES.map((r) => <th key={r} className="border-b border-line px-2 py-2 text-center font-medium">{t(`roles.${r}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {(['entries.create', 'entries.edit_draft', 'entries.submit', 'entries.approve', 'entries.post', 'entries.reverse', 'accounts.manage', 'reports.export', 'audit.view', 'users.manage', 'periods.manage', 'settings.manage'] as const).map((perm) => (
                <tr key={perm}>
                  <td className="border-b border-line py-1.5 text-ink-soft">{t(`permissions.${perm.replace('.', '_')}`)}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="border-b border-line px-2 py-1.5 text-center">
                      {ROLE_MATRIX[r].includes(perm) ? <span className="text-accent">●</span> : <span className="text-faint">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-muted">{t('settings.users.matrixNote')}</p>
      </Section>
    </div>
  );
}

const ROLE_MATRIX: Record<AppRole, string[]> = {
  admin: ['entries.create', 'entries.edit_draft', 'entries.submit', 'entries.approve', 'entries.post', 'entries.reverse', 'accounts.manage', 'reports.export', 'audit.view', 'users.manage', 'periods.manage', 'settings.manage'],
  accountant: ['entries.create', 'entries.edit_draft', 'entries.submit', 'entries.post', 'accounts.manage', 'reports.export'],
  reviewer: ['entries.approve', 'entries.post', 'entries.reverse', 'reports.export', 'audit.view'],
  viewer: ['reports.export'],
};

function ProfileTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { profile } = useCompany();
  const { setLanguage } = useLanguage();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [lang, setLang] = useState<'en' | 'ar'>(profile?.preferred_language ?? 'en');
  const [password, setPassword] = useState('');
  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setLang(profile?.preferred_language ?? 'en');
  }, [profile]);

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('settings.profile.title')}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() || null, preferred_language: lang }).eq('id', user!.id);
              if (error) return toast.error(errorMessage(toAppError(error), t));
              setLanguage(lang);
              await queryClient.invalidateQueries({ queryKey: ['profile'] });
              toast.success(t('settings.savedToast'));
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={t('auth.fullName')}>{(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />}</Field>
          <StaticField label={t('auth.email')}><span dir="ltr">{user?.email}</span></StaticField>
          <Field label={t('settings.profile.language')}>
            {(p) => (
              <Select {...p} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ar')}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </Select>
            )}
          </Field>
        </div>
      </Section>
      <Section
        title={t('settings.profile.passwordTitle')}
        footer={
          <Button
            onClick={async () => {
              if (password.length < 8) return toast.error(t('validation.passwordLength'));
              const { error } = await supabase.auth.updateUser({ password });
              if (error) return toast.error(errorMessage(error, t));
              setPassword('');
              toast.success(t('settings.profile.passwordChanged'));
            }}
          >
            {t('auth.updatePassword')}
          </Button>
        }
      >
        <Field label={t('settings.profile.newPassword')} hint={t('auth.passwordHint')} className="max-w-sm">
          {(p) => <Input {...p} type="password" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </Section>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { can, role } = useCompany();
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const [tab, setTab] = useState<Tab>(isTab(requested) ? requested : 'company');
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={role ? t('settings.subtitle', { role: t(`roles.${role}`) }) : undefined} />
      {!can('settings.manage') && tab !== 'profile' && tab !== 'layout' && <Alert tone="info" className="mb-4">{t('settings.readOnly')}</Alert>}
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'company', label: t('settings.tabs.company') },
          { value: 'accounting', label: t('settings.tabs.accounting') },
          { value: 'users', label: t('settings.tabs.users') },
          { value: 'layout', label: t('settings.tabs.layout') },
          { value: 'profile', label: t('settings.tabs.profile') },
        ]}
      />
      {tab === 'company' && <CompanyTab />}
      {tab === 'accounting' && <AccountingTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'layout' && <LayoutTab />}
      {tab === 'profile' && <ProfileTab />}
    </>
  );
}
