import type { EntryType } from '@/lib/accounting';

/** Starting values another page hands to a new entry. Nothing is saved until the user saves it. */
export interface EntryPrefill {
  entryDate?: string;
  entryType?: EntryType;
  description?: string;
  debitAccountId?: string | null;
  creditAccountId?: string | null;
  /** In the books' currency, as typed in the amount field. */
  amount?: string;
}

/** Router state for a link to a new entry: navigate('/journal/entries/new', { state: prefillState(...) }). */
export function prefillState(prefill: EntryPrefill) {
  return { prefill };
}

export function readPrefill(state: unknown): EntryPrefill {
  return (state as { prefill?: EntryPrefill } | null)?.prefill ?? {};
}
