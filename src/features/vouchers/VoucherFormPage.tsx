import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AccountPicker } from '@/components/forms/AccountPicker';
import { AmountInput, amountToUnits } from '@/components/forms/AmountInput';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Field, Input, Select, StaticField, Textarea } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAccountCategories, useAccounts } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import {
  amountInWords,
  formatUnits,
  linesToPayload,
  summarizeLines,
  toUnits,
  unitsToDecimalString,
  validateVoucher,
  voucherJournalLines,
  type Account,
  type PaymentMethod,
  type VoucherIssue,
  type VoucherType,
} from '@/lib/accounting';
import { todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import { uploadAttachment, useInvalidateLedger } from '@/features/journal/api';
import { AttachmentsPanel, PendingFiles } from '@/features/journal/components/AttachmentsPanel';
import { BalanceIndicator } from '@/features/journal/components/BalanceIndicator';
import { JournalPresentation } from '@/features/journal/components/JournalPresentation';
import { LinesEditor, lineInputsToDrafts, newLine, type LineInput } from '@/features/journal/components/LinesEditor';
import { useSaveVoucher, useVoucher } from './api';
import { VOUCHER_TYPE_LIST } from './VouchersListPage';

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'card', 'other'];

const schema = z.object({
  voucherDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
  partyName: z.string().trim().max(160, 'validation.tooLong'),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'other']),
  chequeNumber: z.string().trim().max(40, 'validation.tooLong'),
  cashAccountId: z.string().nullable(),
  counterAccountId: z.string().nullable(),
  fromAccountId: z.string().nullable(),
  toAccountId: z.string().nullable(),
  amount: z.string(),
  description: z.string().trim().min(1, 'validation.descriptionRequired').max(500, 'validation.tooLong'),
  notes: z.string().max(2000, 'validation.tooLong'),
  referenceNumber: z.string().trim().max(60, 'validation.tooLong'),
  lines: z.array(z.object({ key: z.string(), accountId: z.string().nullable(), debit: z.string(), credit: z.string(), description: z.string() })),
});
type FormValues = z.infer<typeof schema>;
type Intent = 'draft' | 'submit' | 'post';

