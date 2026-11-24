import { describe, expect, it } from 'vitest';
import {
  buildInventoryReport,
  inventoryChecks,
  inventoryEntryAccount,
  reconcileInventory,
  resolveInventoryChart,
  stockCountAdjustment,
  toUnits,
  type Account,
  type EntryType,
  type InventoryReport,
  type LedgerLineRow,
} from './index';

const u = (n: number) => toUnits(n);

function account(code: string, partial: Partial<Account> = {}): Account {
  return {
    id: code,
    company_id: 'c',
    code,
    name_en: code,
    name_ar: code,
    parent_id: null,
    account_type: 'asset',
    category_code: null,
    normal_balance: 'debit',
    is_posting: true,
    is_active: true,
    description: null,
    level: 1,
    ...partial,
  };
}

const accounts = [
  account('1371'),
  account('35121', { account_type: 'expense' }),
  account('4221', { account_type: 'revenue', normal_balance: 'credit' }),
  account('2615'),
];
const chart = resolveInventoryChart(accounts);

interface TestEntry {
  id: string;
  date: string;
  type?: EntryType;
  status?: LedgerLineRow['entry_status'];
  reversalOf?: string;
  lines: Array<[code: string, debit: number, credit: number]>;
}

/** Rows as ledger_lines returns them: only the three accounts, with the first opposite account. */
function ledger(entries: TestEntry[]): LedgerLineRow[] {
  return entries.flatMap((e) =>
    e.lines.flatMap(([code, debit, credit], i) => {
      if (!['1371', '35121', '4221'].includes(code)) return [];
      const counters = e.lines.filter(([, d, c]) => (debit > 0 ? c > 0 : d > 0));
      return [
        {
          line_id: `${e.id}-${i}`,
          account_id: code,
          entry_id: e.id,
          entry_number: `JE-2026-${e.id}`,
          entry_date: e.date,
          entry_type: e.type ?? 'standard',
          entry_status: e.status ?? 'posted',
          voucher_id: null,
          voucher_type: null,
          voucher_number: null,
          entry_description: `Entry ${e.id}`,
          line_description: null,
          debit_amount: debit,
          credit_amount: credit,
          line_number: i + 1,
          counter_account_id: counters[0]?.[0] ?? null,
          counter_line_count: counters.length,
          reversal_of_id: e.reversalOf ?? null,
        },
      ];
    }),
  );
}

const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const build = (entries: TestEntry[], period: { from: string | null; to: string } = YEAR) => buildInventoryReport(ledger(entries), chart.postingIds, period);

/** Cost of goods as the income accounts give it, leaving out year-end closing. */
function costInTheBooks(entries: TestEntry[]) {
  let cost = 0;
  for (const e of entries) {
    if (e.type === 'closing') continue;
    for (const [code, d, c] of e.lines) {
      if (code === '35121') cost += d - c;
      if (code === '4221') cost -= c - d;
    }
  }
  return u(cost);
}

const opening: TestEntry = { id: '001', date: '2026-01-01', type: 'opening', lines: [['1371', 200, 0], ['211', 0, 200]] };
const purchase: TestEntry = { id: '002', date: '2026-03-01', lines: [['35121', 500, 0], ['2615', 0, 500]] };
const returned: TestEntry = { id: '003', date: '2026-04-01', lines: [['2615', 50, 0], ['35121', 0, 50]] };
/** Counted stock is 300, so 1371 rises by 100. */
const count: TestEntry = { id: '004', date: '2026-12-31', type: 'adjusting', lines: [['1371', 100, 0], ['4221', 0, 100]] };
const year = [opening, purchase, returned, count];

function expectSound(report: InventoryReport, entries: TestEntry[]) {
  expect(report.goodsAvailable + report.otherStock - report.closingStock).toBe(report.costOfGoods);
  expect(report.closingStock).toBe(report.ledgerNet.stock);
  expect(report.costOfGoods).toBe(costInTheBooks(entries));
}

describe('inventory chart', () => {
  it('finds the three accounts and names the ones that are not in the chart', () => {
    expect(chart.missing).toEqual([]);
    expect(chart.postingIds).toEqual({ stock: ['1371'], purchases: ['35121'], change: ['4221'] });
    expect(resolveInventoryChart(accounts.slice(1)).missing).toEqual(['1371']);
  });

  it('adds up sub-accounts, and then leaves the account of a prepared entry to the user', () => {
    const split = [account('1371', { is_posting: false }), account('13711', { parent_id: '1371' }), account('13712', { parent_id: '1371' }), ...accounts.slice(1)];
    const c = resolveInventoryChart(split);
    expect(c.postingIds.stock).toEqual(['13711', '13712']);
    expect(inventoryEntryAccount(c, split, 'stock')).toBeNull();
    expect(inventoryEntryAccount(chart, accounts, 'stock')?.code).toBe('1371');
  });
});

