import { formatUnits, type FinancialPosition, type FPLine, type TrialBalanceResult, type Units } from '@/lib/accounting';
import { formatDate } from '@/lib/formatting';
import {
  Note,
  PdfTable,
  ReportDocument,
  ReportHeader,
  ReportPage,
  SignatureBlock,
  StatusLine,
  type PdfColumn,
  type PdfRow,
  type ReportContextValue,
} from '../primitives';

// ---------------------------------------------------------------------------
// Trial balance — ميزان المراجعة
// ---------------------------------------------------------------------------
export interface TrialBalanceReportInput {
  context: ReportContextValue;
  decimals: number;
  currencyCode: string;
  from: string | null;
  to: string;
  periodLabel: string;
  modeLabel: string;
  viewLabel: string;
  result: TrialBalanceResult;
  signatures: boolean;
}

export function TrialBalanceReport({ context, decimals, currencyCode, from, to, periodLabel, modeLabel, viewLabel, result, signatures }: TrialBalanceReportInput) {
  const { t, language } = context;
  const title = t('pdf.trialBalance.title');
  const fmt = (v: Units) => (v === 0n ? '' : formatUnits(v, { decimals }));
  const w = 66;
  const columns: PdfColumn[] = [
    { key: 'code', header: t('accounts.code'), width: 44 },
    { key: 'name', header: t('accounts.name'), flex: 1 },
    { key: 'od', header: t('journal.debit'), width: w, numeric: true },
    { key: 'oc', header: t('journal.credit'), width: w, numeric: true },
    { key: 'pd', header: t('journal.debit'), width: w, numeric: true },
    { key: 'pc', header: t('journal.credit'), width: w, numeric: true },
    { key: 'cd', header: t('journal.debit'), width: w, numeric: true },
    { key: 'cc', header: t('journal.credit'), width: w, numeric: true },
  ];
  const groups = [
    { label: t('trialBalance.opening'), columns: ['od', 'oc'] },
    { label: t('trialBalance.movement'), columns: ['pd', 'pc'] },
    { label: t('trialBalance.closing'), columns: ['cd', 'cc'] },
  ];

  const rows: PdfRow[] = result.rows.map((row) => ({
    key: row.account.id,
    variant: row.isGroup ? 'group' : 'normal',
    indent: row.depth,
    indentColumn: 'name',
    cells: {
      code: row.account.code,
      name: language === 'ar' ? row.account.name_ar : row.account.name_en,
      od: fmt(row.openingDebit),
      oc: fmt(row.openingCredit),
      pd: fmt(row.periodDebit),
      pc: fmt(row.periodCredit),
      cd: fmt(row.closingDebit),
      cc: fmt(row.closingCredit),
    },
  }));
  const totals = result.totals;
  rows.push({
    key: 'totals',
    variant: 'total',
    cells: {
      name: t('common.total'),
      od: formatUnits(totals.openingDebit, { decimals }),
      oc: formatUnits(totals.openingCredit, { decimals }),
      pd: formatUnits(totals.periodDebit, { decimals }),
      pc: formatUnits(totals.periodCredit, { decimals }),
      cd: formatUnits(totals.closingDebit, { decimals }),
      cc: formatUnits(totals.closingCredit, { decimals }),
    },
  });

  const d = result.differences;
  return (
    <ReportDocument context={context} title={title}>
      <ReportPage title={title} orientation="landscape">
        <ReportHeader
          title={title}
          subtitle={`${periodLabel}  (${formatDate(from) || '…'} – ${formatDate(to)})`}
          meta={[
            { label: t('trialBalance.type'), value: modeLabel },
            { label: t('trialBalance.view'), value: viewLabel },
            { label: t('pdf.currency'), value: currencyCode },
          ]}
        />
        <PdfTable columns={columns} rows={rows} groups={groups} emptyLabel={t('pdf.noData')} />
        <StatusLine ok={result.isBalanced}>
          {result.isBalanced
            ? t('trialBalance.balancedMessage')
            : t('trialBalance.unbalancedMessage', {
                opening: formatUnits(d.opening, { decimals }),
                movement: formatUnits(d.period, { decimals }),
                closing: formatUnits(d.closing, { decimals }),
              })}
        </StatusLine>
        <Note>{t('trialBalance.disclaimer')}</Note>
        {signatures && <SignatureBlock labels={[t('pdf.preparedBy'), t('pdf.reviewedBy'), t('pdf.approvedBy')]} />}
      </ReportPage>
    </ReportDocument>
  );
}

// ---------------------------------------------------------------------------
// Statement of financial position — قائمة المركز المالي
// ---------------------------------------------------------------------------
export interface FinancialPositionReportInput {
  context: ReportContextValue;
  decimals: number;
  currencyCode: string;
  asOf: string;
  comparativeDate: string | null;
  statement: FinancialPosition;
  detailed: boolean;
  signatures: boolean;
}

