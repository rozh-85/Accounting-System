import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  buildFinancialPosition,
  buildDailyLedger,
  buildLedgerStatement,
  buildSimpleEntryLines,
  buildTAccount,
  buildTrialBalance,
  formatUnits,
  integerToArabic,
  integerToEnglish,
  isSimpleEntry,
  parseAmountInput,
  postingAccountsInRange,
  postingAccountsUnder,
  summarizeLines,
  toUnits,
  unitsToDecimalString,
  validateLines,
  validateVoucher,
  voucherJournalLines,
  type Account,
  type AccountCategory,
  type AccountSums,
  type LedgerLineRow,
} from './index';

const u = (n: number | string) => toUnits(n);

function account(partial: Partial<Account> & Pick<Account, 'id' | 'code' | 'account_type'>): Account {
  return {
    company_id: 'c1',
    name_en: partial.code,
    name_ar: partial.code,
    parent_id: null,
    category_code: null,
    normal_balance: partial.account_type === 'asset' || partial.account_type === 'expense' ? 'debit' : 'credit',
    is_posting: true,
    is_active: true,
    description: null,
    level: 1,
    ...partial,
  };
}

const categories: AccountCategory[] = [
  { code: 'cash', account_type: 'asset', statement_section: 'current_assets', name_en: 'Cash', name_ar: 'النقدية', is_cash_equivalent: true, is_contra: false, sort_order: 10 },
  { code: 'receivables', account_type: 'asset', statement_section: 'current_assets', name_en: 'Receivables', name_ar: 'الذمم المدينة', is_cash_equivalent: false, is_contra: false, sort_order: 30 },
  { code: 'property_equipment', account_type: 'asset', statement_section: 'non_current_assets', name_en: 'PPE', name_ar: 'الممتلكات', is_cash_equivalent: false, is_contra: false, sort_order: 60 },
  { code: 'accumulated_depreciation', account_type: 'asset', statement_section: 'non_current_assets', name_en: 'Acc. depreciation', name_ar: 'مجمع الإهلاك', is_cash_equivalent: false, is_contra: true, sort_order: 70 },
  { code: 'payables', account_type: 'liability', statement_section: 'current_liabilities', name_en: 'Payables', name_ar: 'الذمم الدائنة', is_cash_equivalent: false, is_contra: false, sort_order: 110 },
  { code: 'long_term_loans', account_type: 'liability', statement_section: 'non_current_liabilities', name_en: 'Loans', name_ar: 'القروض', is_cash_equivalent: false, is_contra: false, sort_order: 140 },
  { code: 'capital', account_type: 'equity', statement_section: 'equity', name_en: 'Capital', name_ar: 'رأس المال', is_cash_equivalent: false, is_contra: false, sort_order: 210 },
  { code: 'retained_earnings', account_type: 'equity', statement_section: 'equity', name_en: 'RE', name_ar: 'الأرباح المحتجزة', is_cash_equivalent: false, is_contra: false, sort_order: 220 },
  { code: 'operating_revenue', account_type: 'revenue', statement_section: 'revenue', name_en: 'Revenue', name_ar: 'الإيرادات', is_cash_equivalent: false, is_contra: false, sort_order: 310 },
  { code: 'operating_expenses', account_type: 'expense', statement_section: 'expenses', name_en: 'Expenses', name_ar: 'المصروفات', is_cash_equivalent: false, is_contra: false, sort_order: 420 },
];

