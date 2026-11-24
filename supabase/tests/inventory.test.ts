/**
 * The inventory report on the real database: the dalil accounts, the posting
 * rules, ledger_lines, account_balances, reversals and year-end closing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { accountId, asUser, createTestDatabase, createUser, header, line, rpc, type TestUser } from './helpers/db';
import {
  buildFinancialPosition,
  buildInventoryReport,
  inventoryChecks,
  INVENTORY_ROLES,
  reconcileInventory,
  resolveInventoryChart,
  stockCountAdjustment,
  sumsByAccount,
  toUnits,
  unitsToNumber,
  type Account,
  type AccountBalanceRow,
  type AccountCategory,
  type LedgerLineRow,
} from '../../src/lib/accounting';

const u = (n: number) => toUnits(n);

let db: PGlite;
let admin: TestUser;
let company: string;
let accounts: Account[];
const acc: Record<string, string> = {};

async function post(date: string, description: string, lines: Array<[code: string, debit: number, credit: number]>, entryType = 'standard') {
  const id = await rpc<string>(db, admin, 'save_journal_entry', [
    company,
    null,
    JSON.stringify(header(date, description, { entry_type: entryType })),
    JSON.stringify(lines.map(([code, d, c]) => line(acc[code], d, c))),
  ]);
  await rpc(db, admin, 'post_journal_entry', [id]);
  return id;
}

/** Dates come back as Date objects here; the API sends them as yyyy-MM-dd. */
async function report(from = '2026-01-01', to = '2026-12-31') {
  const chart = resolveInventoryChart(accounts);
  const ids = INVENTORY_ROLES.flatMap((role) => chart.postingIds[role]);
  return asUser(db, admin, async (tx) => {
    const lines = await tx.query<LedgerLineRow>(
      `select line_id, account_id, entry_id, entry_number, entry_date::text as entry_date, entry_type, entry_status, voucher_id, voucher_type, voucher_number,
              entry_description, line_description, debit_amount, credit_amount, line_number, counter_account_id, counter_line_count, reversal_of_id
         from public.ledger_lines($1, $2::uuid[], null, $3)`,
      [company, ids, to],
    );
    const balances = await tx.query<AccountBalanceRow>(`select * from public.account_balances($1, null, $2, 'all')`, [company, to]);
    const result = buildInventoryReport(lines.rows, chart.postingIds, { from, to });
    const differences = reconcileInventory(result, balances.rows, chart.postingIds);
    return { result, differences, checks: inventoryChecks(result, differences) };
  });
}

async function position(asOf = '2026-12-31') {
  return asUser(db, admin, async (tx) => {
    const categories = await tx.query<AccountCategory>('select * from account_categories');
    const rows = await tx.query<AccountBalanceRow>(`select * from public.account_balances($1, '2026-01-01', $2, 'all')`, [company, asOf]);
    return buildFinancialPosition(accounts, categories.rows, { sums: sumsByAccount(rows.rows) }, null, { includeZero: false });
  });
}

const agreed = { stock: 0n, purchases: 0n, change: 0n };

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, 'Admin User');
  company = await rpc<string>(db, admin, 'create_company', ['Vio Home', 'فيو للمنزل', 'IQD', '2026-01-01', true]);
  accounts = (await asUser(db, admin, (tx) => tx.query<Account>('select * from accounts where company_id = $1', [company]))).rows;
  for (const code of ['1371', '35121', '4221', '2615', '1811', '211', '42111']) acc[code] = await accountId(db, company, code);
});

