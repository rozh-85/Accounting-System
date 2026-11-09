import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, FileDown, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { FilterBar } from '@/components/tables/FilterBar';
import { Button } from '@/components/ui/Button';
import { Alert, Card, EmptyState } from '@/components/ui/Card';
import { Checkbox, Select } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { fiscalYearFor, useAccounts, useFiscalYears, usePeriods } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import { absUnits, buildTrialBalance, formatUnits, sumsByAccount, type Account, type AccountBalanceRow, type TrialBalanceMode, type Units } from '@/lib/accounting';
import { downloadCsv } from '@/lib/csv';
import { formatPeriodName, normalizeSearch, startOfYear, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import { RoomHeading } from '@/features/ledger/LedgerPage';
import { ReportDialog } from '@/features/reports/ReportDialog';

export function TrialBalancePage() {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const navigate = useNavigate();
  const { companyId, currency, can } = useCompany();
  const identity = useReportIdentity();
  const { accounts, isLoading: accountsLoading } = useAccounts();
  const { fiscalYears } = useFiscalYears();
  const { periods } = usePeriods();
  const [params, setParams] = useSearchParams();
  const [reportOpen, setReportOpen] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');

  const today = todayIso();
  const currentYear = fiscalYearFor(fiscalYears, today);
  const from = params.get('from') ?? currentYear?.start_date ?? startOfYear(today);
  const to = params.get('to') ?? (currentYear && currentYear.end_date < today ? currentYear.end_date : today);
  const mode = (params.get('mode') as TrialBalanceMode) || 'adjusted';
  const view = params.get('view') === 'summary' ? 'summary' : 'detailed';
  const summaryLevel = Number(params.get('level') ?? 2);
  const includeZero = params.get('zero') === '1';
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const balances = useQuery({
    queryKey: ['trial-balance', companyId, from, to, mode],
    queryFn: () => rpc<AccountBalanceRow[]>('account_balances', { p_company_id: companyId, p_from: from || null, p_to: to, p_mode: mode }),
  });

  const result = useMemo(
    () => (balances.data ? buildTrialBalance(accounts, sumsByAccount(balances.data), { view, summaryLevel, includeZero }) : null),
    [balances.data, accounts, view, summaryLevel, includeZero],
  );

  // Searching covers the whole chart, including accounts with no balance yet. Each
  // match keeps its group accounts above it, so it reads like the full report.
  const query = normalizeSearch(search);
  const rows = useMemo(() => {
    if (!query) return result?.rows ?? [];
    if (!balances.data) return [];
    const all = buildTrialBalance(accounts, sumsByAccount(balances.data), { view, summaryLevel, includeZero: true }).rows;
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const shown = new Set<string>();
    for (const { account } of all) {
      if (account.code.toLowerCase().startsWith(query) || normalizeSearch(account.name_en).includes(query) || normalizeSearch(account.name_ar).includes(query)) {
        let current: Account | undefined = account;
        while (current && !shown.has(current.id)) {
          shown.add(current.id);
          current = current.parent_id ? byId.get(current.parent_id) : undefined;
        }
      }
    }
    return all.filter((row) => shown.has(row.account.id));
  }, [query, result, balances.data, accounts, view, summaryLevel]);

  const periodOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; from: string; to: string }> = [];
    for (const fy of fiscalYears) {
      options.push({ value: `fy:${fy.id}`, label: `${t('trialBalance.fiscalYear')} ${fy.name}`, from: fy.start_date, to: fy.end_date });
      for (const p of periods.filter((x) => x.fiscal_year_id === fy.id)) {
        options.push({ value: `p:${p.id}`, label: `— ${formatPeriodName(p.name, language)}`, from: p.start_date, to: p.end_date });
      }
    }
    return options;
  }, [fiscalYears, periods, language, t]);
  const selectedPeriod = periodOptions.find((o) => o.from === from && o.to === to)?.value ?? 'custom';
  const periodLabel = selectedPeriod === 'custom' ? t('trialBalance.customRange') : periodOptions.find((o) => o.value === selectedPeriod)!.label.replace(/^— /, '');

  const fmt = (u: Units) => (u === 0n ? '' : formatUnits(u, { decimals: currency.decimals }));
  const fmtTotal = (u: Units) => formatUnits(u, { decimals: currency.decimals });

  const exportCsv = () => {
    if (!result) return;
    downloadCsv(
      `trial-balance-${from}-${to}`,
      [t('accounts.code'), t('accounts.name'), t('trialBalance.openingDebit'), t('trialBalance.openingCredit'), t('trialBalance.periodDebit'), t('trialBalance.periodCredit'), t('trialBalance.closingDebit'), t('trialBalance.closingCredit')],
      [
        ...result.rows.map((r) => [r.account.code, name(r.account), fmtTotal(r.openingDebit), fmtTotal(r.openingCredit), fmtTotal(r.periodDebit), fmtTotal(r.periodCredit), fmtTotal(r.closingDebit), fmtTotal(r.closingCredit)]),
        ['', t('common.total'), fmtTotal(result.totals.openingDebit), fmtTotal(result.totals.openingCredit), fmtTotal(result.totals.periodDebit), fmtTotal(result.totals.periodCredit), fmtTotal(result.totals.closingDebit), fmtTotal(result.totals.closingCredit)],
      ],
    );
  };

  const head = 'h-9 border-b border-line px-3 text-[12px] font-medium text-muted';

  return (
    <>
      <RoomHeading number="03" roomKey="trialBalance" />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        onSearchCommit={() => search.trim() !== (params.get('q') ?? '') && update({ q: search.trim() || null })}
        searchPlaceholder={t('trialBalance.searchPlaceholder')}
        from={from}
        to={to}
        onFromChange={(value) => update({ from: value })}
        onToChange={(value) => update({ to: value })}
        primary={
          <Select
            aria-label={t('trialBalance.period')}
            value={selectedPeriod}
            onChange={(e) => {
              const option = periodOptions.find((o) => o.value === e.target.value);
              if (option) update({ from: option.from, to: option.to });
            }}
          >
            <option value="custom">{t('trialBalance.customRange')}</option>
            {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        }
      >
        <Segmented
          label={t('trialBalance.type')}
          value={mode}
          onChange={(m) => update({ mode: m === 'adjusted' ? null : m })}
          options={(['unadjusted', 'adjusted', 'post_closing'] as const).map((m) => ({ value: m, label: t(`trialBalance.modes.${m}`) }))}
        />
        <Segmented
          label={t('trialBalance.view')}
          value={view}
          onChange={(v) => update({ view: v === 'summary' ? 'summary' : null })}
          options={[
            { value: 'detailed', label: t('common.detailed') },
            { value: 'summary', label: t('common.summary') },
          ]}
        />
        {view === 'summary' && (
          <Select aria-label={t('trialBalance.level')} className="w-[130px]" value={String(summaryLevel)} onChange={(e) => update({ level: e.target.value === '2' ? null : e.target.value })}>
            {[1, 2, 3].map((l) => <option key={l} value={l}>{t('trialBalance.levelN', { level: l })}</option>)}
          </Select>
        )}
        <Checkbox label={t('trialBalance.includeZero')} checked={includeZero} onChange={(e) => update({ zero: e.target.checked ? '1' : null })} />
        <div className="flex w-full gap-2 sm:ms-auto sm:w-auto">
          <Button className="flex-1 sm:flex-none" icon={<FileSpreadsheet size={15} />} onClick={exportCsv} disabled={!result}>{t('common.exportCsv')}</Button>
          {can('reports.export') && <Button className="flex-1 sm:flex-none" icon={<FileDown size={15} />} onClick={() => setReportOpen(true)} disabled={!result}>{t('common.exportPdf')}</Button>}
        </div>
      </FilterBar>

      {accountsLoading || balances.isLoading ? (
        <PageLoader />
      ) : balances.error ? (
        <Alert tone="danger">{errorMessage(balances.error, t)}</Alert>
      ) : !result || (result.rows.length === 0 && !query) ? (
        <Card><EmptyState title={t('trialBalance.empty')} description={t('trialBalance.emptyHint')} /></Card>
      ) : (
        <>
          <div
            role="status"
            className={clsx(
              'mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[12px] border px-4 py-2.5 text-[13px]',
              result.isBalanced ? 'border-success-line bg-success-soft text-success-strong' : 'border-danger-line bg-danger-soft text-danger',
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              {result.isBalanced ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
              {result.isBalanced ? t('trialBalance.balanced') : t('trialBalance.outOfBalance')}
            </span>
            {!result.isBalanced && (
              <span className="num">
                {t('trialBalance.differences')}: {t('trialBalance.opening')} {fmtTotal(absUnits(result.differences.opening))} · {t('trialBalance.movement')} {fmtTotal(absUnits(result.differences.period))} · {t('trialBalance.closing')} {fmtTotal(absUnits(result.differences.closing))}
              </span>
            )}
            <span className="text-[12px] font-normal text-ink-soft sm:ms-auto">{t('trialBalance.disclaimer')}</span>
          </div>

          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState title={t('accounts.empty')} description={t('common.adjustFilters')} />
            ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1080px] border-collapse text-[13px]">
                <thead className="bg-subtle">
                  <tr>
                    <th rowSpan={2} className={clsx(head, 'w-[86px] ps-5 text-start')}>{t('accounts.code')}</th>
                    <th rowSpan={2} className={clsx(head, 'text-start')}>{t('accounts.name')}</th>
                    {(['opening', 'movement', 'closing'] as const).map((g) => (
                      <th key={g} colSpan={2} className={clsx(head, 'border-s border-line text-center text-ink-soft')}>{t(`trialBalance.${g}`)}</th>
                    ))}
                  </tr>
                  <tr>
                    {[0, 1, 2].flatMap((g) => [
                      <th key={`${g}d`} className={clsx(head, 'w-[10.5%] border-s border-line text-end')}>{t('journal.debit')}</th>,
                      <th key={`${g}c`} className={clsx(head, 'w-[10.5%] text-end', g === 2 && 'pe-5')}>{t('journal.credit')}</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.account.id}
                      tabIndex={row.isGroup ? undefined : 0}
                      onClick={() => !row.isGroup && navigate(`/ledger?account=${row.account.id}&from=${from}&to=${to}&view=gl`)}
                      onKeyDown={(e) => e.key === 'Enter' && !row.isGroup && navigate(`/ledger?account=${row.account.id}&from=${from}&to=${to}&view=gl`)}
                      className={clsx(row.isGroup ? 'bg-subtle/70 font-semibold' : 'cursor-pointer hover:bg-subtle')}
                      title={row.isGroup ? undefined : t('trialBalance.drillDown')}
                    >
                      <td className="num border-b border-line py-2 ps-5 text-ink-soft">{row.account.code}</td>
                      <td className="border-b border-line px-3 py-2" style={{ paddingInlineStart: `${12 + row.depth * 16}px` }}>{name(row.account)}</td>
                      {[row.openingDebit, row.openingCredit, row.periodDebit, row.periodCredit, row.closingDebit, row.closingCredit].map((v, i) => (
                        <td key={i} className={clsx('num border-b border-line px-3 py-2 text-end', i % 2 === 0 && 'border-s', i === 5 && 'pe-5')}>{fmt(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-subtle font-semibold">
                    <td className="border-t-2 border-ink py-2.5 ps-5" />
                    <td className="border-t-2 border-ink px-3 py-2.5">{query ? t('trialBalance.totalAll') : t('common.total')}</td>
                    {[result.totals.openingDebit, result.totals.openingCredit, result.totals.periodDebit, result.totals.periodCredit, result.totals.closingDebit, result.totals.closingCredit].map((v, i) => (
                      <td key={i} className={clsx('num border-t-2 border-ink px-3 py-2.5 text-end', i % 2 === 0 && 'border-s border-s-line', i === 5 && 'pe-5')}>{fmtTotal(v)}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            )}
          </Card>
        </>
      )}

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={`${t('pdf.trialBalance.title')} — ${view === 'summary' ? t('common.summary') : t('common.detailed')}`}
        fileName={`trial-balance-${view}`}
        defaultSignatures={identity.signatures}
        generate={async ({ language: lng, signatures }) => {
          if (!result) throw new Error('NO_DATA');
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(
            <pdf.TrialBalanceReport
              context={pdf.reportContext(lng, identity.company, identity.generatedBy)}
              decimals={currency.decimals}
              currencyCode={currency.code}
              from={from}
              to={to}
              periodLabel={selectedPeriod === 'custom' ? t('trialBalance.customRange', { lng }) : periodLabel}
              modeLabel={t(`trialBalance.modes.${mode}`, { lng })}
              viewLabel={view === 'summary' ? t('common.summary', { lng }) : t('common.detailed', { lng })}
              result={result}
              signatures={signatures}
            />,
          );
        }}
      />
    </>
  );
}
