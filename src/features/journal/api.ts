import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import type { EntryStatus, EntryType, VoucherType } from '@/lib/accounting';
import { ATTACHMENTS_BUCKET, supabase } from '@/lib/supabase/client';
import { toAppError } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { JournalEntryDetail, JournalListRow, Permission } from '@/types/database';

/** The dollar is the one foreign currency offered on journal entries. */
export const FOREIGN_CURRENCY = { code: 'USD', decimals: 2 } as const;

type EntryLinks = Pick<JournalListRow, 'status' | 'source' | 'voucher_id' | 'reversal_of_id'>;
type Can = (permission: Permission) => boolean;

/**
 * Drafts need the draft right; anything past draft also needs the right to
 * reverse. An entry that belongs to a voucher cannot be edited, because the
 * voucher would no longer match. The database applies the same rules and also
 * refuses a closed period.
 */
export function entryEditable(entry: EntryLinks, can: Can) {
  if (!can('entries.edit_draft') || entry.voucher_id || entry.source === 'voucher') return false;
  if (entry.status === 'draft') return true;
  return (entry.status === 'posted' || entry.status === 'reversed') && can('entries.reverse');
}

export function entryDeletable(entry: EntryLinks, can: Can) {
  if (!can('entries.edit_draft')) return false;
  return entry.status === 'draft' || can('entries.reverse');
}

/** Deleting this entry also changes a voucher or a reversal linked to it. */
export function entryHasLinks(entry: EntryLinks) {
  return Boolean(entry.voucher_id || entry.reversal_of_id) || entry.status === 'reversed';
}

export interface JournalFilters {
  search: string;
  from: string;
  to: string;
  status: EntryStatus | '';
  entryType: EntryType | '';
  accountId: string | null;
  voucherType: VoucherType | '';
  createdBy: string;
}

export const emptyJournalFilters: JournalFilters = {
  search: '',
  from: '',
  to: '',
  status: '',
  entryType: '',
  accountId: null,
  voucherType: '',
  createdBy: '',
};

export function searchArgs(companyId: string, f: JournalFilters, limit: number, offset: number) {
  return {
    p_company_id: companyId,
    p_search: f.search || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_statuses: f.status ? [f.status] : null,
    p_entry_types: f.entryType ? [f.entryType] : null,
    p_account_id: f.accountId,
    p_voucher_type: f.voucherType || null,
    p_created_by: f.createdBy || null,
    p_limit: limit,
    p_offset: offset,
  };
}

export function useJournalEntries(filters: JournalFilters, page: number, pageSize: number) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ['journal', companyId, 'list', filters, page, pageSize],
    queryFn: () => rpc<JournalListRow[]>('search_journal_entries', searchArgs(companyId, filters, pageSize, page * pageSize)),
    placeholderData: (previous) => previous,
  });
}

export function fetchAllJournalEntries(companyId: string, filters: JournalFilters) {
  return rpc<JournalListRow[]>('search_journal_entries', searchArgs(companyId, filters, 1000, 0));
}

export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['journal-entry', id],
    enabled: Boolean(id),
    queryFn: () => rpc<JournalEntryDetail>('get_journal_entry', { p_entry_id: id }),
  });
}

export interface EntryHeaderPayload {
  entry_date: string;
  entry_type: EntryType;
  voucher_type: VoucherType | null;
  voucher_number: string | null;
  description: string;
  notes: string | null;
  reference_number: string | null;
  currency_code: string;
  foreign_currency: string | null;
  exchange_rate: string | null;
}

export interface LinePayload {
  account_id: string | null;
  debit_amount: string;
  credit_amount: string;
  description: string | null;
}

/** Invalidates every query that depends on ledger data. */
export function useInvalidateLedger() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['journal', 'journal-entry', 'vouchers', 'voucher', 'dashboard', 'ledger', 'balances', 'trial-balance', 'financial-position', 'audit', 'periods', 'fiscal-years'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useSaveEntry() {
  const { companyId } = useCompany();
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: (input: { id: string | null; header: EntryHeaderPayload; lines: LinePayload[] }) =>
      rpc<string>('save_journal_entry', { p_company_id: companyId, p_entry_id: input.id, p_header: input.header, p_lines: input.lines }),
    onSuccess: () => invalidate(),
  });
}

type EntryAction =
  | { type: 'submit'; id: string }
  | { type: 'approve'; id: string }
  | { type: 'post'; id: string }
  | { type: 'reject'; id: string; reason: string }
  | { type: 'reverse'; id: string; date: string; reason: string }
  | { type: 'delete'; id: string };

export function useEntryAction() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (action: EntryAction): Promise<unknown> => {
      switch (action.type) {
        case 'submit':
          return rpc('submit_journal_entry', { p_entry_id: action.id });
        case 'approve':
          return rpc('approve_journal_entry', { p_entry_id: action.id });
        case 'post':
          return rpc('post_journal_entry', { p_entry_id: action.id });
        case 'reject':
          return rpc('reject_journal_entry', { p_entry_id: action.id, p_reason: action.reason });
        case 'reverse':
          return rpc<string>('reverse_journal_entry', { p_entry_id: action.id, p_reversal_date: action.date, p_reason: action.reason });
        case 'delete': {
          const paths = await rpc<string[]>('delete_journal_entry', { p_entry_id: action.id });
          if (paths?.length) await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
          return null;
        }
      }
    },
    onSuccess: () => invalidate(),
  });
}

// ---------------------------------------------------------------------------
// Attachments (shared by journal entries and vouchers)
// ---------------------------------------------------------------------------
export type AttachmentEntity = 'journal_entry' | 'voucher';

function safeFileName(name: string) {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'file';
}

export async function uploadAttachment(companyId: string, entityType: AttachmentEntity, entityId: string, file: File) {
  const path = `${companyId}/${entityType}/${entityId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw toAppError(error);
  try {
    await rpc('register_attachment', {
      p_company_id: companyId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_file_name: file.name,
      p_storage_path: path,
      p_mime_type: file.type || null,
      p_size_bytes: file.size,
    });
  } catch (e) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    throw e;
  }
}

export async function deleteAttachment(attachmentId: string) {
  const path = await rpc<string>('delete_attachment', { p_attachment_id: attachmentId });
  if (path) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
}

export async function attachmentUrl(path: string, download?: string) {
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 120, download ? { download } : undefined);
  if (error) throw toAppError(error);
  return data.signedUrl;
}
