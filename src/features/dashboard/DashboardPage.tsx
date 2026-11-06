import { clsx } from 'clsx';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CreditCard,
  Landmark,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
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
import {
  buildFinancialPosition,
  closingNet,
  formatUnits,
  sumsByAccount,
  unitsToNumber,
  type Account,
  type AccountBalanceRow,
  type AccountCategory,
  type AccountSums,
  type LedgerLineRow,
  type Units,
} from '@/lib/accounting';
import { addDays, formatAmount, formatDate, formatDateTime, formatLongDate, formatPeriodName, intlLocale, todayIso, type Language } from '@/lib/formatting';
import { rpc } from '@/lib/supabase/rpc';
import type { JournalListRow } from '@/types/database';
import { DonutChart, Legend, LineChart, formatCompact, type LinePoint } from './charts';

const RECENT_LIMIT = 6;
const TOP_EXPENSES = 5;

interface Figures {
  cash: Units;
  totalAssets: Units;
  totalLiabilities: Units;
  totalEquity: Units;
  netResult: Units;
  revenue: Units;
  expenses: Array<{ account: Account; amount: Units }>;
  trialBalanceAgrees: boolean;
  positionAgrees: boolean;
}

function computeFigures(accounts: Account[], categories: AccountCategory[], sums: ReadonlyMap<string, AccountSums>): Figures {
  const statement = buildFinancialPosition(accounts, categories, { sums }, null, {});
  const cashCategories = new Set(categories.filter((c) => c.is_cash_equivalent).map((c) => c.code));
  let cash = 0n;
  let debits = 0n;
  let credits = 0n;
  let revenue = 0n;
  const expenses: Array<{ account: Account; amount: Units }> = [];
  for (const account of accounts) {
    const s = sums.get(account.id);
    if (!s || !account.is_posting) continue;
    debits += s.openingDebit + s.periodDebit;
    credits += s.openingCredit + s.periodCredit;
    if (account.category_code && cashCategories.has(account.category_code)) cash += closingNet(s);
    if (account.account_type === 'revenue') revenue += s.periodCredit - s.periodDebit;
    if (account.account_type === 'expense') {
      const amount = s.periodDebit - s.periodCredit;
      if (amount !== 0n) expenses.push({ account, amount });
    }
  }
  expenses.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  return {
    cash,
    totalAssets: statement.totals.totalAssets,
    totalLiabilities: statement.totals.totalLiabilities,
    totalEquity: statement.totals.totalEquity,
    netResult: statement.totals.currentProfit,
    revenue,
    expenses,
    trialBalanceAgrees: debits === credits,
    positionAgrees: statement.isBalanced,
  };
}

/** Balances today and at the end of last month (fiscal year to date), from posted entries. */
function useFigures(fiscalYearStart: string | null) {
  const { companyId } = useCompany();
  const { accounts } = useAccounts();
  const { categories } = useAccountCategories();
  const today = todayIso();
  const previousEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  const hasPrevious = Boolean(fiscalYearStart && previousEnd >= fiscalYearStart);

  const load = (to: string) => rpc<AccountBalanceRow[]>('account_balances', { p_company_id: companyId, p_from: fiscalYearStart, p_to: to, p_mode: 'all' });
  const balances = useQuery({
    queryKey: ['dashboard-balances', companyId, fiscalYearStart, today, hasPrevious],
    queryFn: async () => {
      const [current, previous] = await Promise.all([load(today), hasPrevious ? load(previousEnd) : Promise.resolve(null)]);
      return { current: sumsByAccount(current), previous: previous ? sumsByAccount(previous) : null };
    },
  });

  const figures = useMemo(() => {
    if (!balances.data || !accounts.length || !categories.length) return null;
    return {
      current: computeFigures(accounts, categories, balances.data.current),
      previous: balances.data.previous ? computeFigures(accounts, categories, balances.data.previous) : null,
    };
  }, [balances.data, accounts, categories]);

  return { figures, isLoading: balances.isLoading };
}