describe('inventory report', () => {
  it('opening stock + net purchases - closing stock = cost of goods sold', () => {
    const r = build(year);
    expect(r.openingStock).toBe(u(200));
    expect(r.purchases).toBe(u(500));
    expect(r.purchaseReductions).toBe(u(50));
    expect(r.netPurchases).toBe(u(450));
    expect(r.goodsAvailable).toBe(u(650));
    expect(r.closingStock).toBe(u(300));
    expect(r.costOfGoods).toBe(u(350));
    expect(r.otherStock).toBe(0n);
    expect(r.issues).toEqual([]);
    expect(r.duplicates).toEqual([]);
    expectSound(r, year);
  });

  it('gives the same result when the count is recorded in two steps', () => {
    const twoSteps: TestEntry[] = [
      opening,
      purchase,
      returned,
      { id: '004', date: '2026-12-31', type: 'adjusting', lines: [['4221', 200, 0], ['1371', 0, 200]] },
      { id: '005', date: '2026-12-31', type: 'adjusting', lines: [['1371', 300, 0], ['4221', 0, 300]] },
    ];
    const r = build(twoSteps);
    expect(r.closingStock).toBe(u(300));
    expect(r.costOfGoods).toBe(u(350));
    expect(r.issues).toEqual([]);
    expectSound(r, twoSteps);
  });

  it('a fall in stock adds to the cost', () => {
    const entries: TestEntry[] = [opening, purchase, { id: '004', date: '2026-12-31', type: 'adjusting', lines: [['4221', 120, 0], ['1371', 0, 120]] }];
    const r = build(entries);
    expect(r.closingStock).toBe(u(80));
    expect(r.costOfGoods).toBe(u(620));
    expectSound(r, entries);
  });

  it('starts the next year from the closing stock of this one', () => {
    const next: TestEntry = { id: '010', date: '2027-02-01', lines: [['35121', 70, 0], ['1811', 0, 70]] };
    const r = build([...year, next], { from: '2027-01-01', to: '2027-12-31' });
    expect(r.openingStock).toBe(u(300));
    expect(r.netPurchases).toBe(u(70));
    expect(r.closingStock).toBe(u(300));
    expect(r.stockMovements).toEqual([]);
  });

  it('leaves out entries after the report date', () => {
    const r = build(year, { from: '2026-01-01', to: '2026-03-31' });
    expect(r.netPurchases).toBe(u(500));
    expect(r.closingStock).toBe(u(200));
    expect(r.costOfGoods).toBe(u(500));
  });

  it('reads everything as one period when there is no start date', () => {
    const r = build(year, { from: null, to: '2026-12-31' });
    expect(r.openingStock).toBe(u(200));
    expect(r.costOfGoods).toBe(u(350));
  });
});

