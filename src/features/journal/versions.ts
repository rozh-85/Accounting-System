import { toUnits, type Units } from '@/lib/accounting';
import type { HistoryItem, JournalEntryDetail, Numeric } from '@/types/database';

/** An entry as the audit log stored it before or after an edit. */
export interface EntrySnapshot {
  entry_date?: string;
  entry_type?: string;
  description?: string;
  reference?: string | null;
  notes?: string | null;
  voucher_number?: string | null;
  foreign_currency?: string | null;
  exchange_rate?: Numeric | null;
  lines?: Array<{ account: string; debit: Numeric; credit: Numeric }>;
}

export const VERSION_FIELDS = ['entry_date', 'entry_type', 'description', 'reference', 'notes', 'voucher_number', 'foreign_currency', 'exchange_rate'] as const;
export type VersionField = (typeof VERSION_FIELDS)[number];

export type VersionChange =
  | { kind: 'field'; field: VersionField; from: string | null; to: string | null }
  | { kind: 'line'; account: string; change: 'added' | 'removed' | 'changed'; from: Amounts | null; to: Amounts | null };

export interface Amounts {
  debit: Units;
  credit: Units;
}

export interface EntryVersion {
  /** 1 for the entry as first saved, then 1.1, 1.2, ... */
  label: string;
  actorId: string | null;
  actorName: string | null;
  at: string;
  /** Edited after it was posted. */
  afterPosting: boolean;
  /** False for edits made before versions were recorded in detail. */
  recorded: boolean;
  changes: VersionChange[];
}

const EDIT_ACTIONS = new Set(['updated', 'edited_after_posting']);

export function versionLabel(edits: number) {
  return edits > 0 ? `1.${edits}` : '1';
}

/** The entry as it is now, in the same shape as the stored snapshots. */
export function currentSnapshot(entry: JournalEntryDetail): EntrySnapshot {
  return {
    entry_date: entry.entry_date,
    entry_type: entry.entry_type,
    description: entry.description,
    reference: entry.reference_number,
    notes: entry.notes,
    voucher_number: entry.voucher_number,
    foreign_currency: entry.foreign_currency ?? null,
    exchange_rate: entry.exchange_rate ?? 1,
    lines: entry.lines.map((l) => ({ account: l.account_code, debit: l.debit_amount, credit: l.credit_amount })),
  };
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function sameRate(a: unknown, b: unknown) {
  return Number(a ?? 1) === Number(b ?? 1);
}

function byAccount(lines: EntrySnapshot['lines']) {
  const map = new Map<string, Amounts>();
  for (const line of lines ?? []) {
    const current = map.get(line.account) ?? { debit: 0n, credit: 0n };
    map.set(line.account, { debit: current.debit + toUnits(line.debit), credit: current.credit + toUnits(line.credit) });
  }
  return map;
}

/** What changed between two snapshots. Fields an older snapshot did not keep are skipped. */
export function diffSnapshots(before: EntrySnapshot, after: EntrySnapshot): VersionChange[] {
  const changes: VersionChange[] = [];
  for (const field of VERSION_FIELDS) {
    if (!(field in before) || !(field in after)) continue;
    const from = before[field];
    const to = after[field];
    const differs = field === 'exchange_rate' ? !sameRate(from, to) : text(from) !== text(to);
    if (differs) changes.push({ kind: 'field', field, from: text(from), to: text(to) });
  }
  if (before.lines && after.lines) {
    const old = byAccount(before.lines);
    const next = byAccount(after.lines);
    for (const [account, to] of next) {
      const from = old.get(account);
      if (!from) changes.push({ kind: 'line', account, change: 'added', from: null, to });
      else if (from.debit !== to.debit || from.credit !== to.credit) changes.push({ kind: 'line', account, change: 'changed', from, to });
    }
    for (const [account, from] of old) {
      if (!next.has(account)) changes.push({ kind: 'line', account, change: 'removed', from, to: null });
    }
  }
  return changes;
}

/** The entry's versions, oldest first: the original save, then every edit. */
export function buildVersions(entry: JournalEntryDetail): EntryVersion[] {
  const history: HistoryItem[] = entry.history ?? [];
  const created = history.find((h) => h.action === 'created');
  const edits = history.filter((h) => EDIT_ACTIONS.has(h.action));
  const versions: EntryVersion[] = [
    {
      label: '1',
      actorId: created?.actor_id ?? entry.created_by,
      actorName: created?.actor_name ?? entry.created_by_name,
      at: created?.created_at ?? entry.created_at,
      afterPosting: false,
      recorded: true,
      changes: [],
    },
  ];
  edits.forEach((edit, index) => {
    const details = edit.details as { before?: EntrySnapshot; after?: EntrySnapshot };
    const nextBefore = (edits[index + 1]?.details as { before?: EntrySnapshot } | undefined)?.before;
    const after = details.after ?? nextBefore ?? (index === edits.length - 1 ? currentSnapshot(entry) : undefined);
    const recorded = Boolean(details.before && after);
    versions.push({
      label: `1.${index + 1}`,
      actorId: edit.actor_id,
      actorName: edit.actor_name,
      at: edit.created_at,
      afterPosting: edit.action === 'edited_after_posting',
      recorded,
      changes: recorded ? diffSnapshots(details.before!, after!) : [],
    });
  });
  return versions;
}