// A small chart with a hierarchy.
const chart: Account[] = [
  account({ id: 'a', code: '1000', account_type: 'asset', is_posting: false }),
  account({ id: 'a1', code: '1100', account_type: 'asset', is_posting: false, parent_id: 'a', level: 2 }),
  account({ id: 'cash', code: '1110', account_type: 'asset', parent_id: 'a1', level: 3, category_code: 'cash' }),
  account({ id: 'ar', code: '1130', account_type: 'asset', parent_id: 'a1', level: 3, category_code: 'receivables' }),
  account({ id: 'a2', code: '1200', account_type: 'asset', is_posting: false, parent_id: 'a', level: 2 }),
  account({ id: 'equip', code: '1220', account_type: 'asset', parent_id: 'a2', level: 3, category_code: 'property_equipment' }),
  account({ id: 'accdep', code: '1290', account_type: 'asset', parent_id: 'a2', level: 3, category_code: 'accumulated_depreciation', normal_balance: 'credit' }),
  account({ id: 'l', code: '2000', account_type: 'liability', is_posting: false }),
  account({ id: 'ap', code: '2110', account_type: 'liability', parent_id: 'l', level: 2, category_code: 'payables' }),
  account({ id: 'loan', code: '2210', account_type: 'liability', parent_id: 'l', level: 2, category_code: 'long_term_loans' }),
  account({ id: 'e', code: '3000', account_type: 'equity', is_posting: false }),
  account({ id: 'cap', code: '3100', account_type: 'equity', parent_id: 'e', level: 2, category_code: 'capital' }),
  account({ id: 're', code: '3200', account_type: 'equity', parent_id: 'e', level: 2, category_code: 'retained_earnings' }),
  account({ id: 'r', code: '4000', account_type: 'revenue', is_posting: false }),
  account({ id: 'sales', code: '4100', account_type: 'revenue', parent_id: 'r', level: 2, category_code: 'operating_revenue' }),
  account({ id: 'x', code: '5000', account_type: 'expense', is_posting: false }),
  account({ id: 'rent', code: '5300', account_type: 'expense', parent_id: 'x', level: 2, category_code: 'operating_expenses' }),
  account({ id: 'dep', code: '5500', account_type: 'expense', parent_id: 'x', level: 2, category_code: 'operating_expenses' }),
];

/** Applies posted journal lines to a sums map (period columns). */
function ledgerFrom(entries: Array<Array<[string, number, number]>>, opening = false): Map<string, AccountSums> {
  const map = new Map<string, AccountSums>();
  for (const lines of entries) {
    for (const [id, dr, cr] of lines) {
      const s = map.get(id) ?? { openingDebit: 0n, openingCredit: 0n, periodDebit: 0n, periodCredit: 0n };
      if (opening) {
        s.openingDebit += u(dr);
        s.openingCredit += u(cr);
      } else {
        s.periodDebit += u(dr);
        s.periodCredit += u(cr);
      }
      map.set(id, s);
    }
  }
  return map;
}

// Realistic set of balanced transactions (IQD).
const transactions: Array<Array<[string, number, number]>> = [
  [['cash', 1_000_000, 0], ['cap', 0, 1_000_000]], // owner capital
  [['equip', 400_000, 0], ['cash', 0, 150_000], ['loan', 0, 250_000]], // compound: equipment purchase
  [['ar', 300_000, 0], ['sales', 0, 300_000]], // credit sale
  [['cash', 120_000, 0], ['ar', 0, 120_000]], // collection
  [['rent', 50_000, 0], ['ap', 0, 50_000]], // rent accrued
  [['dep', 20_000, 0], ['accdep', 0, 20_000]], // depreciation
];

describe('money', () => {
  it('parses and formats exactly', () => {
    expect(toUnits('1000000')).toBe(10_000_000_000n);
    expect(toUnits(0.1) + toUnits(0.2)).toBe(toUnits('0.3'));
    expect(unitsToDecimalString(toUnits('1250.5'))).toBe('1250.5');
    expect(formatUnits(toUnits(1_000_000), { decimals: 0 })).toBe('1,000,000');
    expect(formatUnits(toUnits(-1234.5), { decimals: 2, parentheses: true })).toBe('(1,234.50)');
    expect(formatUnits(0n, { decimals: 0, zero: 'blank' })).toBe('');
  });

  it('parses user input with grouping and Arabic-Indic digits', () => {
    expect(parseAmountInput('1,000,000')).toBe(toUnits(1_000_000));
    expect(parseAmountInput('١٢٣٤')).toBe(toUnits(1234));
    expect(parseAmountInput('')).toBeNull();
    expect(() => parseAmountInput('12a')).toThrow();
  });
});