export function FinancialPositionReport({ context, decimals, currencyCode, asOf, comparativeDate, statement, detailed, signatures }: FinancialPositionReportInput) {
  const { t, language } = context;
  const title = t('pdf.financialPosition.title');
  const comparative = Boolean(comparativeDate && statement.comparativeTotals);
  const fmt = (v: Units | null | undefined) => (v === null || v === undefined ? '' : formatUnits(v, { decimals, parentheses: true }));

  const columns: PdfColumn[] = [
    { key: 'label', header: '', flex: 1 },
    { key: 'current', header: formatDate(asOf), width: 96, numeric: true },
    ...(comparative ? [{ key: 'comparative', header: formatDate(comparativeDate), width: 96, numeric: true } as PdfColumn] : []),
  ];

  const rows: PdfRow[] = [];
  const lineLabel = (line: FPLine) => {
    if (line.kind === 'current_profit') return t('financialPosition.currentProfit');
    if (line.kind === 'prior_unclosed') return t('financialPosition.priorUnclosed');
    const a = line.account!;
    return `${a.code}  ${language === 'ar' ? a.name_ar : a.name_en}`;
  };

  const addSection = (key: keyof FinancialPosition['sections'], indent: number) => {
    const section = statement.sections[key];
    rows.push({ key: `${key}-h`, variant: 'section', indent, cells: { label: t(`financialPosition.sections.${key}`) } });
    for (const group of section.groups) {
      const groupName = language === 'ar' ? group.category.name_ar : group.category.name_en;
      if (detailed) {
        rows.push({ key: `${group.key}-g`, variant: 'muted', indent: indent + 1, cells: { label: groupName } });
        for (const line of group.lines) {
          rows.push({ key: line.key, indent: indent + 2, cells: { label: lineLabel(line), current: fmt(line.amount), comparative: fmt(line.comparative) } });
        }
        rows.push({ key: `${group.key}-t`, variant: 'subtotal', indent: indent + 1, cells: { label: t('financialPosition.totalOf', { name: groupName }), current: fmt(group.total), comparative: fmt(group.comparativeTotal) } });
      } else {
        rows.push({ key: `${group.key}-g`, indent: indent + 1, cells: { label: groupName, current: fmt(group.total), comparative: fmt(group.comparativeTotal) } });
      }
    }
    for (const line of section.resultLines) {
      rows.push({ key: line.key, indent: indent + 1, cells: { label: lineLabel(line), current: fmt(line.amount), comparative: fmt(line.comparative) } });
    }
    rows.push({
      key: `${key}-t`,
      variant: 'subtotal',
      indent,
      cells: { label: t('financialPosition.totalSection', { name: t(`financialPosition.sections.${key}`) }), current: fmt(section.total), comparative: fmt(section.comparativeTotal) },
    });
  };

  const tot = statement.totals;
  const ctot = statement.comparativeTotals;

  rows.push({ key: 'assets', variant: 'group', cells: { label: t('financialPosition.assets') } });
  addSection('current_assets', 1);
  addSection('non_current_assets', 1);
  rows.push({ key: 'assets-total', variant: 'total', cells: { label: t('financialPosition.totalAssets'), current: fmt(tot.totalAssets), comparative: fmt(ctot?.totalAssets) } });

  rows.push({ key: 'liabilities', variant: 'group', cells: { label: t('financialPosition.liabilities') } });
  addSection('current_liabilities', 1);
  addSection('non_current_liabilities', 1);
  rows.push({ key: 'liabilities-total', variant: 'subtotal', cells: { label: t('financialPosition.totalLiabilities'), current: fmt(tot.totalLiabilities), comparative: fmt(ctot?.totalLiabilities) } });

  rows.push({ key: 'equity', variant: 'group', cells: { label: t('financialPosition.equity') } });
  addSection('equity', 1);
  rows.push({ key: 'le-total', variant: 'total', cells: { label: t('financialPosition.totalLiabilitiesEquity'), current: fmt(tot.liabilitiesAndEquity), comparative: fmt(ctot?.liabilitiesAndEquity) } });

  return (
    <ReportDocument context={context} title={title}>
      <ReportPage title={title}>
        <ReportHeader
          title={title}
          subtitle={t('financialPosition.asOfLong', { date: formatDate(asOf) })}
          meta={[
            { label: t('financialPosition.view'), value: detailed ? t('common.detailed') : t('common.summary') },
            ...(comparative ? [{ label: t('financialPosition.comparative'), value: formatDate(comparativeDate) }] : []),
            { label: t('pdf.currency'), value: currencyCode },
          ]}
        />
        <PdfTable columns={columns} rows={rows} />
        <StatusLine ok={statement.isBalanced}>
          {t('financialPosition.equation')}:{'  '}
          {formatUnits(tot.totalAssets, { decimals })} = {formatUnits(tot.totalLiabilities, { decimals })} + {formatUnits(tot.totalEquity, { decimals })}
          {'  —  '}
          {statement.isBalanced ? t('financialPosition.balanced') : t('financialPosition.unbalanced', { difference: formatUnits(tot.difference, { decimals }) })}
        </StatusLine>
        <Note>{t('financialPosition.note')}</Note>
        {signatures && <SignatureBlock labels={[t('pdf.accountant'), t('pdf.manager')]} />}
      </ReportPage>
    </ReportDocument>
  );
}
