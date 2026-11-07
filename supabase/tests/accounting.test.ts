/**
 * Database tests for the accounting workflow: posting rules, vouchers,
 * reversals, periods, reports and the shared statement formulas.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  accountId,
  asUser,
  createTestDatabase,
  createUser,
  expectDbError,
  header,
  line,
  rpc,
  type TestUser,
} from './helpers/db';
import {
  buildFinancialPosition,
  buildTrialBalance,
  sumsByAccount,
  type Account,
  type AccountBalanceRow,
  type AccountCategory,
} from '../../src/lib/accounting';

const j = (value: unknown) => JSON.stringify(value);

let db: PGlite;
let admin: TestUser;
let accountant: TestUser;
let reviewer: TestUser;
let viewer: TestUser;
let company: string;
const acc: Record<string, string> = {};

async function saveEntry(user: TestUser, h: Record<string, unknown>, lines: unknown[], entryId: string | null = null) {
  return rpc<string>(db, user, 'save_journal_entry', [company, entryId, j(h), j(lines)]);
}

async function balances(from: string | null, to: string | null, mode = 'all') {
  return asUser(db, admin, async (tx) => {
    const r = await tx.query<AccountBalanceRow>(`select * from public.account_balances($1, $2, $3, $4)`, [company, from, to, mode]);
    return r.rows;
  });
}

/**
 * The tests name accounts by their role (cash 1110, capital 3100, ...); this maps
 * each role to the dalil account that new companies get.
 */
const DALIL: Record<string, string> = {
  '1000': '1',      // Assets (header)
  '1110': '1811',   // Head office cash box
  '1120': '1832',   // Private banks
  '1130': '16141',  // Debtors, private sector
  '1140': '1371',   // Goods held for sale
  '1220': '1161',   // Furniture
  '1290': '2316',   // Accumulated depreciation, furniture
  '2110': '2614',   // Suppliers, private sector
  '2120': '2421',   // Short-term loans
  '2210': '2411',   // Long-term loans
  '3100': '211',    // Paid-up capital
  '3200': '224',    // Accumulated surplus (retained earnings)
  '3300': '225',    // Accumulated deficit (debit equity)
  '4100': '42111',  // Sales
  '4200': '4371',   // Cleaning services revenue
  '5100': '3511',   // Local purchases for sale
  '5200': '3111',   // Salaries
  '5300': '3352',   // Rent of buildings
  '5500': '376',    // Depreciation of furniture
};

async function netOf(code: string, to: string | null = null) {
  const rows = await balances(null, to);
  const row = rows.find((r) => r.account_id === acc[code]);
  if (!row) return 0;
  return Number(row.period_debit) - Number(row.period_credit) + Number(row.opening_debit) - Number(row.opening_credit);
}

async function entry(id: string) {
  return rpc<Record<string, any>>(db, admin, 'get_journal_entry', [id]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, 'Admin User');
  accountant = await createUser(db, 'Accountant User');
  reviewer = await createUser(db, 'Reviewer User');
  viewer = await createUser(db, 'Viewer User');

  company = await rpc<string>(db, admin, 'create_company', ['Vio Home', 'فيو للمنزل', 'IQD', '2026-01-01', true]);
  await rpc(db, admin, 'add_company_member', [company, accountant.email, 'accountant']);
  await rpc(db, admin, 'add_company_member', [company, reviewer.email, 'reviewer']);
  await rpc(db, admin, 'add_company_member', [company, viewer.email, 'viewer']);

  for (const [key, code] of Object.entries(DALIL)) {
    acc[key] = await accountId(db, company, code);
  }
});

describe('company bootstrap', () => {
  it('creates a fiscal year with 12 open monthly periods and a bilingual chart', async () => {
    const periods = await db.query<{ n: number }>(`select count(*)::int as n from accounting_periods where company_id = $1 and status = 'open'`, [company]);
    expect(periods.rows[0].n).toBe(12);
    const chart = await db.query<{ name_ar: string }>(`select name_ar from accounts where company_id = $1 and code = '1811'`, [company]);
    expect(chart.rows[0].name_ar).toBe('صندوق المركز');
  });
});

