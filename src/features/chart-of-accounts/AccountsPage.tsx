import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { FileSpreadsheet, FolderPlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AccountTypeBadge, Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAccountCategories, useAccounts } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { buildAccountTree, flattenTree, type Account, type AccountType } from '@/lib/accounting';
import { downloadCsv } from '@/lib/csv';
import { supabase } from '@/lib/supabase/client';
import { errorMessage, toAppError } from '@/lib/supabase/errors';

const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const NORMAL_BALANCE: Record<AccountType, 'debit' | 'credit'> = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' };

const schema = z
  .object({
    code: z.string().trim().regex(/^[0-9A-Za-z][0-9A-Za-z.-]{0,23}$/, 'validation.accountCode'),
    nameEn: z.string().trim().min(1, 'validation.required').max(120, 'validation.tooLong'),
    nameAr: z.string().trim().min(1, 'validation.required').max(120, 'validation.tooLong'),
    parentId: z.string(),
    accountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    categoryCode: z.string(),
    normalBalance: z.enum(['debit', 'credit']),
    isPosting: z.boolean(),
    isActive: z.boolean(),
    description: z.string().max(500, 'validation.tooLong'),
  })
  .refine((v) => !v.isPosting || v.categoryCode !== '', { path: ['categoryCode'], message: 'validation.categoryRequired' });
type FormValues = z.infer<typeof schema>;

