import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Table, Td, Th, THead, Tr } from '@/components/tables/Table';
import { PeriodStatusBadge, StatusBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useAccountCategories, useAccounts, useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { buildFinancialPosition, closingNet, formatUnits, sumsByAccount, type AccountBalanceRow, type Units } from '@/lib/accounting';
import { formatAmount, formatDate, formatDateTime, formatLongDate, formatPeriodName, todayIso } from '@/lib/formatting';
import { rpc } from '@/lib/supabase/rpc';
import type { JournalListRow } from '@/types/database';
import { ROOMS } from './rooms';

const RECENT_LIMIT = 8;

/** Key balances as of today, from posted entries only. */
function useKeyFigures(fiscalYearStart: string | null) {
  const { companyId } = useCompany();
  const { accounts } = useAccounts();
  const { categories } = useAccountCategories();
  const today = todayIso();

  const balances = useQuery({
    queryKey: ['dashboard-balances', companyId, fiscalYearStart, today],
    queryFn: async () =>
      sumsByAccount(
        await rpc<AccountBalanceRow[]>('account_balances', { p_company_id: companyId, p_from: fiscalYearStart, p_to: today, p_mode: 'all' }),
      ),
  });

  const figures = useMemo(() => {
    if (!balances.data || !accounts.length || !categories.length) return null;
    const statement = buildFinancialPosition(accounts, categories, { sums: balances.data }, null, {});
    const cashCategories = new Set(categories.filter((c) => c.is_cash_equivalent).map((c) => c.code));
    let cash = 0n;
    for (const account of accounts) {
      if (!account.is_posting || !account.category_code || !cashCategories.has(account.category_code)) continue;
      const sums = balances.data.get(account.id);
      if (sums) cash += closingNet(sums);
    }
    return {
      cash,
      totalAssets: statement.totals.totalAssets,
      totalLiabilities: statement.totals.totalLiabilities,
      netResult: statement.totals.currentProfit,
    };
  }, [balances.data, accounts, categories]);

  return { figures, isLoading: balances.isLoading };
}

function Figure({ label, value, caption, negative }: { label: string; value: ReactNode; caption: ReactNode; negative?: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={clsx('num mt-1 text-[19px] font-semibold leading-tight', negative ? 'text-danger' : 'text-ink')}>{value}</dd>
      <dd className="mt-1 text-[11.5px] text-faint">{caption}</dd>
    </div>
  );
}

function PanelRow({ label, children, to }: { label: string; children: ReactNode; to?: string }) {
  const body = (
    <>
      <span className="text-muted">{label}</span>
      <span className="text-end font-medium text-ink">{children}</span>
    </>
  );
  const className = 'flex min-h-10 items-center justify-between gap-4 px-5 py-2 text-[13px]';
  return (
    <li className="border-b border-line last:border-b-0">
      {to ? (
        <Link to={to} className={clsx(className, 'hover:bg-subtle')}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

function PanelFooter({ to, children }: { to: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-5 py-2.5">
      <Link to={to} className="text-[12.5px] font-medium text-accent hover:underline">
        {children}
      </Link>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { language, name, isRtl } = useLanguage();
  const navigate = useNavigate();
  const { company, companyId, currency, can } = useCompany();
  const summary = useDashboardSummary();
  const data = summary.data;
  const period = data?.current_period ?? null;
  const today = todayIso();
  const { figures, isLoading: figuresLoading } = useKeyFigures(period?.fiscal_year_start ?? null);
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  const recent = useQuery({
    queryKey: ['journal', companyId, 'recent', RECENT_LIMIT],
    queryFn: () => rpc<JournalListRow[]>('search_journal_entries', { p_company_id: companyId, p_limit: RECENT_LIMIT, p_offset: 0 }),
  });

  const money = (units: Units | undefined) =>
    units === undefined ? (
      '—'
    ) : (
      <span dir="ltr" className="inline-flex items-baseline gap-1.5">
        {formatUnits(units, { decimals: currency.decimals, parentheses: true })}
        <span className="text-[12px] font-normal text-muted">{currency.code}</span>
      </span>
    );
  const count = (value: number | undefined, highlight = false) => (
    <span className={clsx('num', highlight && (value ?? 0) > 0 && 'text-warning')}>{value ?? '—'}</span>
  );

  const asOfCaption = t('dashboard.asOf', { date: formatDate(today) });
  const ytdCaption = period ? t('dashboard.range', { from: formatDate(period.fiscal_year_start), to: formatDate(today) }) : asOfCaption;
  const netResult = figures?.netResult;
  const isLoss = netResult !== undefined && netResult < 0n;

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(today, language)}
        title={name(company)}
        subtitle={
          period
            ? t('dashboard.subtitle', { year: period.fiscal_year_name, period: formatPeriodName(period.name, language) })
            : t('dashboard.noPeriod')
        }
        actions={
          can('entries.create') && (
            <>
              <ButtonLink to="/journal/vouchers/new?type=receipt">{t('dashboard.newReceipt')}</ButtonLink>
              <ButtonLink to="/journal/vouchers/new?type=payment">{t('dashboard.newPayment')}</ButtonLink>
              <ButtonLink to="/journal/entries/new" variant="primary" icon={<Plus size={15} />}>
                {t('journal.newEntry')}
              </ButtonLink>
            </>
          )
        }
      />

      <Card className="overflow-hidden">
        <CardHeader
          title={t('dashboard.financialSummary')}
          description={t('dashboard.summaryNote')}
          actions={
            <Link to="/financial-position" className="text-[12.5px] font-medium text-accent hover:underline">
              {t('dashboard.viewStatement')}
            </Link>
          }
        />
        {figuresLoading ? (
          <div className="flex h-[92px] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
            <Figure label={t('dashboard.cash')} value={money(figures?.cash)} caption={asOfCaption} negative={(figures?.cash ?? 0n) < 0n} />
            <Figure label={t('dashboard.totalAssets')} value={money(figures?.totalAssets)} caption={asOfCaption} />
            <Figure label={t('dashboard.totalLiabilities')} value={money(figures?.totalLiabilities)} caption={asOfCaption} />
            <Figure label={isLoss ? t('dashboard.netLoss') : t('dashboard.netProfit')} value={money(netResult)} caption={ytdCaption} negative={isLoss} />
          </dl>
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 self-start overflow-hidden">
          <CardHeader
            title={t('dashboard.recentEntries')}
            actions={
              <Link to="/journal" className="text-[12.5px] font-medium text-accent hover:underline">
                {t('common.viewAll')}
              </Link>
            }
          />
          {recent.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : (recent.data?.length ?? 0) === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-muted">{t('dashboard.noEntries')}</p>
          ) : (
            <Table minWidth={640}>
              <THead>
                <tr>
                  <Th>{t('journal.entryNumber')}</Th>
                  <Th>{t('journal.date')}</Th>
                  <Th className="w-[44%]">{t('journal.description')}</Th>
                  <Th numeric>{t('journal.amount')}</Th>
                  <Th>{t('journal.status')}</Th>
                </tr>
              </THead>
              <tbody>
                {recent.data!.map((row) => (
                  <Tr key={row.id} interactive onClick={() => navigate(`/journal/entries/${row.id}`)}>
                    <Td className="num font-medium whitespace-nowrap">
                      <Link to={`/journal/entries/${row.id}`} className="hover:text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                        {row.entry_number}
                      </Link>
                    </Td>
                    <Td className="num whitespace-nowrap text-ink-soft">{formatDate(row.entry_date)}</Td>
                    <Td className="max-w-0">
                      <span className="block truncate text-ink-soft">{row.description}</span>
                    </Td>
                    <Td numeric className="font-medium">
                      {formatAmount(row.total_debit, currency.decimals)}
                    </Td>
                    <Td>
                      <StatusBadge status={row.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card className="overflow-hidden">
            <CardHeader title={t('dashboard.workQueue')} />
            <ul>
              <PanelRow label={t('dashboard.entriesPending')} to="/journal?status=pending_approval">
                {count(data?.entries.pending_approval, true)}
              </PanelRow>
              <PanelRow label={t('dashboard.vouchersPending')} to="/journal/vouchers?status=pending_approval">
                {count(data?.vouchers.pending_approval, true)}
              </PanelRow>
              <PanelRow label={t('dashboard.draftEntries')} to="/journal?status=draft">
                {count(data?.entries.draft)}
              </PanelRow>
              <PanelRow label={t('dashboard.draftVouchers')} to="/journal/vouchers?status=draft">
                {count(data?.vouchers.draft)}
              </PanelRow>
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title={t('dashboard.periodPanel')} />
            <ul>
              <PanelRow label={t('dashboard.fiscalYear')}>{period?.fiscal_year_name ?? '—'}</PanelRow>
              <PanelRow label={t('dashboard.period')}>{period ? formatPeriodName(period.name, language) : '—'}</PanelRow>
              <PanelRow label={t('dashboard.dates')}>
                {period ? <span className="whitespace-nowrap">{t('dashboard.range', { from: formatDate(period.start_date), to: formatDate(period.end_date) })}</span> : '—'}
              </PanelRow>
              <PanelRow label={t('dashboard.status')}>{period ? <PeriodStatusBadge status={period.status} /> : '—'}</PanelRow>
              <PanelRow label={t('dashboard.postedEntries')}>{count(data ? data.entries.posted + data.entries.reversed : undefined)}</PanelRow>
              <PanelRow label={t('dashboard.lastPosting')}>
                <span className="num">{data?.last_posted_at ? formatDateTime(data.last_posted_at) : '—'}</span>
              </PanelRow>
            </ul>
            <PanelFooter to="/periods">{t('dashboard.managePeriods')}</PanelFooter>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title={t('dashboard.rooms')} />
            <ul>
              {ROOMS.map((room) => (
                <li key={room.key} className="border-b border-line last:border-b-0">
                  <Link to={room.path} className="flex min-h-10 items-center gap-3 px-5 py-2 text-[13px] hover:bg-subtle">
                    <span className="num w-6 shrink-0 text-[12px] text-faint">{room.number}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{t(`rooms.${room.key}.title`)}</span>
                    <Chevron size={15} className="shrink-0 text-faint" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
