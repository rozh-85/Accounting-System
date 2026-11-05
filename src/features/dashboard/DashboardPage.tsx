import { CircleAlert, CircleCheck, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Table, Td, Th, THead, Tr } from '@/components/tables/Table';
import { Badge, PeriodStatusBadge, StatusBadge, type BadgeTone } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useAccountCategories, useAccounts, useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { buildFinancialPosition, closingNet, formatUnits, sumsByAccount, unitsToNumber, type AccountBalanceRow, type Units } from '@/lib/accounting';
import { formatAmount, formatDate, formatDateTime, formatLongDate, formatPeriodName, todayIso } from '@/lib/formatting';
import { rpc } from '@/lib/supabase/rpc';
import type { JournalListRow } from '@/types/database';
import { REPORTS } from '@/features/reports/ReportsPage';
import { TileGrid, type TileMetric } from './OverviewTiles';
import { TILES, useOverviewTiles, type TileKey } from './tiles';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const RECENT_LIMIT = 8;

/** Key balances and ledger checks as of today, from posted entries only. */
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
    let debits = 0n;
    let credits = 0n;
    for (const account of accounts) {
      const sums = balances.data.get(account.id);
      if (!sums || !account.is_posting) continue;
      debits += sums.openingDebit + sums.periodDebit;
      credits += sums.openingCredit + sums.periodCredit;
      if (account.category_code && cashCategories.has(account.category_code)) cash += closingNet(sums);
    }
    return {
      cash,
      totalAssets: statement.totals.totalAssets,
      totalLiabilities: statement.totals.totalLiabilities,
      netResult: statement.totals.currentProfit,
      trialBalanceAgrees: debits === credits,
      positionAgrees: statement.isBalanced,
    };
  }, [balances.data, accounts, categories]);

  return { figures, isLoading: balances.isLoading };
}

type FigureTone = 'info' | 'accent' | 'orange' | 'success' | 'danger';
const figureTone: Record<FigureTone, { bar: string; value: string }> = {
  info: { bar: 'bg-info', value: 'text-info' },
  accent: { bar: 'bg-accent', value: 'text-accent' },
  orange: { bar: 'bg-orange', value: 'text-orange' },
  success: { bar: 'bg-success', value: 'text-success' },
  danger: { bar: 'bg-danger', value: 'text-danger' },
};

function Figure({ label, value, caption, tone }: { label: string; value: ReactNode; caption: ReactNode; tone: FigureTone }) {
  return (
    <div className="relative bg-surface py-4 ps-6 pe-5">
      <span className={clsx('absolute inset-y-4 start-0 w-[3px] rounded-e-full', figureTone[tone].bar)} aria-hidden="true" />
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className={clsx('num mt-1 text-[20px] font-semibold leading-tight', figureTone[tone].value)}>{value}</dd>
      <dd className="mt-1 text-[11.5px] text-faint">{caption}</dd>
    </div>
  );
}

