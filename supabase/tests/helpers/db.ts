/**
 * Database test harness.
 *
 * Runs the real migrations on PGlite (PostgreSQL compiled to WebAssembly) with
 * a minimal shim of the Supabase `auth` and `storage` schemas, then executes
 * statements as the `authenticated` role with a JWT subject — exactly how
 * PostgREST runs requests — so RLS, grants and SECURITY DEFINER functions are
 * exercised for real.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');

export const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
`;

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(db: PGlite, name: string): Promise<TestUser> {
  const id = randomUUID();
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`;
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('full_name', $3::text))`,
    [id, email, name],
  );
  return { id, email };
}

type Executor = Pick<Transaction, 'query' | 'exec'>;

/** Runs `fn` inside a transaction as the given authenticated user. */
export async function asUser<T>(db: PGlite, user: TestUser | null, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (user) {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user.id]);
      await tx.exec('set local role authenticated');
    } else {
      await tx.exec('set local role anon');
    }
    return fn(tx);
  });
}

/** Calls a public function as the user and returns the first column of the first row. */
export async function rpc<T = unknown>(db: PGlite, user: TestUser | null, fn: string, args: unknown[] = []): Promise<T> {
  return asUser(db, user, async (tx) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const result = await tx.query<Record<string, unknown>>(`select public.${fn}(${placeholders}) as value`, args);
    return result.rows[0]?.value as T;
  });
}

/** Expects a call to fail with the given database error message code. */
export async function expectDbError(promise: Promise<unknown>, code: string | RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = (error as Error).message;
    if (typeof code === 'string' ? message.includes(code) : code.test(message)) return;
    throw new Error(`Expected error ${String(code)} but got: ${message}`);
  }
  throw new Error(`Expected error ${String(code)} but the call succeeded`);
}

export async function accountId(db: PGlite, companyId: string, code: string): Promise<string> {
  const result = await db.query<{ id: string }>(`select id from public.accounts where company_id = $1 and code = $2`, [companyId, code]);
  if (!result.rows[0]) throw new Error(`Account ${code} not found`);
  return result.rows[0].id;
}

export function line(account: string, debit: number, credit: number, description?: string) {
  return { account_id: account, debit_amount: debit, credit_amount: credit, description: description ?? null };
}

export function header(date: string, description: string, extra: Record<string, unknown> = {}) {
  return { entry_date: date, description, entry_type: 'standard', ...extra };
}