export function VoucherFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = Boolean(id);
  const { t } = useTranslation();
  const { language, isRtl, name } = useLanguage();
  const navigate = useNavigate();
  const toast = useToast();
  const { companyId, currency, can, settings } = useCompany();
  const { accounts, byId } = useAccounts();
  const { categories } = useAccountCategories();
  const existing = useVoucher(id);
  const save = useSaveVoucher();
  const invalidate = useInvalidateLedger();
  const [issues, setIssues] = useState<VoucherIssue[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busyIntent, setBusyIntent] = useState<Intent | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  const requestedType = params.get('type') as VoucherType | null;
  const type: VoucherType = existing.data?.voucher_type ?? (requestedType && VOUCHER_TYPE_LIST.includes(requestedType) ? requestedType : 'receipt');

  const cashCategories = useMemo(() => new Set(categories.filter((c) => c.is_cash_equivalent).map((c) => c.code)), [categories]);
  const isCashAccount = useMemo(() => (a: Account) => a.is_posting && a.is_active && Boolean(a.category_code && cashCategories.has(a.category_code)), [cashCategories]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      voucherDate: todayIso(),
      partyName: '',
      paymentMethod: 'cash',
      chequeNumber: '',
      cashAccountId: null,
      counterAccountId: null,
      fromAccountId: null,
      toAccountId: null,
      amount: '',
      description: '',
      notes: '',
      referenceNumber: '',
      lines: [newLine(), newLine()],
    },
  });

  useEffect(() => {
    const v = existing.data;
    if (!v) return;
    const fmt = (n: number | string) => (toUnits(n) ? formatUnits(toUnits(n), { decimals: currency.decimals }) : '');
    form.reset({
      voucherDate: v.voucher_date,
      partyName: v.party_name ?? '',
      paymentMethod: v.payment_method ?? 'cash',
      chequeNumber: v.cheque_number ?? '',
      cashAccountId: v.cash_account_id,
      counterAccountId: v.counter_account_id,
      fromAccountId: v.from_account_id,
      toAccountId: v.to_account_id,
      amount: fmt(v.amount),
      description: v.description,
      notes: v.notes ?? '',
      referenceNumber: v.reference_number ?? '',
      lines: v.lines.length ? v.lines.map((l) => newLine({ accountId: l.account_id, debit: fmt(l.debit_amount), credit: fmt(l.credit_amount), description: l.description ?? '' })) : [newLine(), newLine()],
    });
  }, [existing.data, form, currency.decimals]);

  const w = useWatch({ control: form.control });
  const draft = {
    voucherType: type,
    amount: amountToUnits(w.amount ?? ''),
    cashAccountId: w.cashAccountId ?? null,
    counterAccountId: w.counterAccountId ?? null,
    fromAccountId: w.fromAccountId ?? null,
    toAccountId: w.toAccountId ?? null,
    partyName: w.partyName ?? '',
    lines: lineInputsToDrafts((w.lines ?? []) as LineInput[]),
  };
  const journalLines = voucherJournalLines(draft);
  const summary = summarizeLines(journalLines);
  const presentation = journalLines
    .filter((l) => l.accountId && (l.debit > 0n || l.credit > 0n))
    .map((l, i) => {
      const account = byId.get(l.accountId!);
      return { key: `${i}`, accountCode: account?.code ?? '', accountName: account ? name(account) : '', debit: l.debit, credit: l.credit, description: l.description };
    });

  const requireApproval = settings?.require_approval ?? true;
  const canPostDirectly = can('entries.post') && (!requireApproval || can('entries.approve'));

  const submit = (intent: Intent) =>
    form.handleSubmit(async (values) => {
      setServerError(null);
      setShowErrors(true);
      const found = validateVoucher(draft, currency.decimals);
      const relevant = intent === 'draft' ? found.filter((i) => i.code !== 'ENTRY_UNBALANCED' && i.code !== 'ENTRY_ZERO_TOTAL' && i.code !== 'ENTRY_MIN_LINES') : found;
      setIssues(relevant);
      if (relevant.length) return;
      setBusyIntent(intent);
      let voucherId = id ?? null;
      try {
        voucherId = await save.mutateAsync({
          id: id ?? null,
          data: {
            voucher_type: type,
            voucher_date: values.voucherDate,
            party_name: values.partyName.trim() || null,
            payment_method: type === 'receipt' || type === 'payment' ? values.paymentMethod : null,
            cheque_number: values.paymentMethod === 'cheque' ? values.chequeNumber.trim() || null : null,
            cash_account_id: values.cashAccountId,
            counter_account_id: values.counterAccountId,
            from_account_id: values.fromAccountId,
            to_account_id: values.toAccountId,
            amount: unitsToDecimalString(amountToUnits(values.amount)),
            currency_code: currency.code,
            description: values.description.trim(),
            notes: values.notes.trim() || null,
            reference_number: values.referenceNumber.trim() || null,
          },
          lines: type === 'journal' ? linesToPayload(lineInputsToDrafts(values.lines)) : [],
        });
        for (const file of pendingFiles) await uploadAttachment(companyId, 'voucher', voucherId, file);
        if (intent === 'submit') await rpc('submit_voucher', { p_voucher_id: voucherId });
        if (intent === 'post') await rpc('post_voucher', { p_voucher_id: voucherId });
        await invalidate();
        toast.success(t(intent === 'post' ? 'vouchers.postedToast' : intent === 'submit' ? 'journal.submittedToast' : 'journal.savedToast'));
        navigate(`/journal/vouchers/${voucherId}`, { replace: true });
      } catch (e) {
        const message = errorMessage(e, t);
        if (voucherId && voucherId !== id) {
          toast.error(message);
          await invalidate();
          navigate(`/journal/vouchers/${voucherId}`, { replace: true });
        } else {
          setServerError(message);
        }
      } finally {
        setBusyIntent(null);
      }
    })();

  if (editing && existing.isLoading) return <PageLoader />;
  if (editing && existing.data && existing.data.status !== 'draft') {
    return (
      <Alert tone="warning" title={t('journal.notEditableTitle')} action={<ButtonLink to={`/journal/vouchers/${id}`}>{t('common.view')}</ButtonLink>}>
        {t('vouchers.notEditable')}
      </Alert>
    );
  }
  if (!can(editing ? 'entries.edit_draft' : 'entries.create')) return <Alert tone="warning">{t('errors.PERMISSION_DENIED')}</Alert>;

  const err = (field: keyof FormValues) => {
    const m = form.formState.errors[field]?.message;
    return m ? t(String(m)) : null;
  };
  const voucher = existing.data;
  const amountUnits = amountToUnits(w.amount ?? '');
  const accountError = showErrors && issues.some((i) => i.code === 'VOUCHER_ACCOUNT_REQUIRED');

  const accountField = (field: 'cashAccountId' | 'counterAccountId' | 'fromAccountId' | 'toAccountId', label: string, hint: string, filter?: (a: Account) => boolean) => (
    <Controller
      control={form.control}
      name={field}
      render={({ field: f }) => (
        <Field label={label} hint={hint} required error={accountError && !f.value ? t('errors.VOUCHER_ACCOUNT_REQUIRED') : null}>
          {(p) => <AccountPicker id={p.id} aria-describedby={p['aria-describedby']} accounts={accounts} value={f.value} onChange={f.onChange} filter={filter} invalid={accountError && !f.value} />}
        </Field>
      )}
    />
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="pb-24">
      <PageHeader
        eyebrow={
          <Link to={editing ? `/journal/vouchers/${id}` : '/journal/vouchers'} className="inline-flex items-center gap-1.5 hover:text-ink">
            <BackIcon size={14} /> {t('journal.tabs.vouchers')}
          </Link>
        }
        title={editing ? `${t(`voucherTypes.${type}`)} ${voucher?.voucher_number ?? ''}` : t('vouchers.newOfType', { type: t(`voucherTypes.${type}`) })}
        subtitle={t(`vouchers.typeHints.${type}`)}
      />

      {voucher?.rejection_reason && (
        <Alert tone="warning" title={t('journal.rejectedTitle')} className="mb-4">{voucher.rejection_reason}</Alert>
      )}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title={t('vouchers.sections.voucher')} />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <StaticField label={t('vouchers.number')}><span className="num">{voucher?.voucher_number ?? t('journal.assignedOnSave')}</span></StaticField>
            <Field label={type === 'transfer' ? t('vouchers.transferDate') : t('vouchers.date')} required error={err('voucherDate')}>
              {(p) => <Input {...p} type="date" className="num" {...form.register('voucherDate')} />}
            </Field>
            <StaticField label={t('journal.currency')}><span className="num">{currency.code}</span></StaticField>
            <StaticField label={t('journal.status')}><StatusBadge status={voucher?.status ?? 'draft'} /></StaticField>

            {(type === 'receipt' || type === 'payment') && (
              <>
                <Field label={type === 'receipt' ? t('vouchers.receivedFrom') : t('vouchers.paidTo')} required error={showErrors && !w.partyName?.trim() ? t('errors.VOUCHER_PARTY_REQUIRED') : err('partyName')} className="sm:col-span-2">
                  {(p) => <Input {...p} {...form.register('partyName')} />}
                </Field>
                <Field label={t('vouchers.paymentMethod')}>
                  {(p) => (
                    <Select {...p} {...form.register('paymentMethod')}>
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
                    </Select>
                  )}
                </Field>
                {w.paymentMethod === 'cheque' ? (
                  <Field label={t('vouchers.chequeNumber')} error={err('chequeNumber')}>
                    {(p) => <Input {...p} dir="ltr" className="num" {...form.register('chequeNumber')} />}
                  </Field>
                ) : <div className="hidden lg:block" />}
              </>
            )}
            <Field label={t('journal.reference')} error={err('referenceNumber')}>
              {(p) => <Input {...p} dir="ltr" {...form.register('referenceNumber')} />}
            </Field>
          </div>
        </Card>

        {type !== 'journal' ? (
          <Card>
            <CardHeader title={t('vouchers.sections.accounts')} />
            <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
              {type === 'receipt' && (
                <>
                  {accountField('cashAccountId', t('vouchers.cashAccount'), t('vouchers.cashAccountHintReceipt'), isCashAccount)}
                  {accountField('counterAccountId', t('vouchers.counterAccount'), t('vouchers.counterAccountHint'))}
                </>
              )}
              {type === 'payment' && (
                <>
                  {accountField('cashAccountId', t('vouchers.cashAccount'), t('vouchers.cashAccountHintPayment'), isCashAccount)}
                  {accountField('counterAccountId', t('vouchers.debitAccount'), t('vouchers.debitAccountHint'))}
                </>
              )}
              {type === 'transfer' && (
                <>
                  {accountField('fromAccountId', t('vouchers.fromAccount'), t('vouchers.fromAccountHint'), isCashAccount)}
                  {accountField('toAccountId', t('vouchers.toAccount'), t('vouchers.toAccountHint'), isCashAccount)}
                </>
              )}
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <Field label={`${t('vouchers.amount')} (${currency.code})`} required error={showErrors && amountUnits <= 0n ? t('errors.VOUCHER_AMOUNT_REQUIRED') : null} hint={amountUnits > 0n ? amountInWords(amountUnits, currency, language) : undefined}>
                    {(p) => <AmountInput {...p} value={field.value} onChange={field.onChange} decimals={currency.decimals} />}
                  </Field>
                )}
              />
            </div>
            {showErrors && issues.some((i) => i.code === 'VOUCHER_SAME_ACCOUNTS') && (
              <div className="px-5 pb-4"><Alert tone="danger">{t('errors.VOUCHER_SAME_ACCOUNTS')}</Alert></div>
            )}
          </Card>
        ) : (
          <Card>
            <CardHeader title={t('vouchers.sections.lines')} description={t('journal.compoundHint')} />
            <Controller
              control={form.control}
              name="lines"
              render={({ field }) => <LinesEditor value={field.value as LineInput[]} onChange={field.onChange} accounts={accounts} decimals={currency.decimals} showErrors={showErrors} />}
            />
            <div className="border-t border-line p-5">
              <BalanceIndicator totalDebit={summary.totalDebit} totalCredit={summary.totalCredit} decimals={currency.decimals} />
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title={t('journal.sections.statement')} />
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
            <Field label={t('journal.description')} required error={err('description')}>
              {(p) => <Textarea {...p} rows={3} maxLength={500} {...form.register('description')} />}
            </Field>
            <Field label={t('journal.notes')} error={err('notes')}>
              {(p) => <Textarea {...p} rows={3} maxLength={2000} {...form.register('notes')} />}
            </Field>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={t('vouchers.accountingEffect')} description={t('vouchers.accountingEffectHint')} />
          <JournalPresentation lines={presentation} decimals={currency.decimals} />
        </Card>

        {voucher ? (
          <AttachmentsPanel entityType="voucher" entityId={voucher.id} attachments={voucher.attachments} editable onChanged={() => void existing.refetch()} />
        ) : (
          <Card>
            <CardHeader title={t('attachments.title')} />
            <div className="p-5"><PendingFiles files={pendingFiles} onChange={setPendingFiles} /></div>
          </Card>
        )}

        {(issues.length > 0 || serverError) && (
          <Alert tone="danger" title={t('journal.fixIssues')}>
            <ul className="list-disc ps-5">
              {serverError && <li>{serverError}</li>}
              {[...new Set(issues.map((i) => i.code))].map((code) => {
                const issue = issues.find((i) => i.code === code)!;
                const detail = 'line' in issue ? issue.line : 'difference' in issue ? formatUnits(issue.difference, { decimals: currency.decimals }) : '';
                return <li key={code}>{t(`errors.${code}`, { detail })}</li>;
              })}
            </ul>
          </Alert>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:ps-[var(--sidebar-width)]">
        <div className="mx-auto flex max-w-[2800px] flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <ButtonLink to={editing ? `/journal/vouchers/${id}` : '/journal/vouchers'} variant="ghost">{t('common.cancel')}</ButtonLink>
          <Button onClick={() => void submit('draft')} loading={busyIntent === 'draft'} disabled={Boolean(busyIntent)}>{t('journal.saveDraft')}</Button>
          {/* One next step: post if this user may, otherwise send for approval. */}
          {canPostDirectly ? (
            <Button variant="accent" onClick={() => void submit('post')} loading={busyIntent === 'post'} disabled={Boolean(busyIntent) || !summary.isBalanced}>{t('vouchers.saveAndPost')}</Button>
          ) : can('entries.submit') ? (
            <Button variant="accent" onClick={() => void submit('submit')} loading={busyIntent === 'submit'} disabled={Boolean(busyIntent) || !summary.isBalanced}>{t('journal.saveAndSubmit')}</Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