describe('journal entries', () => {
  it('posts a simple balanced entry and updates the ledger (T-account)', async () => {
    const id = await saveEntry(admin, header('2026-01-02', 'Owner capital contribution'), [
      line(acc['1110'], 1_000_000, 0),
      line(acc['3100'], 0, 1_000_000),
    ]);
    const draft = await entry(id);
    expect(draft.status).toBe('draft');
    expect(draft.entry_number).toBe('JE-2026-00001');
    expect(await netOf('1110')).toBe(0); // drafts do not affect balances

    await rpc(db, admin, 'post_journal_entry', [id]);
    const posted = await entry(id);
    expect(posted.status).toBe('posted');
    expect(Number(posted.total_debit)).toBe(1_000_000);
    expect(posted.period_name).toBe('2026-01');
    expect(await netOf('1110')).toBe(1_000_000);
    expect(await netOf('3100')).toBe(-1_000_000);

    const ledger = await asUser(db, viewer, (tx) =>
      tx.query<{ debit_amount: string; counter_account_id: string }>(`select * from public.ledger_lines($1, $2, null, null)`, [company, [acc['1110']]]),
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].counter_account_id).toBe(acc['3100']);
  });

  it('refuses to post an unbalanced entry', async () => {
    const id = await saveEntry(admin, header('2026-01-03', 'Unbalanced'), [
      line(acc['1110'], 1_000, 0),
      line(acc['3100'], 0, 900),
    ]);
    await expectDbError(rpc(db, admin, 'post_journal_entry', [id]), 'ENTRY_UNBALANCED');
    await expectDbError(rpc(db, accountant, 'submit_journal_entry', [id]), 'ENTRY_UNBALANCED');
    expect((await entry(id)).status).toBe('draft');
  });

  it('supports compound entries with multiple debit and credit lines', async () => {
    const id = await saveEntry(admin, header('2026-01-04', 'Equipment purchase, part cash part loan'), [
      line(acc['1220'], 400_000, 0, 'Packing machine'),
      line(acc['5300'], 50_000, 0, 'Installation space rent'),
      line(acc['1110'], 0, 200_000),
      line(acc['2210'], 0, 250_000),
    ]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    const posted = await entry(id);
    expect(posted.lines).toHaveLength(4);
    expect(Number(posted.total_debit)).toBe(450_000);
    expect(Number(posted.total_credit)).toBe(450_000);
  });

  it('rejects invalid lines: both sides, negative, header accounts, precision', async () => {
    await expectDbError(saveEntry(admin, header('2026-01-05', 'x'), [line(acc['1110'], 10, 10), line(acc['3100'], 0, 10)]), 'LINE_INVALID_AMOUNT');
    await expectDbError(saveEntry(admin, header('2026-01-05', 'x'), [line(acc['1110'], -10, 0), line(acc['3100'], 0, 10)]), 'LINE_INVALID_AMOUNT');
    await expectDbError(saveEntry(admin, header('2026-01-05', 'x'), [line(acc['1000'], 10, 0), line(acc['3100'], 0, 10)]), 'ACCOUNT_NOT_POSTABLE');
    await expectDbError(saveEntry(admin, header('2026-01-05', 'x'), [line(acc['1110'], 10.5, 0), line(acc['3100'], 0, 10.5)]), 'AMOUNT_PRECISION');
    await expectDbError(saveEntry(admin, header('2026-01-05', 'x'), [line(acc['1110'], 10, 0), { account_id: null, debit_amount: 0, credit_amount: 10 }]), 'LINE_ACCOUNT_REQUIRED');
    await expectDbError(saveEntry(admin, header('2026-01-05', ''), [line(acc['1110'], 10, 0), line(acc['3100'], 0, 10)]), 'ENTRY_DESCRIPTION_REQUIRED');
  });

  it('requires at least one debit and one credit line to post', async () => {
    const id = await saveEntry(admin, header('2026-01-05', 'Single line'), [line(acc['1110'], 10, 0)]);
    await expectDbError(rpc(db, admin, 'post_journal_entry', [id]), 'ENTRY_MIN_LINES');
  });

  it('rejects inactive accounts', async () => {
    await db.query(`update accounts set is_active = false where id = $1`, [acc['4200']]);
    await expectDbError(saveEntry(admin, header('2026-01-06', 'Service'), [line(acc['1110'], 10, 0), line(acc['4200'], 0, 10)]), 'ACCOUNT_INACTIVE');
    await db.query(`update accounts set is_active = true where id = $1`, [acc['4200']]);
  });

  it('makes posted entries immutable, even for privileged database users', async () => {
    const id = await saveEntry(admin, header('2026-01-07', 'Office supplies'), [line(acc['5200'], 5_000, 0), line(acc['1110'], 0, 5_000)]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    await expectDbError(db.query(`update journal_entries set description = 'changed' where id = $1`, [id]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(db.query(`update journal_entry_lines set debit_amount = 1 where journal_entry_id = $1 and debit_amount > 0`, [id]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(db.query(`delete from journal_entries where id = $1`, [id]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(db.query(`delete from journal_entry_lines where journal_entry_id = $1`, [id]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(saveEntry(admin, header('2026-01-07', 'edit'), [line(acc['5200'], 1, 0), line(acc['1110'], 0, 1)], id), 'ENTRY_NOT_EDITABLE');
    await expectDbError(rpc(db, admin, 'delete_journal_entry', [id]), 'ENTRY_NOT_EDITABLE');
  });

  it('allows editing and deleting drafts only', async () => {
    const id = await saveEntry(accountant, header('2026-01-08', 'Draft'), [line(acc['5200'], 1_000, 0), line(acc['1110'], 0, 1_000)]);
    await saveEntry(accountant, header('2026-01-08', 'Draft edited'), [line(acc['5200'], 2_000, 0), line(acc['1110'], 0, 2_000)], id);
    expect(Number((await entry(id)).total_debit)).toBe(2_000);
    await rpc(db, accountant, 'delete_journal_entry', [id]);
    const left = await db.query(`select 1 from journal_entries where id = $1`, [id]);
    expect(left.rows).toHaveLength(0);
  });

  it('assigns unique, sequential entry numbers', async () => {
    const r = await db.query<{ n: number; d: number }>(`select count(*)::int n, count(distinct entry_number)::int d from journal_entries where company_id = $1`, [company]);
    expect(r.rows[0].n).toBe(r.rows[0].d);
  });
});

describe('approval workflow', () => {
  it('requires approval: accountant submits, reviewer approves and posts', async () => {
    const id = await saveEntry(accountant, header('2026-02-01', 'Purchase of inventory on credit'), [line(acc['1140'], 300_000, 0), line(acc['2110'], 0, 300_000)]);
    await expectDbError(rpc(db, accountant, 'post_journal_entry', [id]), 'APPROVAL_REQUIRED');
    await expectDbError(rpc(db, accountant, 'approve_journal_entry', [id]), 'PERMISSION_DENIED');
    await rpc(db, accountant, 'submit_journal_entry', [id]);
    expect((await entry(id)).status).toBe('pending_approval');
    expect(await netOf('1140')).toBe(0); // pending entries do not affect balances
    await rpc(db, reviewer, 'approve_journal_entry', [id]);
    const posted = await entry(id);
    expect(posted.status).toBe('posted');
    expect(posted.approved_by).toBe(reviewer.id);
    expect(posted.created_by).toBe(accountant.id);
    expect(await netOf('1140')).toBe(300_000);
  });

  it('returns rejected entries to draft with a reason', async () => {
    const id = await saveEntry(accountant, header('2026-02-02', 'Needs correction'), [line(acc['5200'], 10, 0), line(acc['1110'], 0, 10)]);
    await rpc(db, accountant, 'submit_journal_entry', [id]);
    await expectDbError(rpc(db, reviewer, 'reject_journal_entry', [id, '  ']), 'REASON_REQUIRED');
    await rpc(db, reviewer, 'reject_journal_entry', [id, 'Wrong expense account']);
    const e = await entry(id);
    expect(e.status).toBe('draft');
    expect(e.rejection_reason).toBe('Wrong expense account');
  });

  it('lets accountants post directly when approval is not required', async () => {
    await db.query(`update company_settings set require_approval = false where company_id = $1`, [company]);
    const id = await saveEntry(accountant, header('2026-02-03', 'Cash sale'), [line(acc['1110'], 80_000, 0), line(acc['4100'], 0, 80_000)]);
    await rpc(db, accountant, 'post_journal_entry', [id]);
    expect((await entry(id)).status).toBe('posted');
    await db.query(`update company_settings set require_approval = true where company_id = $1`, [company]);
  });

  it('records the audit trail of each action', async () => {
    const id = await saveEntry(accountant, header('2026-02-04', 'Audited'), [line(acc['5200'], 10, 0), line(acc['1110'], 0, 10)]);
    await rpc(db, accountant, 'submit_journal_entry', [id]);
    await rpc(db, reviewer, 'approve_journal_entry', [id]);
    const history = (await entry(id)).history as Array<{ action: string; actor_id: string }>;
    expect(history.map((h) => h.action)).toEqual(['created', 'submitted', 'approved', 'posted']);
    expect(history.find((h) => h.action === 'approved')?.actor_id).toBe(reviewer.id);
    await expectDbError(db.query(`delete from audit_logs`), 'AUDIT_LOG_IMMUTABLE');
  });
});

describe('vouchers', () => {
  async function saveVoucher(data: Record<string, unknown>, lines: unknown[] = []) {
    return rpc<string>(db, admin, 'save_voucher', [company, null, j(data), j(lines)]);
  }
  async function voucherLines(voucherId: string) {
    const v = await rpc<Record<string, any>>(db, admin, 'get_voucher', [voucherId]);
    const e = await entry(v.journal_entry_id);
    return { voucher: v, lines: (e.lines as any[]).map((l) => [l.account_id, Number(l.debit_amount), Number(l.credit_amount)]) };
  }

  it('receipt voucher: Dr cash, Cr counterparty', async () => {
    const id = await saveVoucher({ voucher_type: 'receipt', voucher_date: '2026-03-01', party_name: 'Al-Noor Trading', cash_account_id: acc['1110'], counter_account_id: acc['1130'], amount: 120_000, description: 'Collection of invoice INV-0042', payment_method: 'cash' });
    await rpc(db, admin, 'post_voucher', [id]);
    const { voucher, lines } = await voucherLines(id);
    expect(voucher.voucher_number).toBe('RV-2026-00001');
    expect(voucher.status).toBe('posted');
    expect(lines).toEqual([[acc['1110'], 120_000, 0], [acc['1130'], 0, 120_000]]);
  });

  it('payment voucher: Dr expense, Cr bank', async () => {
    const id = await saveVoucher({ voucher_type: 'payment', voucher_date: '2026-03-02', party_name: 'Landlord', cash_account_id: acc['1110'], counter_account_id: acc['5300'], amount: 75_000, description: 'March office rent', payment_method: 'cash' });
    await rpc(db, admin, 'post_voucher', [id]);
    const { lines } = await voucherLines(id);
    expect(lines).toEqual([[acc['5300'], 75_000, 0], [acc['1110'], 0, 75_000]]);
  });

  it('transfer voucher: Dr destination, Cr source; source and destination must differ', async () => {
    await expectDbError(saveVoucher({ voucher_type: 'transfer', voucher_date: '2026-03-03', from_account_id: acc['1110'], to_account_id: acc['1110'], amount: 10, description: 'x' }), 'VOUCHER_SAME_ACCOUNTS');
    await expectDbError(saveVoucher({ voucher_type: 'transfer', voucher_date: '2026-03-03', from_account_id: acc['1110'], to_account_id: acc['5300'], amount: 10, description: 'x' }), 'VOUCHER_CASH_ACCOUNT_INVALID');
    const id = await saveVoucher({ voucher_type: 'transfer', voucher_date: '2026-03-03', from_account_id: acc['1110'], to_account_id: acc['1120'], amount: 200_000, description: 'Deposit cash to bank' });
    await rpc(db, admin, 'post_voucher', [id]);
    const { lines } = await voucherLines(id);
    expect(lines).toEqual([[acc['1120'], 200_000, 0], [acc['1110'], 0, 200_000]]);
  });

  it('journal voucher: multiple balanced lines', async () => {
    const id = await saveVoucher({ voucher_type: 'journal', voucher_date: '2026-03-31', description: 'Monthly depreciation' }, [
      line(acc['5500'], 20_000, 0),
      line(acc['1290'], 0, 20_000),
    ]);
    await rpc(db, admin, 'post_voucher', [id]);
    const { voucher, lines } = await voucherLines(id);
    expect(Number(voucher.amount)).toBe(20_000);
    expect(lines).toEqual([[acc['5500'], 20_000, 0], [acc['1290'], 0, 20_000]]);
  });

  it('cannot post the same voucher twice', async () => {
    const id = await saveVoucher({ voucher_type: 'receipt', voucher_date: '2026-03-04', party_name: 'Client', cash_account_id: acc['1110'], counter_account_id: acc['4100'], amount: 5_000, description: 'Cash sale' });
    await rpc(db, admin, 'post_voucher', [id]);
    await expectDbError(rpc(db, admin, 'post_voucher', [id]), 'VOUCHER_ALREADY_POSTED');
    await expectDbError(rpc(db, reviewer, 'approve_voucher', [id]), 'VOUCHER_ALREADY_POSTED');
    // The unique constraint is the final guard against a second entry for the voucher.
    await expectDbError(
      db.query(`insert into journal_entries (company_id, entry_number, entry_date, currency_code, voucher_id) values ($1, 'JE-X', '2026-03-04', 'IQD', $2)`, [company, id]),
      /duplicate key|unique/i,
    );
    const count = await db.query<{ n: number }>(`select count(*)::int n from journal_entries where voucher_id = $1`, [id]);
    expect(count.rows[0].n).toBe(1);
  });

  it('requires approval for vouchers prepared by accountants', async () => {
    const id = await rpc<string>(db, accountant, 'save_voucher', [company, null, j({ voucher_type: 'payment', voucher_date: '2026-03-05', party_name: 'Supplier', cash_account_id: acc['1110'], counter_account_id: acc['2110'], amount: 100_000, description: 'Settle supplier balance' }), j([])]);
    await expectDbError(rpc(db, accountant, 'post_voucher', [id]), 'APPROVAL_REQUIRED');
    await rpc(db, accountant, 'submit_voucher', [id]);
    await rpc(db, reviewer, 'approve_voucher', [id]);
    const v = await rpc<Record<string, any>>(db, admin, 'get_voucher', [id]);
    expect(v.status).toBe('posted');
    expect(v.journal_entry_number).toMatch(/^JE-2026-/);
  });
});

describe('reversals', () => {
  it('reverses a posted entry without deleting it', async () => {
    const before = await netOf('1110');
    const id = await saveEntry(admin, header('2026-04-01', 'Wrongly recorded cash sale'), [line(acc['1110'], 33_000, 0), line(acc['4100'], 0, 33_000)]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    expect(await netOf('1110')).toBe(before + 33_000);

    await expectDbError(rpc(db, accountant, 'reverse_journal_entry', [id, '2026-04-02', 'Duplicate']), 'PERMISSION_DENIED');
    const reversalId = await rpc<string>(db, reviewer, 'reverse_journal_entry', [id, '2026-04-02', 'Duplicate recording']);
    const original = await entry(id);
    const reversal = await entry(reversalId);
    expect(original.status).toBe('reversed');
    expect(original.reversed_entry_id).toBe(reversalId);
    expect(reversal.status).toBe('posted');
    expect(reversal.entry_type).toBe('reversing');
    expect(reversal.reversal_of_id).toBe(id);
    expect(reversal.lines.map((l: any) => [l.account_id, Number(l.debit_amount), Number(l.credit_amount)])).toEqual([
      [acc['1110'], 0, 33_000],
      [acc['4100'], 33_000, 0],
    ]);
    expect(await netOf('1110')).toBe(before);
    await expectDbError(rpc(db, reviewer, 'reverse_journal_entry', [id, '2026-04-02', 'again']), 'ENTRY_ALREADY_REVERSED');
    await expectDbError(rpc(db, reviewer, 'reverse_journal_entry', [reversalId, '2026-04-02', 'again']), 'ENTRY_IS_REVERSAL');
  });
});

describe('accounting periods', () => {
  it('rejects postings into closed periods until an admin reopens them', async () => {
    const period = await db.query<{ id: string }>(`select id from accounting_periods where company_id = $1 and name = '2026-05'`, [company]);
    const periodId = period.rows[0].id;
    const id = await saveEntry(admin, header('2026-05-10', 'May expense'), [line(acc['5200'], 1_000, 0), line(acc['1110'], 0, 1_000)]);

    await expectDbError(rpc(db, accountant, 'close_accounting_period', [periodId]), 'PERMISSION_DENIED');
    await rpc(db, admin, 'close_accounting_period', [periodId]);
    await expectDbError(rpc(db, admin, 'post_journal_entry', [id]), 'PERIOD_CLOSED');

    await expectDbError(rpc(db, admin, 'reopen_accounting_period', [periodId, '']), 'REASON_REQUIRED');
    await rpc(db, admin, 'reopen_accounting_period', [periodId, 'Late supplier invoice']);
    await rpc(db, admin, 'post_journal_entry', [id]);
    expect((await entry(id)).status).toBe('posted');
  });

  it('rejects dates outside any fiscal period', async () => {
    const id = await saveEntry(admin, header('2027-02-01', 'Next year'), [line(acc['5200'], 1, 0), line(acc['1110'], 0, 1)]);
    await expectDbError(rpc(db, admin, 'post_journal_entry', [id]), 'PERIOD_MISSING');
    await rpc(db, admin, 'delete_journal_entry', [id]);
  });

  it('prevents overlapping fiscal years', async () => {
    await expectDbError(rpc(db, admin, 'create_fiscal_year', [company, 'Overlap', '2026-06-01', '2027-05-31', true]), 'FISCAL_YEAR_OVERLAP');
  });
});

describe('recurring entries', () => {
  it('generates real dated draft entries and never changes earlier ones', async () => {
    const templateId = await rpc<string>(db, admin, 'save_recurring_template', [
      company, null,
      j({ name: 'Warehouse rent', description: 'Monthly warehouse rent', frequency: 'monthly', start_date: '2026-01-31' }),
      j([line(acc['5300'], 40_000, 0), line(acc['2110'], 0, 40_000)]),
    ]);
    expect(await rpc<number>(db, admin, 'generate_recurring_entries', [templateId, '2026-03-31'])).toBe(3);
    const rows = await db.query<{ entry_date: string; status: string }>(
      `select to_char(entry_date, 'YYYY-MM-DD') entry_date, status from journal_entries where recurring_template_id = $1 order by entry_date`, [templateId]);
    expect(rows.rows.map((r) => r.entry_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(rows.rows.every((r) => r.status === 'draft')).toBe(true);
    expect(await rpc<number>(db, admin, 'generate_recurring_entries', [templateId, '2026-03-31'])).toBe(0);
    expect(await rpc<number>(db, admin, 'generate_recurring_entries', [templateId, '2026-04-30'])).toBe(1);
  });
});

describe('reports', () => {
  async function chart() {
    const accounts = (await db.query<Account>(`select * from accounts where company_id = $1`, [company])).rows;
    const categories = (await db.query<AccountCategory>(`select * from account_categories`)).rows;
    return { accounts, categories };
  }

  it('trial balance debit and credit totals agree', async () => {
    const { accounts } = await chart();
    const rows = await balances('2026-02-01', '2026-12-31', 'all');
    const tb = buildTrialBalance(accounts, sumsByAccount(rows), { view: 'detailed', includeZero: false });
    expect(tb.isBalanced).toBe(true);
    expect(tb.totals.openingDebit).toBeGreaterThan(0n);
    expect(tb.totals.periodDebit).toBe(tb.totals.periodCredit);
  });

  it('report totals match the database ledger', async () => {
    const { accounts } = await chart();
    const tb = buildTrialBalance(accounts, sumsByAccount(await balances(null, '2026-12-31')), { view: 'detailed', includeZero: false });
    const db_ = await db.query<{ d: string; c: string }>(
      `select sum(l.debit_amount) d, sum(l.credit_amount) c from journal_entry_lines l join journal_entries e on e.id = l.journal_entry_id
       where e.company_id = $1 and e.status in ('posted', 'reversed')`, [company]);
    expect(tb.totals.periodDebit).toBe(BigInt(Math.round(Number(db_.rows[0].d))) * 10_000n);
    expect(tb.totals.periodCredit).toBe(BigInt(Math.round(Number(db_.rows[0].c))) * 10_000n);
  });

  it('unadjusted trial balance excludes adjusting entries', async () => {
    const id = await saveEntry(admin, header('2026-06-30', 'Accrued salaries', { entry_type: 'adjusting' }), [line(acc['5200'], 9_000, 0), line(acc['2110'], 0, 9_000)]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    const adjusted = await balances('2026-06-01', '2026-06-30', 'adjusted');
    const unadjusted = await balances('2026-06-01', '2026-06-30', 'unadjusted');
    const pick = (rows: AccountBalanceRow[]) => Number(rows.find((r) => r.account_id === acc['5200'])?.period_debit ?? 0);
    expect(pick(adjusted) - pick(unadjusted)).toBe(9_000);
  });

  it('statement of financial position satisfies Assets = Liabilities + Equity', async () => {
    const { accounts, categories } = await chart();
    const fp = buildFinancialPosition(accounts, categories, { sums: sumsByAccount(await balances('2026-01-01', '2026-12-31')) });
    expect(fp.totals.totalAssets).toBeGreaterThan(0n);
    expect(fp.totals.difference).toBe(0n);
    expect(fp.isBalanced).toBe(true);
  });

  it('closing entry transfers the result to retained earnings without breaking the balance sheet', async () => {
    const fy = await db.query<{ id: string }>(`select id from fiscal_years where company_id = $1`, [company]);
    const { accounts, categories } = await chart();
    const before = buildFinancialPosition(accounts, categories, { sums: sumsByAccount(await balances('2026-01-01', '2026-12-31')) });

    const closingId = await rpc<string>(db, admin, 'create_closing_entry', [fy.rows[0].id, 'Year-end closing 2026']);
    await expectDbError(rpc(db, admin, 'create_closing_entry', [fy.rows[0].id, 'again']), 'CLOSING_ENTRY_EXISTS');
    await rpc(db, admin, 'post_journal_entry', [closingId]);

    const after = buildFinancialPosition(accounts, categories, { sums: sumsByAccount(await balances('2026-01-01', '2026-12-31')) });
    expect(after.totals.currentProfit).toBe(0n);
    expect(after.totals.totalEquity).toBe(before.totals.totalEquity);
    expect(after.isBalanced).toBe(true);
    expect(await netOf('4100')).toBe(0);

    const postClosing = buildTrialBalance(accounts, sumsByAccount(await balances(null, '2026-12-31', 'post_closing')), { view: 'detailed', includeZero: false });
    const income = postClosing.rows.filter((r) => (r.account.account_type === 'revenue' || r.account.account_type === 'expense') && !r.isGroup);
    expect(income.length).toBeGreaterThan(0);
    expect(income.every((r) => r.closingDebit === 0n && r.closingCredit === 0n)).toBe(true);
    expect(postClosing.isBalanced).toBe(true);
  });

  it('dashboard summary counts entries by status', async () => {
    const s = await rpc<Record<string, any>>(db, viewer, 'dashboard_summary', [company, '2026-03-15']);
    expect(s.entries.posted).toBeGreaterThan(0);
    expect(s.current_period.name).toBe('2026-03');
  });

  it('searches the journal register with filters and pagination', async () => {
    const page = await asUser(db, viewer, (tx) =>
      tx.query<{ entry_number: string; total_count: number }>(
        `select * from public.search_journal_entries($1, null, '2026-01-01', '2026-01-31', array['posted']::entry_status[], null, $2, null, null, 2, 0)`,
        [company, acc['1110']],
      ),
    );
    expect(page.rows.length).toBeLessThanOrEqual(2);
    expect(Number(page.rows[0].total_count)).toBeGreaterThanOrEqual(page.rows.length);
  });
});

describe('chart of accounts integrity', () => {
  it('prevents deleting accounts with transactions and changing their type', async () => {
    await expectDbError(asUser(db, admin, (tx) => tx.query(`delete from accounts where id = $1`, [acc['1110']])), 'ACCOUNT_HAS_TRANSACTIONS');
    await expectDbError(asUser(db, admin, (tx) => tx.query(`update accounts set account_type = 'expense', category_code = 'operating_expenses' where id = $1`, [acc['1110']])), /ACCOUNT_HAS_TRANSACTIONS|ACCOUNT_TYPE_MISMATCH/);
  });

  it('enforces hierarchy rules', async () => {
    const currentAssets = await accountId(db, company, '181');
    await expectDbError(
      asUser(db, admin, (tx) => tx.query(
        `insert into accounts (company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance) values ($1, '18111', 'Petty cash', 'السلفة النثرية', $2, 'asset', 'cash', 'debit')`,
        [company, acc['1110']])),
      'ACCOUNT_PARENT_IS_POSTING');
    await expectDbError(
      asUser(db, admin, (tx) => tx.query(
        `insert into accounts (company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance) values ($1, '1814', 'Wrong', 'خطأ', $2, 'liability', 'payables', 'credit')`,
        [company, currentAssets])),
      'ACCOUNT_TYPE_MISMATCH');
    await asUser(db, accountant, (tx) => tx.query(
      `insert into accounts (company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance) values ($1, '1814', 'Petty Cash', 'السلفة النثرية', $2, 'asset', 'cash', 'debit')`,
      [company, currentAssets]));
    const created = await db.query<{ level: number; created_by: string }>(`select level, created_by from accounts where company_id = $1 and code = '1814'`, [company]);
    expect(created.rows[0].level).toBe(4);
    expect(created.rows[0].created_by).toBe(accountant.id);
  });
});
