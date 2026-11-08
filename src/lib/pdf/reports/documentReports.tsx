import { Text, View } from '@react-pdf/renderer';
import { amountInWords, formatUnits, orderForPresentation, toUnits, type CurrencyWords } from '@/lib/accounting';
import { formatDate, formatDateTime, formatRate } from '@/lib/formatting';
import type { JournalEntryDetail, VoucherDetail } from '@/types/database';
import {
  KeyValueGrid,
  PdfTable,
  ReportDocument,
  ReportHeader,
  ReportPage,
  SignatureBlock,
  StatusLine,
  colors,
  useReport,
  type MetaItem,
  type PdfColumn,
  type PdfRow,
  type ReportContextValue,
} from '../primitives';

function lineRows(
  lines: Array<{ id: string; account_code: string; account_name_en: string; account_name_ar: string; debit_amount: number | string; credit_amount: number | string; description: string | null }>,
  language: 'en' | 'ar',
  decimals: number,
  t: ReportContextValue['t'],
) {
  const withUnits = lines.map((l) => ({ ...l, debit: toUnits(l.debit_amount), credit: toUnits(l.credit_amount) }));
  const ordered = orderForPresentation(withUnits);
  const debitCount = ordered.filter((l) => l.debit > 0n).length;
  const creditCount = ordered.length - debitCount;
  let totalDebit = 0n;
  let totalCredit = 0n;
  const rows: PdfRow[] = [];
  for (const l of ordered) {
    totalDebit += l.debit;
    totalCredit += l.credit;
    const side = l.debit > 0n ? 'debit' : 'credit';
    const grouped = (side === 'debit' ? debitCount : creditCount) > 1 && language === 'ar';
    const prefix = grouped ? t('journal.notation.account') : side === 'debit' ? t('journal.notation.from') : t('journal.notation.to');
    rows.push({
      key: l.id,
      indent: side === 'credit' ? 3 : 0,
      indentColumn: 'account',
      cells: {
        code: l.account_code,
        account: `${prefix ? `${prefix} ` : ''}${language === 'ar' ? l.account_name_ar : l.account_name_en}`,
        description: l.description ?? '',
        debit: l.debit ? formatUnits(l.debit, { decimals }) : '',
        credit: l.credit ? formatUnits(l.credit, { decimals }) : '',
      },
    });
  }
  rows.push({ key: 'total', variant: 'total', cells: { account: t('common.total'), debit: formatUnits(totalDebit, { decimals }), credit: formatUnits(totalCredit, { decimals }) } });
  return { rows, balanced: totalDebit === totalCredit && totalDebit > 0n };
}

function linesColumns(t: ReportContextValue['t']): PdfColumn[] {
  return [
    { key: 'code', header: t('accounts.code'), width: 42 },
    { key: 'account', header: t('journal.account'), flex: 1.3 },
    { key: 'description', header: t('journal.lineDescription'), flex: 1 },
    { key: 'debit', header: t('journal.debit'), width: 74, numeric: true },
    { key: 'credit', header: t('journal.credit'), width: 74, numeric: true },
  ];
}

function TextBlock({ label, value }: { label: string; value: string | null | undefined }) {
  const r = useReport();
  if (!value) return null;
  return (
    <View style={{ marginTop: 7 }} wrap={false}>
      <Text style={{ fontSize: 7.2, color: colors.muted, textAlign: r.start }}>{label}</Text>
      <Text style={{ marginTop: 2, textAlign: r.start }}>{value}</Text>
    </View>
  );
}

/** Printable journal entry (قيد يومية). */
export function JournalEntryDocument({ context, decimals, entry }: { context: ReportContextValue; decimals: number; entry: JournalEntryDetail }) {
  const { t, language } = context;
  const title = t('pdf.entry.title');
  const { rows, balanced } = lineRows(entry.lines, language, decimals, t);
  const items: MetaItem[] = [
    { label: t('journal.entryDate'), value: formatDate(entry.entry_date) },
    { label: t('journal.entryType'), value: t(`entryTypes.${entry.entry_type}`) },
    { label: t('journal.status'), value: t(`status.${entry.status}`) },
    { label: t('journal.voucherType'), value: entry.voucher_type ? t(`voucherTypes.${entry.voucher_type}`) : '—' },
    { label: t('journal.voucherNumber'), value: entry.voucher_number ?? '—' },
    { label: t('journal.reference'), value: entry.reference_number ?? '—' },
    { label: t('journal.currency'), value: entry.foreign_currency ?? entry.currency_code },
    ...(entry.foreign_currency
      ? [
          { label: t('journal.amountIn', { currency: entry.foreign_currency }), value: formatUnits(entry.lines.reduce((sum, l) => sum + toUnits(l.foreign_debit), 0n), { decimals: 2 }) },
          { label: t('journal.exchangeRate'), value: `1 ${entry.foreign_currency} = ${formatRate(entry.exchange_rate)} ${entry.currency_code}` },
        ]
      : []),
    { label: t('journal.createdBy'), value: entry.created_by_name ?? '—' },
    { label: t('journal.approvedBy'), value: entry.approved_by_name ?? '—' },
    { label: t('journal.postedAt'), value: entry.posted_at ? formatDateTime(entry.posted_at) : '—' },
    { label: t('journal.period'), value: entry.period_name ?? '—' },
  ];
  return (
    <ReportDocument context={context} title={`${title} ${entry.entry_number}`}>
      <ReportPage title={`${title} ${entry.entry_number}`}>
        <ReportHeader compact title={title} subtitle={entry.entry_number} />
        <KeyValueGrid items={items} />
        <TextBlock label={t('journal.description')} value={entry.description} />
        <View style={{ marginTop: 9 }}>
          <PdfTable columns={linesColumns(t)} rows={rows} />
        </View>
        <StatusLine ok={balanced}>{balanced ? t('journal.balanced') : t('journal.unbalanced')}</StatusLine>
        {entry.reversal_of_number && <TextBlock label={t('journal.reversalOf')} value={entry.reversal_of_number} />}
        {entry.reversed_entry_number && <TextBlock label={t('journal.reversedBy')} value={entry.reversed_entry_number} />}
        <TextBlock label={t('journal.notes')} value={entry.notes} />
        <SignatureBlock
          labels={[t('pdf.preparedBy'), t('pdf.reviewedBy'), t('pdf.approvedBy')]}
          names={[entry.created_by_name, null, entry.approved_by_name]}
        />
      </ReportPage>
    </ReportDocument>
  );
}

