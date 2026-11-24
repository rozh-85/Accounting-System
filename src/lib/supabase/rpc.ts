import { supabase } from './client';
import { toAppError } from './errors';

/** Calls a database function and throws an AppError carrying its error code. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

/** Rows asked for at a time. The API cuts longer results short without an error. */
const PAGE_SIZE = 1000;

/** Calls a set-returning function and reads all of its pages, in the given column order. */
export async function rpcAll<T>(fn: string, args: Record<string, unknown>, orderBy: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    let query = supabase.rpc(fn, args, { count: 'exact' });
    for (const column of orderBy) query = query.order(column);
    const { data, error, count } = await query.range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw toAppError(error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length === 0 || rows.length >= (count ?? 0)) return rows;
  }
}
