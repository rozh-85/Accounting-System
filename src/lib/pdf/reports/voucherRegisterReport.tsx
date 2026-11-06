import { View } from '@react-pdf/renderer';
import { formatUnits, toUnits, type VoucherStatus, type VoucherType } from '@/lib/accounting';
import { formatDate } from '@/lib/formatting';
import { Note, PdfTable, ReportDocument, ReportHeader, ReportPage, SignatureBlock, type PdfColumn, type PdfRow, type ReportContextValue } from '../primitives';

export interface VoucherRegisterRow {
  id: string;
  voucher_type: VoucherType;
  voucher_number: string;
  voucher_date: string;
  status: VoucherStatus;
  party_name: string | null;
  amount: number | string;
  description: string;
  reference_number: string | null;
  journal_entry_number: string | null;
}

export interface VoucherRegisterInput {
  context: ReportContextValue;
  decimals: number;
  currencyCode: string;
  from: string | null;
  to: string | null;
  typeLabel: string;
  statusLabel: string;
  vouchers: VoucherRegisterRow[];
  signatures: boolean;
}

const TYPE_ORDER: VoucherType[] = ['receipt', 'payment', 'journal', 'transfer'];

/** Voucher register — سجل السندات: every voucher in a range, with totals by type. */
export function VoucherRegisterReport({ context, decimals, currencyCode, from, to, typeLabel, statusLabel, vouchers, signatures }: VoucherRegisterInput) {
  const { t } = context;
  const title = t('pdf.voucherRegister.title');
  const fmt = (v: bigint) => formatUnits(v, { decimals, parentheses: true });

  const columns: PdfColumn[] = [
    { key: 'date', header: t('vouchers.date'), width: 54 },
    { key: 'number', header: t('vouchers.number'), width: 76 },
    { key: 'type', header: t('vouchers.type'), width: 62 },
    { key: 'details', header: t('pdf.voucherRegister.partyAndStatement'), flex: 1 },
    { key: 'entry', header: t('vouchers.journalEntry'), width: 76 },
    { key: 'status', header: t('journal.status'), width: 50 },
    { key: 'amount', header: t('vouchers.amount'), width: 72, numeric: true },
  ];

  const ordered = [...vouchers].sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_number.localeCompare(b.voucher_number));
  const totals = new Map<VoucherType, { amount: bigint; count: number }>();
  const rows: PdfRow[] = [];

  for (const v of ordered) {
    const amount = toUnits(v.amount);
    const reversed = v.status === 'reversed';
    if (!reversed) {
      const total = totals.get(v.voucher_type) ?? { amount: 0n, count: 0 };
      totals.set(v.voucher_type, { amount: total.amount + amount, count: total.count + 1 });
    }
    rows.push({
      key: v.id,
      variant: reversed ? 'muted' : 'normal',
      cells: {
        date: formatDate(v.voucher_date),
        number: v.voucher_number,
        type: t(`voucherTypes.${v.voucher_type}`),
        details: [v.party_name, v.description].filter(Boolean).join('\n'),
        entry: v.journal_entry_number ?? '—',
        status: t(`status.${v.status}`),
        amount: formatUnits(amount, { decimals }),
      },
    });
  }

  if (ordered.length > 0) {
    let first = true;
    for (const type of TYPE_ORDER) {
      const total = totals.get(type);
      if (!total) continue;
      rows.push({
        key: `total-${type}`,
        variant: first ? 'subtotal' : 'normal',
        cells: { details: t(`pdf.voucherRegister.totals.${type}`, { n: total.count }), amount: fmt(total.amount) },
      });
      first = false;
    }
    const receipts = totals.get('receipt')?.amount ?? 0n;
    const payments = totals.get('payment')?.amount ?? 0n;
    const hasCash = totals.has('receipt') || totals.has('payment');
    const all = [...totals.values()].reduce((sum, total) => sum + total.amount, 0n);
    rows.push({
      key: 'total',
      variant: 'total',
      cells: { details: hasCash ? t('pdf.voucherRegister.net') : t('pdf.grandTotal'), amount: fmt(hasCash ? receipts - payments : all) },
    });
  }

  const period = from || to ? `${formatDate(from) || '…'} – ${formatDate(to) || '…'}` : t('pdf.allDates');

  return (
    <ReportDocument context={context} title={title}>
      <ReportPage title={title}>
        <ReportHeader
          title={title}
          subtitle={`${t('pdf.period')}: ${period}`}
          meta={[
            { label: t('vouchers.type'), value: typeLabel },
            { label: t('pdf.status'), value: statusLabel },
            { label: t('pdf.voucherRegister.count'), value: String(ordered.length) },
            { label: t('pdf.currency'), value: currencyCode },
          ]}
        />
        <PdfTable columns={columns} rows={rows} emptyLabel={t('pdf.noData')} />
        <View>
          <Note>{t('pdf.voucherRegister.note')}</Note>
        </View>
        {signatures && <SignatureBlock labels={[t('pdf.preparedBy'), t('pdf.approvedBy')]} />}
      </ReportPage>
    </ReportDocument>
  );
}