/** Printable voucher (سند قبض / سند صرف / سند قيد / سند تحويل). */
export function VoucherDocument({
  context,
  decimals,
  currency,
  voucher,
  journalLines,
}: {
  context: ReportContextValue;
  decimals: number;
  currency: CurrencyWords;
  voucher: VoucherDetail;
  journalLines: JournalEntryDetail['lines'];
}) {
  const { t, language } = context;
  const title = t(`pdf.voucher.${voucher.voucher_type}`);
  const amount = toUnits(voucher.amount);
  const acct = (id: string | null) => {
    if (!id) return '—';
    const a = voucher.accounts[id];
    return a ? `${a.code} — ${language === 'ar' ? a.name_ar : a.name_en}` : '—';
  };

  const items: MetaItem[] = [
    { label: t('vouchers.date'), value: formatDate(voucher.voucher_date) },
  ];
  if (voucher.voucher_type === 'receipt' || voucher.voucher_type === 'payment') {
    items.push(
      { label: voucher.voucher_type === 'receipt' ? t('vouchers.receivedFrom') : t('vouchers.paidTo'), value: voucher.party_name ?? '—' },
      { label: t('vouchers.paymentMethod'), value: voucher.payment_method ? t(`paymentMethods.${voucher.payment_method}`) : '—' },
      { label: t('vouchers.cashAccount'), value: acct(voucher.cash_account_id) },
      { label: voucher.voucher_type === 'receipt' ? t('vouchers.counterAccount') : t('vouchers.debitAccount'), value: acct(voucher.counter_account_id) },
    );
    if (voucher.cheque_number) items.push({ label: t('vouchers.chequeNumber'), value: voucher.cheque_number });
  }
  if (voucher.voucher_type === 'transfer') {
    items.push({ label: t('vouchers.fromAccount'), value: acct(voucher.from_account_id) }, { label: t('vouchers.toAccount'), value: acct(voucher.to_account_id) });
  }
  items.push(
    { label: t('journal.reference'), value: voucher.reference_number ?? '—' },
    { label: t('journal.status'), value: t(`status.${voucher.status}`) },
    { label: t('vouchers.journalEntry'), value: voucher.journal_entry_number ?? '—' },
  );

  const { rows } = lineRows(journalLines, language, decimals, t);
  const receiverLabel = voucher.voucher_type === 'receipt' ? t('pdf.voucher.payer') : voucher.voucher_type === 'payment' ? t('pdf.voucher.receiver') : t('pdf.reviewedBy');

  return (
    <ReportDocument context={context} title={`${title} ${voucher.voucher_number}`}>
      <ReportPage title={`${title} ${voucher.voucher_number}`}>
        <ReportHeader compact title={title} subtitle={voucher.voucher_number} />
        <View wrap={false} style={{ borderWidth: 1, borderColor: colors.ink, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 8 }}>
          <Text style={{ fontSize: 8, color: colors.muted, textAlign: context.language === 'ar' ? 'right' : 'left' }}>{t('vouchers.amount')}</Text>
          <Text style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginTop: 1, direction: 'ltr', textAlign: context.language === 'ar' ? 'right' : 'left' } as never}>
            {formatUnits(amount, { decimals })} {voucher.currency_code}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 9, textAlign: context.language === 'ar' ? 'right' : 'left' }}>{amountInWords(amount, currency, language)}</Text>
        </View>
        <KeyValueGrid items={items} />
        <TextBlock label={t('journal.description')} value={voucher.description} />
        {journalLines.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontSize: 8, color: colors.muted, marginBottom: 3, textAlign: context.language === 'ar' ? 'right' : 'left' }}>{t('vouchers.accountingEffect')}</Text>
            <PdfTable columns={linesColumns(t)} rows={rows} repeatHeader={false} />
          </View>
        )}
        <TextBlock label={t('journal.notes')} value={voucher.notes} />
        <SignatureBlock labels={[t('pdf.preparedBy'), receiverLabel, t('pdf.approvedBy')]} names={[voucher.created_by_name, voucher.voucher_type === 'receipt' || voucher.voucher_type === 'payment' ? voucher.party_name : null, voucher.approved_by_name]} />
      </ReportPage>
    </ReportDocument>
  );
}
