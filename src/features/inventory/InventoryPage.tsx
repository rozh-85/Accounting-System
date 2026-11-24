import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, ClipboardCheck, FileDown, FileSpreadsheet, Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Table, Td, Th, THead, TotalsRow } from '@/components/tables/Table';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Alert, Card, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { prefillState } from '@/features/journal/prefill';
import { RoomHeading } from '@/features/ledger/LedgerPage';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { useLanguage } from '@/hooks/useLanguage';
import { usePeriodOptions } from '@/hooks/usePeriodOptions';
import { fiscalYearFor, useAccounts, useFiscalYears } from '@/hooks/useReferenceData';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import {
  absUnits,
  formatUnits,
  inventoryChecks,
  inventoryEntryAccount,
  INVENTORY_CODES,
  INVENTORY_ROLES,
  maxUnits,
  resolveInventoryChart,
  type Account,
  type InventoryCheck,
  type InventoryMovement,
  type InventoryMovementKind,
  type InventoryRole,
  type Units,
} from '@/lib/accounting';
import { downloadCsv } from '@/lib/csv';
import { formatDate, startOfYear, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { StockCountDialog } from './StockCountDialog';
import { useInventory } from './useInventory';

type MovementTab = 'purchases' | 'stock';

const KIND_TONE: Record<InventoryMovementKind, BadgeTone> = {
  purchase: 'accent',
  reduction: 'orange',
  reversal: 'danger',
  opening: 'info',
  count: 'success',
  direct: 'danger',
};

const CHECK_STYLE: Record<InventoryCheck['status'], { icon: ReactNode; text: string }> = {
  ok: { icon: <CircleCheck size={17} className="text-success" />, text: 'text-ink-soft' },
  warning: { icon: <TriangleAlert size={17} className="text-warning" />, text: 'text-warning' },
  danger: { icon: <CircleAlert size={17} className="text-danger" />, text: 'text-danger' },
};

export function InventoryPage() {
  const { t } = useTranslation();
  const { name } = useLanguage();
  const navigate = useNavigate();
  const { currency, can } = useCompany();
  const identity = useReportIdentity();
  const { accounts, byId, isLoading: accountsLoading } = useAccounts();
  const { fiscalYears, isLoading: fyLoading } = useFiscalYears();
  const periodOptions = usePeriodOptions();
  const [params, setParams] = useSearchParams();
  const [reportOpen, setReportOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);

  const today = todayIso();
  const currentYear = fiscalYearFor(fiscalYears, today);
  const from = params.get('from') ?? currentYear?.start_date ?? startOfYear(today);
  const to = params.get('to') ?? (currentYear && currentYear.end_date < today ? currentYear.end_date : today);
  const tab: MovementTab = params.get('tab') === 'stock' ? 'stock' : 'purchases';
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const chart = useMemo(() => resolveInventoryChart(accounts), [accounts]);
  const entryAccounts = useMemo(
    () => Object.fromEntries(INVENTORY_ROLES.map((role) => [role, inventoryEntryAccount(chart, accounts, role)])) as Record<InventoryRole, Account | null>,
    [chart, accounts],
  );
  const ready = !accountsLoading && !fyLoading && chart.missing.length === 0;
  const inventory = useInventory(chart, from, to, ready && Boolean(to));
  const report = inventory.data?.report;
  const checks = useMemo(() => (inventory.data ? inventoryChecks(inventory.data.report, inventory.data.differences) : []), [inventory.data]);
  const difference = inventory.data ? INVENTORY_ROLES.map((role) => absUnits(inventory.data.differences[role])).reduce(maxUnits, 0n) : 0n;

  const selectedPeriod = periodOptions.find((o) => o.from === from && o.to === to)?.value ?? 'custom';
  const canCreate = can('entries.create');
  const money = (u: Units) => formatUnits(u, { decimals: currency.decimals, parentheses: true });
  const amount = (u: Units) => (u === 0n ? '' : money(u));
  const openLedger = (role: InventoryRole) => navigate(`/ledger?account=${chart.accounts[role]!.id}&from=${from}&to=${to}&view=gl`);

  const checkText = (check: InventoryCheck, lng?: 'en' | 'ar') =>
    t(`inventory.check.${check.message}`, {
      ...INVENTORY_CODES,
      n: check.n,
      difference: money(difference),
      date: formatDate(report?.lastCountDate),
      ...(lng ? { lng } : {}),
    });

  /** The account on the other side of the entry, or "Sundries" when there are several. */
  const counterLabel = (m: InventoryMovement) => {
    const account = m.counterLineCount === 1 && m.counterAccountId ? byId.get(m.counterAccountId) : undefined;
    return account ? `${account.code} ${name(account)}` : t('ledger.sundries');
  };

  const newPurchase = () =>
    navigate('/journal/entries/new', { state: prefillState({ debitAccountId: entryAccounts.purchases?.id ?? null, description: t('inventory.purchaseDescription') }) });
  const newOpening = () =>
    navigate('/journal/entries/new', {
      state: prefillState({ entryDate: from, entryType: 'opening', debitAccountId: entryAccounts.stock?.id ?? null, description: t('inventory.openingDescription') }),
    });

  const exportCsv = () => {
    if (!report) return;
    const rows: string[][] = [
      [t('inventory.openingStock'), INVENTORY_CODES.stock, money(report.openingStock)],
      [t('inventory.purchases'), INVENTORY_CODES.purchases, money(report.purchases)],
      [t('inventory.lessReductions'), INVENTORY_CODES.purchases, money(-report.purchaseReductions)],
      [t('inventory.netPurchases'), '', money(report.netPurchases)],
      [t('inventory.goodsAvailable'), '', money(report.goodsAvailable)],
      ...(report.otherStock !== 0n ? [[t('inventory.otherStock'), INVENTORY_CODES.stock, money(report.otherStock)]] : []),
      [t('inventory.lessClosing'), INVENTORY_CODES.stock, money(-report.closingStock)],
      [t('inventory.costOfGoods'), '', money(report.costOfGoods)],
    ];
    const movements = (list: InventoryMovement[]) =>
      list.map((m) => [formatDate(m.entryDate), m.entryNumber, m.description, counterLabel(m), t(`inventory.kinds.${m.kind}`), money(m.debit), money(m.credit), money(m.runningNet)]);
    const head = (debit: string, credit: string) => [
      t('ledger.transactionDate'),
      t('journal.entryNumber'),
      t('journal.description'),
      t('inventory.otherAccount'),
      t('inventory.kind'),
      debit,
      credit,
      t('ledger.runningBalance'),
    ];
    downloadCsv(`inventory-${from}-${to}`, [t('inventory.item'), t('accounts.code'), t('inventory.amount')], [
      ...rows,
      [],
      [t('inventory.purchasesTab', INVENTORY_CODES)],
      head(t('inventory.purchasesColumn'), t('inventory.reductionsColumn')),
      ...movements(report.purchaseMovements),
      [],
      [t('inventory.stockTab', INVENTORY_CODES)],
      head(t('inventory.in'), t('inventory.out')),
      ...movements(report.stockMovements),
    ]);
  };

  const statementRow = (label: ReactNode, value: Units, options: { role?: InventoryRole; indent?: boolean; strong?: boolean; tone?: 'danger' } = {}) => {
    const { role, indent, strong, tone } = options;
    return (
      <tr
        className={clsx('border-b border-line', strong && 'bg-subtle/70 font-semibold', role && 'cursor-pointer hover:bg-subtle', tone === 'danger' && 'text-danger')}
        onClick={role ? () => openLedger(role) : undefined}
        title={role ? t('trialBalance.drillDown') : undefined}
      >
        <td className={clsx('py-2.5 pe-3', indent ? 'ps-8 sm:ps-11' : 'ps-5 sm:ps-6')}>{label}</td>
        <td className="num w-[52px] px-1.5 py-2.5 text-[12.5px] text-muted sm:w-[90px] sm:px-3">
          {role && (
            <Link to={`/ledger?account=${chart.accounts[role]!.id}&from=${from}&to=${to}&view=gl`} onClick={(e) => e.stopPropagation()} className="hover:text-accent hover:underline">
              {INVENTORY_CODES[role]}
            </Link>
          )}
        </td>
        <td className="num w-[116px] whitespace-nowrap py-2.5 pe-5 ps-2 text-end sm:w-[190px] sm:pe-6 sm:ps-3">{money(value)}</td>
      </tr>
    );
  };

  const movementTable = (list: InventoryMovement[], kind: MovementTab) => {
    const stock = kind === 'stock';
    const debit = list.reduce((sum, m) => sum + m.debit, 0n);
    const credit = list.reduce((sum, m) => sum + m.credit, 0n);
    const closing = list.length ? list[list.length - 1].runningNet : stock ? report!.broughtForward : 0n;
    return (
      <Table minWidth={980}>
        <THead>
          <tr>
            <Th>{t('ledger.transactionDate')}</Th>
            <Th>{t('journal.entryNumber')}</Th>
            <Th className="w-[30%]">{t('journal.description')}</Th>
            <Th>{t('inventory.otherAccount')}</Th>
            <Th>{t('inventory.kind')}</Th>
            <Th numeric>{stock ? t('inventory.in') : t('inventory.purchasesColumn')}</Th>
            <Th numeric>{stock ? t('inventory.out') : t('inventory.reductionsColumn')}</Th>
            <Th numeric>{t('ledger.runningBalance')}</Th>
          </tr>
        </THead>
        <tbody>
          {stock && (
            <tr className="bg-subtle/60 text-ink-soft">
              <Td colSpan={7} className="font-medium">{t('inventory.broughtForward')}</Td>
              <Td numeric className="font-medium">{money(report!.broughtForward)}</Td>
            </tr>
          )}
          {list.map((m) => (
            <tr key={m.lineId} className="hover:bg-subtle">
              <Td className="num text-ink-soft">{formatDate(m.entryDate)}</Td>
              <Td className="whitespace-nowrap"><Link to={`/journal/entries/${m.entryId}`} className="num font-medium text-accent hover:underline">{m.entryNumber}</Link></Td>
              <Td><span className="line-clamp-2">{m.description}</span></Td>
              <Td className="text-ink-soft">{counterLabel(m)}</Td>
              <Td><Badge tone={KIND_TONE[m.kind]} dot={false}>{t(`inventory.kinds.${m.kind}`)}</Badge></Td>
              <Td numeric>{amount(m.debit)}</Td>
              <Td numeric>{amount(m.credit)}</Td>
              <Td numeric className="text-ink-soft">{money(m.runningNet)}</Td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><Td colSpan={8} className="py-8 text-center text-muted">{stock ? t('inventory.noStock') : t('inventory.noPurchases')}</Td></tr>
          )}
          <TotalsRow>
            <Td colSpan={5}>{t('common.total')}</Td>
            <Td numeric>{money(debit)}</Td>
            <Td numeric>{money(credit)}</Td>
            <Td numeric>{money(closing)}</Td>
          </TotalsRow>
        </tbody>
      </Table>
    );
  };

  return (
    <>
      <RoomHeading number="05" roomKey="inventory" />

      <Card className="mb-4 p-3 sm:p-4">
        <div className="grid grid-cols-2 items-end gap-3 lg:flex lg:flex-wrap">
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
            {t('common.from')}
            <Input type="date" className="num lg:w-[160px]" value={from} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
            {t('common.to')}
            <Input type="date" className="num lg:w-[160px]" value={to} onChange={(e) => update({ to: e.target.value })} />
          </label>
          <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[12px] text-muted">
            {t('trialBalance.period')}
            <Select
              className="lg:w-[210px]"
              value={selectedPeriod}
              onChange={(e) => {
                const option = periodOptions.find((o) => o.value === e.target.value);
                if (option) update({ from: option.from, to: option.to });
              }}
            >
              <option value="custom">{t('trialBalance.customRange')}</option>
              {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
          <div className="col-span-2 grid grid-cols-2 gap-2 lg:ms-auto lg:flex">
            {canCreate && (
              <>
                <Button variant="primary" icon={<Plus size={15} />} disabled={!ready} onClick={newPurchase}>{t('inventory.recordPurchase')}</Button>
                <Button icon={<ClipboardCheck size={15} />} disabled={!report} onClick={() => setCountOpen(true)}>{t('inventory.recordCount')}</Button>
              </>
            )}
            <Button icon={<FileSpreadsheet size={15} />} disabled={!report} onClick={exportCsv}>{t('common.exportCsv')}</Button>
            {can('reports.export') && <Button icon={<FileDown size={15} />} disabled={!report} onClick={() => setReportOpen(true)}>{t('common.exportPdf')}</Button>}
          </div>
        </div>
      </Card>

      {accountsLoading || fyLoading ? (
        <PageLoader />
      ) : chart.missing.length > 0 ? (
        <Alert tone="warning" icon={<TriangleAlert size={16} />} title={t('inventory.missingTitle', { codes: chart.missing.join(', ') })} action={<ButtonLink size="sm" to="/accounts">{t('nav.accounts')}</ButtonLink>}>
          {t('inventory.missingBody')}
        </Alert>
      ) : inventory.error ? (
        <Alert tone="danger">{errorMessage(inventory.error, t)}</Alert>
      ) : !report ? (
        <PageLoader />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line lg:grid-cols-4">
            {(
              [
                [t('inventory.openingStock'), report.openingStock],
                [t('inventory.netPurchases'), report.netPurchases],
                [t('inventory.closingStock'), report.closingStock],
                [t('inventory.costOfGoods'), report.costOfGoods],
              ] as Array<[string, Units]>
            ).map(([label, value], i) => (
              <div key={label} className={clsx('px-4 py-3', i === 3 ? 'bg-subtle' : 'bg-surface')}>
                <p className="text-[12px] text-muted">{label}</p>
                <p className="num mt-0.5 text-[16px] font-semibold">{money(value)}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card className="overflow-hidden">
              <CardHeader title={t('inventory.calculation')} description={t('inventory.calculationHint', { from: formatDate(from), to: formatDate(to), currency: currency.code })} />
              <table className="w-full border-collapse text-[13.5px]">
                <thead className="sr-only">
                  <tr>
                    <th>{t('inventory.item')}</th>
                    <th>{t('accounts.code')}</th>
                    <th>{t('inventory.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {statementRow(
                    <span className="flex flex-wrap items-center gap-x-3">
                      {t('inventory.openingStock')}
                      {canCreate && report.openingStock === 0n && report.stockMovements.length === 0 && (
                        <button
                          type="button"
                          className="text-[12.5px] font-medium text-accent hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            newOpening();
                          }}
                        >
                          {t('inventory.recordOpening')}
                        </button>
                      )}
                    </span>,
                    report.openingStock,
                    { role: 'stock' },
                  )}
                  {statementRow(t('inventory.purchases'), report.purchases, { role: 'purchases', indent: true })}
                  {report.purchaseReductions !== 0n && statementRow(t('inventory.lessReductions'), -report.purchaseReductions, { role: 'purchases', indent: true })}
                  {statementRow(t('inventory.netPurchases'), report.netPurchases)}
                  {statementRow(t('inventory.goodsAvailable'), report.goodsAvailable, { strong: true })}
                  {report.otherStock !== 0n && statementRow(t('inventory.otherStock'), report.otherStock, { role: 'stock', tone: 'danger' })}
                  {statementRow(t('inventory.lessClosing'), -report.closingStock, { role: 'stock' })}
                </tbody>
                <tfoot>
                  <tr className="bg-subtle font-semibold">
                    <td className="border-y-2 border-ink py-3 pe-3 ps-5 sm:ps-6" colSpan={2}>{t('inventory.costOfGoods')}</td>
                    <td className="num whitespace-nowrap border-y-2 border-ink py-3 pe-5 ps-3 text-end sm:pe-6">{money(report.costOfGoods)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="px-5 py-3 text-[12.5px] leading-relaxed text-muted sm:px-6">{t('inventory.note', INVENTORY_CODES)}</p>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title={t('inventory.checks')}
                actions={
                  checks.some((c) => c.status === 'danger') ? (
                    <Badge tone="danger">{t('inventory.statusReview')}</Badge>
                  ) : checks.some((c) => c.status === 'warning') ? (
                    <Badge tone="warning">{t('inventory.statusAttention')}</Badge>
                  ) : (
                    <Badge tone="success">{t('inventory.statusOk')}</Badge>
                  )
                }
              />
              <ul className="flex flex-col" role="status">
                {checks.map((check) => (
                  <li key={check.message} className="flex items-start gap-3 border-b border-line px-5 py-3 text-[13px] leading-relaxed last:border-b-0 sm:px-6">
                    <span className="mt-0.5 shrink-0">{CHECK_STYLE[check.status].icon}</span>
                    <span className={CHECK_STYLE[check.status].text}>{checkText(check)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {(report.issues.length > 0 || report.duplicates.length > 0) && (
            <Card className="mb-4 overflow-hidden">
              <CardHeader title={t('inventory.review')} description={t('inventory.reviewHint')} />
              <Table minWidth={760}>
                <THead>
                  <tr>
                    <Th>{t('ledger.transactionDate')}</Th>
                    <Th>{t('journal.entryNumber')}</Th>
                    <Th className="w-[55%]">{t('inventory.reason')}</Th>
                    <Th numeric>{t('inventory.amount')}</Th>
                  </tr>
                </THead>
                <tbody>
                  {report.issues.map((issue) => (
                    <tr key={issue.entryId}>
                      <Td className="num text-ink-soft">{formatDate(issue.entryDate)}</Td>
                      <Td className="whitespace-nowrap"><Link to={`/journal/entries/${issue.entryId}`} className="num font-medium text-accent hover:underline">{issue.entryNumber}</Link></Td>
                      <Td>
                        <p className="text-danger">{t(`inventory.issues.${issue.kind}`, INVENTORY_CODES)}</p>
                        <p className="text-[12px] text-muted">{issue.description}</p>
                      </Td>
                      <Td numeric>{money(issue.amount)}</Td>
                    </tr>
                  ))}
                  {report.duplicates.map((group) => (
                    <tr key={group.entries[0].entryId}>
                      <Td className="num text-ink-soft">{formatDate(group.entryDate)}</Td>
                      <Td>
                        <span className="flex flex-col gap-0.5">
                          {group.entries.map((e) => (
                            <Link key={e.entryId} to={`/journal/entries/${e.entryId}`} className="num font-medium text-accent hover:underline">{e.entryNumber}</Link>
                          ))}
                        </span>
                      </Td>
                      <Td className="text-warning">{t('inventory.issues.duplicate')}</Td>
                      <Td numeric>{money(group.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <Card className="overflow-hidden">
            <Tabs
              className="px-3 sm:px-4"
              value={tab}
              onChange={(value) => update({ tab: value === 'stock' ? 'stock' : null })}
              items={[
                { value: 'purchases', label: t('inventory.purchasesTab', INVENTORY_CODES), count: report.purchaseMovements.length },
                { value: 'stock', label: t('inventory.stockTab', INVENTORY_CODES), count: report.stockMovements.length },
              ]}
            />
            {tab === 'stock' ? movementTable(report.stockMovements, 'stock') : movementTable(report.purchaseMovements, 'purchases')}
          </Card>

          <StockCountDialog
            open={countOpen}
            onClose={() => setCountOpen(false)}
            date={to}
            bookStock={report.closingStock}
            hasOpeningStock={report.openingStock !== 0n}
            chart={chart}
            entryAccounts={entryAccounts}
          />
        </>
      )}

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t('pdf.inventory.title')}
        fileName={`inventory-${to}`}
        defaultSignatures={identity.signatures}
        generate={async ({ language: lng, signatures }) => {
          if (!report) throw new Error('NO_DATA');
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(
            <pdf.InventoryReportDocument
              context={pdf.reportContext(lng, identity.company, identity.generatedBy)}
              decimals={currency.decimals}
              currencyCode={currency.code}
              from={from}
              to={to}
              report={report}
              checks={checks.map((check) => ({ status: check.status, text: checkText(check, lng) }))}
              counterLabel={(m) => {
                const account = m.counterLineCount === 1 && m.counterAccountId ? byId.get(m.counterAccountId) : undefined;
                return account ? (lng === 'ar' ? account.name_ar : account.name_en) : t('ledger.sundries', { lng });
              }}
              signatures={signatures}
            />,
          );
        }}
      />
    </>
  );
}
