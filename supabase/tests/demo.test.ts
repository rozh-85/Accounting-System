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
