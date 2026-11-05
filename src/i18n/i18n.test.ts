import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ar } from './ar/translation';
import { en } from './en/translation';

type Tree = { [key: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

function baseKeys(tree: Tree) {
  return new Set(flatten(tree).map((k) => k.replace(PLURAL, '')));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sourceFiles(path);
    return /\.(tsx?)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('translations', () => {
  const enKeys = baseKeys(en as unknown as Tree);
  const arKeys = baseKeys(ar as unknown as Tree);

  it('English and Arabic define the same keys', () => {
    expect([...enKeys].filter((k) => !arKeys.has(k))).toEqual([]);
    expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('every statically referenced key exists', () => {
    const root = join(__dirname, '..');
    const missing = new Set<string>();
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!enKeys.has(match[1])) missing.add(`${match[1]} (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('defines every database error code', () => {
    const sql = readdirSync(join(__dirname, '..', '..', 'supabase', 'migrations'))
      .map((f) => readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', f), 'utf8'))
      .join('\n');
    const codes = new Set([...sql.matchAll(/(?:_raise\('|message = ')([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]));
    const missing = [...codes].filter((code) => !enKeys.has(`errors.${code}`) || !arKeys.has(`errors.${code}`));
    expect(missing).toEqual([]);
  });

  it('uses Arabic accounting terminology for the four rooms', () => {
    expect(ar.rooms.journal.title).toBe('القيود اليومية');
    expect(ar.rooms.trialBalance.title).toBe('ميزان المراجعة');
    expect(ar.rooms.financialPosition.title).toBe('قائمة المركز المالي');
    expect(ar.journal.fromAccountDebit).toBe('من حـ / مدين');
    expect(ar.journal.toAccountCredit).toBe('إلى حـ / دائن');
  });
});
