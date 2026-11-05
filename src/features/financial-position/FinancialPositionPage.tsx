import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, FileDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Button } from '@/components/ui/Button';
import { Alert, Card } from '@/components/ui/Card';
import { Checkbox, Input, Select } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { fiscalYearFor, useAccountCategories, useAccounts, useFiscalYears } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import {
  buildFinancialPosition,
  formatUnits,
  sumsByAccount,
  type AccountBalanceRow,
  type BalanceSheetSection,
  type FPGroup,
  type FPLine,
  type Units,
} from '@/lib/accounting';
import { addDays, formatDate, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { FiscalYear } from '@/types/database';
import { RoomHeading } from '@/features/ledger/LedgerPage';
import { ReportDialog } from '@/features/reports/ReportDialog';

type ComparativeMode = 'none' | 'previous_year_end' | 'same_date_last_year' | 'custom';

async function loadColumn(companyId: string, fiscalYears: FiscalYear[], asOf: string) {
  const fy = fiscalYearFor(fiscalYears, asOf);
  const rows = await rpc<AccountBalanceRow[]>('account_balances', { p_company_id: companyId, p_from: fy?.start_date ?? null, p_to: asOf, p_mode: 'all' });
  return sumsByAccount(rows);
}

export function FinancialPositionPage() {
  const { t } = useTranslation();
  const { name, isRtl } = useLanguage();
  const navigate = useNavigate();
  const { companyId, currency, can } = useCompany();
  const identity = useReportIdentity();
  const { accounts } = useAccounts();
  const { categories } = useAccountCategories();
  const { fiscalYears, isLoading: fyLoading } = useFiscalYears();
  const [params, setParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reportOpen, setReportOpen] = useState(false);

  const asOf = params.get('asOf') ?? todayIso();
  const detailed = params.get('view') !== 'summary';
  const includeZero = params.get('zero') === '1';
  const comparativeMode = (params.get('compare') as ComparativeMode) || 'none';
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const comparativeDate = useMemo(() => {
    if (comparativeMode === 'none') return null;
    if (comparativeMode === 'custom') return params.get('compareDate') || null;
    if (comparativeMode === 'same_date_last_year') return `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
    const fy = fiscalYearFor(fiscalYears, asOf);
    return fy ? addDays(fy.start_date, -1) : `${Number(asOf.slice(0, 4)) - 1}-12-31`;
  }, [comparativeMode, params, asOf, fiscalYears]);

  const data = useQuery({
    queryKey: ['financial-position', companyId, asOf, comparativeDate, fiscalYears.length],
    enabled: !fyLoading,
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        loadColumn(companyId, fiscalYears, asOf),
        comparativeDate ? loadColumn(companyId, fiscalYears, comparativeDate) : Promise.resolve(null),
      ]);
      return { current, previous };
    },
  });

  const statement = useMemo(
    () =>
      data.data && accounts.length && categories.length
        ? buildFinancialPosition(accounts, categories, { sums: data.data.current }, data.data.previous ? { sums: data.data.previous } : null, { includeZero })
        : null,
    [data.data, accounts, categories, includeZero],
  );

  const comparative = Boolean(comparativeDate && statement?.comparativeTotals);
  const fmt = (u: Units | null | undefined) => (u === null || u === undefined ? '' : formatUnits(u, { decimals: currency.decimals, parentheses: true }));
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  const amountCells = (current: Units | null | undefined, previous: Units | null | undefined, strong?: boolean) => (
    <>
      <td className={clsx('num w-[170px] px-4 py-2 text-end', strong && 'font-semibold')}>{fmt(current)}</td>
      {comparative && <td className={clsx('num w-[170px] px-4 py-2 pe-6 text-end text-ink-soft', strong && 'font-semibold')}>{fmt(previous)}</td>}
    </>
  );

  const lineLabel = (line: FPLine) =>
    line.kind === 'current_profit' ? t('financialPosition.currentProfit') : line.kind === 'prior_unclosed' ? t('financialPosition.priorUnclosed') : name(line.account!);

  const groupRows = (group: FPGroup, indent: number) => {
    const open = detailed && !collapsed.has(group.key);
    return [
      <tr key={group.key} className="border-b border-line">
        <td className="py-2 pe-4" style={{ paddingInlineStart: `${20 + indent * 18}px` }}>
          {detailed ? (
            <button type="button" onClick={() => toggle(group.key)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-ink hover:text-accent">
              {open ? <ChevronDown size={14} className="text-muted" /> : <Chevron size={14} className="text-muted" />}
              {name(group.category)}
            </button>
          ) : (
            name(group.category)
          )}
        </td>
        {amountCells(open ? null : group.total, open ? null : group.comparativeTotal)}
      </tr>,
      ...(open
        ? [
            ...group.lines.map((line) => (
              <tr
                key={line.key}
                tabIndex={0}
                className="cursor-pointer border-b border-line text-ink-soft hover:bg-subtle"
                onClick={() => navigate(`/ledger?account=${line.account!.id}&to=${asOf}&view=gl`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/ledger?account=${line.account!.id}&to=${asOf}&view=gl`)}
                title={t('financialPosition.drillDown')}
              >
                <td className="py-1.5 pe-4 text-[12.5px]" style={{ paddingInlineStart: `${42 + indent * 18}px` }}>
                  <span className="num me-2 text-faint">{line.account!.code}</span>
                  {lineLabel(line)}
                </td>
                {amountCells(line.amount, line.comparative)}
              </tr>
            )),
            <tr key={`${group.key}-total`} className="border-b border-line">
              <td className="py-2 pe-4 text-[12.5px] font-medium" style={{ paddingInlineStart: `${20 + indent * 18}px` }}>{t('financialPosition.totalOf', { name: name(group.category) })}</td>
              {amountCells(group.total, group.comparativeTotal, true)}
            </tr>,
          ]
        : []),
    ];
  };

  const sectionRows = (key: BalanceSheetSection) => {
    if (!statement) return null;
    const section = statement.sections[key];
    return (
      <>
        <tr>
          <td colSpan={comparative ? 3 : 2} className="pb-1 pt-4 text-[13px] font-semibold text-ink" style={{ paddingInlineStart: 38 }}>
            {t(`financialPosition.sections.${key}`)}
          </td>
        </tr>
        {section.groups.length === 0 && section.resultLines.length === 0 && (
          <tr className="border-b border-line">
            <td colSpan={comparative ? 3 : 2} className="py-2 text-[12.5px] text-faint" style={{ paddingInlineStart: 56 }}>{t('financialPosition.noBalances')}</td>
          </tr>
        )}
        {section.groups.flatMap((g) => groupRows(g, 1))}
        {section.resultLines.map((line) => (
          <tr key={line.key} className="border-b border-line">
            <td className="py-2 pe-4" style={{ paddingInlineStart: 38 }}>{lineLabel(line)}</td>
            {amountCells(line.amount, line.comparative)}
          </tr>
        ))}
        <tr className="border-b border-line-strong">
          <td className="py-2 pe-4 font-semibold" style={{ paddingInlineStart: 38 }}>{t('financialPosition.totalSection', { name: t(`financialPosition.sections.${key}`) })}</td>
          {amountCells(section.total, section.comparativeTotal, true)}
        </tr>
      </>
    );
  };

  const headingRow = (label: string) => (
    <tr className="bg-subtle">
      <td colSpan={comparative ? 3 : 2} className="border-y border-line px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-soft">{label}</td>
    </tr>
  );
  const totalRow = (label: string, current: Units | undefined, previous: Units | undefined): ReactNode => (
    <tr className="bg-subtle">
      <td className="border-y-2 border-ink px-5 py-3 font-semibold">{label}</td>
      <td className="num border-y-2 border-ink px-4 py-3 text-end font-semibold">{fmt(current)}</td>
      {comparative && <td className="num border-y-2 border-ink px-4 py-3 pe-6 text-end font-semibold">{fmt(previous)}</td>}
    </tr>
  );

  const tot = statement?.totals;
  const ctot = statement?.comparativeTotals ?? undefined;

  return (
    <>
      <RoomHeading number="04" roomKey="financialPosition" />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('financialPosition.asOf')}
            <Input type="date" className="num w-[160px]" value={asOf} onChange={(e) => update({ asOf: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('financialPosition.comparative')}
            <Select className="w-[230px]" value={comparativeMode} onChange={(e) => update({ compare: e.target.value === 'none' ? null : e.target.value })}>
              {(['none', 'previous_year_end', 'same_date_last_year', 'custom'] as const).map((m) => (
                <option key={m} value={m}>{t(`financialPosition.compareModes.${m}`)}</option>
              ))}
            </Select>
          </label>
          {comparativeMode === 'custom' && (
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              {t('financialPosition.compareDate')}
              <Input type="date" className="num w-[160px]" value={params.get('compareDate') ?? ''} onChange={(e) => update({ compareDate: e.target.value })} />
            </label>
          )}
          <div className="flex flex-col gap-1 text-[12px] text-muted">
            {t('financialPosition.view')}
            <Segmented
              value={detailed ? 'detailed' : 'summary'}
              onChange={(v) => update({ view: v === 'summary' ? 'summary' : null })}
              options={[
                { value: 'detailed', label: t('common.detailed') },
                { value: 'summary', label: t('common.summary') },
              ]}
            />
          </div>
          <Checkbox className="mb-2" label={t('trialBalance.includeZero')} checked={includeZero} onChange={(e) => update({ zero: e.target.checked ? '1' : null })} />
          <div className="ms-auto flex gap-2">
            {detailed && statement && (
              <Button
                size="md"
                variant="ghost"
                onClick={() =>
                  setCollapsed((prev) =>
                    prev.size > 0 ? new Set() : new Set(Object.values(statement.sections).flatMap((s) => s.groups.map((g) => g.key))),
                  )
                }
              >
                {collapsed.size > 0 ? t('financialPosition.expandAll') : t('financialPosition.collapseAll')}
              </Button>
            )}
            {can('reports.export') && <Button icon={<FileDown size={15} />} disabled={!statement} onClick={() => setReportOpen(true)}>{t('common.exportPdf')}</Button>}
          </div>
        </div>
      </Card>

      {data.isLoading || fyLoading ? (
        <PageLoader />
      ) : data.error ? (
        <Alert tone="danger">{errorMessage(data.error, t)}</Alert>
      ) : !statement || !tot ? (
        <PageLoader />
      ) : (
        <>
          {!statement.isBalanced && (
            <Alert tone="danger" icon={<CircleAlert size={16} />} title={t('financialPosition.unbalancedTitle')} className="mb-4">
              {t('financialPosition.unbalanced', { difference: formatUnits(tot.difference, { decimals: currency.decimals }) })}
            </Alert>
          )}
          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-5 text-center">
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{name(identity.company)}</p>
              <h2 className="mt-1 text-[17px] font-semibold">{t('rooms.financialPosition.title')}</h2>
              <p className="mt-0.5 text-[13px] text-ink-soft">{t('financialPosition.asOfLong', { date: formatDate(asOf) })}</p>
              <p className="mt-0.5 text-[12px] text-muted">{t('financialPosition.amountsIn', { currency: currency.code })}</p>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[620px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="text-[12px] text-muted">
                    <th className="h-10 border-b border-line px-5 text-start font-medium">{t('financialPosition.item')}</th>
                    <th className="num h-10 w-[170px] border-b border-line px-4 text-end font-medium">{formatDate(asOf)}</th>
                    {comparative && <th className="num h-10 w-[170px] border-b border-line px-4 pe-6 text-end font-medium">{formatDate(comparativeDate)}</th>}
                  </tr>
                </thead>
                <tbody>
                  {headingRow(t('financialPosition.assets'))}
                  {sectionRows('current_assets')}
                  {sectionRows('non_current_assets')}
                  {totalRow(t('financialPosition.totalAssets'), tot.totalAssets, ctot?.totalAssets)}
                  {headingRow(t('financialPosition.liabilities'))}
                  {sectionRows('current_liabilities')}
                  {sectionRows('non_current_liabilities')}
                  <tr className="border-b border-line-strong">
                    <td className="px-5 py-2.5 font-semibold">{t('financialPosition.totalLiabilities')}</td>
                    {amountCells(tot.totalLiabilities, ctot?.totalLiabilities, true)}
                  </tr>
                  {headingRow(t('financialPosition.equity'))}
                  {sectionRows('equity')}
                  {totalRow(t('financialPosition.totalLiabilitiesEquity'), tot.liabilitiesAndEquity, ctot?.liabilitiesAndEquity)}
                </tbody>
              </table>
            </div>
            <div className={clsx('flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-5 py-4 text-[13px]', statement.isBalanced ? 'border-[#c4dcd9] bg-accent-soft' : 'border-[#e8c6c3] bg-danger-soft')}>
              <span className={clsx('flex items-center gap-2 font-semibold', statement.isBalanced ? 'text-accent-strong' : 'text-danger')}>
                {statement.isBalanced ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
                {t('financialPosition.equation')}
              </span>
              <span className="num text-ink">
                {formatUnits(tot.totalAssets, { decimals: currency.decimals, parentheses: true })} = {formatUnits(tot.totalLiabilities, { decimals: currency.decimals, parentheses: true })} + {formatUnits(tot.totalEquity, { decimals: currency.decimals, parentheses: true })}
              </span>
              <span className={clsx('font-medium', statement.isBalanced ? 'text-accent-strong' : 'text-danger')}>
                {statement.isBalanced ? t('financialPosition.balanced') : t('financialPosition.difference', { difference: formatUnits(tot.difference, { decimals: currency.decimals }) })}
              </span>
            </div>
          </Card>
          <p className="mt-3 text-[12px] text-muted">{t('financialPosition.note')}</p>
        </>
      )}

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t('pdf.financialPosition.title')}
        fileName={`financial-position-${asOf}`}
        defaultSignatures={identity.signatures}
        generate={async ({ language: lng, signatures }) => {
          if (!statement) throw new Error('NO_DATA');
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(
            <pdf.FinancialPositionReport
              context={pdf.reportContext(lng, identity.company, identity.generatedBy)}
              decimals={currency.decimals}
              currencyCode={currency.code}
              asOf={asOf}
              comparativeDate={comparative ? comparativeDate : null}
              statement={statement}
              detailed={detailed}
              signatures={signatures}
            />,
          );
        }}
      />
    </>
  );
}