describe('no amount is counted twice', () => {
  const closing: TestEntry = { id: '006', date: '2026-12-31', type: 'closing', lines: [['4221', 100, 0], ['224', 350, 0], ['35121', 0, 450]] };

  it('year-end closing does not cancel the purchases of the year', () => {
    const r = build([...year, closing]);
    expect(r.netPurchases).toBe(u(450));
    expect(r.costOfGoods).toBe(u(350));
    expect(r.purchaseMovements).toHaveLength(2);
    expect(r.issues).toEqual([]);
  });

  it('reversing the closing entry does not add the purchases again', () => {
    const undo: TestEntry = { id: '007', date: '2026-12-31', type: 'reversing', reversalOf: '006', lines: [['4221', 0, 100], ['224', 0, 350], ['35121', 450, 0]] };
    const r = build([...year, { ...closing, status: 'reversed' }, undo]);
    expect(r.netPurchases).toBe(u(450));
    expect(r.costOfGoods).toBe(u(350));
    expect(r.issues).toEqual([]);
  });

  it('a count typed as a closing entry still counts once', () => {
    const r = build([opening, purchase, returned, { ...count, type: 'closing' }, closing]);
    expect(r.closingStock).toBe(u(300));
    expect(r.costOfGoods).toBe(u(350));
    expect(r.issues).toEqual([]);
  });

  it('a reversed purchase leaves nothing in purchases or returns', () => {
    const r = build([
      { ...purchase, status: 'reversed' },
      { id: '008', date: '2026-03-02', type: 'reversing', reversalOf: '002', lines: [['2615', 500, 0], ['35121', 0, 500]] },
    ]);
    expect(r.purchases).toBe(0n);
    expect(r.purchaseReductions).toBe(0n);
    expect(r.netPurchases).toBe(0n);
    expect(r.lastPurchaseDate).toBeNull();
  });

  it('flags an entry that debits purchases and stock for the same goods', () => {
    const both: TestEntry = { id: '009', date: '2026-05-01', lines: [['35121', 300, 0], ['1371', 300, 0], ['2615', 0, 600]] };
    const r = build([opening, both]);
    expect(r.issues).toMatchObject([{ kind: 'counted_twice', entryNumber: 'JE-2026-009', amount: u(300) }]);
    expect(r.otherStock).toBe(u(300));
    expectSound(r, [opening, both]);
  });

  it('flags goods bought straight into stock, and keeps them out of the cost', () => {
    const direct: TestEntry = { id: '009', date: '2026-05-01', lines: [['1371', 300, 0], ['2615', 0, 300]] };
    const r = build([...year, direct]);
    expect(r.issues).toMatchObject([{ kind: 'direct_stock', amount: u(300) }]);
    expect(r.closingStock).toBe(u(600));
    expect(r.costOfGoods).toBe(u(350));
    expectSound(r, [...year, direct]);
  });

  it('flags the change-in-stock account moving without stock', () => {
    const alone: TestEntry = { id: '009', date: '2026-05-01', lines: [['1811', 40, 0], ['4221', 0, 40]] };
    const r = build([...year, alone]);
    expect(r.issues).toMatchObject([{ kind: 'change_only', amount: u(40) }]);
    expectSound(r, [...year, alone]);
  });

  it('does not flag a wrong entry that was reversed', () => {
    const r = build([
      ...year,
      { id: '009', date: '2026-05-01', status: 'reversed', lines: [['1371', 300, 0], ['2615', 0, 300]] },
      { id: '010', date: '2026-05-02', type: 'reversing', reversalOf: '009', lines: [['2615', 300, 0], ['1371', 0, 300]] },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.otherStock).toBe(0n);
    expect(r.closingStock).toBe(u(300));
  });

  it('points out two purchases alike in date, amount and supplier', () => {
    const again: TestEntry = { ...purchase, id: '011' };
    const otherSupplier: TestEntry = { id: '012', date: '2026-03-01', lines: [['35121', 500, 0], ['1811', 0, 500]] };
    expect(build([...year, again, otherSupplier]).duplicates).toMatchObject([
      { entryDate: '2026-03-01', amount: u(500), entries: [{ entryNumber: 'JE-2026-002' }, { entryNumber: 'JE-2026-011' }] },
    ]);
    expect(build([...year, otherSupplier]).duplicates).toEqual([]);
  });

  it('finds a missing line by comparing with the balances of the ledger', () => {
    const balances = [
      { account_id: '1371', opening_debit: 0, opening_credit: 0, period_debit: 300, period_credit: 0 },
      { account_id: '35121', opening_debit: 0, opening_credit: 0, period_debit: '500', period_credit: '50' },
      { account_id: '4221', opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 100 },
    ];
    expect(reconcileInventory(build(year), balances, chart.postingIds)).toEqual({ stock: 0n, purchases: 0n, change: 0n });
    const short = build([opening, purchase, count]);
    const differences = reconcileInventory(short, balances, chart.postingIds);
    expect(differences.purchases).toBe(u(50));
    expect(inventoryChecks(short, differences)[0]).toMatchObject({ message: 'ledger_differs', status: 'danger' });
  });
});

describe('stock count', () => {
  it('prepares one entry for the difference only', () => {
    expect(stockCountAdjustment(u(200), u(300))).toEqual({ debit: 'stock', credit: 'change', amount: u(100) });
    expect(stockCountAdjustment(u(200), u(80))).toEqual({ debit: 'change', credit: 'stock', amount: u(120) });
    expect(stockCountAdjustment(u(200), u(200))).toBeNull();
  });

  it('asks for a count while goods bought after the last one are uncounted', () => {
    expect(build([opening, purchase])).toMatchObject({ lastCountDate: null, lastPurchaseDate: '2026-03-01', countOutdated: true });
    expect(build(year)).toMatchObject({ lastCountDate: '2026-12-31', countOutdated: false });
    const late: TestEntry = { id: '013', date: '2026-12-31', lines: [['35121', 5, 0], ['2615', 0, 5]] };
    expect(build([opening, purchase, { ...count, date: '2026-06-30' }, late])).toMatchObject({ lastCountDate: '2026-06-30', countOutdated: true });
    expect(build([opening])).toMatchObject({ lastPurchaseDate: null, countOutdated: false });
  });

  it('reports a stock balance below zero', () => {
    const r = build([{ id: '001', date: '2026-02-01', type: 'adjusting', lines: [['4221', 10, 0], ['1371', 0, 10]] }]);
    expect(inventoryChecks(r, { stock: 0n, purchases: 0n, change: 0n }).some((c) => c.message === 'negative')).toBe(true);
  });
});
