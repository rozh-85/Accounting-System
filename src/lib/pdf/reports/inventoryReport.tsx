import { Text, View } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { formatUnits, INVENTORY_CODES, type InventoryCheck, type InventoryMovement, type InventoryReport, type Units } from '@/lib/accounting';
import { formatDate } from '@/lib/formatting';
import { colors, PdfTable, ReportDocument, ReportHeader, ReportPage, SignatureBlock, useReport, type PdfColumn, type PdfRow, type ReportContextValue } from '../primitives';

export interface InventoryReportInput {
  context: ReportContextValue;
  decimals: number;
  currencyCode: string;
  from: string | null;
  to: string;
  report: InventoryReport;
  checks: Array<{ status: InventoryCheck['status']; text: string }>;
  counterLabel: (movement: InventoryMovement) => string;
  signatures: boolean;
}

const STATUS_LABEL = { ok: 'inventory.statusOk', warning: 'inventory.statusAttention', danger: 'inventory.statusReview' } as const;

/** The checks, one line each, and the note. Sentences set their own direction, which react-pdf does not inherit. */
function Checks({ checks }: Pick<InventoryReportInput, 'checks'>) {
  const r = useReport();
  const sentence = { direction: r.rtl ? 'rtl' : 'ltr', textAlign: r.start } as Style;
  return (
    <View wrap={false} style={{ marginTop: 12 }}>
      {checks.map((check) => (
        <View key={check.text} style={{ flexDirection: r.row, paddingVertical: 3, borderBottomWidth: 0.4, borderBottomColor: colors.line }}>
          <Text style={{ ...sentence, width: 84, paddingHorizontal: 4, fontWeight: 600, color: check.status === 'ok' ? colors.accent : colors.danger }}>{r.t(STATUS_LABEL[check.status])}</Text>
          <Text style={{ ...sentence, flex: 1, paddingHorizontal: 4 }}>{check.text}</Text>
        </View>
      ))}
      <Text style={{ ...sentence, marginTop: 6, fontSize: 7.4, color: colors.muted }}>{r.t('inventory.note', INVENTORY_CODES)}</Text>
    </View>
  );
}

/** Inventory report — تقرير المخزون. */
export function InventoryReportDocument({ context, decimals, currencyCode, from, to, report, checks, counterLabel, signatures }: InventoryReportInput) {
  const { t } = context;
  const title = t('pdf.inventory.title');
  const money = (v: Units) => formatUnits(v, { decimals, parentheses: true });
  const blank = (v: Units) => (v === 0n ? '' : money(v));

  const statementColumns: PdfColumn[] = [
    { key: 'label', header: t('inventory.item'), flex: 1 },
    { key: 'code', header: t('accounts.code'), width: 60 },
    { key: 'amount', header: t('inventory.amount'), width: 110, numeric: true },
  ];
  const row = (key: string, label: string, code: string, value: Units, extra: Partial<PdfRow> = {}): PdfRow => ({ key, cells: { label, code, amount: money(value) }, ...extra });
  const statement: PdfRow[] = [
    row('opening', t('inventory.openingStock'), INVENTORY_CODES.stock, report.openingStock),
    row('purchases', t('inventory.purchases'), INVENTORY_CODES.purchases, report.purchases, { indent: 1, indentColumn: 'label' }),
    ...(report.purchaseReductions !== 0n
      ? [row('reductions', t('inventory.lessReductions'), INVENTORY_CODES.purchases, -report.purchaseReductions, { indent: 1, indentColumn: 'label' })]
      : []),
    row('net', t('inventory.netPurchases'), '', report.netPurchases),
    row('available', t('inventory.goodsAvailable'), '', report.goodsAvailable, { variant: 'group' }),
    ...(report.otherStock !== 0n ? [row('other', t('inventory.otherStock'), INVENTORY_CODES.stock, report.otherStock)] : []),
    row('closing', t('inventory.lessClosing'), INVENTORY_CODES.stock, -report.closingStock),
    row('cost', t('inventory.costOfGoods'), '', report.costOfGoods, { variant: 'total' }),
  ];

  const movementColumns = (debit: string, credit: string): PdfColumn[] => [
    { key: 'date', header: t('ledger.transactionDate'), width: 52 },
    { key: 'entry', header: t('journal.entryNumber'), width: 70 },
    { key: 'description', header: t('journal.description'), flex: 1.2 },
    { key: 'counter', header: t('inventory.otherAccount'), flex: 1 },
    { key: 'debit', header: debit, width: 68, numeric: true },
    { key: 'credit', header: credit, width: 68, numeric: true },
    { key: 'balance', header: t('ledger.runningBalance'), width: 70, numeric: true },
  ];
  const movementRows = (list: InventoryMovement[], broughtForward: Units | null): PdfRow[] => [
    ...(broughtForward !== null ? [{ key: 'bf', variant: 'muted', cells: { description: t('inventory.broughtForward'), balance: money(broughtForward) } } as PdfRow] : []),
    ...list.map((m) => ({
      key: m.lineId,
      cells: {
        date: formatDate(m.entryDate),
        entry: m.entryNumber,
        description: m.description,
        counter: counterLabel(m),
        debit: blank(m.debit),
        credit: blank(m.credit),
        balance: money(m.runningNet),
      },
    })),
    ...(list.length > 0
      ? [
          {
            key: 'total',
            variant: 'total',
            cells: {
              description: t('common.total'),
              debit: money(list.reduce((sum, m) => sum + m.debit, 0n)),
              credit: money(list.reduce((sum, m) => sum + m.credit, 0n)),
              balance: money(list[list.length - 1].runningNet),
            },
          } as PdfRow,
        ]
      : []),
  ];

  return (
    <ReportDocument context={context} title={title}>
      <ReportPage title={title}>
        <ReportHeader
          title={title}
          subtitle={`${formatDate(from) || '…'} – ${formatDate(to)}`}
          meta={[
            { label: t('pdf.inventory.method'), value: t('pdf.inventory.periodic') },
            { label: t('pdf.currency'), value: currencyCode },
          ]}
        />
        <PdfTable columns={statementColumns} rows={statement} repeatHeader={false} />
        <Checks checks={checks} />

        <View style={{ marginTop: 16 }}>
          <PdfTable columns={[{ key: 'label', header: t('inventory.purchasesTab', INVENTORY_CODES), flex: 1 }]} rows={[]} repeatHeader={false} />
          <PdfTable columns={movementColumns(t('inventory.purchasesColumn'), t('inventory.reductionsColumn'))} rows={movementRows(report.purchaseMovements, null)} emptyLabel={t('inventory.noPurchases')} />
        </View>
        <View style={{ marginTop: 16 }}>
          <PdfTable columns={[{ key: 'label', header: t('inventory.stockTab', INVENTORY_CODES), flex: 1 }]} rows={[]} repeatHeader={false} />
          <PdfTable columns={movementColumns(t('inventory.in'), t('inventory.out'))} rows={movementRows(report.stockMovements, report.broughtForward)} emptyLabel={t('inventory.noStock')} />
        </View>
        {signatures && <SignatureBlock labels={[t('pdf.preparedBy'), t('pdf.reviewedBy'), t('pdf.approvedBy')]} />}
      </ReportPage>
    </ReportDocument>
  );
}
