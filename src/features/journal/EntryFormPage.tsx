import { clsx } from 'clsx';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AccountPicker } from '@/components/forms/AccountPicker';
import { AmountInput, amountToUnits } from '@/components/forms/AmountInput';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Field, Input, Select, StaticField, Textarea } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useAccounts, usePeriods, periodFor } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import {
  buildSimpleEntryLines,
  formatUnits,
  isSimpleEntry,
  linesToPayload,
  summarizeLines,
  toUnits,
  validateLines,
  type JournalIssue,
  type JournalLineDraft,
} from '@/lib/accounting';
import { formatPeriodName, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import { uploadAttachment, useJournalEntry, useSaveEntry, useInvalidateLedger } from './api';
import { AttachmentsPanel, PendingFiles } from './components/AttachmentsPanel';
import { BalanceIndicator } from './components/BalanceIndicator';
import { JournalPresentation } from './components/JournalPresentation';
import { LinesEditor, lineInputsToDrafts, newLine, type LineInput } from './components/LinesEditor';
import { ENTRY_TYPES, VOUCHER_TYPES } from './EntriesListPage';

const schema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
  entryType: z.enum(['standard', 'opening', 'adjusting', 'closing', 'reversing', 'recurring']),
  voucherType: z.string(),
  voucherNumber: z.string().trim().max(40, 'validation.tooLong'),
  referenceNumber: z.string().trim().max(60, 'validation.tooLong'),
  description: z.string().trim().min(1, 'validation.descriptionRequired').max(500, 'validation.tooLong'),
  notes: z.string().max(2000, 'validation.tooLong'),
  mode: z.enum(['simple', 'compound']),
  debitAccountId: z.string().nullable(),
  creditAccountId: z.string().nullable(),
  amount: z.string(),
  lines: z.array(z.object({ key: z.string(), accountId: z.string().nullable(), debit: z.string(), credit: z.string(), description: z.string() })),
});
type FormValues = z.infer<typeof schema>;
type Intent = 'draft' | 'submit' | 'post';

function effectiveLines(values: Pick<FormValues, 'mode' | 'debitAccountId' | 'creditAccountId' | 'amount' | 'lines'>): JournalLineDraft[] {
  if (values.mode === 'simple') {
    return buildSimpleEntryLines(values.debitAccountId, values.creditAccountId, amountToUnits(values.amount));
  }
  return lineInputsToDrafts(values.lines);
}

function SidePanel({ title, secondary, tone, children }: { title: string; secondary: string; tone: 'debit' | 'credit'; children: React.ReactNode }) {
  const { isRtl } = useLanguage();
  return (
    <section className={clsx('rounded-[12px] border border-line border-t-[3px] bg-subtle/60 p-4', tone === 'debit' ? 'border-t-accent' : 'border-t-orange')}>
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
        <h3 className={clsx('text-[13.5px] font-semibold', tone === 'debit' ? 'text-accent-strong' : 'text-orange')}>{title}</h3>
        <span lang={isRtl ? 'en' : 'ar'} className={isRtl ? 'text-[12px] text-muted' : 'font-ar text-[13px] text-muted'}>
          {secondary}
        </span>
      </div>
      <div className={tone === 'credit' ? 'ps-0 sm:ps-6' : ''}>{children}</div>
    </section>
  );
}

