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
import { toUnits } from '@/lib/accounting';
import { formatDate, formatDateTime, formatPeriodName, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { useEntryAction, useJournalEntry } from './api';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { BalanceIndicator } from './components/BalanceIndicator';
import { HistoryTimeline } from './components/HistoryTimeline';
import { JournalPresentation } from './components/JournalPresentation';
import { ReasonDialog } from './components/ReasonDialog';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] text-ink">{children || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

export function EntryDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { language, isRtl } = useLanguage();
  const navigate = useNavigate();
  const toast = useToast();
  const { currency, can, settings } = useCompany();
  const identity = useReportIdentity();
  const query = useJournalEntry(id);
  const action = useEntryAction();
  const [dialog, setDialog] = useState<'reverse' | 'reject' | 'delete' | 'print' | null>(null);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return <Alert tone="danger">{errorMessage(query.error ?? new Error('ENTRY_NOT_FOUND'), t)}</Alert>;
  }
  const entry = query.data;
  const isDraft = entry.status === 'draft';
  const isPending = entry.status === 'pending_approval';
  const requireApproval = settings?.require_approval ?? true;
  const canPostDirectly = can('entries.post') && (!requireApproval || can('entries.approve'));

  const run = async (input: Parameters<typeof action.mutateAsync>[0], success: string) => {
    try {
      const result = await action.mutateAsync(input);
      toast.success(success);
      setDialog(null);
      if (input.type === 'delete') navigate('/journal', { replace: true });
      if (input.type === 'reverse' && typeof result === 'string') navigate(`/journal/entries/${result}`);
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  const lines = entry.lines.map((l) => ({
    key: l.id,
    accountCode: l.account_code,
    accountName: language === 'ar' ? l.account_name_ar : l.account_name_en,
    debit: toUnits(l.debit_amount),
    credit: toUnits(l.credit_amount),
    description: l.description,
  }));
  const totalDebit = toUnits(entry.total_debit);
  const totalCredit = toUnits(entry.total_credit);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/journal" className="inline-flex items-center gap-1.5 hover:text-ink">
            <BackIcon size={14} /> {t('rooms.journal.title')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="num">{entry.entry_number}</span>
            <StatusBadge status={entry.status} />
          </span>
        }
        subtitle={`${formatDate(entry.entry_date)} · ${t(`entryTypes.${entry.entry_type}`)}${entry.period_name ? ` · ${formatPeriodName(entry.period_name, language)}` : ''}`}
        actions={
          <>
            <Button icon={<Printer size={15} />} onClick={() => setDialog('print')}>
              {t('common.print')}
            </Button>
            {isDraft && can('entries.edit_draft') && entry.source !== 'voucher' && (
              <>
                <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setDialog('delete')}>
                  {t('journal.deleteDraft')}
                </Button>
                <ButtonLink to={`/journal/entries/${entry.id}/edit`} icon={<Pencil size={15} />}>
                  {t('common.edit')}
                </ButtonLink>
              </>
            )}
            {isDraft && can('entries.submit') && (requireApproval || !canPostDirectly) && (
              <Button variant="primary" icon={<Send size={15} />} loading={action.isPending} onClick={() => void run({ type: 'submit', id: entry.id }, t('journal.submittedToast'))}>
                {t('journal.submitForApproval')}
              </Button>
            )}
            {isDraft && canPostDirectly && (
              <Button variant="accent" icon={<CheckCheck size={15} />} loading={action.isPending} onClick={() => void run({ type: 'post', id: entry.id }, t('journal.postedToast'))}>
                {t('journal.postEntry')}
              </Button>
            )}
            {isPending && can('entries.approve') && (
              <>
                <Button variant="danger" icon={<X size={15} />} onClick={() => setDialog('reject')}>
                  {t('journal.reject')}
                </Button>
                <Button variant="accent" icon={<CheckCheck size={15} />} loading={action.isPending} onClick={() => void run({ type: 'approve', id: entry.id }, t('journal.postedToast'))}>
                  {t('journal.approveAndPost')}
                </Button>
              </>
            )}
            {entry.status === 'posted' && !entry.reversal_of_id && can('entries.reverse') && (
              <Button icon={<Undo2 size={15} />} onClick={() => setDialog('reverse')}>
                {t('journal.reverse')}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {isDraft && entry.rejection_reason && (
          <Alert tone="warning" title={t('journal.rejectedTitle')}>
            {entry.rejection_reason}
          </Alert>
        )}
        {isPending && (
          <Alert tone="info" title={t('journal.pendingTitle')}>
            {can('entries.approve') ? t('journal.pendingApprover') : t('journal.pendingPreparer')}
          </Alert>
        )}
        {entry.status === 'reversed' && entry.reversed_entry_id && (
          <Alert tone="danger" title={t('journal.reversedTitle')}>
            {t('journal.reversedBody', { date: formatDateTime(entry.reversed_at), name: entry.reversed_by_name ?? '' })}{' '}
            <Link className="num font-medium text-accent hover:underline" to={`/journal/entries/${entry.reversed_entry_id}`}>
              {entry.reversed_entry_number}
            </Link>
          </Alert>
        )}
        {entry.reversal_of_id && (
          <Alert tone="info" title={t('journal.reversalTitle')}>
            {t('journal.reversalBody')}{' '}
            <Link className="num font-medium text-accent hover:underline" to={`/journal/entries/${entry.reversal_of_id}`}>
              {entry.reversal_of_number}
            </Link>
          </Alert>
        )}

        <Card>
          <CardHeader title={t('journal.sections.details')} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-4">
            <Detail label={t('journal.entryNumber')}><span className="num">{entry.entry_number}</span></Detail>
            <Detail label={t('journal.entryDate')}><span className="num">{formatDate(entry.entry_date)}</span></Detail>
            <Detail label={t('journal.entryType')}>{t(`entryTypes.${entry.entry_type}`)}</Detail>
            <Detail label={t('journal.currency')}><span className="num">{entry.currency_code}</span></Detail>
            <Detail label={t('journal.voucherType')}>{entry.voucher_type ? t(`voucherTypes.${entry.voucher_type}`) : null}</Detail>
            <Detail label={t('journal.voucherNumber')}>
              {entry.voucher_id ? (
                <Link to={`/journal/vouchers/${entry.voucher_id}`} className="num text-accent hover:underline">{entry.voucher_number}</Link>
              ) : (
                entry.voucher_number && <span className="num">{entry.voucher_number}</span>
              )}
            </Detail>
            <Detail label={t('journal.reference')}>{entry.reference_number}</Detail>
            <Detail label={t('journal.period')}>{entry.period_name ? formatPeriodName(entry.period_name, language) : null}</Detail>
            <Detail label={t('journal.createdBy')}>{entry.created_by_name && `${entry.created_by_name} · ${formatDateTime(entry.created_at)}`}</Detail>
            <Detail label={t('journal.approvedBy')}>{entry.approved_by_name && `${entry.approved_by_name} · ${formatDateTime(entry.approved_at)}`}</Detail>
            <Detail label={t('journal.postedBy')}>{entry.posted_by_name && `${entry.posted_by_name} · ${formatDateTime(entry.posted_at)}`}</Detail>
            <Detail label={t('journal.source')}>{t(`journal.sources.${entry.source}`)}</Detail>
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={t('journal.sections.journal')} description={entry.description} />
          <JournalPresentation lines={lines} decimals={currency.decimals} />
          <div className="border-t border-line p-5">
            <BalanceIndicator totalDebit={totalDebit} totalCredit={totalCredit} decimals={currency.decimals} />
          </div>
        </Card>

        {entry.notes && (
          <Card>
            <CardHeader title={t('journal.notes')} />
            <p className="whitespace-pre-wrap px-5 py-4 text-[13.5px] text-ink-soft">{entry.notes}</p>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AttachmentsPanel entityType="journal_entry" entityId={entry.id} attachments={entry.attachments} editable={isDraft} onChanged={() => void query.refetch()} />
          <HistoryTimeline items={entry.history} />
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'reverse'}
        onClose={() => setDialog(null)}
        title={t('journal.reverseTitle', { number: entry.entry_number })}
        description={t('journal.reverseDescription')}
        confirmLabel={t('journal.reverse')}
        withDate
        defaultDate={todayIso() < entry.entry_date ? entry.entry_date : todayIso()}
        minDate={entry.entry_date}
        loading={action.isPending}
        onConfirm={(reason, date) => void run({ type: 'reverse', id: entry.id, reason, date }, t('journal.reversedToast'))}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('journal.rejectTitle', { number: entry.entry_number })}
        description={t('journal.rejectDescription')}
        confirmLabel={t('journal.reject')}
        confirmVariant="danger"
        loading={action.isPending}
        onConfirm={(reason) => void run({ type: 'reject', id: entry.id, reason }, t('journal.rejectedToast'))}
      />
      <Dialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('journal.deleteTitle', { number: entry.entry_number })}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={action.isPending} onClick={() => void run({ type: 'delete', id: entry.id }, t('journal.deletedToast'))}>
              {t('journal.deleteDraft')}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-soft">{t('journal.deleteBody')}</p>
      </Dialog>
      <ReportDialog
        open={dialog === 'print'}
        onClose={() => setDialog(null)}
        title={`${t('pdf.entry.title')} ${entry.entry_number}`}
        fileName={entry.entry_number}
        signaturesOption={false}
        generate={async ({ language: lng }) => {
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(<pdf.JournalEntryDocument context={pdf.reportContext(lng, identity.company, identity.generatedBy)} decimals={currency.decimals} entry={entry} />);
        }}
      />
    </>
  );
}
