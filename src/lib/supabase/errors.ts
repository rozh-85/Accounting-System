import type { TFunction } from 'i18next';

/** Error raised by the data layer, carrying the database's stable error code. */
export class AppError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message?: string, detail?: string) {
    super(message ?? code);
    this.code = code;
    this.detail = detail;
  }
}

const KNOWN_CODE = /^[A-Z][A-Z0-9_]+$/;

interface PostgrestLikeError {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

/** Normalises Supabase/PostgREST/Auth errors into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = error as PostgrestLikeError & { status?: number; name?: string };
  const message = e?.message ?? String(error);
  if (KNOWN_CODE.test(message)) return new AppError(message, message, e.details ?? undefined);
  if (e?.code === '23505') return new AppError('DUPLICATE_VALUE', message, e.details ?? undefined);
  if (e?.code === '23503') return new AppError('REFERENCED_RECORD', message, e.details ?? undefined);
  if (e?.code === '42501' || /permission denied|row-level security/i.test(message)) {
    return new AppError('PERMISSION_DENIED', message);
  }
  if (/invalid login credentials/i.test(message)) return new AppError('INVALID_CREDENTIALS', message);
  if (/email not confirmed/i.test(message)) return new AppError('EMAIL_NOT_CONFIRMED', message);
  if (/user already registered/i.test(message)) return new AppError('USER_EXISTS', message);
  if (/password should be at least/i.test(message)) return new AppError('WEAK_PASSWORD', message);
  if (/failed to fetch|network/i.test(message)) return new AppError('NETWORK_ERROR', message);
  return new AppError('UNKNOWN_ERROR', message);
}

/** Bilingual, user-facing message for an error. */
export function errorMessage(error: unknown, t: TFunction): string {
  const appError = toAppError(error);
  const key = `errors.${appError.code}`;
  const translated = t(key, { detail: appError.detail ?? '' });
  if (translated !== key) return translated;
  return t('errors.UNKNOWN_ERROR');
}

export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}
