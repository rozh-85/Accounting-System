import { supabase } from './client';
import { toAppError } from './errors';

/** Calls a database function and throws an AppError carrying its error code. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}
