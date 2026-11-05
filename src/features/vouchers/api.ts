import { useMutation, useQuery } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import type { VoucherStatus, VoucherType } from '@/lib/accounting';
import { ATTACHMENTS_BUCKET, supabase } from '@/lib/supabase/client';
import { rpc } from '@/lib/supabase/rpc';
import type { VoucherDetail, VoucherListRow } from '@/types/database';
import { useInvalidateLedger, type LinePayload } from '@/features/journal/api';

export interface VoucherFilters {
  search: string;
  from: string;
  to: string;
  type: VoucherType | '';
  status: VoucherStatus | '';
}

export function voucherSearchArgs(companyId: string, f: VoucherFilters, limit: number, offset: number) {
  return {
    p_company_id: companyId,
    p_search: f.search || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_types: f.type ? [f.type] : null,
    p_statuses: f.status ? [f.status] : null,
    p_limit: limit,
    p_offset: offset,
  };
}

export function useVouchers(filters: VoucherFilters, page: number, pageSize: number) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ['vouchers', companyId, filters, page, pageSize],
    queryFn: () => rpc<VoucherListRow[]>('search_vouchers', voucherSearchArgs(companyId, filters, pageSize, page * pageSize)),
    placeholderData: (previous) => previous,
  });
}

export function useVoucher(id: string | undefined) {
  return useQuery({
    queryKey: ['voucher', id],
    enabled: Boolean(id),
    queryFn: () => rpc<VoucherDetail>('get_voucher', { p_voucher_id: id }),
  });
}

export interface VoucherPayload {
  voucher_type: VoucherType;
  voucher_date: string;
  party_name: string | null;
  payment_method: string | null;
  cheque_number: string | null;
  cash_account_id: string | null;
  counter_account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  amount: string;
  currency_code: string;
  description: string;
  notes: string | null;
  reference_number: string | null;
}

export function useSaveVoucher() {
  const { companyId } = useCompany();
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: (input: { id: string | null; data: VoucherPayload; lines: LinePayload[] }) =>
      rpc<string>('save_voucher', { p_company_id: companyId, p_voucher_id: input.id, p_data: input.data, p_lines: input.lines }),
    onSuccess: () => invalidate(),
  });
}

type VoucherAction =
  | { type: 'submit' | 'approve' | 'post' | 'delete'; id: string }
  | { type: 'reject'; id: string; reason: string }
  | { type: 'reverse'; id: string; date: string; reason: string };

export function useVoucherAction() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (action: VoucherAction): Promise<unknown> => {
      switch (action.type) {
        case 'submit':
          return rpc('submit_voucher', { p_voucher_id: action.id });
        case 'approve':
          return rpc('approve_voucher', { p_voucher_id: action.id });
        case 'post':
          return rpc('post_voucher', { p_voucher_id: action.id });
        case 'reject':
          return rpc('reject_voucher', { p_voucher_id: action.id, p_reason: action.reason });
        case 'reverse':
          return rpc('reverse_voucher', { p_voucher_id: action.id, p_reversal_date: action.date, p_reason: action.reason });
        case 'delete': {
          const paths = await rpc<string[]>('delete_voucher', { p_voucher_id: action.id });
          if (paths?.length) await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
          return null;
        }
      }
    },
    onSuccess: () => invalidate(),
  });
}