describe('journal entries', () => {
  it('builds a simple entry: من حـ / الصندوق إلى حـ / رأس المال', () => {
    const lines = buildSimpleEntryLines('cash', 'cap', u(1_000_000));
    const summary = summarizeLines(lines);
    expect(summary.totalDebit).toBe(u(1_000_000));
    expect(summary.totalCredit).toBe(u(1_000_000));
    expect(summary.isBalanced).toBe(true);
    expect(isSimpleEntry(lines)).toBe(true);
    expect(validateLines(lines, { forPosting: true, decimals: 0 })).toEqual([]);
  });

  it('rejects an unbalanced entry for posting but allows it as a draft', () => {
    const lines = [
      { accountId: 'cash', debit: u(1_000), credit: 0n },
      { accountId: 'cap', debit: 0n, credit: u(900) },
    ];
    expect(validateLines(lines, { forPosting: true, decimals: 0 }).map((i) => i.code)).toContain('ENTRY_UNBALANCED');
    expect(validateLines(lines, { forPosting: false, decimals: 0 })).toEqual([]);
  });

  it('supports compound entries with several debit and credit lines', () => {
    const lines = [
      { accountId: 'equip', debit: u(400_000), credit: 0n },
      { accountId: 'rent', debit: u(10_000), credit: 0n },
      { accountId: 'cash', debit: 0n, credit: u(160_000) },
      { accountId: 'loan', debit: 0n, credit: u(250_000) },
    ];
    expect(isSimpleEntry(lines)).toBe(false);
    expect(summarizeLines(lines).isBalanced).toBe(true);
    expect(validateLines(lines, { forPosting: true, decimals: 0 })).toEqual([]);
  });

  it('rejects lines with both sides, negative amounts, missing accounts and bad precision', () => {
    const codes = validateLines(
      [
        { accountId: 'cash', debit: u(10), credit: u(10) },
        { accountId: null, debit: 0n, credit: u(5) },
        { accountId: 'cap', debit: -u(5), credit: 0n },
        { accountId: 'cap', debit: u('1.5'), credit: 0n },
      ],
      { forPosting: false, decimals: 0 },
    ).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['LINE_INVALID_AMOUNT', 'LINE_ACCOUNT_REQUIRED', 'AMOUNT_PRECISION']));
  });

  it('requires at least one debit and one credit line', () => {
    const codes = validateLines([{ accountId: 'cash', debit: u(10), credit: 0n }], { forPosting: true, decimals: 0 }).map((i) => i.code);
    expect(codes).toContain('ENTRY_MIN_LINES');
  });
});

describe('vouchers produce the expected journal lines', () => {
  it('receipt: Dr cash, Cr counterparty', () => {
    const lines = voucherJournalLines({ voucherType: 'receipt', amount: u(500), cashAccountId: 'cash', counterAccountId: 'ar', partyName: 'Client' });
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([['cash', u(500), 0n], ['ar', 0n, u(500)]]);
  });
  it('payment: Dr expense, Cr cash', () => {
    const lines = voucherJournalLines({ voucherType: 'payment', amount: u(75), cashAccountId: 'cash', counterAccountId: 'rent', partyName: 'Landlord' });
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([['rent', u(75), 0n], ['cash', 0n, u(75)]]);
  });
  it('transfer: Dr destination, Cr source; same account rejected', () => {
    const lines = voucherJournalLines({ voucherType: 'transfer', amount: u(90), fromAccountId: 'cash', toAccountId: 'bank' });
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([['bank', u(90), 0n], ['cash', 0n, u(90)]]);
    expect(validateVoucher({ voucherType: 'transfer', amount: u(90), fromAccountId: 'cash', toAccountId: 'cash' }, 0).map((i) => i.code)).toContain('VOUCHER_SAME_ACCOUNTS');
  });
  it('journal voucher: its own balanced lines', () => {
    const own = [
      { accountId: 'dep', debit: u(20), credit: 0n },
      { accountId: 'accdep', debit: 0n, credit: u(20) },
    ];
    expect(voucherJournalLines({ voucherType: 'journal', amount: u(20), lines: own })).toEqual(own);
    expect(validateVoucher({ voucherType: 'journal', amount: u(20), lines: own }, 0)).toEqual([]);
  });
});

