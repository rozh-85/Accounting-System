import { ArrowLeft, ArrowRight, CheckCheck, Pencil, Printer, Send, Trash2, Undo2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useLanguage } from '@/hooks/useLanguage';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import { amountInWords, formatUnits, toUnits, unitsToDecimalString, voucherJournalLines } from '@/lib/accounting';
import { formatDate, formatDateTime, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { JournalEntryDetail } from '@/types/database';
import { useJournalEntry } from '@/features/journal/api';
import { AttachmentsPanel } from '@/features/journal/components/AttachmentsPanel';
import { HistoryTimeline } from '@/features/journal/components/HistoryTimeline';
import { JournalPresentation } from '@/features/journal/components/JournalPresentation';
import { ReasonDialog } from '@/features/journal/components/ReasonDialog';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { useVoucher, useVoucherAction } from './api';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] text-ink">{children || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

export function VoucherDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { language, isRtl } = useLanguage();
  const navigate = useNavigate();
  const toast = useToast();
  const { currency, can, settings } = useCompany();
  const identity = useReportIdentity();
  const query = useVoucher(id);
  const entry = useJournalEntry(query.data?.journal_entry_id ?? undefined);
  const action = useVoucherAction();
  const [dialog, setDialog] = useState<'reverse' | 'reject' | 'delete' | 'print' | null>(null);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) return <Alert tone="danger">{errorMessage(query.error ?? new Error('VOUCHER_NOT_FOUND'), t)}</Alert>;
  const v = query.data;
  const isDraft = v.status === 'draft';
  const isPending = v.status === 'pending_approval';
  const requireApproval = settings?.require_approval ?? true;
  const canPostDirectly = can('entries.post') && (!requireApproval || can('entries.approve'));
  const amount = toUnits(v.amount);

  const accountRef = (accountId: string | null) => {
    if (!accountId) return null;
    const a = v.accounts[accountId];
    return a ? `${a.code} · ${language === 'ar' ? a.name_ar : a.name_en}` : null;
  };

  // Accounting effect: the posted journal lines, or a preview while not yet posted.
  const accountInfo = (accountId: string | null) => {
    if (!accountId) return null;
    const fromHeader = v.accounts[accountId];
    if (fromHeader) return fromHeader;
    const fromLines = v.lines.find((x) => x.account_id === accountId);
    return fromLines ? { code: fromLines.account_code, name_en: fromLines.account_name_en, name_ar: fromLines.account_name_ar } : null;
  };
  const previewLines: JournalEntryDetail['lines'] = voucherJournalLines({
    voucherType: v.voucher_type,
    amount,
    cashAccountId: v.cash_account_id,
    counterAccountId: v.counter_account_id,
    fromAccountId: v.from_account_id,
    toAccountId: v.to_account_id,
    partyName: v.party_name,
    lines: v.lines.map((l) => ({ accountId: l.account_id, debit: toUnits(l.debit_amount), credit: toUnits(l.credit_amount), description: l.description })),
  }).map((l, i) => {
    const a = accountInfo(l.accountId);
    return {
      id: `preview-${i}`,
      line_number: i + 1,
      account_id: l.accountId ?? '',
      account_code: a?.code ?? '',
      account_name_en: a?.name_en ?? '',
      account_name_ar: a?.name_ar ?? '',
      debit_amount: unitsToDecimalString(l.debit),
      credit_amount: unitsToDecimalString(l.credit),
      description: l.description ?? null,
    };
  });
  const effectLines = entry.data?.lines ?? previewLines;
  const lines = effectLines.map((l) => ({
    key: l.id,
    accountCode: l.account_code,
    accountName: language === 'ar' ? l.account_name_ar : l.account_name_en,
    debit: toUnits(l.debit_amount),
    credit: toUnits(l.credit_amount),
    description: l.description,
  }));

  const run = async (input: Parameters<typeof action.mutateAsync>[0], success: string) => {
    try {
      await action.mutateAsync(input);
      toast.success(success);
      setDialog(null);
      if (input.type === 'delete') navigate('/journal/vouchers', { replace: true });
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/journal/vouchers" className="inline-flex items-center gap-1.5 hover:text-ink">
            <BackIcon size={14} /> {t('journal.tabs.vouchers')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{t(`voucherTypes.${v.voucher_type}`)}</span>
            <span className="num text-ink-soft">{v.voucher_number}</span>
            <StatusBadge status={v.status} />
          </span>
        }
        subtitle={`${formatDate(v.voucher_date)} · ${v.description}`}
        actions={
          <>
            <Button icon={<Printer size={15} />} onClick={() => setDialog('print')}>{t('vouchers.printVoucher')}</Button>
            {isDraft && can('entries.edit_draft') && (
              <>
                <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setDialog('delete')}>{t('journal.deleteDraft')}</Button>
                <ButtonLink to={`/journal/vouchers/${v.id}/edit`} icon={<Pencil size={15} />}>{t('common.edit')}</ButtonLink>
              </>
            )}
            {isDraft && can('entries.submit') && (requireApproval || !canPostDirectly) && (
              <Button variant="primary" icon={<Send size={15} />} loading={action.isPending} onClick={() => void run({ type: 'submit', id: v.id }, t('journal.submittedToast'))}>{t('journal.submitForApproval')}</Button>
            )}
            {isDraft && canPostDirectly && (
              <Button variant="accent" icon={<CheckCheck size={15} />} loading={action.isPending} onClick={() => void run({ type: 'post', id: v.id }, t('vouchers.postedToast'))}>{t('vouchers.post')}</Button>
            )}
            {isPending && can('entries.approve') && (
              <>
                <Button variant="danger" icon={<X size={15} />} onClick={() => setDialog('reject')}>{t('journal.reject')}</Button>
                <Button variant="accent" icon={<CheckCheck size={15} />} loading={action.isPending} onClick={() => void run({ type: 'approve', id: v.id }, t('vouchers.postedToast'))}>{t('journal.approveAndPost')}</Button>
              </>
            )}
            {v.status === 'posted' && can('entries.reverse') && (
              <Button icon={<Undo2 size={15} />} onClick={() => setDialog('reverse')}>{t('journal.reverse')}</Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {isDraft && v.rejection_reason && <Alert tone="warning" title={t('journal.rejectedTitle')}>{v.rejection_reason}</Alert>}
        {isPending && <Alert tone="info" title={t('journal.pendingTitle')}>{can('entries.approve') ? t('journal.pendingApprover') : t('journal.pendingPreparer')}</Alert>}
        {v.status === 'reversed' && <Alert tone="danger" title={t('journal.reversedTitle')}>{t('vouchers.reversedBody')}</Alert>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={t('vouchers.sections.voucher')} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-3">
              <Detail label={t('vouchers.number')}><span className="num">{v.voucher_number}</span></Detail>
              <Detail label={v.voucher_type === 'transfer' ? t('vouchers.transferDate') : t('vouchers.date')}><span className="num">{formatDate(v.voucher_date)}</span></Detail>
              <Detail label={t('vouchers.type')}>{t(`voucherTypes.${v.voucher_type}`)}</Detail>
              {(v.voucher_type === 'receipt' || v.voucher_type === 'payment') && (
                <>
                  <Detail label={v.voucher_type === 'receipt' ? t('vouchers.receivedFrom') : t('vouchers.paidTo')}>{v.party_name}</Detail>
                  <Detail label={t('vouchers.paymentMethod')}>{v.payment_method ? t(`paymentMethods.${v.payment_method}`) : null}</Detail>
                  <Detail label={t('vouchers.chequeNumber')}>{v.cheque_number}</Detail>
                  <Detail label={t('vouchers.cashAccount')}>{accountRef(v.cash_account_id)}</Detail>
                  <Detail label={v.voucher_type === 'receipt' ? t('vouchers.counterAccount') : t('vouchers.debitAccount')}>{accountRef(v.counter_account_id)}</Detail>
                </>
              )}
              {v.voucher_type === 'transfer' && (
                <>
                  <Detail label={t('vouchers.fromAccount')}>{accountRef(v.from_account_id)}</Detail>
                  <Detail label={t('vouchers.toAccount')}>{accountRef(v.to_account_id)}</Detail>
                </>
              )}
              <Detail label={t('journal.reference')}>{v.reference_number}</Detail>
              <Detail label={t('vouchers.journalEntry')}>
                {v.journal_entry_id && <Link className="num text-accent hover:underline" to={`/journal/entries/${v.journal_entry_id}`}>{v.journal_entry_number}</Link>}
              </Detail>
              <Detail label={t('journal.createdBy')}>{v.created_by_name && `${v.created_by_name} · ${formatDateTime(v.created_at)}`}</Detail>
              <Detail label={t('journal.approvedBy')}>{v.approved_by_name}</Detail>
              <Detail label={t('journal.postedBy')}>{v.posted_by_name && `${v.posted_by_name} · ${formatDateTime(v.posted_at)}`}</Detail>
            </dl>
          </Card>
          <Card className="flex flex-col justify-between p-5">
            <div>
              <p className="text-[12px] text-muted">{t('vouchers.amount')}</p>
              <p className="num mt-1 text-[26px] font-semibold tracking-[-0.01em]">
                {formatUnits(amount, { decimals: currency.decimals })} <span className="text-[14px] font-medium text-muted">{v.currency_code}</span>
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{amountInWords(amount, currency, language)}</p>
            </div>
            {v.notes && <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">{v.notes}</p>}
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title={t('vouchers.accountingEffect')} description={entry.data ? t('vouchers.postedEffect') : t('vouchers.accountingEffectHint')} />
          <JournalPresentation lines={lines} decimals={currency.decimals} />
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AttachmentsPanel entityType="voucher" entityId={v.id} attachments={v.attachments} editable={isDraft} onChanged={() => void query.refetch()} />
          <HistoryTimeline items={v.history} />
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'reverse'}
        onClose={() => setDialog(null)}
        title={t('journal.reverseTitle', { number: v.voucher_number })}
        description={t('vouchers.reverseDescription')}
        confirmLabel={t('journal.reverse')}
        withDate
        defaultDate={todayIso() < v.voucher_date ? v.voucher_date : todayIso()}
        minDate={v.voucher_date}
        loading={action.isPending}
        onConfirm={(reason, date) => void run({ type: 'reverse', id: v.id, reason, date }, t('journal.reversedToast'))}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('journal.rejectTitle', { number: v.voucher_number })}
        description={t('journal.rejectDescription')}
        confirmLabel={t('journal.reject')}
        confirmVariant="danger"
        loading={action.isPending}
        onConfirm={(reason) => void run({ type: 'reject', id: v.id, reason }, t('journal.rejectedToast'))}
      />
      <Dialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('journal.deleteTitle', { number: v.voucher_number })}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={action.isPending} onClick={() => void run({ type: 'delete', id: v.id }, t('journal.deletedToast'))}>{t('journal.deleteDraft')}</Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-soft">{t('journal.deleteBody')}</p>
      </Dialog>
      <ReportDialog
        open={dialog === 'print'}
        onClose={() => setDialog(null)}
        title={`${t(`voucherTypes.${v.voucher_type}`)} ${v.voucher_number}`}
        fileName={v.voucher_number}
        signaturesOption={false}
        generate={async ({ language: lng }) => {
          const journal = v.journal_entry_id ? await rpc<JournalEntryDetail>('get_journal_entry', { p_entry_id: v.journal_entry_id }) : null;
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(
            <pdf.VoucherDocument context={pdf.reportContext(lng, identity.company, identity.generatedBy)} decimals={currency.decimals} currency={currency} voucher={v} journalLines={journal?.lines ?? previewLines} />,
          );
        }}
      />
    </>
  );
}
