/**
 * Demo company: sample data is complete and balanced, removal leaves nothing
 * behind, and a real company can never be deleted this way.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { accountId, asUser, createTestDatabase, createUser, expectDbError, header, line, rpc, type TestUser } from './helpers/db';

const j = (value: unknown) => JSON.stringify(value);

/** Every table with a company_id, so a removal can be checked exhaustively. */
const COMPANY_TABLES = [
  'company_settings', 'user_roles', 'fiscal_years', 'accounting_periods', 'accounts', 'document_sequences', 'vouchers',
  'voucher_lines', 'recurring_entry_templates', 'recurring_template_lines', 'journal_entries', 'journal_entry_lines',
  'attachments', 'audit_logs',
];

describe('demo company', () => {
  let db: PGlite;
  let owner: TestUser;
  let other: TestUser;
  let real: string;
  let demo: string;

  const count = async (table: string, company: string) =>
    Number((await db.query<{ n: string }>(`select count(*) as n from public.${table} where company_id = $1`, [company])).rows[0].n);

  beforeAll(async () => {
    db = await createTestDatabase();
    owner = await createUser(db, 'Demo Owner');
    other = await createUser(db, 'Other Owner');
    real = await rpc<string>(db, owner, 'create_company', ['Real Co', 'شركة حقيقية', 'IQD', '2026-01-01', true]);
    const cash = await accountId(db, real, '1110');
    const capital = await accountId(db, real, '3100');
    const entry = await rpc<string>(db, owner, 'save_journal_entry', [real, null, j(header('2026-01-05', 'Real capital')), j([line(cash, 1000, 0), line(capital, 0, 1000)])]);
    await rpc(db, owner, 'post_journal_entry', [entry]);
    demo = await rpc<string>(db, owner, 'create_demo_company');
  }, 120_000);

  it('creates a flagged company with posted, pending, draft and reversed work', async () => {
    const flag = await db.query<{ is_demo: boolean }>(`select is_demo from public.companies where id = $1`, [demo]);
    expect(flag.rows[0].is_demo).toBe(true);

    const statuses = await db.query<{ status: string }>(`select distinct status from public.journal_entries where company_id = $1`, [demo]);
    expect(statuses.rows.map((r) => r.status).sort()).toEqual(['draft', 'pending_approval', 'posted', 'reversed']);
    const vouchers = await db.query<{ status: string }>(`select distinct status from public.vouchers where company_id = $1`, [demo]);
    expect(vouchers.rows.map((r) => r.status).sort()).toEqual(['draft', 'pending_approval', 'posted', 'reversed']);
    expect(await count('recurring_entry_templates', demo)).toBe(1);
  });

  it('uses the full Kurdistan chart of accounts', async () => {
    expect(await count('accounts', demo)).toBe(731);
    const settings = await db.query<{ code: string }>(
      `select a.code from public.company_settings s join public.accounts a on a.id = s.retained_earnings_account_id where s.company_id = $1`,
      [demo],
    );
    expect(settings.rows[0].code).toBe('224');
    const types = await db.query<{ code: string; account_type: string; is_posting: boolean; parent: string | null }>(
      `select a.code, a.account_type, a.is_posting, p.code as parent
         from public.accounts a left join public.accounts p on p.id = a.parent_id
        where a.company_id = $1 and a.code in ('1', '211', '2316', '2414', '3111', '42111', '4211')`,
      [demo],
    );
    const byCode = Object.fromEntries(types.rows.map((r) => [r.code, r]));
    expect(byCode['1'].is_posting).toBe(false);
    expect(byCode['211'].account_type).toBe('equity');
    expect(byCode['2316'].account_type).toBe('asset');
    expect(byCode['2414'].account_type).toBe('liability');
    expect(byCode['42111'].parent).toBe('4211');
    expect(byCode['4211'].is_posting).toBe(false);
  });

  it('has an English name for every account', async () => {
    const left = await db.query(`select code from public.accounts where company_id = $1 and (name_en = name_ar or name_en ~ '[\u0600-\u06FF]')`, [demo]);
    expect(left.rows).toEqual([]);
    const names = await db.query<{ code: string; name_en: string; name_ar: string }>(
      `select code, name_en, name_ar from public.accounts where company_id = $1 and code in ('1811', '231', '42111')`,
      [demo],
    );
    const byCode = Object.fromEntries(names.rows.map((r) => [r.code, r]));
    expect(byCode['1811'].name_en).toBe('Head Office Cash Box');
    expect(byCode['1811'].name_ar).toBe('صندوق المركز');
    expect(byCode['231'].name_en).toBe('Accumulated Depreciation Provision');
    expect(byCode['42111'].name_en).toBe('Sales');
  });

  it('adds English names to a demo company created before them, keeping edited names', async () => {
    const accounts = await db.query<{ id: string; code: string }>(`select id, code from public.accounts where company_id = $1 and code in ('1811', '1812')`, [demo]);
    const id = (code: string) => accounts.rows.find((r) => r.code === code)!.id;
    await db.exec(`alter table public.accounts disable trigger user`);
    await db.query(`update public.accounts set name_en = name_ar where id = $1`, [id('1811')]);
    await db.query(`update public.accounts set name_en = 'Our own name' where id = $1`, [id('1812')]);
    await db.exec(`alter table public.accounts enable trigger user`);

    await db.query(`select public._apply_demo_chart_english($1)`, [demo]);

    const after = await db.query<{ code: string; name_en: string }>(`select code, name_en from public.accounts where id = any($1::uuid[])`, [[id('1811'), id('1812')]]);
    const names = Object.fromEntries(after.rows.map((r) => [r.code, r.name_en]));
    expect(names['1811']).toBe('Head Office Cash Box');
    expect(names['1812']).toBe('Our own name');
    await expectDbError(rpc(db, owner, '_apply_demo_chart_english', [demo]), /permission denied/);
  });

  it('chart passes the rules the account trigger normally enforces', async () => {
    const broken = await db.query(
      `select c.code
         from public.accounts c
         left join public.accounts p on p.id = c.parent_id
         left join public.account_categories k on k.code = c.category_code
        where c.company_id = $1
          and ((p.id is not null and (p.is_posting or p.account_type <> c.account_type or p.company_id <> c.company_id or c.level <> p.level + 1))
            or (p.id is null and c.level <> 1)
            or (c.is_posting and k.code is null)
            or (k.code is not null and k.account_type <> c.account_type)
            or (not c.is_posting and not exists (select 1 from public.accounts k2 where k2.parent_id = c.id)))`,
      [demo],
    );
    expect(broken.rows).toEqual([]);
    const guards = await db.query(`select 1 from pg_trigger where tgrelid = 'public.accounts'::regclass and tgenabled = 'D' and not tgisinternal`);
    expect(guards.rows).toHaveLength(0);
    const audit = await db.query<{ n: string }>(`select count(*) as n from public.audit_logs where company_id = $1 and entity_type = 'accounts'`, [demo]);
    expect(Number(audit.rows[0].n)).toBe(0);
  });

  it('posts sample activity to the chart, and assets equal liabilities plus equity', async () => {
    const totals = await db.query<{ account_type: string; net: string }>(
      `select a.account_type, sum(l.debit_amount - l.credit_amount) as net
         from public.journal_entry_lines l
         join public.journal_entries e on e.id = l.journal_entry_id
         join public.accounts a on a.id = l.account_id
        where e.company_id = $1 and e.status in ('posted', 'reversed')
        group by a.account_type`,
      [demo],
    );
    const net = Object.fromEntries(totals.rows.map((r) => [r.account_type, Number(r.net)]));
    expect(net.asset).toBeGreaterThan(0);
    expect(net.revenue).toBeLessThan(0);
    expect(net.expense).toBeGreaterThan(0);
    expect(net.liability).toBeLessThan(0);
    expect(net.equity).toBeLessThan(0);
    expect(net.asset + net.liability + net.equity + net.revenue + net.expense).toBe(0);
  });

  it('sample data balances', async () => {
    const totals = await db.query<{ debit: string; credit: string }>(
      `select sum(l.debit_amount) as debit, sum(l.credit_amount) as credit
         from public.journal_entry_lines l join public.journal_entries e on e.id = l.journal_entry_id
        where e.company_id = $1 and e.status in ('posted', 'reversed')`,
      [demo],
    );
    expect(Number(totals.rows[0].debit)).toBeGreaterThan(0);
    expect(totals.rows[0].debit).toBe(totals.rows[0].credit);
  });

  it('does not touch the real company', async () => {
    expect(await count('journal_entries', real)).toBe(1);
  });

  it('returns the existing demo company instead of making a second one', async () => {
    expect(await rpc<string>(db, owner, 'create_demo_company')).toBe(demo);
  });

  it('refuses to delete a real company', async () => {
    await expectDbError(rpc(db, owner, 'delete_demo_company', [real]), 'NOT_A_DEMO_COMPANY');
    expect(await count('journal_entries', real)).toBe(1);
  });

  it('refuses a user who is not in the demo company', async () => {
    await expectDbError(rpc(db, other, 'delete_demo_company', [demo]), 'PERMISSION_DENIED');
    expect(await count('journal_entries', demo)).toBeGreaterThan(0);
  });

  it('does not let a user flag a real company as demo', async () => {
    await expectDbError(
      asUser(db, owner, (tx) => tx.query(`update public.companies set is_demo = true where id = $1`, [real])),
      /permission denied/,
    );
  });

  it('does not expose the internal sample-data helpers', async () => {
    await expectDbError(
      rpc(db, owner, '_demo_entry', [real, '2026-01-06', 'x', j([]), 'post', 'standard']),
      /permission denied/,
    );
  });

  it('removes the demo company and everything in it', async () => {
    await rpc(db, owner, 'delete_demo_company', [demo]);
    const left = await db.query(`select 1 from public.companies where id = $1`, [demo]);
    expect(left.rows).toHaveLength(0);
    for (const table of COMPANY_TABLES) {
      expect(await count(table, demo), table).toBe(0);
    }
  });

  it('keeps the real company and restores every protection afterwards', async () => {
    expect(await count('journal_entries', real)).toBe(1);
    await expectDbError(db.query(`delete from public.journal_entries where company_id = $1`, [real]), 'POSTED_ENTRY_IMMUTABLE');
    await expectDbError(db.query(`delete from public.audit_logs where company_id = $1`, [real]), 'AUDIT_LOG_IMMUTABLE');
    const disabled = await db.query(`select 1 from pg_trigger where tgrelid::regnamespace::text = 'public' and tgenabled = 'D' and not tgisinternal`);
    expect(disabled.rows).toHaveLength(0);
  });

  it('can be switched on again after removal', async () => {
    const again = await rpc<string>(db, owner, 'create_demo_company');
    expect(again).not.toBe(demo);
    await rpc(db, owner, 'delete_demo_company', [again]);
  });
});
