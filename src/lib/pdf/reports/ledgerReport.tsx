import { Text, View } from '@react-pdf/renderer';
import { absUnits, buildTAccount, formatUnits, type LedgerStatement, type Units } from '@/lib/accounting';
import { formatDate } from '@/lib/formatting';
import {
  PdfTable,
  ReportDocument,
  ReportHeader,
  ReportPage,
  SignatureBlock,
  colors,
  useReport,
  type PdfColumn,
  type PdfRow,
  type ReportContextValue,
} from '../primitives';

export interface LedgerReportAccount {
  code: string;
  name_en: string;
  name_ar: string;
  /** Present when several posting accounts are aggregated under a parent. */
  aggregated?: boolean;
  statement: LedgerStatement;
}

export interface LedgerReportInput {
  context: ReportContextValue;
  decimals: number;
  currencyCode: string;
  from: string | null;
  to: string | null;
  accounts: LedgerReportAccount[];
  /** Resolves counter-account names for T-account items. */
  accountLabel: (accountId: string | null, counterCount: number) => string;
  signatures: boolean;
}

function balanceText(net: Units, decimals: number, t: ReportContextValue['t']) {
  if (net === 0n) return formatUnits(0n, { decimals });
  return `${formatUnits(absUnits(net), { decimals })} ${net > 0n ? t('ledger.dr') : t('ledger.cr')}`;
}

/** Detailed general ledger statement — كشف حساب الأستاذ. One section per account. */
export function LedgerStatementReport({ context, decimals, currencyCode, from, to, accounts, signatures }: LedgerReportInput) {
  const { t } = context;
  const title = t('pdf.ledger.title');
  const fmt = (v: Units) => (v === 0n ? '' : formatUnits(v, { decimals }));
  const period = `${formatDate(from) || '…'} – ${formatDate(to) || '…'}`;
  const columns: PdfColumn[] = [
    { key: 'date', header: t('ledger.transactionDate'), width: 52 },
    { key: 'entry', header: t('journal.entryNumber'), width: 72 },
    { key: 'voucher', header: t('journal.voucherNumber'), width: 66 },
    { key: 'description', header: t('journal.description'), flex: 1 },
    { key: 'debit', header: t('journal.debit'), width: 68, numeric: true },
    { key: 'credit', header: t('journal.credit'), width: 68, numeric: true },
    { key: 'balance', header: t('ledger.runningBalance'), width: 82, numeric: true },
  ];

  return (
    <ReportDocument context={context} title={title}>
      {accounts.map((account) => {
        const s = account.statement;
        const rows: PdfRow[] = [
          { key: 'opening', variant: 'muted', cells: { date: formatDate(from), description: t('ledger.openingBalance'), balance: balanceText(s.openingNet, decimals, t) } },
          ...s.movements.map((m) => ({
            key: m.lineId,
            cells: {
              date: formatDate(m.entryDate),
              entry: m.entryNumber,
              voucher: m.voucherNumber ?? '',
              description: m.description,
              debit: fmt(m.debit),
              credit: fmt(m.credit),
              balance: balanceText(m.runningNet, decimals, t),
            },
          })),
          { key: 'totals', variant: 'subtotal', cells: { description: t('ledger.periodTotals'), debit: formatUnits(s.periodDebit, { decimals }), credit: formatUnits(s.periodCredit, { decimals }) } },
          { key: 'closing', variant: 'total', cells: { date: formatDate(to), description: t('ledger.endingBalance'), balance: balanceText(s.closingNet, decimals, t) } },
        ];
        const name = context.language === 'ar' ? account.name_ar : account.name_en;
        return (
          <ReportPage key={account.code} title={title}>
            <ReportHeader
              title={title}
              subtitle={`${account.code} — ${name}${account.aggregated ? ` (${t('ledger.aggregated')})` : ''}`}
              meta={[
                { label: t('pdf.period'), value: period },
                { label: t('ledger.openingBalance'), value: balanceText(s.openingNet, decimals, t) },
                { label: t('ledger.endingBalance'), value: balanceText(s.closingNet, decimals, t) },
                { label: t('pdf.currency'), value: currencyCode },
              ]}
            />
            <PdfTable columns={columns} rows={rows} />
            {signatures && <SignatureBlock labels={[t('pdf.preparedBy'), t('pdf.reviewedBy')]} />}
          </ReportPage>
        );
      })}
    </ReportDocument>
  );
}

