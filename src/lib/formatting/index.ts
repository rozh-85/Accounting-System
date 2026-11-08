import { formatUnits, toUnits, type FormatOptions, type Units } from '@/lib/accounting/money';

export type Language = 'en' | 'ar';

/** Locale for Intl APIs. Arabic uses Iraqi month names with Latin digits. */
export function intlLocale(language: Language): string {
  return language === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB';
}

function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Numeric date used everywhere (UI tables, PDFs, exports): dd/MM/yyyy.
 * Slashes keep the date in the correct order inside Arabic text, unlike
 * hyphens, which the Unicode bidi algorithm reorders after Arabic letters.
 */
const SEARCH_LETTERS: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ە': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و',
};

/**
 * Folds text so a search finds it however it was typed. Arabic and Kurdish
 * keyboards produce different letters for the same word (ي / ی, ك / ک), and the
 * chart of accounts mixes them. Arabic-Indic digits become Latin ones.
 */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[يىئكةەأإآؤ]/g, (c) => SEARCH_LETTERS[c])
    .replace(/\s+/g, ' ')
    .trim();
}

/** An exchange rate as people say it: 1,680 or 1,683.5, without trailing zeros. */
export function formatRate(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLongDate(value: string | null | undefined, language: Language): string {
  if (!value) return '';
  const d = parseIsoDate(value) ?? new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(language), { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** "2026-11" → "November 2026" / "تشرين الثاني 2026". Other names are returned unchanged. */
export function formatPeriodName(name: string, language: Language): string {
  const m = /^(\d{4})-(\d{2})$/.exec(name);
  if (!m) return name;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return new Intl.DateTimeFormat(intlLocale(language), { month: 'long', year: 'numeric' }).format(d);
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The user's current local date as YYYY-MM-DD. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso)!;
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function startOfYear(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`;
}

export function formatAmount(value: Units | number | string | null | undefined, decimals: number, options: Omit<FormatOptions, 'decimals'> = {}): string {
  if (value === null || value === undefined) return '';
  const units = typeof value === 'bigint' ? value : toUnits(value);
  return formatUnits(units, { decimals, ...options });
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
