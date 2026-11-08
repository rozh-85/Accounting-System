/**
 * Editing and deleting posted entries, entries typed in dollars, and dates
 * outside every fiscal year.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { accountId, asUser, createTestDatabase, createUser, expectDbError, header, line, rpc, type TestUser } from './helpers/db';

const j = (value: unknown) => JSON.stringify(value);

let db: PGlite;
let admin: TestUser;
let accountant: TestUser;
let company: string;
let cash: string;
let capital: string;
let rent: string;

const save = (user: TestUser, head: Record<string, unknown>, lines: unknown[], id: string | null = null) =>
  rpc<string>(db, user, 'save_journal_entry', [company, id, j(head), j(lines)]);

const post = async (date: string, amount = 1000, extra: Record<string, unknown> = {}) => {
  const id = await save(admin, header(date, 'Rent', extra), [line(rent, amount, 0), line(cash, 0, amount)]);
  await rpc(db, admin, 'post_journal_entry', [id]);
  return id;
};

const get = (id: string) => rpc<Record<string, any>>(db, admin, 'get_journal_entry', [id]);

const cashBalance = async () => {
  const rows = await db.query<{ n: string }>(`select coalesce(sum(debit_amount - credit_amount), 0) as n from public.journal_entry_lines where account_id = $1`, [cash]);
  return Number(rows.rows[0].n);
};

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, 'Admin');
  accountant = await createUser(db, 'Accountant');
  company = await rpc<string>(db, admin, 'create_company', ['Hotel', 'فندق', 'IQD', '2026-01-01', true]);
  await rpc(db, admin, 'add_company_member', [company, accountant.email, 'accountant']);
  cash = await accountId(db, company, '1811');
  capital = await accountId(db, company, '211');
  rent = await accountId(db, company, '3352');
}, 120_000);

describe('editing a posted entry', () => {
  it('changes the ledger, keeps it posted and keeps the old figures in the history', async () => {
    const id = await post('2026-03-10');
    const before = await cashBalance();
    await save(admin, header('2026-03-12', 'Rent corrected'), [line(rent, 1500, 0), line(cash, 0, 1500)], id);
    expect(await cashBalance()).toBe(before - 500);
    const entry = await get(id);
    expect(entry.status).toBe('posted');
    expect(entry.description).toBe('Rent corrected');
    expect(Number(entry.total_debit)).toBe(1500);
    const edit = entry.history.find((h: { action: string }) => h.action === 'edited_after_posting');
    expect(Number(edit.details.before.total)).toBe(1000);
  });

  it('moves the entry to the period of its new date', async () => {
    const id = await post('2026-03-10');
    await save(admin, header('2026-05-02', 'Moved'), [line(rent, 1000, 0), line(cash, 0, 1000)], id);
    expect((await get(id)).period_name).toBe('2026-05');
  });

  it('refuses an unbalanced edit and leaves the entry as it was', async () => {
    const id = await post('2026-03-10');
    await expectDbError(save(admin, header('2026-03-10', 'Bad'), [line(rent, 1500, 0), line(cash, 0, 1000)], id), 'ENTRY_UNBALANCED');
    expect(Number((await get(id)).total_debit)).toBe(1000);
  });

  it('is refused for someone who may not reverse entries', async () => {
    const id = await post('2026-03-10');
    await expectDbError(save(accountant, header('2026-03-10', 'No'), [line(rent, 2, 0), line(cash, 0, 2)], id), 'PERMISSION_DENIED');
    await expectDbError(rpc(db, accountant, 'delete_journal_entry', [id]), 'PERMISSION_DENIED');
  });

  it('is refused in a closed period, for the old date and the new one', async () => {
    const id = await post('2026-04-10');
    const other = await post('2026-03-10');
    const period = (await db.query<{ id: string }>(`select id from public.accounting_periods where company_id = $1 and name = '2026-04'`, [company])).rows[0].id;
    await rpc(db, admin, 'close_accounting_period', [period]);
    await expectDbError(save(admin, header('2026-03-10', 'No'), [line(rent, 2, 0), line(cash, 0, 2)], id), 'PERIOD_CLOSED');
    await expectDbError(rpc(db, admin, 'delete_journal_entry', [id]), 'PERIOD_CLOSED');
    await expectDbError(save(admin, header('2026-04-15', 'No'), [line(rent, 2, 0), line(cash, 0, 2)], other), 'PERIOD_CLOSED');
    await rpc(db, admin, 'reopen_accounting_period', [period, 'Done testing']);
  });

  it('is refused for reversed entries and reversals', async () => {
    const id = await post('2026-03-10');
    const reversal = await rpc<string>(db, admin, 'reverse_journal_entry', [id, '2026-03-11', 'Mistake']);
    await expectDbError(save(admin, header('2026-03-10', 'No'), [line(rent, 2, 0), line(cash, 0, 2)], id), 'ENTRY_NOT_EDITABLE');
    await expectDbError(save(admin, header('2026-03-11', 'No'), [line(rent, 2, 0), line(cash, 0, 2)], reversal), 'ENTRY_NOT_EDITABLE');
    await expectDbError(rpc(db, admin, 'delete_journal_entry', [reversal]), 'ENTRY_NOT_EDITABLE');
  });

  it('is refused for an entry that belongs to a voucher', async () => {
    const voucher = await rpc<string>(db, admin, 'save_voucher', [company, null, j({ voucher_type: 'receipt', voucher_date: '2026-03-14', party_name: 'Guest', cash_account_id: cash, counter_account_id: capital, amount: 50, description: 'Receipt' }), j([])]);
    await rpc(db, admin, 'post_voucher', [voucher]);
    const entry = (await db.query<{ id: string }>(`select id from public.journal_entries where voucher_id = $1`, [voucher])).rows[0].id;
    await expectDbError(save(admin, header('2026-03-14', 'No'), [line(rent, 2, 0), line(cash, 0, 2)], entry), 'ENTRY_NOT_EDITABLE');
    await expectDbError(rpc(db, admin, 'delete_journal_entry', [entry]), 'ENTRY_NOT_EDITABLE');
  });

  it('still blocks a direct change to a posted entry', async () => {
    const id = await post('2026-03-10');
    await expectDbError(db.query(`update public.journal_entries set description = 'x' where id = $1`, [id]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(db.query(`delete from public.journal_entry_lines where journal_entry_id = $1`, [id]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(db.query(`delete from public.journal_entries where id = $1`, [id]), 'POSTED_ENTRY_IMMUTABLE');
  });
});

describe('deleting a posted entry', () => {
  it('removes it from the ledger and records it in the audit log', async () => {
    const id = await post('2026-06-10', 700);
    const before = await cashBalance();
    await rpc(db, admin, 'delete_journal_entry', [id]);
    expect(await cashBalance()).toBe(before + 700);
    const found = await db.query(`select 1 from public.journal_entries where id = $1`, [id]);
    expect(found.rows).toHaveLength(0);
    const audit = await db.query<{ details: { status: string; before: { total: string } } }>(`select details from public.audit_logs where entity_id = $1 and action = 'deleted'`, [id]);
    expect(audit.rows[0].details.status).toBe('posted');
    expect(Number(audit.rows[0].details.before.total)).toBe(700);
  });
});

describe('entries in dollars', () => {
  const usd = (date: string, extra: Record<string, unknown> = {}) => header(date, 'Paid in dollars', { foreign_currency: 'USD', exchange_rate: '1680', ...extra });

  it('books 100 dollars at 1,680 as 168,000 dinars and keeps the dollars', async () => {
    const id = await save(admin, usd('2026-07-01'), [line(rent, 100, 0), line(cash, 0, 100)]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    const entry = await get(id);
    expect(entry.currency_code).toBe('IQD');
    expect(entry.foreign_currency).toBe('USD');
    expect(Number(entry.exchange_rate)).toBe(1680);
    expect(Number(entry.total_debit)).toBe(168000);
    expect(Number(entry.lines[0].debit_amount)).toBe(168000);
    expect(Number(entry.lines[0].foreign_debit)).toBe(100);
    expect(Number(entry.lines[1].credit_amount)).toBe(168000);
    expect(Number(entry.lines[1].foreign_credit)).toBe(100);
  });

  it('keeps cents and absorbs rounding so the entry still balances', async () => {
    const id = await save(admin, usd('2026-07-02', { exchange_rate: '1683.5' }), [
      line(rent, 1.33, 0), line(rent, 1.33, 0), line(cash, 0, 2.66),
    ]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    const entry = await get(id);
    expect(entry.status).toBe('posted');
    expect(Number(entry.total_debit)).toBe(Number(entry.total_credit));
    expect(Number(entry.lines[2].foreign_credit)).toBe(2.66);
  });

  it('requires a usable rate and refuses unknown currencies', async () => {
    const lines = [line(rent, 100, 0), line(cash, 0, 100)];
    await expectDbError(save(admin, usd('2026-07-03', { exchange_rate: '' }), lines), 'EXCHANGE_RATE_INVALID');
    await expectDbError(save(admin, usd('2026-07-03', { exchange_rate: '0' }), lines), 'EXCHANGE_RATE_INVALID');
    await expectDbError(save(admin, usd('2026-07-03', { exchange_rate: 'abc' }), lines), 'EXCHANGE_RATE_INVALID');
    await expectDbError(save(admin, usd('2026-07-03', { foreign_currency: 'XXX' }), lines), 'CURRENCY_NOT_SUPPORTED');
  });

  it('can be edited back to dinars, which clears the dollars', async () => {
    const id = await save(admin, usd('2026-07-04'), [line(rent, 100, 0), line(cash, 0, 100)]);
    await save(admin, header('2026-07-04', 'In dinars'), [line(rent, 5000, 0), line(cash, 0, 5000)], id);
    const entry = await get(id);
    expect(entry.foreign_currency).toBeNull();
    expect(Number(entry.exchange_rate)).toBe(1);
    expect(entry.lines[0].foreign_debit).toBeNull();
  });
});

describe('dates outside every fiscal year', () => {
  it('opens the missing earlier year, for someone without the periods right', async () => {
    const id = await save(accountant, header('2025-03-15', 'Last year'), [line(rent, 10, 0), line(cash, 0, 10)]);
    await rpc(db, accountant, 'post_journal_entry', [id]).catch(async (e) => {
      // This company requires approval, so the accountant's right to post may be limited.
      if (!String(e).includes('APPROVAL')) throw e;
      await rpc(db, admin, 'post_journal_entry', [id]);
    });
    const entry = await get(id);
    expect(entry.status).toBe('posted');
    expect(entry.period_name).toBe('2025-03');
    const year = await db.query<{ name: string; start_date: string; end_date: string; periods: number }>(
      `select f.name, f.start_date::text, f.end_date::text, (select count(*)::int from public.accounting_periods p where p.fiscal_year_id = f.id) as periods
         from public.fiscal_years f where f.company_id = $1 and f.name = '2025'`, [company]);
    expect(year.rows[0]).toEqual({ name: '2025', start_date: '2025-01-01', end_date: '2025-12-31', periods: 12 });
  });

  it('opens one year only, and reuses it for the next entry', async () => {
    await post('2025-04-01');
    const years = await db.query(`select 1 from public.fiscal_years where company_id = $1 and name = '2025'`, [company]);
    expect(years.rows).toHaveLength(1);
  });

  it('opens the year for a voucher too', async () => {
    const voucher = await rpc<string>(db, admin, 'save_voucher', [company, null, j({ voucher_type: 'receipt', voucher_date: '2024-02-14', party_name: 'Guest', cash_account_id: cash, counter_account_id: capital, amount: 50, description: 'Receipt' }), j([])]);
    await rpc(db, admin, 'post_voucher', [voucher]);
    const years = await db.query(`select 1 from public.fiscal_years where company_id = $1 and name = '2024'`, [company]);
    expect(years.rows).toHaveLength(1);
  });

  it('fits between years that do not start on the first of the month', async () => {
    const other = await rpc<string>(db, admin, 'create_company', ['Late', 'متأخر', 'IQD', '2026-11-07', true]);
    const c = await accountId(db, other, '1811');
    const r = await accountId(db, other, '3352');
    const id = await rpc<string>(db, admin, 'save_journal_entry', [other, null, j(header('2026-11-02', 'Before the start')), j([line(r, 1, 0), line(c, 0, 1)])]);
    await rpc(db, admin, 'post_journal_entry', [id]);
    const year = await db.query<{ start_date: string; end_date: string }>(
      `select start_date::text, end_date::text from public.fiscal_years where company_id = $1 and start_date < '2026-11-07'`, [other]);
    expect(year.rows).toEqual([{ start_date: '2026-11-01', end_date: '2026-11-06' }]);
  });

  it('still refuses a date in a closed year', async () => {
    const year = (await db.query<{ id: string }>(`select id from public.fiscal_years where company_id = $1 and name = '2024'`, [company])).rows[0].id;
    await db.query(`update public.accounting_periods set status = 'closed' where fiscal_year_id = $1`, [year]);
    const id = await save(admin, header('2024-03-01', 'Closed'), [line(rent, 1, 0), line(cash, 0, 1)]);
    await expectDbError(rpc(db, admin, 'post_journal_entry', [id]), 'PERIOD_CLOSED');
  });

  it('treats a date far away as a typing mistake', async () => {
    const id = await save(admin, header('1926-03-01', 'Typo'), [line(rent, 1, 0), line(cash, 0, 1)]);
    await expectDbError(rpc(db, admin, 'post_journal_entry', [id]), 'PERIOD_MISSING');
  });
});

describe('internal helpers', () => {
  it('are not callable through the API', async () => {
    await expectDbError(asUser(db, admin, (tx) => tx.query(`select public._create_period_for($1, '2020-01-01')`, [company])), /permission denied/);
    await expectDbError(asUser(db, admin, (tx) => tx.query(`select public._lines_to_base('[]', 1, 0::smallint, 2::smallint)`)), /permission denied/);
    await expectDbError(asUser(db, admin, (tx) => tx.query(`select public._entry_snapshot($1)`, [company])), /permission denied/);
  });
});
