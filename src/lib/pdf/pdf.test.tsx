/**
 * Generates every report in Arabic and English from realistic data (long
 * descriptions, mixed Arabic/English text, multi-page tables) and checks the
 * resulting PDFs. Files are written to test-output/pdf for visual inspection.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import {
  buildFinancialPosition,
  buildLedgerStatement,
  buildTrialBalance,
  toUnits,
  type Account,
  type AccountCategory,
  type AccountSums,
  type LedgerLineRow,
} from '@/lib/accounting';
import type { JournalEntryDetail, VoucherDetail } from '@/types/database';
import { registerPdfFonts } from './fonts';
import type { PdfLanguage, ReportContextValue, Translate } from './primitives';
import {
  FinancialPositionReport,
  JournalEntryDocument,
  JournalReport,
  LedgerStatementReport,
  TAccountReport,
  TrialBalanceReport,
  VoucherDocument,
  VoucherRegisterReport,
  type JournalReportLine,
  type VoucherRegisterRow,
} from './index';

const root = join(__dirname, '..', '..', '..');
const outDir = join(root, 'test-output', 'pdf');

function context(language: PdfLanguage): ReportContextValue {
  return {
    fonts: registerPdfFonts(join(root, 'public', 'fonts', 'pdf') + '/'),
    language,
    t: i18n.getFixedT(language) as unknown as Translate,
    company: {
      name_en: 'Vio Home Trading Co.',
      name_ar: 'شركة فيو للتجارة المنزلية',
      address_en: 'Erbil, Kurdistan Region, Iraq',
      address_ar: 'أربيل، إقليم كوردستان، العراق',
      tax_number: '100-245-7781',
      phone: '+964 750 000 0000',
      email: 'accounts@vio.example',
    },
    logoSrc: `data:image/png;base64,${readFileSync(join(root, 'public', 'brand', 'vio-logo-red.png')).toString('base64')}`,
    generatedAt: '05/11/2026 14:30',
    generatedBy: language === 'ar' ? 'روژ نوشيروان' : 'Accounts Department',
  };
}

async function render(name: string, element: ReactElement) {
  const buffer = await renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
  writeFileSync(join(outDir, `${name}.pdf`), buffer);
  const text = buffer.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { size: buffer.length, pages, text };
}

const acc = (id: string, code: string, en: string, ar: string, type: Account['account_type'], category: string | null, parent: string | null, posting = true, normal?: 'debit' | 'credit'): Account => ({
  id, company_id: 'c', code, name_en: en, name_ar: ar, parent_id: parent, account_type: type, category_code: category,
  normal_balance: normal ?? (type === 'asset' || type === 'expense' ? 'debit' : 'credit'), is_posting: posting, is_active: true, description: null, level: parent ? 2 : 1,
});

const accounts: Account[] = [
  acc('a', '1000', 'Assets', 'الأصول', 'asset', null, null, false),
  acc('cash', '1110', 'Cash on Hand', 'الصندوق', 'asset', 'cash', 'a'),
  acc('bank', '1120', 'Bank - Current Account', 'المصرف - الحساب الجاري', 'asset', 'bank', 'a'),
  acc('ar', '1130', 'Accounts Receivable', 'الذمم المدينة', 'asset', 'receivables', 'a'),
  acc('equip', '1220', 'Equipment', 'المعدات', 'asset', 'property_equipment', 'a'),
  acc('accdep', '1290', 'Accumulated Depreciation', 'مجمع الإهلاك', 'asset', 'accumulated_depreciation', 'a', true, 'credit'),
  acc('l', '2000', 'Liabilities', 'الالتزامات', 'liability', null, null, false),
  acc('ap', '2110', 'Accounts Payable', 'الذمم الدائنة', 'liability', 'payables', 'l'),
  acc('loan', '2210', 'Long-term Loans', 'القروض طويلة الأجل', 'liability', 'long_term_loans', 'l'),
  acc('e', '3000', 'Equity', 'حقوق الملكية', 'equity', null, null, false),
  acc('cap', '3100', 'Owner Capital', 'رأس المال', 'equity', 'capital', 'e'),
  acc('r', '4000', 'Revenue', 'الإيرادات', 'revenue', null, null, false),
  acc('sales', '4100', 'Sales Revenue', 'إيرادات المبيعات', 'revenue', 'operating_revenue', 'r'),
  acc('x', '5000', 'Expenses', 'المصروفات', 'expense', null, null, false),
  acc('rent', '5300', 'Rent Expense', 'مصروف الإيجار', 'expense', 'operating_expenses', 'x'),
  acc('dep', '5500', 'Depreciation Expense', 'مصروف الإهلاك', 'expense', 'operating_expenses', 'x'),
];
const categories: AccountCategory[] = [
  ['cash', 'asset', 'current_assets', 'Cash on hand', 'النقدية في الصندوق', 10],
  ['bank', 'asset', 'current_assets', 'Cash at bank', 'النقدية لدى المصارف', 20],
  ['receivables', 'asset', 'current_assets', 'Receivables', 'الذمم المدينة', 30],
  ['property_equipment', 'asset', 'non_current_assets', 'Property, plant and equipment', 'الممتلكات والمعدات', 60],
  ['accumulated_depreciation', 'asset', 'non_current_assets', 'Accumulated depreciation', 'مجمع الإهلاك', 70],
  ['payables', 'liability', 'current_liabilities', 'Payables', 'الذمم الدائنة', 110],
  ['long_term_loans', 'liability', 'non_current_liabilities', 'Long-term loans', 'القروض طويلة الأجل', 140],
  ['capital', 'equity', 'equity', 'Capital', 'رأس المال', 210],
  ['operating_revenue', 'revenue', 'revenue', 'Operating revenue', 'الإيرادات التشغيلية', 310],
  ['operating_expenses', 'expense', 'expenses', 'Operating expenses', 'المصروفات التشغيلية', 420],
].map(([code, account_type, statement_section, name_en, name_ar, sort_order]) => ({
  code, account_type, statement_section, name_en, name_ar, sort_order, is_cash_equivalent: code === 'cash' || code === 'bank', is_contra: code === 'accumulated_depreciation',
})) as AccountCategory[];
const byId = new Map(accounts.map((a) => [a.id, a]));

// 60 balanced entries: capital, sales, collections, rent and depreciation, with long mixed-language descriptions.
type Line = [string, number, number];
const entries: Array<{ number: string; date: string; description: string; lines: Line[] }> = [];
entries.push({ number: 'JE-2026-00001', date: '2026-01-02', description: 'إيداع رأس المال من المالك Rozh Nawshirwan بموجب العقد رقم CAP-2026/01', lines: [['cash', 25_000_000, 0], ['cap', 0, 25_000_000]] });
entries.push({ number: 'JE-2026-00002', date: '2026-01-05', description: 'Purchase of packing equipment from Al-Rafidain Machinery — شراء معدات تغليف، دفعة أولى نقداً والباقي قرض طويل الأجل', lines: [['equip', 12_000_000, 0], ['cash', 0, 4_000_000], ['loan', 0, 8_000_000]] });
for (let i = 3; i <= 60; i++) {
  const day = String(((i * 3) % 27) + 1).padStart(2, '0');
  const month = String(Math.min(12, Math.floor(i / 6) + 1)).padStart(2, '0');
  const amount = 150_000 + i * 12_500;
  const kind = i % 4;
  const lines: Line[] = kind === 0 ? [['ar', amount, 0], ['sales', 0, amount]] : kind === 1 ? [['cash', amount, 0], ['ar', 0, amount]] : kind === 2 ? [['rent', amount, 0], ['ap', 0, amount]] : [['bank', amount, 0], ['cash', 0, amount]];
  const description = kind === 0
    ? `فاتورة مبيعات آجلة رقم INV-2026-${String(i).padStart(4, '0')} للزبون شركة النور للتجارة العامة عن توريد أدوات منزلية متنوعة حسب أمر الشراء PO-${i}/2026`
    : kind === 1 ? `Collection from customer Al-Noor Trading — تحصيل جزء من الرصيد المستحق بتاريخ 05/11/2026` : kind === 2 ? `استحقاق إيجار المستودع لشهر ${month}/2026` : `Cash deposit to bank — إيداع نقدي في المصرف`;
  entries.push({ number: `JE-2026-${String(i).padStart(5, '0')}`, date: `2026-${month}-${day}`, description, lines });
}
entries.push({ number: 'JE-2026-00061', date: '2026-12-31', description: 'قيد تسوية: إهلاك المعدات للسنة — Annual depreciation', lines: [['dep', 1_200_000, 0], ['accdep', 0, 1_200_000]] });

const journalLines: JournalReportLine[] = entries.flatMap((e, i) =>
  e.lines.map(([id, d, c], n) => {
    const a = byId.get(id)!;
    return {
      entry_id: `e${i}`, entry_number: e.number, entry_date: e.date, entry_type: i === entries.length - 1 ? 'adjusting' : 'standard', status: 'posted',
      voucher_type: i % 5 === 0 ? 'receipt' : null, voucher_number: i % 5 === 0 ? `RV-2026-${String(i).padStart(5, '0')}` : null,
      entry_description: e.description, reference_number: i % 7 === 0 ? `REF-${i}` : null, line_number: n + 1, account_code: a.code,
      account_name_en: a.name_en, account_name_ar: a.name_ar, line_description: null, debit_amount: d, credit_amount: c,
    };
  }),
);

const sums = new Map<string, AccountSums>();
for (const e of entries) for (const [id, d, c] of e.lines) {
  const s = sums.get(id) ?? { openingDebit: 0n, openingCredit: 0n, periodDebit: 0n, periodCredit: 0n };
  s.periodDebit += toUnits(d);
  s.periodCredit += toUnits(c);
  sums.set(id, s);
}

const ledgerRows = (accountId: string): LedgerLineRow[] =>
  entries.flatMap((e, i) =>
    e.lines
      .map(([id, d, c], n) => ({ id, d, c, n }))
      .filter((l) => l.id === accountId)
      .map((l) => {
        const counters = e.lines.filter(([, d2]) => (l.d > 0 ? d2 === 0 : d2 > 0));
        return {
          line_id: `${i}-${l.n}`, account_id: accountId, entry_id: `e${i}`, entry_number: e.number, entry_date: e.date, entry_type: 'standard', entry_status: 'posted',
          voucher_id: null, voucher_type: null, voucher_number: i % 5 === 0 ? `RV-2026-${String(i).padStart(5, '0')}` : null, entry_description: e.description,
          line_description: null, debit_amount: l.d, credit_amount: l.c, line_number: l.n + 1, counter_account_id: counters[0]?.[0] ?? null,
          counter_line_count: counters.length, reversal_of_id: null,
        } satisfies LedgerLineRow;
      }),
  );

const entryDetail: JournalEntryDetail = {
  id: 'e1', company_id: 'c', entry_number: 'JE-2026-00002', entry_date: '2026-01-05', entry_type: 'standard', status: 'posted', voucher_id: null,
  voucher_type: 'journal', voucher_number: 'JV-2026-00001', description: entries[1].description, notes: 'تم استلام المعدات وفحصها من قبل قسم المخازن.',
  reference_number: 'PO-2026-0007', currency_code: 'IQD', total_debit: 12_000_000, total_credit: 12_000_000, source: 'manual', reversal_of_id: null,
  reversed_entry_id: null, rejection_reason: null, created_by: 'u1', created_at: '2026-01-05T09:00:00Z', submitted_at: null, approved_at: '2026-01-05T11:00:00Z',
  posted_at: '2026-01-05T11:00:00Z', reversed_at: null, created_by_name: 'Sara Ahmed', submitted_by_name: null, approved_by_name: 'روژ نوشيروان', posted_by_name: 'روژ نوشيروان',
  reversed_by_name: null, reversal_of_number: null, reversed_entry_number: null, period_name: '2026-01', attachments: [], history: [],
  lines: entries[1].lines.map(([id, d, c], n) => ({ id: `l${n}`, line_number: n + 1, account_id: id, account_code: byId.get(id)!.code, account_name_en: byId.get(id)!.name_en, account_name_ar: byId.get(id)!.name_ar, debit_amount: d, credit_amount: c, description: n === 0 ? 'Packing machine model PM-200' : null })),
};

const voucher: VoucherDetail = {
  id: 'v1', company_id: 'c', voucher_type: 'receipt', voucher_number: 'RV-2026-00012', voucher_date: '2026-03-14', status: 'posted', party_name: 'شركة النور للتجارة العامة',
  payment_method: 'cheque', cheque_number: '000451', cash_account_id: 'bank', counter_account_id: 'ar', from_account_id: null, to_account_id: null, amount: 1_250_000,
  currency_code: 'IQD', description: 'تحصيل قيمة الفاتورة INV-2026-0045 بموجب صك مصرف الرافدين', notes: null, reference_number: 'INV-2026-0045', journal_entry_id: 'e9',
  journal_entry_number: 'JE-2026-00031', journal_entry_status: 'posted', rejection_reason: null, created_by: 'u1', created_at: '2026-03-14T08:00:00Z', posted_at: '2026-03-14T10:00:00Z',
  created_by_name: 'Sara Ahmed', approved_by_name: 'روژ نوشيروان', posted_by_name: 'روژ نوشيروان', reversed_by_name: null, lines: [],
  accounts: { bank: { code: '1120', name_en: 'Bank - Current Account', name_ar: 'المصرف - الحساب الجاري' }, ar: { code: '1130', name_en: 'Accounts Receivable', name_ar: 'الذمم المدينة' } },
  attachments: [], history: [],
};

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
});

const iqd = { code: 'IQD', name_en: 'Iraqi Dinar', name_ar: 'دينار عراقي', decimals: 0 };

const voucherRows: VoucherRegisterRow[] = Array.from({ length: 70 }, (_, i) => ({
  id: `v-${i}`,
  voucher_type: (['receipt', 'payment', 'journal', 'transfer'] as const)[i % 4],
  voucher_number: `RV-2026-${String(i + 1).padStart(5, '0')}`,
  voucher_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`,
  status: i % 9 === 8 ? 'reversed' : 'posted',
  party_name: i % 2 === 0 ? 'شركة النور للتجارة' : 'Al-Noor Trading Co.',
  amount: 1_250_000 + i * 10_000,
  description: 'تسديد قيمة البضاعة المشتراة حسب الفاتورة — settlement of invoice',
  reference_number: null,
  journal_entry_number: `JE-2026-${String(i + 1).padStart(5, '0')}`,
}));

describe.each(['ar', 'en'] as const)('PDF reports (%s)', (language) => {
  it('long reports keep their line height across pages (react-pdf patch)', async () => {
    // Without scripts/patch-react-pdf.mjs, line height compounds at every page
    // break: rows swell, the page count doubles, and past page 12 rendering fails.
    const copies = Math.ceil(420 / journalLines.length);
    const lines = Array.from({ length: copies }, (_, copy) =>
      journalLines.map((l) => ({ ...l, entry_id: `${l.entry_id}-${copy}`, entry_number: `${l.entry_number}-${copy}` })),
    ).flat();
    const rowsPerPage = 16;
    const entries = new Set(lines.map((l) => l.entry_id)).size;
    const r = await render(`journal-long-${language}`, (
      <JournalReport context={context(language)} decimals={0} currencyCode="IQD" from="2026-01-01" to="2026-12-31" statusLabel={i18n.getFixedT(language)('status.posted')} lines={lines} signatures={false} />
    ));
    expect(r.pages).toBeGreaterThan(12);
    expect(r.pages).toBeLessThan((lines.length + entries) / rowsPerPage + 3);
  }, 120_000);

  it('voucher register spans multiple pages with totals by type', async () => {
    const fixed = i18n.getFixedT(language);
    const r = await render(`voucher-register-${language}`, (
      <VoucherRegisterReport context={context(language)} decimals={0} currencyCode="IQD" from="2026-01-01" to="2026-12-31" typeLabel={fixed('common.all')} statusLabel={fixed('status.posted')} vouchers={voucherRows} signatures />
    ));
    expect(r.pages).toBeGreaterThan(1);
    expect(r.text).toContain('/FontFile');
  });

  it('voucher register with no vouchers', async () => {
    const fixed = i18n.getFixedT(language);
    const r = await render(`voucher-register-empty-${language}`, (
      <VoucherRegisterReport context={context(language)} decimals={0} currencyCode="IQD" from={null} to={null} typeLabel={fixed('common.all')} statusLabel={fixed('status.posted')} vouchers={[]} signatures={false} />
    ));
    expect(r.pages).toBe(1);
  });

  it('daily journal report spans multiple pages with repeated headers and grand totals', async () => {
    const r = await render(`journal-${language}`, (
      <JournalReport context={context(language)} decimals={0} currencyCode="IQD" from="2026-01-01" to="2026-12-31" statusLabel={i18n.getFixedT(language)('status.posted')} lines={journalLines} signatures />
    ));
    expect(r.pages).toBeGreaterThan(1);
    expect(r.text).toContain('/FontFile');
  });

  it('general ledger statement and T-account', async () => {
    const statement = buildLedgerStatement(['cash'], { debit: 0n, credit: 0n }, ledgerRows('cash'));
    const input = {
      context: context(language), decimals: 0, currencyCode: 'IQD', from: '2026-01-01', to: '2026-12-31',
      accounts: [{ code: '1110', name_en: 'Cash on Hand', name_ar: 'الصندوق', statement }], signatures: true,
      accountLabel: (id: string | null, count: number) => (count === 1 && id ? (language === 'ar' ? byId.get(id)!.name_ar : byId.get(id)!.name_en) : language === 'ar' ? 'مذكورين' : 'Sundries'),
    };
    const gl = await render(`ledger-${language}`, <LedgerStatementReport {...input} />);
    const t = await render(`t-account-${language}`, <TAccountReport {...input} />);
    expect(gl.pages).toBeGreaterThanOrEqual(1);
    expect(t.pages).toBeGreaterThanOrEqual(1);
  });

  it('trial balance (landscape) and statement of financial position balance', async () => {
    const tb = buildTrialBalance(accounts, sums, { view: 'detailed', includeZero: false });
    expect(tb.isBalanced).toBe(true);
    await render(`trial-balance-${language}`, (
      <TrialBalanceReport context={context(language)} decimals={0} currencyCode="IQD" from="2026-01-01" to="2026-12-31" periodLabel="2026" modeLabel="Adjusted" viewLabel="Detailed" result={tb} signatures />
    ));
    const fp = buildFinancialPosition(accounts, categories, { sums }, { sums: new Map([...sums].slice(0, 3)) });
    expect(fp.isBalanced).toBe(true);
    const r = await render(`financial-position-${language}`, (
      <FinancialPositionReport context={context(language)} decimals={0} currencyCode="IQD" asOf="2026-12-31" comparativeDate="2026-06-30" statement={fp} detailed signatures />
    ));
    expect(r.pages).toBeGreaterThanOrEqual(1);
  });

  it('journal entry and voucher documents', async () => {
    await render(`entry-${language}`, <JournalEntryDocument context={context(language)} decimals={0} entry={entryDetail} />);
    const lines = [
      { id: '1', line_number: 1, account_id: 'bank', account_code: '1120', account_name_en: 'Bank - Current Account', account_name_ar: 'المصرف - الحساب الجاري', debit_amount: 1_250_000, credit_amount: 0, description: null },
      { id: '2', line_number: 2, account_id: 'ar', account_code: '1130', account_name_en: 'Accounts Receivable', account_name_ar: 'الذمم المدينة', debit_amount: 0, credit_amount: 1_250_000, description: null },
    ];
    const r = await render(`voucher-${language}`, <VoucherDocument context={context(language)} decimals={0} currency={iqd} voucher={voucher} journalLines={lines} />);
    expect(r.pages).toBe(1);
  });
});