/** Monthly cash receipts and payments for the fiscal year, excluding transfers between cash accounts. */
function useCashFlow(fiscalYearStart: string | null, language: Language) {
  const { companyId } = useCompany();
  const { accounts } = useAccounts();
  const { categories } = useAccountCategories();
  const today = todayIso();
  const cashIds = useMemo(() => {
    const cashCategories = new Set(categories.filter((c) => c.is_cash_equivalent).map((c) => c.code));
    return accounts.filter((a) => a.is_posting && a.category_code && cashCategories.has(a.category_code)).map((a) => a.id);
  }, [accounts, categories]);

  const lines = useQuery({
    queryKey: ['dashboard-cash-flow', companyId, fiscalYearStart, today, cashIds.join(',')],
    enabled: Boolean(fiscalYearStart) && cashIds.length > 0,
    queryFn: () => rpc<LedgerLineRow[]>('ledger_lines', { p_company_id: companyId, p_account_ids: cashIds, p_from: fiscalYearStart, p_to: today }),
  });

  const points = useMemo<LinePoint[]>(() => {
    if (!fiscalYearStart) return [];
    const cashSet = new Set(cashIds);
    const months: string[] = [];
    for (let m = fiscalYearStart.slice(0, 7); m <= today.slice(0, 7) && months.length < 12; ) {
      months.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    const totals = new Map(months.map((m) => [m, { inflow: 0n, outflow: 0n }]));
    for (const line of lines.data ?? []) {
      // Opening balances and transfers between cash accounts are not cash flows.
      if (line.entry_type === 'opening') continue;
      if (line.counter_account_id && cashSet.has(line.counter_account_id)) continue;
      const bucket = totals.get(line.entry_date.slice(0, 7));
      if (!bucket) continue;
      bucket.inflow += BigInt(Math.round(Number(line.debit_amount) * 10_000));
      bucket.outflow += BigInt(Math.round(Number(line.credit_amount) * 10_000));
    }
    const short = new Intl.DateTimeFormat(intlLocale(language), { month: 'short' });
    const long = new Intl.DateTimeFormat(intlLocale(language), { month: 'long', year: 'numeric' });
    return months.map((m) => {
      const date = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
      const t = totals.get(m)!;
      return { label: short.format(date), title: long.format(date), values: { inflow: unitsToNumber(t.inflow), outflow: unitsToNumber(t.outflow) } };
    });
  }, [lines.data, fiscalYearStart, today, cashIds, language]);

  return { points, isLoading: lines.isLoading && lines.fetchStatus !== 'idle', hasCashAccounts: cashIds.length > 0 };
}

/* ------------------------------------------------------------------ pieces */

type Tone = 'info' | 'accent' | 'orange' | 'success' | 'danger';
const toneClasses: Record<Tone, string> = {
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
  orange: 'bg-orange-soft text-orange',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
};

function ChangeChip({ current, previous, goodWhenUp = true }: { current: Units; previous: Units | null | undefined; goodWhenUp?: boolean }) {
  const { t } = useTranslation();
  if (previous === null || previous === undefined) return <span className="text-[12px] text-faint">{t('dashboard.noComparison')}</span>;
  const diff = current - previous;
  const base = previous < 0n ? -previous : previous;
  const percent = base === 0n ? null : (unitsToNumber(diff) / unitsToNumber(base)) * 100;
  const up = diff > 0n;
  const flat = diff === 0n;
  const good = flat ? null : up === goodWhenUp;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[12px]">
      <span
        className={clsx(
          'num inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full px-2 font-semibold',
          good === null ? 'bg-hover text-ink-soft' : good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
        )}
      >
        {!flat && <Arrow size={13} strokeWidth={2.2} />}
        {percent === null ? formatCompact(unitsToNumber(diff)) : `${Math.abs(percent).toFixed(1)}%`}
      </span>
      <span className="truncate text-muted">{t('dashboard.vsLastMonth')}</span>
    </span>
  );
}