export function EntryFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { t } = useTranslation();
  const { language, isRtl, name } = useLanguage();
  const navigate = useNavigate();
  const toast = useToast();
  const { companyId, currency, can, settings } = useCompany();
  const { accounts, byId, isLoading: accountsLoading } = useAccounts();
  const { periods } = usePeriods();
  const existing = useJournalEntry(id);
  const save = useSaveEntry();
  const invalidate = useInvalidateLedger();
  const [issues, setIssues] = useState<JournalIssue[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showLineErrors, setShowLineErrors] = useState(false);
  const [busyIntent, setBusyIntent] = useState<Intent | null>(null);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entryDate: todayIso(),
      entryType: 'standard',
      voucherType: '',
      voucherNumber: '',
      referenceNumber: '',
      description: '',
      notes: '',
      mode: 'simple',
      debitAccountId: null,
      creditAccountId: null,
      amount: '',
      lines: [newLine(), newLine()],
    },
  });

  // Load an existing draft into the form.
  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    const drafts: JournalLineDraft[] = e.lines.map((l) => ({ accountId: l.account_id, debit: toUnits(l.debit_amount), credit: toUnits(l.credit_amount), description: l.description }));
    const simple = isSimpleEntry(drafts) && e.lines.every((l) => !l.description);
    const debitLine = e.lines.find((l) => toUnits(l.debit_amount) > 0n);
    const creditLine = e.lines.find((l) => toUnits(l.credit_amount) > 0n);
    form.reset({
      entryDate: e.entry_date,
      entryType: e.entry_type,
      voucherType: e.voucher_type ?? '',
      voucherNumber: e.voucher_number ?? '',
      referenceNumber: e.reference_number ?? '',
      description: e.description,
      notes: e.notes ?? '',
      mode: simple ? 'simple' : 'compound',
      debitAccountId: debitLine?.account_id ?? null,
      creditAccountId: creditLine?.account_id ?? null,
      amount: simple && debitLine ? formatUnits(toUnits(debitLine.debit_amount), { decimals: currency.decimals }) : '',
      lines: e.lines.map((l) =>
        newLine({
          accountId: l.account_id,
          debit: toUnits(l.debit_amount) ? formatUnits(toUnits(l.debit_amount), { decimals: currency.decimals }) : '',
          credit: toUnits(l.credit_amount) ? formatUnits(toUnits(l.credit_amount), { decimals: currency.decimals }) : '',
          description: l.description ?? '',
        }),
      ),
    });
  }, [existing.data, form, currency.decimals]);

  const watched = useWatch({ control: form.control });
  const lines = useMemo(
    () =>
      effectiveLines({
        mode: watched.mode ?? 'simple',
        debitAccountId: watched.debitAccountId ?? null,
        creditAccountId: watched.creditAccountId ?? null,
        amount: watched.amount ?? '',
        lines: (watched.lines ?? []) as LineInput[],
      }),
    [watched.mode, watched.debitAccountId, watched.creditAccountId, watched.amount, watched.lines],
  );
  const summary = summarizeLines(lines);
  const period = watched.entryDate ? periodFor(periods, watched.entryDate) : undefined;

  const requireApproval = settings?.require_approval ?? true;
  const canPostDirectly = can('entries.post') && (!requireApproval || can('entries.approve'));
  const canSubmit = can('entries.submit');

  const presentation = lines
    .filter((l) => l.accountId && (l.debit > 0n || l.credit > 0n))
    .map((l, i) => {
      const account = byId.get(l.accountId!);
      return { key: `${i}`, accountCode: account?.code ?? '', accountName: account ? name(account) : '', debit: l.debit, credit: l.credit, description: l.description };
    });

  const switchMode = (mode: 'simple' | 'compound') => {
    const values = form.getValues();
    if (mode === values.mode) return;
    if (mode === 'compound') {
      const current = effectiveLines(values);
      form.setValue(
        'lines',
        current.map((l) =>
          newLine({
            accountId: l.accountId,
            debit: l.debit ? formatUnits(l.debit, { decimals: currency.decimals }) : '',
            credit: l.credit ? formatUnits(l.credit, { decimals: currency.decimals }) : '',
          }),
        ),
      );
    } else {
      const drafts = lineInputsToDrafts(values.lines).filter((l) => l.accountId || l.debit || l.credit);
      if (drafts.length > 0 && !isSimpleEntry(drafts)) {
        toast.info(t('journal.cannotSimplify'));
        return;
      }
      const debit = drafts.find((l) => l.debit > 0n);
      const credit = drafts.find((l) => l.credit > 0n);
      form.setValue('debitAccountId', debit?.accountId ?? null);
      form.setValue('creditAccountId', credit?.accountId ?? null);
      form.setValue('amount', debit ? formatUnits(debit.debit, { decimals: currency.decimals }) : '');
    }
    form.setValue('mode', mode);
  };

  const onSubmit = (intent: Intent) =>
    form.handleSubmit(async (values) => {
      setServerError(null);
      setShowLineErrors(true);
      const drafts = effectiveLines(values);
      const found = validateLines(drafts, { forPosting: intent !== 'draft', decimals: currency.decimals, accounts: byId });
      if (values.mode === 'simple' && values.debitAccountId && values.debitAccountId === values.creditAccountId) {
        found.push({ code: 'LINE_INVALID_AMOUNT', line: 2 });
        setServerError(t('errors.SAME_ACCOUNT_BOTH_SIDES'));
      }
      setIssues(found);
      if (found.length) return;

      setBusyIntent(intent);
      let entryId = id ?? null;
      try {
        entryId = await save.mutateAsync({
          id: id ?? null,
          header: {
            entry_date: values.entryDate,
            entry_type: values.entryType,
            voucher_type: (values.voucherType || null) as never,
            voucher_number: values.voucherNumber.trim() || null,
            description: values.description.trim(),
            notes: values.notes.trim() || null,
            reference_number: values.referenceNumber.trim() || null,
            currency_code: currency.code,
          },
          lines: linesToPayload(drafts),
        });
        for (const file of pendingFiles) await uploadAttachment(companyId, 'journal_entry', entryId, file);
        if (intent === 'submit') await rpc('submit_journal_entry', { p_entry_id: entryId });
        if (intent === 'post') await rpc('post_journal_entry', { p_entry_id: entryId });
        await invalidate();
        toast.success(t(intent === 'post' ? 'journal.postedToast' : intent === 'submit' ? 'journal.submittedToast' : 'journal.savedToast'));
        navigate(`/journal/entries/${entryId}`, { replace: true });
      } catch (e) {
        const message = errorMessage(e, t);
        if (entryId && entryId !== id) {
          // The draft was saved but a later step failed; continue from the saved draft.
          toast.error(message);
          await invalidate();
          navigate(`/journal/entries/${entryId}`, { replace: true });
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
      <Alert tone="warning" title={t('journal.notEditableTitle')} action={<ButtonLink to={`/journal/entries/${id}`}>{t('common.view')}</ButtonLink>}>
        {t('journal.notEditableBody')}
      </Alert>
    );
  }
  if (!can(editing ? 'entries.edit_draft' : 'entries.create')) {
    return <Alert tone="warning">{t('errors.PERMISSION_DENIED')}</Alert>;
  }

  const err = (field: keyof FormValues) => {
    const m = form.formState.errors[field]?.message;
    return m ? t(String(m)) : null;
  };
  const entry = existing.data;
  const mode = watched.mode ?? 'simple';

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="pb-24">
      <PageHeader
        eyebrow={
          <Link to={editing ? `/journal/entries/${id}` : '/journal'} className="inline-flex items-center gap-1.5 hover:text-ink">
            <BackIcon size={14} /> {editing ? entry?.entry_number : t('rooms.journal.title')}
          </Link>
        }
        title={editing ? t('journal.editEntry', { number: entry?.entry_number ?? '' }) : t('journal.newEntry')}
        subtitle={t('journal.formSubtitle')}
      />

      {entry?.rejection_reason && (
        <Alert tone="warning" title={t('journal.rejectedTitle')} className="mb-4">
          {entry.rejection_reason}
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title={t('journal.sections.details')} />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <StaticField label={t('journal.entryNumber')}>
              <span className="num">{entry?.entry_number ?? t('journal.assignedOnSave')}</span>
            </StaticField>
            <Field
              label={t('journal.entryDate')}
              required
              error={err('entryDate')}
              hint={period ? `${t('journal.period')}: ${formatPeriodName(period.name, language)} · ${t(`periods.status.${period.status}`)}` : t('journal.noPeriodForDate')}
            >
              {(p) => <Input {...p} type="date" className="num" {...form.register('entryDate')} />}
            </Field>
            <Field label={t('journal.entryType')} required>
              {(p) => (
                <Select {...p} {...form.register('entryType')}>
                  {ENTRY_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`entryTypes.${type}`)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <StaticField label={t('journal.currency')}>
              <span className="num">{currency.code}</span>
              <span className="ms-2 text-muted">{name(currency)}</span>
            </StaticField>
            <Field label={t('journal.voucherType')} hint={t('journal.voucherTypeHint')}>
              {(p) => (
                <Select {...p} {...form.register('voucherType')}>
                  <option value="">{t('common.none')}</option>
                  {VOUCHER_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`voucherTypes.${type}`)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('journal.voucherNumber')} error={err('voucherNumber')}>
              {(p) => <Input {...p} dir="ltr" className="num" {...form.register('voucherNumber')} />}
            </Field>
            <Field label={t('journal.reference')} error={err('referenceNumber')}>
              {(p) => <Input {...p} dir="ltr" {...form.register('referenceNumber')} />}
            </Field>
            <StaticField label={t('journal.status')}>
              <StatusBadge status={entry?.status ?? 'draft'} />
            </StaticField>
            {entry && (
              <>
                <StaticField label={t('journal.createdBy')}>{entry.created_by_name ?? '—'}</StaticField>
                <StaticField label={t('journal.approvedBy')}>{entry.approved_by_name ?? '—'}</StaticField>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t('journal.sections.accounts')}
            description={mode === 'simple' ? t('journal.simpleHint') : t('journal.compoundHint')}
            actions={
              <Segmented
                label={t('journal.entryMode')}
                value={mode}
                onChange={switchMode}
                options={[
                  { value: 'simple', label: t('journal.simpleEntry') },
                  { value: 'compound', label: t('journal.compoundEntry') },
                ]}
              />
            }
          />
          {accountsLoading ? (
            <PageLoader />
          ) : mode === 'simple' ? (
            <div className="flex flex-col gap-4 p-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SidePanel title={t('journal.fromAccountDebit')} secondary={t('journal.fromAccountDebit', { lng: isRtl ? 'en' : 'ar' })} tone="debit">
                  <Controller
                    control={form.control}
                    name="debitAccountId"
                    render={({ field }) => (
                      <AccountPicker
                        accounts={accounts}
                        value={field.value}
                        onChange={field.onChange}
                        invalid={showLineErrors && !field.value}
                        aria-label={t('journal.fromAccountDebit')}
                      />
                    )}
                  />
                </SidePanel>
                <SidePanel title={t('journal.toAccountCredit')} secondary={t('journal.toAccountCredit', { lng: isRtl ? 'en' : 'ar' })} tone="credit">
                  <Controller
                    control={form.control}
                    name="creditAccountId"
                    render={({ field }) => (
                      <AccountPicker
                        accounts={accounts}
                        value={field.value}
                        onChange={field.onChange}
                        invalid={showLineErrors && !field.value}
                        aria-label={t('journal.toAccountCredit')}
                      />
                    )}
                  />
                </SidePanel>
              </div>
              <div className="max-w-xs">
                <Controller
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <Field label={`${t('journal.amount')} (${currency.code})`} required error={showLineErrors && amountToUnits(field.value) <= 0n ? t('errors.VOUCHER_AMOUNT_REQUIRED') : null}>
                      {(p) => <AmountInput {...p} value={field.value} onChange={field.onChange} decimals={currency.decimals} />}
                    </Field>
                  )}
                />
              </div>
            </div>
          ) : (
            <Controller
              control={form.control}
              name="lines"
              render={({ field }) => (
                <LinesEditor value={field.value as LineInput[]} onChange={field.onChange} accounts={accounts} decimals={currency.decimals} showErrors={showLineErrors} />
              )}
            />
          )}
          <div className="border-t border-line p-5">
            <BalanceIndicator totalDebit={summary.totalDebit} totalCredit={summary.totalCredit} decimals={currency.decimals} />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('journal.sections.statement')} />
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
            <Field label={t('journal.description')} required error={err('description')} hint={t('journal.descriptionHint')}>
              {(p) => <Textarea {...p} rows={3} maxLength={500} {...form.register('description')} />}
            </Field>
            <Field label={t('journal.notes')} error={err('notes')}>
              {(p) => <Textarea {...p} rows={3} maxLength={2000} {...form.register('notes')} />}
            </Field>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={t('journal.sections.preview')} description={t('journal.previewHint')} />
          <JournalPresentation lines={presentation} decimals={currency.decimals} />
        </Card>

        {entry ? (
          <AttachmentsPanel entityType="journal_entry" entityId={entry.id} attachments={entry.attachments} editable onChanged={() => void existing.refetch()} />
        ) : (
          <Card>
            <CardHeader title={t('attachments.title')} />
            <div className="p-5">
              <PendingFiles files={pendingFiles} onChange={setPendingFiles} />
            </div>
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
          <span className="me-auto hidden text-[12.5px] text-muted md:block">
            {summary.isBalanced ? t('journal.readyToPost') : t('journal.postingDisabledUnbalanced')}
          </span>
          <ButtonLink to={editing ? `/journal/entries/${id}` : '/journal'} variant="ghost">
            {t('common.cancel')}
          </ButtonLink>
          <Button onClick={() => void onSubmit('draft')} loading={busyIntent === 'draft'} disabled={Boolean(busyIntent)}>
            {t('journal.saveDraft')}
          </Button>
          {/* One next step: post if this user may, otherwise send for approval. */}
          {canPostDirectly ? (
            <Button variant="accent" onClick={() => void onSubmit('post')} loading={busyIntent === 'post'} disabled={Boolean(busyIntent) || !summary.isBalanced}>
              {t('journal.saveAndPost')}
            </Button>
          ) : canSubmit ? (
            <Button variant="accent" onClick={() => void onSubmit('submit')} loading={busyIntent === 'submit'} disabled={Boolean(busyIntent) || !summary.isBalanced}>
              {t('journal.saveAndSubmit')}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