function PanelRow({ label, children, to, dot }: { label: string; children: ReactNode; to?: string; dot?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-2.5 text-ink-soft">
        {dot && <span className={clsx('h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden="true" />}
        {label}
      </span>
      <span className="text-end font-medium text-ink">{children}</span>
    </>
  );
  const className = 'flex min-h-11 items-center justify-between gap-4 px-5 py-2 text-[13px]';
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

function CountBadge({ value, tone }: { value: number | undefined; tone: BadgeTone }) {
  if (value === undefined) return <span className="text-faint">—</span>;
  return (
    <Badge tone={value > 0 ? tone : 'neutral'} dot={false} className="num min-w-8 justify-center">
      {value}
    </Badge>
  );
}

function CheckBadge({ ok }: { ok: boolean | undefined }) {
  const { t } = useTranslation();
  if (ok === undefined) return <span className="text-faint">—</span>;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[12.5px] font-semibold', ok ? 'text-success' : 'text-danger')}>
      {ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
      {ok ? t('dashboard.balanced') : t('dashboard.outOfBalance')}
    </span>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const navigate = useNavigate();
  const { company, companyId, currency, can } = useCompany();
  const summary = useDashboardSummary();
  const data = summary.data;
  const period = data?.current_period ?? null;
  const today = todayIso();
  const { figures, isLoading: figuresLoading } = useKeyFigures(period?.fiscal_year_start ?? null);

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

  const asOfCaption = t('dashboard.asOf', { date: formatDate(today) });
  const ytdCaption = period ? t('dashboard.range', { from: formatDate(period.fiscal_year_start), to: formatDate(today) }) : asOfCaption;
  const netResult = figures?.netResult;
  const isLoss = netResult !== undefined && netResult < 0n;

  const { accounts } = useAccounts();
  const { selected } = useOverviewTiles();
  const tiles = TILES.filter((tile) => selected.includes(tile.key) && (!tile.permission || can(tile.permission)));
  const pendingTotal = data ? data.entries.pending_approval + data.vouchers.pending_approval : undefined;
  const metrics: Partial<Record<TileKey, TileMetric>> = {
    journal:
      pendingTotal === undefined
        ? undefined
        : { value: pendingTotal, label: t('dashboard.tiles.pending'), tone: pendingTotal > 0 ? 'text-warning' : undefined },
    ledger: data ? { value: data.posting_accounts, label: t('dashboard.tiles.postingAccounts') } : undefined,
    trialBalance:
      figures === null
        ? undefined
        : {
            value: figures.trialBalanceAgrees ? t('dashboard.balanced') : t('dashboard.outOfBalance'),
            label: t('dashboard.tiles.debitsCredits'),
            tone: figures.trialBalanceAgrees ? 'text-success' : 'text-danger',
          },
    financialPosition:
      figures === null
        ? undefined
        : { value: compactNumber.format(unitsToNumber(figures.totalAssets)), label: `${t('dashboard.totalAssets')} · ${currency.code}` },
    accounts: accounts.length ? { value: accounts.length, label: t('dashboard.tiles.accounts') } : undefined,
    vouchers: data ? { value: data.vouchers.draft + data.vouchers.pending_approval, label: t('dashboard.tiles.notPosted') } : undefined,
    reports: { value: REPORTS.length, label: t('dashboard.tiles.templates') },
    periods: data ? { value: data.open_periods, label: t('dashboard.tiles.openPeriods') } : undefined,
  };

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

      {tiles.length > 0 && (
        <section aria-labelledby="overview-tiles" className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="overview-tiles" className="text-[14px] font-semibold text-ink">
              {t('dashboard.tiles.heading')}
            </h2>
            <Link to="/settings?tab=overview" className="text-[12.5px] font-medium text-accent hover:underline">
              {t('dashboard.tiles.customize')}
            </Link>
          </div>
          <TileGrid tiles={tiles} metrics={metrics} />
        </section>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          className="bg-subtle"
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
            <Figure tone="info" label={t('dashboard.cash')} value={money(figures?.cash)} caption={asOfCaption} />
            <Figure tone="accent" label={t('dashboard.totalAssets')} value={money(figures?.totalAssets)} caption={asOfCaption} />
            <Figure tone="orange" label={t('dashboard.totalLiabilities')} value={money(figures?.totalLiabilities)} caption={asOfCaption} />
            <Figure
              tone={isLoss ? 'danger' : 'success'}
              label={isLoss ? t('dashboard.netLoss') : t('dashboard.netProfit')}
              value={money(netResult)}
              caption={ytdCaption}
            />
          </dl>
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 self-start overflow-hidden">
          <CardHeader
            className="bg-subtle"
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
                      <Link to={`/journal/entries/${row.id}`} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
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
            <CardHeader className="bg-subtle" title={t('dashboard.workQueue')} />
            <ul>
              <PanelRow dot="bg-[#d08a1c]" label={t('dashboard.entriesPending')} to="/journal?status=pending_approval">
                <CountBadge value={data?.entries.pending_approval} tone="warning" />
              </PanelRow>
              <PanelRow dot="bg-[#d08a1c]" label={t('dashboard.vouchersPending')} to="/journal/vouchers?status=pending_approval">
                <CountBadge value={data?.vouchers.pending_approval} tone="warning" />
              </PanelRow>
              <PanelRow dot="bg-faint" label={t('dashboard.draftEntries')} to="/journal?status=draft">
                <CountBadge value={data?.entries.draft} tone="accent" />
              </PanelRow>
              <PanelRow dot="bg-faint" label={t('dashboard.draftVouchers')} to="/journal/vouchers?status=draft">
                <CountBadge value={data?.vouchers.draft} tone="accent" />
              </PanelRow>
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="bg-subtle" title={t('dashboard.checks')} />
            <ul>
              <PanelRow label={t('dashboard.trialBalanceCheck')} to="/trial-balance">
                <CheckBadge ok={figures?.trialBalanceAgrees} />
              </PanelRow>
              <PanelRow label={t('dashboard.positionCheck')} to="/financial-position">
                <CheckBadge ok={figures?.positionAgrees} />
              </PanelRow>
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="bg-subtle" title={t('dashboard.periodPanel')} />
            <ul>
              <PanelRow label={t('dashboard.fiscalYear')}>{period?.fiscal_year_name ?? '—'}</PanelRow>
              <PanelRow label={t('dashboard.period')}>
                <span className="text-accent">{period ? formatPeriodName(period.name, language) : '—'}</span>
              </PanelRow>
              <PanelRow label={t('dashboard.dates')}>
                {period ? (
                  <span className="whitespace-nowrap">{t('dashboard.range', { from: formatDate(period.start_date), to: formatDate(period.end_date) })}</span>
                ) : (
                  '—'
                )}
              </PanelRow>
              <PanelRow label={t('dashboard.status')}>{period ? <PeriodStatusBadge status={period.status} /> : '—'}</PanelRow>
              <PanelRow label={t('dashboard.postedEntries')}>
                <span className="num">{data ? data.entries.posted + data.entries.reversed : '—'}</span>
              </PanelRow>
              <PanelRow label={t('dashboard.lastPosting')}>
                <span className="num">{data?.last_posted_at ? formatDateTime(data.last_posted_at) : '—'}</span>
              </PanelRow>
            </ul>
            <PanelFooter to="/periods">{t('dashboard.managePeriods')}</PanelFooter>
          </Card>
        </div>
      </div>
    </>
  );
}