function KpiCard({ label, value, icon: Icon, tone, footer, to }: { label: string; value: ReactNode; icon: LucideIcon; tone: Tone; footer: ReactNode; to: string }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="pt-0.5 text-[13px] font-medium leading-snug text-muted">{label}</p>
        <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', toneClasses[tone])}>
          <Icon size={19} strokeWidth={1.8} />
        </span>
      </div>
      <div className="num mt-2 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-ink 2xl:text-[26px]">{value}</div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        {footer}
        <Link to={to} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink" aria-label={label}>
          <ArrowRight size={15} className="rtl:-scale-x-100" />
        </Link>
      </div>
    </Card>
  );
}

function PanelRow({ label, children, to, dot }: { label: string; children: ReactNode; to?: string; dot?: string }) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2.5 text-ink-soft">
        {dot && <span className={clsx('h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-end font-medium text-ink">{children}</span>
    </>
  );
  const className = 'flex min-h-11 items-center justify-between gap-4 px-5 py-2 text-[13px] sm:px-6';
  return (
    <li className="border-b border-line last:border-b-0">
      {to ? (
        <Link to={to} className={clsx(className, 'transition-colors hover:bg-subtle')}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
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

function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-hover hover:text-ink">
      {children}
    </Link>
  );
}

function Loading({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <Spinner />
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export function DashboardPage() {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const navigate = useNavigate();
  const { companyId, currency, can } = useCompany();
  const summary = useDashboardSummary();
  const data = summary.data;
  const period = data?.current_period ?? null;
  const fiscalYearStart = period?.fiscal_year_start ?? null;
  const today = todayIso();
  const { figures, isLoading: figuresLoading } = useFigures(fiscalYearStart);
  const cashFlow = useCashFlow(fiscalYearStart, language);

  const recent = useQuery({
    queryKey: ['journal', companyId, 'recent', RECENT_LIMIT],
    queryFn: () => rpc<JournalListRow[]>('search_journal_entries', { p_company_id: companyId, p_limit: RECENT_LIMIT, p_offset: 0 }),
  });

  const amount = (units: Units | undefined) =>
    units === undefined ? (
      '—'
    ) : (
      <span dir="ltr" className="inline-flex items-baseline gap-1.5">
        {formatUnits(units, { decimals: currency.decimals, parentheses: true })}
        <span className="text-[13px] font-medium text-muted">{currency.code}</span>
      </span>
    );

  const now = figures?.current;
  const before = figures?.previous;
  const isLoss = now !== undefined && now.netResult < 0n;
  const monthResult = now && before ? now.netResult - before.netResult : null;

  const series = [
    { key: 'inflow', label: t('dashboard.cashIn'), color: 'var(--color-chart-1)' },
    { key: 'outflow', label: t('dashboard.cashOut'), color: 'var(--color-chart-2)' },
  ];
  const cashTotals = cashFlow.points.reduce((acc, p) => ({ inflow: acc.inflow + p.values.inflow, outflow: acc.outflow + p.values.outflow }), { inflow: 0, outflow: 0 });

  const funding = now
    ? [
        { key: 'liabilities', label: t('dashboard.liabilities'), value: unitsToNumber(now.totalLiabilities), color: 'var(--color-chart-2)' },
        { key: 'equity', label: t('dashboard.equity'), value: unitsToNumber(now.totalEquity), color: 'var(--color-chart-3)' },
      ]
    : [];
  const fundingTotal = funding.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const equityShare = fundingTotal > 0 ? Math.round((Math.max(funding[1].value, 0) / fundingTotal) * 100) : null;

  const expenseTotal = now ? now.expenses.reduce((sum, e) => sum + e.amount, 0n) : 0n;
  const topExpenses = now ? now.expenses.slice(0, TOP_EXPENSES) : [];
  const otherExpenses = now ? now.expenses.slice(TOP_EXPENSES).reduce((sum, e) => sum + e.amount, 0n) : 0n;

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(today, language)}
        title={t('nav.overview')}
        subtitle={
          period
            ? t('dashboard.subtitle', { year: period.fiscal_year_name, period: formatPeriodName(period.name, language) })
            : t('dashboard.noPeriod')
        }
        actions={
          can('entries.create') && (
            <>
              <ButtonLink to="/journal/vouchers/new?type=receipt" className="max-sm:flex-1">
                {t('dashboard.newReceipt')}
              </ButtonLink>
              <ButtonLink to="/journal/vouchers/new?type=payment" className="max-sm:flex-1">
                {t('dashboard.newPayment')}
              </ButtonLink>
              <ButtonLink to="/journal/entries/new" variant="primary" icon={<Plus size={16} />} className="max-sm:w-full">
                {t('journal.newEntry')}
              </ButtonLink>
            </>
          )
        }
      />

      {/* Key figures */}
      <section aria-label={t('dashboard.financialSummary')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-6">
        {figuresLoading || !now ? (
          Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <Loading height={150} />
            </Card>
          ))
        ) : (
          <>
            <KpiCard label={t('dashboard.cash')} value={amount(now.cash)} icon={Wallet} tone="info" to="/ledger" footer={<ChangeChip current={now.cash} previous={before?.cash} />} />
            <KpiCard
              label={t('dashboard.totalAssets')}
              value={amount(now.totalAssets)}
              icon={Landmark}
              tone="accent"
              to="/financial-position"
              footer={<ChangeChip current={now.totalAssets} previous={before?.totalAssets} />}
            />
            <KpiCard
              label={t('dashboard.totalLiabilities')}
              value={amount(now.totalLiabilities)}
              icon={CreditCard}
              tone="orange"
              to="/financial-position"
              footer={<ChangeChip current={now.totalLiabilities} previous={before?.totalLiabilities} goodWhenUp={false} />}
            />
            <KpiCard
              label={isLoss ? t('dashboard.netLoss') : t('dashboard.netProfit')}
              value={amount(now.netResult)}
              icon={isLoss ? TrendingDown : TrendingUp}
              tone={isLoss ? 'danger' : 'success'}
              to="/trial-balance"
              footer={
                monthResult === null ? (
                  <span className="text-[12px] text-faint">{t('dashboard.noComparison')}</span>
                ) : (
                  <span className="flex min-w-0 items-center gap-2 text-[12px]">
                    <span className={clsx('num inline-flex h-6 shrink-0 items-center rounded-full px-2 font-semibold', monthResult < 0n ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>
                      {monthResult > 0n ? '+' : ''}
                      {formatCompact(unitsToNumber(monthResult))}
                    </span>
                    <span className="truncate text-muted">{t('dashboard.thisMonth')}</span>
                  </span>
                )
              }
            />
          </>
        )}
      </section>

      {/* Cash flow + financing */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12 2xl:mt-6 2xl:gap-6">
        <Card className="min-w-0 xl:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="min-w-0">
              <h2 className="text-[15.5px] font-semibold text-ink">{t('dashboard.cashFlow')}</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">{t('dashboard.cashFlowHint')}</p>
            </div>
            <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 px-5 sm:px-6">
            {[
              { label: t('dashboard.cashIn'), value: cashTotals.inflow },
              { label: t('dashboard.cashOut'), value: cashTotals.outflow },
              { label: t('dashboard.netCash'), value: cashTotals.inflow - cashTotals.outflow },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-xl bg-subtle px-3 py-2.5">
                <dt className="truncate text-[11.5px] text-muted">{item.label}</dt>
                <dd className={clsx('num truncate text-[15px] font-semibold', item.value < 0 ? 'text-danger' : 'text-ink')}>{formatCompact(item.value)}</dd>
              </div>
            ))}
          </dl>
          <div className="px-2 pb-3 pt-2 sm:px-3">
            {cashFlow.isLoading ? (
              <Loading height={260} />
            ) : cashFlow.points.length === 0 || (cashTotals.inflow === 0 && cashTotals.outflow === 0) ? (
              <p className="flex h-[200px] items-center justify-center px-5 text-center text-[13px] text-muted">{t('dashboard.noCashMovements')}</p>
            ) : (
              <LineChart series={series} points={cashFlow.points} valueLabel={t('dashboard.cashFlow')} />
            )}
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col xl:col-span-4">
          <div className="px-5 pt-5 sm:px-6">
            <h2 className="text-[15.5px] font-semibold text-ink">{t('dashboard.funding')}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">{t('dashboard.fundingHint', { date: formatDate(today) })}</p>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-6 px-5 py-6 sm:px-6">
            {figuresLoading ? (
              <Loading height={196} />
            ) : fundingTotal <= 0 ? (
              <p className="py-10 text-center text-[13px] text-muted">{t('dashboard.noFunding')}</p>
            ) : (
              <>
                <DonutChart
                  segments={funding}
                  center={
                    <>
                      <span className="num text-[32px] font-semibold leading-none text-ink">
                        {equityShare}
                        <span className="text-[18px] text-muted">%</span>
                      </span>
                      <span className="mt-1.5 text-[12px] text-muted">{t('dashboard.equityShare')}</span>
                    </>
                  }
                />
                <ul className="flex flex-col gap-2.5">
                  {funding.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="flex items-center gap-2 text-ink-soft">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                        {s.label}
                      </span>
                      <span className="flex items-baseline gap-2">
                        <span className="num font-semibold text-ink">{formatCompact(s.value)}</span>
                        <span className="num w-10 text-end text-[12px] text-muted">{Math.round((Math.max(s.value, 0) / fundingTotal) * 100)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Recent entries + expenses */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12 2xl:mt-6 2xl:gap-6">
        <Card className="min-w-0 self-start overflow-hidden xl:col-span-7">
          <CardHeader title={t('dashboard.recentEntries')} actions={<CardLink to="/journal">{t('common.viewAll')}</CardLink>} />
          {recent.isLoading ? (
            <Loading height={200} />
          ) : (recent.data?.length ?? 0) === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">{t('dashboard.noEntries')}</p>
          ) : (
            <>
              {/* Phones: stacked list */}
              <ul className="divide-y divide-line sm:hidden">
                {recent.data!.map((row) => (
                  <li key={row.id}>
                    <Link to={`/journal/entries/${row.id}`} className="flex items-start justify-between gap-3 px-5 py-3.5 active:bg-subtle">
                      <span className="min-w-0">
                        <span className="num block text-[13px] font-semibold text-accent">{row.entry_number}</span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-ink-soft">{row.description}</span>
                        <span className="num mt-0.5 block text-[12px] text-muted">{formatDate(row.entry_date)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="num text-[13px] font-semibold text-ink">{formatAmount(row.total_debit, currency.decimals)}</span>
                        <StatusBadge status={row.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Tablets and up: table */}
              <div className="hidden sm:block">
                <Table minWidth={480}>
                  <THead>
                    <tr>
                      <Th>{t('journal.entryNumber')}</Th>
                      <Th className="w-[42%]">{t('journal.description')}</Th>
                      <Th numeric>{t('journal.amount')}</Th>
                      <Th>{t('journal.status')}</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {recent.data!.map((row) => (
                      <Tr key={row.id} interactive onClick={() => navigate(`/journal/entries/${row.id}`)}>
                        <Td className="num whitespace-nowrap">
                          <Link to={`/journal/entries/${row.id}`} className="block font-semibold text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                            {row.entry_number}
                          </Link>
                          <span className="mt-0.5 block text-[12px] text-muted">{formatDate(row.entry_date)}</span>
                        </Td>
                        <Td className="max-w-0">
                          <span className="block truncate text-ink-soft">{row.description}</span>
                        </Td>
                        <Td numeric className="font-semibold text-ink">
                          {formatAmount(row.total_debit, currency.decimals)}
                        </Td>
                        <Td>
                          <StatusBadge status={row.status} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </Card>

        <Card className="min-w-0 self-start xl:col-span-5">
          <CardHeader title={t('dashboard.expenses')} description={t('dashboard.expensesHint')} actions={<CardLink to="/trial-balance">{t('common.viewAll')}</CardLink>} />
          {figuresLoading || !now ? (
            <Loading height={200} />
          ) : (
            <div className="px-5 py-5 sm:px-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-subtle px-3.5 py-3">
                  <p className="text-[12px] text-muted">{t('dashboard.revenue')}</p>
                  <p className="num mt-0.5 text-[18px] font-semibold text-ink">{formatCompact(unitsToNumber(now.revenue))}</p>
                </div>
                <div className="rounded-xl bg-subtle px-3.5 py-3">
                  <p className="text-[12px] text-muted">{t('dashboard.totalExpenses')}</p>
                  <p className="num mt-0.5 text-[18px] font-semibold text-ink">{formatCompact(unitsToNumber(expenseTotal))}</p>
                </div>
              </div>
              {topExpenses.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-muted">{t('dashboard.noExpenses')}</p>
              ) : (
                <ul className="mt-5 flex flex-col gap-4">
                  {[...topExpenses.map((e) => ({ key: e.account.id, label: name(e.account), code: e.account.code, amount: e.amount })), ...(otherExpenses > 0n ? [{ key: 'other', label: t('dashboard.otherExpenses'), code: '', amount: otherExpenses }] : [])].map(
                    (row) => {
                      const share = expenseTotal > 0n ? (unitsToNumber(row.amount) / unitsToNumber(expenseTotal)) * 100 : 0;
                      return (
                        <li key={row.key}>
                          <div className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="min-w-0 truncate text-ink-soft">
                              {row.code && <span className="num me-1.5 text-[12px] text-faint">{row.code}</span>}
                              {row.label}
                            </span>
                            <span className="flex shrink-0 items-baseline gap-2">
                              <span className="num font-semibold text-ink">{formatCompact(unitsToNumber(row.amount))}</span>
                              <span className="num w-9 text-end text-[12px] text-muted">{Math.round(share)}%</span>
                            </span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-hover" role="presentation">
                            <div className="h-full rounded-full bg-[var(--color-chart-2)]" style={{ width: `${Math.max(share, 1.5)}%` }} />
                          </div>
                        </li>
                      );
                    },
                  )}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Work queue, checks, period */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:mt-6 2xl:gap-6">
        <Card className="overflow-hidden">
          <CardHeader title={t('dashboard.workQueue')} />
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
          <CardHeader title={t('dashboard.checks')} />
          <ul>
            <PanelRow label={t('dashboard.trialBalanceCheck')} to="/trial-balance">
              <CheckBadge ok={now?.trialBalanceAgrees} />
            </PanelRow>
            <PanelRow label={t('dashboard.positionCheck')} to="/financial-position">
              <CheckBadge ok={now?.positionAgrees} />
            </PanelRow>
            <PanelRow label={t('dashboard.postedEntries')} to="/journal?status=posted">
              <span className="num">{data ? data.entries.posted + data.entries.reversed : '—'}</span>
            </PanelRow>
            <PanelRow label={t('dashboard.lastPosting')}>
              <span className="num text-[12.5px]">{data?.last_posted_at ? formatDateTime(data.last_posted_at) : '—'}</span>
            </PanelRow>
          </ul>
        </Card>

        <Card className="overflow-hidden md:col-span-2 xl:col-span-1">
          <CardHeader title={t('dashboard.periodPanel')} actions={<CardLink to="/periods">{t('dashboard.managePeriods')}</CardLink>} />
          <ul>
            <PanelRow label={t('dashboard.fiscalYear')}>{period?.fiscal_year_name ?? '—'}</PanelRow>
            <PanelRow label={t('dashboard.period')}>{period ? formatPeriodName(period.name, language) : '—'}</PanelRow>
            <PanelRow label={t('dashboard.dates')}>
              {period ? (
                <span className="whitespace-nowrap text-[12.5px]">{t('dashboard.range', { from: formatDate(period.start_date), to: formatDate(period.end_date) })}</span>
              ) : (
                '—'
              )}
            </PanelRow>
            <PanelRow label={t('dashboard.status')}>{period ? <PeriodStatusBadge status={period.status} /> : '—'}</PanelRow>
          </ul>
        </Card>
      </div>
    </>
  );
}