describe('inventory report on the dalil', () => {
  it('every new company has the three accounts', () => {
    expect(resolveInventoryChart(accounts).missing).toEqual([]);
    expect(accounts.some((a) => a.code === '171')).toBe(false);
  });

  it('is zero and sound before anything is posted', async () => {
    const { result, differences, checks } = await report();
    expect(result.costOfGoods).toBe(0n);
    expect(differences).toEqual(agreed);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('follows opening stock, purchases, returns, sales and the count', async () => {
    await post('2026-01-01', 'Opening balances', [['1371', 20_000_000, 0], ['1811', 5_000_000, 0], ['211', 0, 25_000_000]], 'opening');
    await post('2026-02-10', 'Import, shipment 1', [['35121', 50_000_000, 0], ['2615', 0, 50_000_000]]);
    await post('2026-03-05', 'Damaged goods sent back', [['2615', 2_000_000, 0], ['35121', 0, 2_000_000]]);
    await post('2026-06-15', 'Sales', [['1811', 70_000_000, 0], ['42111', 0, 70_000_000]]);

    const before = await report();
    expect(before.result.closingStock).toBe(u(20_000_000));
    expect(before.checks.at(-1)).toMatchObject({ message: 'count_none', status: 'warning' });

    const adjustment = stockCountAdjustment(before.result.closingStock, u(31_000_000))!;
    const code = { stock: '1371', change: '4221', purchases: '35121' };
    const amount = unitsToNumber(adjustment.amount);
    await post('2026-12-31', 'Stock count', [[code[adjustment.debit], amount, 0], [code[adjustment.credit], 0, amount]], 'adjusting');

    const { result, differences, checks } = await report();
    expect(result.openingStock).toBe(u(20_000_000));
    expect(result.netPurchases).toBe(u(48_000_000));
    expect(result.closingStock).toBe(u(31_000_000));
    expect(result.costOfGoods).toBe(u(37_000_000));
    expect(differences).toEqual(agreed);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('agrees with the financial position: the same stock, and profit = sales - cost of goods sold', async () => {
    const { result } = await report();
    const statement = await position();
    expect(statement.isBalanced).toBe(true);
    const stock = statement.sections.current_assets.groups.flatMap((g) => g.lines).find((l) => l.account?.code === '1371');
    expect(stock?.amount).toBe(result.closingStock);
    expect(statement.totals.currentProfit).toBe(u(70_000_000) - result.costOfGoods);
  });

  it('does not change when the year is closed, nor when the closing is undone', async () => {
    const before = (await report()).result;
    const year = await db.query<{ id: string }>('select id from fiscal_years where company_id = $1', [company]);
    const closing = await rpc<string>(db, admin, 'create_closing_entry', [year.rows[0].id, 'Closing 2026']);
    await rpc(db, admin, 'post_journal_entry', [closing]);

    const closed = await report();
    expect(closed.result.netPurchases).toBe(before.netPurchases);
    expect(closed.result.costOfGoods).toBe(before.costOfGoods);
    expect(closed.result.issues).toEqual([]);
    expect(closed.differences).toEqual(agreed);

    await rpc(db, admin, 'reverse_journal_entry', [closing, '2026-12-31', 'Reopen the year']);
    const undone = await report();
    expect(undone.result.netPurchases).toBe(before.netPurchases);
    expect(undone.result.costOfGoods).toBe(before.costOfGoods);
    expect(undone.result.issues).toEqual([]);
    expect(undone.differences).toEqual(agreed);
  });

  it('a wrong entry is listed until it is reversed', async () => {
    const sound = (await report()).result;
    const wrong = await post('2026-07-01', 'Goods put straight into stock', [['1371', 4_000_000, 0], ['2615', 0, 4_000_000]]);
    const flagged = await report();
    expect(flagged.result.issues).toMatchObject([{ kind: 'direct_stock', entryId: wrong, amount: u(4_000_000) }]);
    expect(flagged.result.costOfGoods).toBe(sound.costOfGoods);
    expect(flagged.differences).toEqual(agreed);

    await rpc(db, admin, 'reverse_journal_entry', [wrong, '2026-07-02', 'Wrong account']);
    const fixed = await report();
    expect(fixed.result.issues).toEqual([]);
    expect(fixed.result.closingStock).toBe(sound.closingStock);
  });

  it('drafts are not in the report', async () => {
    const sound = (await report()).result;
    await rpc(db, admin, 'save_journal_entry', [
      company,
      null,
      JSON.stringify(header('2026-08-01', 'Draft purchase')),
      JSON.stringify([line(acc['35121'], 9_000_000, 0), line(acc['2615'], 0, 9_000_000)]),
    ]);
    expect((await report()).result.netPurchases).toBe(sound.netPurchases);
  });
});
