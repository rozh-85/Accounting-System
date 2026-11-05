import { View } from '@react-pdf/renderer';
import { formatUnits, toUnits, type EntryStatus, type EntryType, type VoucherType } from '@/lib/accounting';
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

export interface JournalReportLine {
  entry_id: string;
  entry_number: string;
  entry_date: string;
  entry_type: EntryType;
  status: EntryStatus;
  voucher_type: VoucherType | null;
  voucher_number: string | null;
  entry_description: string;
  reference_number: string | null;
  line_number: number;
  account_code: string;
  account_name_en: string;
  account_name_ar: string;
  line_description: string | null;
  debit_amount: number | string;
  credit_amount: number | string;
}

export interface JournalReportInput {
  context: ReportContextValue;
  decimals: number;
  currencyCode: string;
  from: string | null;
  to: string | null;
  statusLabel: string;
  lines: JournalReportLine[];
  signatures: boolean;
}

/** Daily journal report — تقرير القيود اليومية. */
export function JournalReport({ context, decimals, currencyCode, from, to, statusLabel, lines, signatures }: JournalReportInput) {
  const { t, language } = context;
  const ar = language === 'ar';
  const fmt = (v: bigint) => (v === 0n ? '' : formatUnits(v, { decimals }));
  const title = t('pdf.journal.title');

  const columns: PdfColumn[] = [
    { key: 'date', header: t('journal.date'), width: 56 },
    { key: 'number', header: t('journal.entryNumber'), width: 78 },
    { key: 'code', header: t('accounts.code'), width: 38 },
    { key: 'account', header: t('pdf.journal.accountAndStatement'), flex: 1 },
    { key: 'debit', header: t('journal.debit'), width: 72, numeric: true },
    { key: 'credit', header: t('journal.credit'), width: 72, numeric: true },
  ];

  const rows: PdfRow[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;
  const entries = new Map<string, JournalReportLine[]>();
  for (const line of lines) {
    const list = entries.get(line.entry_id) ?? [];
    list.push(line);
    entries.set(line.entry_id, list);
  }

  for (const [entryId, entryLines] of entries) {
    const head = entryLines[0];
    // Left-to-right marks keep Latin references in place inside Arabic lines.
    const ltr = (value: string) => (ar ? `‎${value}‎` : value);
    const refs = [
      head.voucher_number ? `${t('journal.voucherNumber')}: ${ltr(head.voucher_number)}` : null,
      head.reference_number ? `${t('journal.reference')}: ${ltr(head.reference_number)}` : null,
      `${t(`entryTypes.${head.entry_type}`)} · ${t(`status.${head.status}`)}`,
    ].filter(Boolean);
    rows.push({
      key: `${entryId}-h`,
      variant: 'group',
      cells: { date: formatDate(head.entry_date), number: head.entry_number, account: `${head.entry_description}\n${refs.join('   ·   ')}` },
    });

    const debits = entryLines.filter((l) => toUnits(l.debit_amount) > 0n);
    const credits = entryLines.filter((l) => toUnits(l.debit_amount) === 0n);
    const sundry = (side: 'debit' | 'credit', list: JournalReportLine[]) => {
      if (list.length > 1 && ar) {
        rows.push({
          key: `${entryId}-${side}-s`,
          variant: 'muted',
          indent: side === 'credit' ? 3 : 1,
          cells: { account: side === 'debit' ? t('journal.notation.fromSundries') : t('journal.notation.toSundries') },
        });
      }
      for (const l of list) {
        const debit = toUnits(l.debit_amount);
        const credit = toUnits(l.credit_amount);
        totalDebit += debit;
        totalCredit += credit;
        const name = ar ? l.account_name_ar : l.account_name_en;
        const prefix = list.length > 1 && ar ? t('journal.notation.account') : side === 'debit' ? t('journal.notation.from') : t('journal.notation.to');
        rows.push({
          key: `${entryId}-${l.line_number}`,
          indent: side === 'credit' ? 3 : 1,
          cells: {
            code: l.account_code,
            account: `${prefix ? `${prefix} ` : ''}${name}${l.line_description ? `  —  ${l.line_description}` : ''}`,
            debit: fmt(debit),
            credit: fmt(credit),
          },
        });
      }
    };
    sundry('debit', debits);
    sundry('credit', credits);
  }

  rows.push({
    key: 'total',
    variant: 'total',
    cells: { account: t('pdf.grandTotal'), debit: formatUnits(totalDebit, { decimals }), credit: formatUnits(totalCredit, { decimals }) },
  });

  const period = from || to ? `${formatDate(from) || '…'} – ${formatDate(to) || '…'}` : t('pdf.allDates');
  const balanced = totalDebit === totalCredit;

  return (
    <ReportDocument context={context} title={title}>
      <ReportPage title={title}>
        <ReportHeader
          title={title}
          subtitle={`${t('pdf.period')}: ${period}`}
          meta={[
            { label: t('pdf.status'), value: statusLabel },
            { label: t('pdf.entries'), value: String(entries.size) },
            { label: t('pdf.currency'), value: currencyCode },
          ]}
        />
        <PdfTable columns={columns} rows={rows} emptyLabel={t('pdf.noData')} />
        <StatusLine ok={balanced}>
          {balanced ? t('pdf.journal.balanced') : t('pdf.journal.unbalanced', { difference: formatUnits(totalDebit - totalCredit, { decimals }) })}
        </StatusLine>
        <View>
          <Note>{t('pdf.journal.note')}</Note>
        </View>
        {signatures && <SignatureBlock labels={[t('pdf.preparedBy'), t('pdf.approvedBy')]} />}
      </ReportPage>
    </ReportDocument>
  );
}