describe('ledger and T-accounts', () => {
  const row = (n: number, date: string, dr: number, cr: number): LedgerLineRow => ({
    line_id: `l${n}`, account_id: 'cash', entry_id: `e${n}`, entry_number: `JE-2026-0000${n}`, entry_date: date,
    entry_type: 'standard', entry_status: 'posted', voucher_id: null, voucher_type: null, voucher_number: null,
    entry_description: `Entry ${n}`, line_description: null, debit_amount: dr, credit_amount: cr, line_number: 1,
    counter_account_id: null, counter_line_count: 1, reversal_of_id: null,
  });

  it('computes running balances and a debit balance of 700,000 for cash', () => {
    const statement = buildLedgerStatement(['cash'], { debit: 0n, credit: 0n }, [
      row(1, '2026-01-02', 1_000_000, 0),
      row(2, '2026-01-05', 0, 300_000),
    ]);
    expect(statement.movements.map((m) => m.runningNet)).toEqual([u(1_000_000), u(700_000)]);
    expect(statement.closingNet).toBe(u(700_000));

    const t = buildTAccount(statement, { opening: 'Opening balance', balanceCd: 'Balance c/d' });
    expect(t.debitTotal).toBe(u(1_000_000));
    expect(t.creditTotal).toBe(u(300_000));
    expect(t.balance).toBe(u(700_000));
    expect(t.balanceSide).toBe('debit');
    expect(t.footing).toBe(u(1_000_000));
  });

  it('places a credit opening balance on the credit side', () => {
    const statement = buildLedgerStatement(['cap'], { debit: 0n, credit: u(1_000_000) }, []);
    const t = buildTAccount(statement, { opening: 'b/d', balanceCd: 'c/d' });
    expect(t.creditItems[0].kind).toBe('opening');
    expect(t.balanceSide).toBe('credit');
  });

  it('resolves account hierarchies and ranges to posting accounts', () => {
    expect(postingAccountsUnder(chart, 'a').map((a) => a.code)).toEqual(['1110', '1130', '1220', '1290']);
    expect(postingAccountsInRange(chart, '2000', '3999').map((a) => a.code)).toEqual(['2110', '2210', '3100', '3200']);
  });
});

