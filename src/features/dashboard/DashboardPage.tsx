import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Card, PageHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { formatAmount, formatDate, formatDateTime, formatLongDate, formatPeriodName, todayIso } from '@/lib/formatting';
import { rpc } from '@/lib/supabase/rpc';
import type { JournalListRow } from '@/types/database';
import { ROOMS, type RoomDefinition } from './rooms';

function RoomCard({ room, meta }: { room: RoomDefinition; meta?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const Arrow = isRtl ? ArrowLeft : ArrowRight;
  const secondaryLang = isRtl ? 'en' : 'ar';
  const Icon = room.icon;

  return (
    <Link
      to={room.path}
      className="group flex min-h-[214px] flex-col rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong focus-visible:border-accent"
    >
      <div className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-ink-soft transition-colors group-hover:border-line-strong group-hover:text-ink">
          <Icon size={19} strokeWidth={1.6} />
        </span>
        <span className="num text-[12px] font-medium tracking-[0.08em] text-faint">{t('dashboard.room')} {room.number}</span>
      </div>

      <div className="mt-5 pb-5">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{t(`rooms.${room.key}.title`)}</h2>
        <p lang={secondaryLang} dir={secondaryLang === 'ar' ? 'rtl' : 'ltr'} className={secondaryLang === 'ar' ? 'font-ar mt-0.5 text-[14px] text-muted' : 'mt-0.5 text-[13px] text-muted'}>
          {t(`rooms.${room.key}.title`, { lng: secondaryLang })}
        </p>
        <p className="mt-3 max-w-[46ch] text-[13px] leading-relaxed text-ink-soft">{t(`rooms.${room.key}.description`)}</p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
          {t(`rooms.${room.key}.action`)}
          <Arrow size={15} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
        </span>
        {meta && <span className="text-[12px] text-muted">{meta}</span>}
      </div>
    </Link>
  );
}

function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const body = (
    <>
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className="num mt-1.5 text-[20px] font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="block bg-surface px-5 py-4 transition-colors hover:bg-subtle">
      {body}
    </Link>
  ) : (
    <div className="bg-surface px-5 py-4">{body}</div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const { company, companyId, currency, can } = useCompany();
  const summary = useDashboardSummary();
  const data = summary.data;
  const period = data?.current_period;

  const pending = useQuery({
    queryKey: ['journal', companyId, 'pending-preview'],
    enabled: (data?.entries.pending_approval ?? 0) > 0,
    queryFn: () =>
      rpc<JournalListRow[]>('search_journal_entries', {
        p_company_id: companyId,
        p_statuses: ['pending_approval'],
        p_limit: 5,
        p_offset: 0,
      }),
  });

  const meta: Record<RoomDefinition['key'], ReactNode> = {
    journal: data ? t('dashboard.journalMeta', { count: data.entries.pending_approval }) : null,
    ledger: data ? t('dashboard.ledgerMeta', { count: data.posting_accounts }) : null,
    trialBalance: period ? formatPeriodName(period.name, language) : null,
    financialPosition: t('dashboard.asOf', { date: formatDate(todayIso()) }),
  };

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(todayIso(), language)}
        title={name(company)}
        subtitle={
          period
            ? t('dashboard.subtitle', {
                year: period.fiscal_year_name,
                period: formatPeriodName(period.name, language),
              })
            : t('dashboard.noPeriod')
        }
      />

      <section aria-label={t('nav.rooms')} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5">
        {ROOMS.map((room) => (
          <RoomCard key={room.key} room={room} meta={meta[room.key]} />
        ))}
      </section>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[var(--shadow-card)] lg:grid-cols-4">
        <Stat label={t('dashboard.postedEntries')} value={data ? data.entries.posted + data.entries.reversed : '—'} hint={data?.last_posted_at ? t('dashboard.lastPosted', { date: formatDateTime(data.last_posted_at) }) : t('dashboard.nothingPosted')} to="/journal?status=posted" />
        <Stat label={t('dashboard.drafts')} value={data ? data.entries.draft + data.vouchers.draft : '—'} hint={t('dashboard.draftsHint')} to="/journal?status=draft" />
        <Stat label={t('dashboard.pendingApproval')} value={data ? data.entries.pending_approval + data.vouchers.pending_approval : '—'} hint={t('dashboard.pendingHint')} to="/journal?status=pending_approval" />
        <Stat
          label={t('dashboard.currentPeriod')}
          value={period ? formatPeriodName(period.name, language) : '—'}
          hint={period ? `${formatDate(period.start_date)} – ${formatDate(period.end_date)} · ${t(`periods.status.${period.status}`)}` : t('dashboard.noPeriod')}
          to="/periods"
        />
      </div>

      {can('entries.approve') && (pending.data?.length ?? 0) > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-semibold">{t('dashboard.awaitingApproval')}</h2>
            <Link to="/journal?status=pending_approval" className="text-[12.5px] font-medium text-accent hover:underline">
              {t('common.viewAll')}
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {pending.data!.map((row) => (
              <li key={row.id}>
                <Link to={`/journal/entries/${row.id}`} className="flex items-center gap-4 px-5 py-3 text-[13px] hover:bg-subtle">
                  <span className="num w-[120px] shrink-0 font-medium text-ink">{row.entry_number}</span>
                  <span className="num w-[86px] shrink-0 text-muted">{formatDate(row.entry_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft">{row.description}</span>
                  <span className="num shrink-0 font-medium">{formatAmount(row.total_debit, currency.decimals)}</span>
                  <StatusBadge status={row.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
