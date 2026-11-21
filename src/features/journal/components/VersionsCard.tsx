import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Card, CardHeader } from '@/components/ui/Card';
import { useAccounts } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { formatUnits } from '@/lib/accounting';
import { formatDate, formatDateTime, formatRate } from '@/lib/formatting';
import type { JournalEntryDetail } from '@/types/database';
import { buildVersions, type Amounts, type VersionChange, type VersionField } from '../versions';

const FIELD_LABELS: Record<VersionField, string> = {
  entry_date: 'journal.entryDate',
  entry_type: 'journal.entryType',
  description: 'journal.description',
  reference: 'journal.reference',
  notes: 'journal.notes',
  voucher_number: 'journal.voucherNumber',
  foreign_currency: 'journal.currency',
  exchange_rate: 'journal.exchangeRate',
};

/** One colour per person, so edits by different users are easy to tell apart. */
const PERSON_TONES = [
  'bg-accent-soft text-accent-strong',
  'bg-success-soft text-success-strong',
  'bg-purple-soft text-purple',
  'bg-orange-soft text-orange',
  'bg-primary-soft text-primary-strong',
];

function initials(name: string | null) {
  const parts = (name ?? '').replace(/@.*/, '').trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

function Arrow() {
  return <ArrowRight size={12} className="mx-1 inline shrink-0 text-faint rtl:-scale-x-100" aria-hidden="true" />;
}

/** Every saved version of the entry, newest first, with who changed what and when. */
export function VersionsCard({ entry }: { entry: JournalEntryDetail }) {
  const { t } = useTranslation();
  const { name } = useLanguage();
  const { currency } = useCompany();
  const { accounts } = useAccounts();
  const versions = useMemo(() => buildVersions(entry), [entry]);
  const accountsByCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  const edits = versions.length - 1;

  const tones = new Map<string, string>();
  for (const v of versions) {
    const key = v.actorId ?? v.actorName ?? '';
    if (!tones.has(key)) tones.set(key, PERSON_TONES[tones.size % PERSON_TONES.length]);
  }

  const money = (units: bigint) => formatUnits(units, { decimals: currency.decimals });
  const account = (code: string) => {
    const a = accountsByCode.get(code);
    return (
      <span className="font-medium text-ink">
        <span className="num text-muted">{code}</span> {a ? name(a) : ''}
      </span>
    );
  };
  const side = (amounts: Amounts) =>
    amounts.debit > 0n ? `${t('journal.debit')} ${money(amounts.debit)}` : `${t('journal.credit')} ${money(amounts.credit)}`;

  const fieldValue = (field: VersionField, value: string | null): ReactNode => {
    if (value === null) return <span className="text-faint">—</span>;
    if (field === 'entry_date') return <span className="num">{formatDate(value)}</span>;
    if (field === 'entry_type') return t(`entryTypes.${value}`);
    if (field === 'exchange_rate') return <span className="num">{formatRate(value)}</span>;
    return value;
  };

  const describe = (change: VersionChange): ReactNode => {
    if (change.kind === 'field') {
      return (
        <>
          <span className="text-muted">{t(FIELD_LABELS[change.field])}:</span>{' '}
          <span className="text-muted line-through decoration-faint">{fieldValue(change.field, change.from)}</span>
          <Arrow />
          <span className="font-medium text-ink">{fieldValue(change.field, change.to)}</span>
        </>
      );
    }
    if (change.change === 'added') {
      return (
        <>
          <span className="font-medium text-success-strong">{t('versions.added')}</span> {account(change.account)} · <span className="num">{side(change.to!)}</span>
        </>
      );
    }
    if (change.change === 'removed') {
      return (
        <>
          <span className="font-medium text-danger">{t('versions.removed')}</span> {account(change.account)} · <span className="num">{side(change.from!)}</span>
        </>
      );
    }
    return (
      <>
        {account(change.account)}:{' '}
        <span className="num text-muted line-through decoration-faint">{side(change.from!)}</span>
        <Arrow />
        <span className="num font-medium text-ink">{side(change.to!)}</span>
      </>
    );
  };

  return (
    <Card>
      <CardHeader
        title={t('versions.title')}
        description={edits > 0 ? t('versions.summary', { count: edits, version: versions[versions.length - 1].label }) : t('versions.none')}
      />
      <ol>
        {[...versions].reverse().map((v) => (
          <li key={v.label} className="flex gap-3 border-t border-line px-5 py-3.5">
            <span
              className={clsx(
                'num mt-0.5 inline-flex h-6 min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold',
                v.label === versions[versions.length - 1].label ? 'bg-ink text-surface' : 'bg-hover text-ink-soft',
              )}
              title={t('versions.versionN', { version: v.label })}
            >
              {v.label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span
                  className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-full text-[10.5px] font-semibold', tones.get(v.actorId ?? v.actorName ?? ''))}
                  aria-hidden="true"
                >
                  {initials(v.actorName)}
                </span>
                <span className="font-medium text-ink">{v.actorName ?? t('audit.system')}</span>
                <span className="num text-muted">{formatDateTime(v.at)}</span>
                <span className="text-[12px] text-muted">
                  · {v.label === '1' ? t('versions.original') : v.afterPosting ? t('versions.editedPosted') : t('versions.editedDraft')}
                </span>
              </p>
              {v.label !== '1' && (
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-ink-soft">
                  {!v.recorded ? (
                    <li className="text-muted">{t('versions.notRecorded')}</li>
                  ) : v.changes.length === 0 ? (
                    <li className="text-muted">{t('versions.noChanges')}</li>
                  ) : (
                    v.changes.map((c, i) => <li key={i}>{describe(c)}</li>)
                  )}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
