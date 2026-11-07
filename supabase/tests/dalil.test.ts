/**
 * The dalil (Kurdistan chart of accounts): every new company starts on it, the
 * old demo is removed completely, and the clear-books script leaves only the
 * dalil behind.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { accountId, createTestDatabase, createUser, expectDbError, header, line, rpc, runMigrations, type TestUser } from './helpers/db';

const j = (value: unknown) => JSON.stringify(value);
const DALIL_MIGRATION = '20261107000300_dalil_for_every_company.sql';
const clearScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'clear_books_keep_dalil.sql'), 'utf8');

/** Every table with a company_id, so a removal can be checked exhaustively. */
const COMPANY_TABLES = [
  'company_settings', 'user_roles', 'fiscal_years', 'accounting_periods', 'accounts', 'document_sequences', 'vouchers',
  'voucher_lines', 'recurring_entry_templates', 'recurring_template_lines', 'journal_entries', 'journal_entry_lines',
  'attachments', 'audit_logs',
];
const BOOK_TABLES = ['document_sequences', 'vouchers', 'voucher_lines', 'recurring_entry_templates', 'recurring_template_lines',
  'journal_entries', 'journal_entry_lines', 'attachments'];

const count = async (db: PGlite, table: string, company: string) =>
  Number((await db.query<{ n: string }>(`select count(*) as n from public.${table} where company_id = $1`, [company])).rows[0].n);

const disabledTriggers = async (db: PGlite) =>
  (await db.query(`select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and t.tgenabled = 'D' and not t.tgisinternal`)).rows.length;

describe('new companies', () => {
  let db: PGlite;
  let owner: TestUser;
  let company: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    owner = await createUser(db, 'Owner');
    company = await rpc<string>(db, owner, 'create_company', ['Hotel', 'فندق', 'IQD', '2026-01-01', true]);
  }, 120_000);

  it('start on the 731-account dalil with Arabic and English names', async () => {
    expect(await count(db, 'accounts', company)).toBe(731);
    const retained = await db.query<{ code: string }>(
      `select a.code from public.company_settings s join public.accounts a on a.id = s.retained_earnings_account_id where s.company_id = $1`,
      [company],
    );
    expect(retained.rows[0].code).toBe('224');
    const untranslated = await db.query(`select code from public.accounts where company_id = $1 and (name_en = name_ar or name_en ~ '[\\u0600-\\u06FF]')`, [company]);
    expect(untranslated.rows).toEqual([]);
    const cash = await db.query<{ name_en: string; name_ar: string; category_code: string }>(
      `select name_en, name_ar, category_code from public.accounts where company_id = $1 and code = '1811'`, [company]);
    expect(cash.rows[0]).toEqual({ name_en: 'Head Office Cash Box', name_ar: 'صندوق المركز', category_code: 'cash' });
  });

  it('get a chart that passes the rules the account trigger normally enforces', async () => {
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
      [company],
    );
    expect(broken.rows).toEqual([]);
    expect(await disabledTriggers(db)).toBe(0);
    const audit = await db.query<{ n: string }>(`select count(*) as n from public.audit_logs where company_id = $1 and entity_type = 'accounts'`, [company]);
    expect(Number(audit.rows[0].n)).toBe(0);
  });

  it('can post to the dalil straight away', async () => {
    const cash = await accountId(db, company, '1811');
    const capital = await accountId(db, company, '211');
    const entry = await rpc<string>(db, owner, 'save_journal_entry', [company, null, j(header('2026-01-05', 'Capital')), j([line(cash, 1000, 0), line(capital, 0, 1000)])]);
    await rpc(db, owner, 'post_journal_entry', [entry]);
    const status = await db.query<{ status: string }>(`select status from public.journal_entries where id = $1`, [entry]);
    expect(status.rows[0].status).toBe('posted');
  });

  it('do not expose the chart and clearing helpers', async () => {
    for (const fn of ['_clear_company_books', '_seed_default_chart', '_seed_dalil_chart']) {
      const args = fn === '_clear_company_books' ? [company, false] : [company];
      await expectDbError(rpc(db, owner, fn, args), /permission denied/);
    }
  });
});