describe('daily ledger', () => {
  const row = (id: string, date: string, debit: number, credit: number, number: string) => ({
    line_id: id, account_id: 'cash', entry_id: id, entry_number: number, entry_date: date, entry_type: 'standard' as const,
    entry_status: 'posted' as const, voucher_id: null, voucher_type: null, voucher_number: null, entry_description: 'x',
    line_description: null, debit_amount: debit, credit_amount: credit, line_number: 1, counter_account_id: null,
    counter_line_count: 1, reversal_of_id: null,
  });

  it('gives one row per day with both sides and the running balance', () => {
    const statement = buildLedgerStatement(['cash'], { debit: u(5_000), credit: 0n }, [
      row('a', '2026-08-01', 1_000, 0, 'JE-1'),
      row('b', '2026-08-01', 0, 400, 'JE-2'),
      row('c', '2026-08-02', 0, 9_000, 'JE-3'),
      row('d', '2026-09-03', 3_000, 0, 'JE-4'),
    ]);
    const daily = buildDailyLedger(statement);

    expect(daily.openingDebit).toBe(u(5_000));
    expect(daily.openingCredit).toBe(0n);
    expect(daily.months.map((m) => m.key)).toEqual(['2026-08', '2026-09']);
    const [first, second] = daily.months[0].rows;
    expect([first.serial, first.debit, first.credit, first.balanceDebit, first.balanceCredit]).toEqual([1, u(1_000), u(400), u(5_600), 0n]);
    // Balance crosses to the credit side: it moves column instead of going negative.
    expect([second.serial, second.debit, second.credit, second.balanceDebit, second.balanceCredit]).toEqual([2, 0n, u(9_000), 0n, u(3_400)]);
    expect(daily.months[1].rows[0].serial).toBe(3);
    expect([daily.totalDebit, daily.totalCredit]).toEqual([u(4_000), u(9_400)]);
    expect([daily.closingDebit, daily.closingCredit]).toEqual([0n, u(400)]);
  });

  it('agrees with the statement it condenses', () => {
    const statement = buildLedgerStatement(['cash'], { debit: 0n, credit: u(700) }, [row('a', '2026-01-05', 200, 0, 'JE-1'), row('b', '2026-02-05', 0, 100, 'JE-2')]);
    const daily = buildDailyLedger(statement);
    const rows = daily.months.flatMap((m) => m.rows);
    expect(rows.reduce((sum, r) => sum + r.debit, 0n)).toBe(statement.periodDebit);
    expect(rows.reduce((sum, r) => sum + r.credit, 0n)).toBe(statement.periodCredit);
    expect(daily.closingDebit - daily.closingCredit).toBe(statement.closingNet);
  });

  it('handles an account with no movements', () => {
    const daily = buildDailyLedger(buildLedgerStatement(['cash'], { debit: u(100), credit: 0n }, []));
    expect(daily.months).toEqual([]);
    expect(daily.closingDebit).toBe(u(100));
  });
});

describe('trial balance', () => {
  const sums = ledgerFrom(transactions);

  it('debit and credit totals agree for a balanced ledger', () => {
    const tb = buildTrialBalance(chart, sums, { view: 'detailed', includeZero: false });
    expect(tb.isBalanced).toBe(true);
    expect(tb.totals.periodDebit).toBe(u(1_890_000));
    expect(tb.totals.periodCredit).toBe(u(1_890_000));
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
  });

  it('does not double count parent accounts', () => {
    const tb = buildTrialBalance(chart, sums, { view: 'detailed', includeZero: false });
    const assets = tb.rows.find((r) => r.account.code === '1000')!;
    expect(assets.isGroup).toBe(true);
    expect(assets.countsInTotals).toBe(false);
    // Cash 970,000 + AR 180,000 + equipment 400,000 - acc. dep 20,000 = 1,530,000 net debit
    expect(assets.closingDebit).toBe(u(1_530_000));
  });

  it('summary view totals agree and remain balanced', () => {
    const summary = buildTrialBalance(chart, sums, { view: 'summary', summaryLevel: 1, includeZero: false });
    expect(summary.rows.every((r) => r.depth === 0)).toBe(true);
    expect(summary.isBalanced).toBe(true);
  });

  it('reports the exact difference when out of balance', () => {
    const broken = new Map(sums);
    broken.set('cash', { ...broken.get('cash')!, periodDebit: broken.get('cash')!.periodDebit + u(5) });
    const tb = buildTrialBalance(chart, broken, { view: 'detailed', includeZero: true });
    expect(tb.isBalanced).toBe(false);
    expect(tb.differences.period).toBe(u(5));
  });

  it('splits opening balances into debit and credit columns', () => {
    const opening = ledgerFrom([[['cash', 500, 0], ['cap', 0, 500]]], true);
    const tb = buildTrialBalance(chart, opening, { view: 'detailed', includeZero: false });
    expect(tb.totals.openingDebit).toBe(u(500));
    expect(tb.totals.openingCredit).toBe(u(500));
    expect(tb.differences.opening).toBe(0n);
  });
});