function AccountDialog({ open, account, parent, onClose }: { open: boolean; account: Account | null; parent: Account | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { name } = useLanguage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const { accounts } = useAccounts();
  const { categories } = useAccountCategories();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setError(null);
    const type = account?.account_type ?? parent?.account_type ?? 'asset';
    form.reset({
      code: account?.code ?? '',
      nameEn: account?.name_en ?? '',
      nameAr: account?.name_ar ?? '',
      parentId: account?.parent_id ?? parent?.id ?? '',
      accountType: type,
      categoryCode: account?.category_code ?? '',
      normalBalance: account?.normal_balance ?? NORMAL_BALANCE[type],
      isPosting: account?.is_posting ?? true,
      isActive: account?.is_active ?? true,
      description: account?.description ?? '',
    });
  }, [open, account, parent, form]);

  const values = form.watch();
  const parents = accounts.filter((a) => !a.is_posting && a.id !== account?.id);
  const typeCategories = categories.filter((c) => c.account_type === values.accountType);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const row = {
        code: v.code.trim(),
        name_en: v.nameEn.trim(),
        name_ar: v.nameAr.trim(),
        parent_id: v.parentId || null,
        account_type: v.accountType,
        category_code: v.categoryCode || null,
        normal_balance: v.normalBalance,
        is_posting: v.isPosting,
        is_active: v.isActive,
        description: v.description.trim() || null,
      };
      const result = account
        ? await supabase.from('accounts').update(row).eq('id', account.id).select('id')
        : await supabase.from('accounts').insert({ ...row, company_id: companyId }).select('id');
      if (result.error) throw toAppError(result.error);
      if (!result.data?.length) throw toAppError({ message: 'PERMISSION_DENIED' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const err = (f: keyof FormValues) => {
    const m = form.formState.errors[f]?.message;
    return m ? t(String(m)) : null;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={account ? t('accounts.editTitle', { code: account.code }) : t('accounts.newTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={form.handleSubmit(async (v) => {
              setError(null);
              try {
                await save.mutateAsync(v);
                toast.success(t('accounts.savedToast'));
                onClose();
              } catch (e) {
                const appError = toAppError(e);
                setError(appError.code === 'DUPLICATE_VALUE' ? t('errors.ACCOUNT_CODE_EXISTS') : errorMessage(e, t));
              }
            })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {error && <Alert tone="danger" className="md:col-span-2">{error}</Alert>}
        <Field label={t('accounts.code')} required error={err('code')} hint={t('accounts.codeHint')}>
          {(p) => <Input {...p} dir="ltr" className="num" {...form.register('code')} />}
        </Field>
        <Field label={t('accounts.parent')} hint={t('accounts.parentHint')}>
          {(p) => (
            <Select
              {...p}
              {...form.register('parentId', {
                onChange: (e) => {
                  const selected = accounts.find((a) => a.id === e.target.value);
                  if (selected) {
                    form.setValue('accountType', selected.account_type);
                    form.setValue('normalBalance', NORMAL_BALANCE[selected.account_type]);
                    form.setValue('categoryCode', '');
                  }
                },
              })}
            >
              <option value="">{t('accounts.noParent')}</option>
              {parents.map((a) => (
                <option key={a.id} value={a.id}>
                  {'  '.repeat(Math.max(0, a.level - 1))}
                  {a.code} — {name(a)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('accounts.nameEn')} required error={err('nameEn')}>
          {(p) => <Input {...p} dir="ltr" {...form.register('nameEn')} />}
        </Field>
        <Field label={t('accounts.nameAr')} required error={err('nameAr')}>
          {(p) => <Input {...p} dir="rtl" className="font-ar" {...form.register('nameAr')} />}
        </Field>
        <Field label={t('accounts.type')} required hint={values.parentId ? t('accounts.typeFromParent') : undefined}>
          {(p) => (
            <Select
              {...p}
              {...form.register('accountType', {
                onChange: (e) => {
                  form.setValue('normalBalance', NORMAL_BALANCE[e.target.value as AccountType]);
                  form.setValue('categoryCode', '');
                },
              })}
            >
              {(values.parentId ? ACCOUNT_TYPES.filter((type) => type === accounts.find((a) => a.id === values.parentId)?.account_type) : ACCOUNT_TYPES).map((type) => (
                <option key={type} value={type}>{t(`accountTypes.${type}`)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('accounts.category')} required={values.isPosting} error={err('categoryCode')} hint={t('accounts.categoryHint')}>
          {(p) => (
            <Select
              {...p}
              {...form.register('categoryCode', {
                onChange: (e) => {
                  const category = categories.find((c) => c.code === e.target.value);
                  if (category) form.setValue('normalBalance', category.is_contra ? (NORMAL_BALANCE[category.account_type] === 'debit' ? 'credit' : 'debit') : NORMAL_BALANCE[category.account_type]);
                },
              })}
            >
              <option value="">{t('common.none')}</option>
              {typeCategories.map((c) => <option key={c.code} value={c.code}>{name(c)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('accounts.normalBalance')} hint={t('accounts.normalBalanceHint')}>
          {(p) => (
            <Select {...p} {...form.register('normalBalance')}>
              <option value="debit">{t('journal.debit')}</option>
              <option value="credit">{t('journal.credit')}</option>
            </Select>
          )}
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox label={t('accounts.isPosting')} {...form.register('isPosting')} />
          <Checkbox label={t('accounts.isActive')} {...form.register('isActive')} />
        </div>
        <Field label={t('accounts.description')} error={err('description')} className="md:col-span-2">
          {(p) => <Textarea {...p} rows={2} {...form.register('description')} />}
        </Field>
        {account && <p className="text-[12px] text-muted md:col-span-2">{t('accounts.lockedHint')}</p>}
      </div>
    </Dialog>
  );
}

export function AccountsPage() {
  const { t } = useTranslation();
  const { name, isRtl } = useLanguage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useCompany();
  const { accounts, isLoading, error } = useAccounts();
  const { categories } = useAccountCategories();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AccountType | ''>('');
  const [showInactive, setShowInactive] = useState(true);
  const [dialog, setDialog] = useState<{ account: Account | null; parent: Account | null } | null>(null);
  const canManage = can('accounts.manage');
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.code, name(c)])), [categories, name]);

  const rows = useMemo(() => {
    const flat = flattenTree(buildAccountTree(accounts));
    const q = search.trim().toLowerCase();
    return flat.filter(({ account: a }) => {
      if (typeFilter && a.account_type !== typeFilter) return false;
      if (!showInactive && !a.is_active) return false;
      if (q && !a.code.toLowerCase().includes(q) && !a.name_en.toLowerCase().includes(q) && !a.name_ar.includes(search.trim())) return false;
      return true;
    });
  }, [accounts, search, typeFilter, showInactive]);

  const toggleActive = async (a: Account) => {
    const { error: e } = await supabase.from('accounts').update({ is_active: !a.is_active }).eq('id', a.id);
    if (e) toast.error(errorMessage(toAppError(e), t));
    else await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  const remove = async (a: Account) => {
    if (!window.confirm(t('accounts.deleteConfirm', { code: a.code }))) return;
    const { error: e } = await supabase.from('accounts').delete().eq('id', a.id);
    if (e) toast.error(errorMessage(toAppError(e), t));
    else {
      toast.success(t('accounts.deletedToast'));
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  };

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <>
            <Button
              icon={<FileSpreadsheet size={15} />}
              onClick={() =>
                downloadCsv(
                  'chart-of-accounts',
                  [t('accounts.code'), t('accounts.nameEn'), t('accounts.nameAr'), t('accounts.type'), t('accounts.category'), t('accounts.normalBalance'), t('accounts.isPosting'), t('accounts.status')],
                  rows.map(({ account: a }) => [a.code, a.name_en, a.name_ar, t(`accountTypes.${a.account_type}`), a.category_code ? categoryName.get(a.category_code) : '', t(`journal.${a.normal_balance}`), a.is_posting ? t('common.yes') : t('common.no'), a.is_active ? t('accounts.active') : t('accounts.inactive')]),
                )
              }
            >
              {t('common.exportCsv')}
            </Button>
            {canManage && (
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setDialog({ account: null, parent: null })}>
                {t('accounts.new')}
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input type="search" className="ps-9" placeholder={t('accounts.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('common.search')} />
        </div>
        <Select className="w-[180px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as AccountType | '')} aria-label={t('accounts.type')}>
          <option value="">{t('accounts.allTypes')}</option>
          {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{t(`accountTypes.${type}`)}</option>)}
        </Select>
        <Checkbox label={t('accounts.showInactive')} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        <span className="num ms-auto text-[12.5px] text-muted">{t('accounts.count', { count: accounts.length })}</span>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : error ? (
          <div className="p-5"><Alert tone="danger">{errorMessage(error, t)}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('accounts.empty')} />
        ) : (
          <div className="relative overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[980px] border-collapse text-[13px]">
              <thead className="bg-subtle text-[12px] text-muted">
                <tr>
                  <th className="h-10 border-b border-line ps-5 text-start font-medium">{t('accounts.code')}</th>
                  <th className="h-10 border-b border-line px-3 text-start font-medium">{t('accounts.name')}</th>
                  <th className="h-10 border-b border-line px-3 text-start font-medium">{t('accounts.type')}</th>
                  <th className="h-10 border-b border-line px-3 text-start font-medium">{t('accounts.category')}</th>
                  <th className="h-10 border-b border-line px-3 text-start font-medium">{t('accounts.normalBalance')}</th>
                  <th className="h-10 border-b border-line px-3 text-start font-medium">{t('accounts.kind')}</th>
                  <th className="h-10 border-b border-line px-3 text-start font-medium">{t('accounts.status')}</th>
                  <th className="h-10 border-b border-line pe-4"><span className="sr-only">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ account: a, depth }) => (
                  <tr key={a.id} className={clsx('hover:bg-subtle', !a.is_posting && 'font-semibold', !a.is_active && 'text-faint')}>
                    <td className="num border-b border-line py-2 ps-5">{a.code}</td>
                    <td className="border-b border-line px-3 py-2" style={{ paddingInlineStart: `${12 + depth * 18}px` }}>
                      <span>{name(a)}</span>
                      {a.name_en !== a.name_ar && <span lang={isRtl ? 'en' : 'ar'} className={clsx('ms-2 text-[12px] font-normal text-muted', !isRtl && 'font-ar')}>{isRtl ? a.name_en : a.name_ar}</span>}
                    </td>
                    <td className="border-b border-line px-3 py-2 font-normal"><AccountTypeBadge type={a.account_type} /></td>
                    <td className="border-b border-line px-3 py-2 font-normal text-ink-soft">{a.category_code ? categoryName.get(a.category_code) : '—'}</td>
                    <td className="border-b border-line px-3 py-2 font-normal text-ink-soft">{t(`journal.${a.normal_balance}`)}</td>
                    <td className="border-b border-line px-3 py-2 font-normal">{a.is_posting ? t('accounts.posting') : <Badge dot={false}>{t('accounts.header')}</Badge>}</td>
                    <td className="border-b border-line px-3 py-2 font-normal">
                      {a.is_active ? <Badge tone="success">{t('accounts.active')}</Badge> : <Badge>{t('accounts.inactive')}</Badge>}
                    </td>
                    <td className="border-b border-line py-1.5 pe-4">
                      {canManage && (
                        <div className="flex justify-end gap-0.5">
                          {!a.is_posting && (
                            <IconButton label={t('accounts.addChild')} onClick={() => setDialog({ account: null, parent: a })}>
                              <FolderPlus size={15} />
                            </IconButton>
                          )}
                          <IconButton label={t('common.edit')} onClick={() => setDialog({ account: a, parent: null })}>
                            <Pencil size={15} />
                          </IconButton>
                          <Button size="sm" variant="ghost" onClick={() => void toggleActive(a)}>
                            {a.is_active ? t('accounts.deactivate') : t('accounts.activate')}
                          </Button>
                          <IconButton label={t('common.delete')} onClick={() => void remove(a)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-muted">{t('accounts.footnote')}</p>

      <AccountDialog open={dialog !== null} account={dialog?.account ?? null} parent={dialog?.parent ?? null} onClose={() => setDialog(null)} />
    </>
  );
}
