import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { buildSetupSql } from '../../scripts/build-setup-sql.mjs';
import { SUPABASE_SHIM } from './helpers/db';

const committed = () => readFileSync(join(__dirname, '..', 'setup.sql'), 'utf8').replace(/\r\n/g, '\n');

describe('supabase/setup.sql', () => {
  it('matches the migrations (run `npm run db:setup-sql` after changing them)', () => {
    expect(committed()).toBe(buildSetupSql());
  });

  it('applies cleanly to a fresh database in one run', async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_SHIM);
    await db.exec(committed());
    const r = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'post_journal_entry'`);
    expect(r.rows[0].n).toBe(1);
  });
});