describe('statement of financial position', () => {
  it('satisfies Assets = Liabilities + Equity, including current period profit', () => {
    const fp = buildFinancialPosition(chart, categories, { sums: ledgerFrom(transactions) });
    // Assets: cash 970,000 + AR 180,000 + equipment 400,000 - accumulated depreciation 20,000
    expect(fp.totals.totalAssets).toBe(u(1_530_000));
    // Liabilities: AP 50,000 + loan 250,000
    expect(fp.totals.totalLiabilities).toBe(u(300_000));
    // Equity: capital 1,000,000 + profit (300,000 - 50,000 - 20,000)
    expect(fp.totals.currentProfit).toBe(u(230_000));
    expect(fp.totals.totalEquity).toBe(u(1_230_000));
    expect(fp.isBalanced).toBe(true);
  });

  it('treats accumulated depreciation as a contra asset', () => {
    const fp = buildFinancialPosition(chart, categories, { sums: ledgerFrom(transactions) });
    const nonCurrent = fp.sections.non_current_assets;
    const accdep = nonCurrent.groups.flatMap((g) => g.lines).find((l) => l.account?.code === '1290')!;
    expect(accdep.amount).toBe(-u(20_000));
    expect(nonCurrent.total).toBe(u(380_000));
  });

  it('never lists revenue or expense accounts as balance sheet lines', () => {
    const fp = buildFinancialPosition(chart, categories, { sums: ledgerFrom(transactions) });
    const types = Object.values(fp.sections).flatMap((s) => s.groups.flatMap((g) => g.lines.map((l) => l.account?.account_type)));
    expect(types).not.toContain('revenue');
    expect(types).not.toContain('expense');
  });

  it('does not double count closed income after a closing entry', () => {
    const withClosing = [
      ...transactions,
      [['sales', 300_000, 0], ['rent', 0, 50_000], ['dep', 0, 20_000], ['re', 0, 230_000]] as Array<[string, number, number]>,
    ];
    const fp = buildFinancialPosition(chart, categories, { sums: ledgerFrom(withClosing) });
    expect(fp.totals.currentProfit).toBe(0n);
    expect(fp.totals.totalEquity).toBe(u(1_230_000));
    expect(fp.isBalanced).toBe(true);
  });

  it('separates unclosed results of prior years from the current period', () => {
    const prior = ledgerFrom([[['cash', 100, 0], ['sales', 0, 100]]], true);
    const fp = buildFinancialPosition(chart, categories, { sums: prior });
    expect(fp.totals.priorUnclosed).toBe(u(100));
    expect(fp.totals.currentProfit).toBe(0n);
    expect(fp.isBalanced).toBe(true);
  });

  it('builds a comparative column', () => {
    const fp = buildFinancialPosition(
      chart,
      categories,
      { sums: ledgerFrom(transactions) },
      { sums: ledgerFrom(transactions.slice(0, 1)) },
    );
    expect(fp.comparativeTotals?.totalAssets).toBe(u(1_000_000));
    expect(fp.comparativeIsBalanced).toBe(true);
  });
});

describe('amount in words', () => {
  it('writes English and Arabic amounts', () => {
    expect(integerToEnglish(1_234_567n)).toBe('one million two hundred thirty-four thousand five hundred sixty-seven');
    expect(integerToArabic(1_000_000n)).toBe('مليون');
    expect(integerToArabic(2_500n)).toBe('ألفان وخمسمائة');
    expect(integerToArabic(15_000n)).toBe('خمسة عشر ألفاً');
    expect(integerToArabic(3_000_000n)).toBe('ثلاثة ملايين');
    expect(integerToArabic(125n)).toBe('مائة وخمسة وعشرون');
    const iqd = { code: 'IQD', name_en: 'Iraqi Dinar', name_ar: 'دينار عراقي', decimals: 0 };
    expect(amountInWords(u(1_000_000), iqd, 'ar')).toBe('فقط مليون دينار عراقي لا غير');
    expect(amountInWords(u(1_000_000), iqd, 'en')).toBe('One million Iraqi Dinar only');
  });
});