function TSide({ items, label }: { items: Array<{ key: string; date: string; ref: string; text: string; amount: string; strong?: boolean }>; label: string }) {
  const r = useReport();
  return (
    <View style={{ paddingHorizontal: 6 }}>
      <Text style={{ textAlign: 'center', fontWeight: 600, fontSize: 9, paddingBottom: 4, color: colors.inkSoft }}>{label}</Text>
      {items.map((item) => (
        <View key={item.key} wrap={false} style={{ flexDirection: r.row, paddingVertical: 2.6, borderBottomWidth: 0.4, borderBottomColor: colors.line }}>
          <Text style={{ width: 46, textAlign: r.start, color: colors.muted }}>{item.date}</Text>
          <View style={{ flex: 1, paddingHorizontal: 3 }}>
            <Text style={{ textAlign: r.start, fontWeight: item.strong ? 600 : 400 }}>{item.text}</Text>
            {item.ref ? <Text style={{ textAlign: r.start, fontSize: 7, color: colors.muted }}>{item.ref}</Text> : null}
          </View>
          <Text style={{ width: 66, textAlign: r.end, direction: 'ltr', fontWeight: item.strong ? 600 : 400 } as never}>{item.amount}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Visual T-account — حساب على شكل T.
 * Debit (مدين) is always on the left and Credit (دائن) on the right, in both
 * languages, following the accounting convention.
 */
export function TAccountReport({ context, decimals, currencyCode, from, to, accounts, accountLabel, signatures }: LedgerReportInput) {
  const { t } = context;
  const title = t('pdf.tAccount.title');
  const period = `${formatDate(from) || '…'} – ${formatDate(to) || '…'}`;

  return (
    <ReportDocument context={context} title={title}>
      {accounts.map((account) => {
        const tAccount = buildTAccount(account.statement, { opening: t('ledger.openingBd'), balanceCd: t('ledger.balanceCd') });
        // Debit-side items read "To <counter account>", credit-side items "By <counter account>".
        const toItem = (side: 'debit' | 'credit') => (i: (typeof tAccount.debitItems)[number]) => ({
          key: i.key,
          date: i.date ? formatDate(i.date) : '',
          ref: i.entryNumber ?? '',
          text: i.kind === 'movement' ? `${t(side === 'debit' ? 'ledger.toPrefix' : 'ledger.byPrefix')} ${accountLabel(i.counterAccountId, i.counterLineCount)}` : i.description,
          amount: formatUnits(i.amount, { decimals }),
          strong: i.kind !== 'movement',
        });
        const debitItems = tAccount.debitItems.map(toItem('debit'));
        const creditItems = tAccount.creditItems.map(toItem('credit'));
        if (tAccount.balanceCarriedDown) {
          const cd = { ...toItem('debit')(tAccount.balanceCarriedDown), date: formatDate(to) };
          (tAccount.balanceSide === 'debit' ? creditItems : debitItems).push(cd);
        }
        const name = context.language === 'ar' ? account.name_ar : account.name_en;
        const footing = formatUnits(tAccount.footing, { decimals });
        const balanceLabel =
          tAccount.balanceSide === null
            ? t('ledger.zeroBalance')
            : t(tAccount.balanceSide === 'debit' ? 'ledger.debitBalanceOf' : 'ledger.creditBalanceOf', { amount: formatUnits(tAccount.balance, { decimals }) });

        return (
          <ReportPage key={account.code} title={title}>
            <ReportHeader
              title={title}
              subtitle={`${t('pdf.period')}: ${period}`}
              meta={[
                { label: t('ledger.totalDebits'), value: formatUnits(tAccount.debitTotal, { decimals }) },
                { label: t('ledger.totalCredits'), value: formatUnits(tAccount.creditTotal, { decimals }) },
                { label: t('pdf.currency'), value: currencyCode },
              ]}
            />
            <View style={{ marginTop: 6 }}>
              <Text style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, lineHeight: 1.6 }}>{name}</Text>
              <Text style={{ textAlign: 'center', fontSize: 8.5, color: colors.muted, marginTop: 1, direction: 'ltr' } as never}>{account.code}</Text>
              {/* The "T": a heavy top rule and a vertical rule between the sides. */}
              <View style={{ marginTop: 6, borderTopWidth: 1.6, borderTopColor: colors.ink, flexDirection: 'row' }}>
                <View style={{ flex: 1, borderRightWidth: 1.6, borderRightColor: colors.ink, paddingTop: 5 }}>
                  <TSide items={debitItems} label={t('ledger.debitSide')} />
                </View>
                <View style={{ flex: 1, paddingTop: 5 }}>
                  <TSide items={creditItems} label={t('ledger.creditSide')} />
                </View>
              </View>
              <View style={{ flexDirection: 'row' }}>
                {[0, 1].map((i) => (
                  <View key={i} style={{ flex: 1, paddingHorizontal: 6, borderRightWidth: i === 0 ? 1.6 : 0, borderRightColor: colors.ink }}>
                    <Text style={{ textAlign: 'right', direction: 'ltr', fontWeight: 700, paddingVertical: 3, borderTopWidth: 0.8, borderBottomWidth: 2, borderColor: colors.ink, marginTop: 2 } as never}>
                      {footing}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={{ marginTop: 10, textAlign: 'center', fontWeight: 600, color: colors.accent }}>{balanceLabel}</Text>
            </View>
            {signatures && <SignatureBlock labels={[t('pdf.preparedBy'), t('pdf.reviewedBy')]} />}
          </ReportPage>
        );
      })}
    </ReportDocument>
  );
}
