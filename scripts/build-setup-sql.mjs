// Concatenates supabase/migrations into supabase/setup.sql so a fresh hosted
// Supabase project can be set up by pasting one file into the SQL Editor.
// Run: npm run db:setup-sql
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildSetupSql() {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const parts = files.map((f) => `-- >>> ${f}\n${readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()}\n`);
  return [
    '-- =============================================================================',
    '-- Vio Accounting — complete database setup (generated, do not edit by hand)',
    '-- Paste into Supabase Dashboard → SQL Editor → New query → Run, ONCE, on a',
    '-- fresh project. Regenerate with `npm run db:setup-sql` after changing migrations.',
    '-- =============================================================================',
    '',
    ...parts,
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, 'supabase', 'setup.sql'), buildSetupSql());
  console.log('supabase/setup.sql written');
}