describe('removing the demo and clearing the books', () => {
  let db: PGlite;
  let owner: TestUser;
  let real: string;
  let demo: string;

  beforeAll(async () => {
    // A database as it was before this change: a real company with work in it,
    // and a demo company.
    db = await createTestDatabase(DALIL_MIGRATION);
    owner = await createUser(db, 'Owner');
    real = await rpc<string>(db, owner, 'create_company', ['Real Co', 'شركة حقيقية', 'IQD', '2026-01-01', true]);
    const cash = await accountId(db, real, '1110');
    const capital = await accountId(db, real, '3100');
    const entry = await rpc<string>(db, owner, 'save_journal_entry', [real, null, j(header('2026-01-05', 'Real capital')), j([line(cash, 1000, 0), line(capital, 0, 1000)])]);
    await rpc(db, owner, 'post_journal_entry', [entry]);
    await rpc(db, owner, 'save_voucher', [real, null, j({ voucher_type: 'receipt', voucher_date: '2026-01-06', party_name: 'Client', cash_account_id: cash, counter_account_id: capital, amount: 500, description: 'Receipt' }), j([])]);
    demo = await rpc<string>(db, owner, 'create_demo_company');
    await runMigrations(db, (f) => f >= DALIL_MIGRATION);
  }, 180_000);

  it('deletes the demo company and everything in it', async () => {
    const left = await db.query(`select 1 from public.companies where id = $1`, [demo]);
    expect(left.rows).toHaveLength(0);
    for (const table of COMPANY_TABLES) expect(await count(db, table, demo), table).toBe(0);
  });

  it('drops the demo functions and flag', async () => {
    const fns = await db.query(`select proname from pg_proc where proname in ('create_demo_company', 'delete_demo_company', '_demo_entry', '_demo_voucher', '_seed_demo_chart', '_seed_demo_chart_arabic', '_apply_demo_chart_english')`);
    expect(fns.rows).toEqual([]);
    const column = await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'is_demo'`);
    expect(column.rows).toHaveLength(0);
  });

  it('leaves the real company alone until the clear script runs', async () => {
    expect(await count(db, 'journal_entries', real)).toBe(1);
    expect(await count(db, 'vouchers', real)).toBe(1);
    expect(await count(db, 'accounts', real)).toBe(39);
  });

  it('clear script removes all work and leaves only the dalil', async () => {
    await db.exec(clearScript);
    for (const table of BOOK_TABLES) expect(await count(db, table, real), table).toBe(0);
    // The only audit row left records the new retained earnings account.
    const audit = await db.query<{ entity_type: string }>(`select entity_type from public.audit_logs where company_id = $1`, [real]);
    expect(audit.rows.map((r) => r.entity_type)).toEqual(['company_settings']);
    expect(await count(db, 'accounts', real)).toBe(731);
    const old = await db.query(`select 1 from public.accounts where company_id = $1 and code = '1110'`, [real]);
    expect(old.rows).toHaveLength(0);
    const retained = await db.query<{ code: string }>(
      `select a.code from public.company_settings s join public.accounts a on a.id = s.retained_earnings_account_id where s.company_id = $1`,
      [real],
    );
    expect(retained.rows[0].code).toBe('224');
    const english = await db.query(`select 1 from public.accounts where company_id = $1 and name_en = name_ar`, [real]);
    expect(english.rows).toHaveLength(0);
  });

  it('keeps the company, its users and periods, and every protection', async () => {
    expect(await count(db, 'company_settings', real)).toBe(1);
    expect(await count(db, 'user_roles', real)).toBe(1);
    expect(await count(db, 'fiscal_years', real)).toBe(1);
    expect(await count(db, 'accounting_periods', real)).toBe(12);
    expect(await disabledTriggers(db)).toBe(0);
  });

  it('starts numbering again and accepts new work', async () => {
    const cash = await accountId(db, real, '1811');
    const capital = await accountId(db, real, '211');
    const entry = await rpc<string>(db, owner, 'save_journal_entry', [real, null, j(header('2026-02-01', 'Opening')), j([line(cash, 1000, 0), line(capital, 0, 1000)])]);
    await rpc(db, owner, 'post_journal_entry', [entry]);
    const posted = await db.query<{ entry_number: string }>(`select entry_number from public.journal_entries where id = $1`, [entry]);
    expect(posted.rows[0].entry_number).toMatch(/0*1$/);
    // A posted entry is protected again.
    await expectDbError(db.query(`delete from public.journal_entries where id = $1`, [entry]), /.+/);
  });
});

// The hosted database may have skipped some of the earlier demo files. The dalil
// file must work from each of those states, and when run twice.
describe.each([
  ['the demo file only', '20261107000100'],
  ['the Arabic dalil demo, without English names', '20261107000200'],
  ['every earlier file', DALIL_MIGRATION],
])('a database that ran %s', (_label, before) => {
  let db: PGlite;
  let owner: TestUser;
  let real: string;

  beforeAll(async () => {
    db = await createTestDatabase(before);
    owner = await createUser(db, 'Owner');
    real = await rpc<string>(db, owner, 'create_company', ['Real Co', 'شركة حقيقية', 'IQD', '2026-01-01', true]);
    await rpc(db, owner, 'create_demo_company');
    await runMigrations(db, (f) => f === DALIL_MIGRATION);
    await runMigrations(db, (f) => f === DALIL_MIGRATION);
    await db.exec(clearScript);
  }, 180_000);

  it('ends with only the real company, on the dalil', async () => {
    const companies = await db.query<{ id: string }>(`select id from public.companies`);
    expect(companies.rows.map((r) => r.id)).toEqual([real]);
    expect(await count(db, 'accounts', real)).toBe(731);
    expect(await count(db, 'journal_entries', real)).toBe(0);
    const english = await db.query(`select 1 from public.accounts where company_id = $1 and name_en = name_ar`, [real]);
    expect(english.rows).toHaveLength(0);
    expect(await disabledTriggers(db)).toBe(0);
  });

  it('gives a new company the dalil', async () => {
    const company = await rpc<string>(db, owner, 'create_company', ['New Co', 'شركة جديدة', 'IQD', '2026-01-01', true]);
    expect(await count(db, 'accounts', company)).toBe(731);
  });
});
