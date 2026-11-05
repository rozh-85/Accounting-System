import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryStatus, VoucherStatus } from '@/lib/accounting';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'orange' | 'purple';

const tones: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: 'border-line-strong bg-subtle text-ink-soft', dot: 'bg-faint' },
  accent: { box: 'border-accent-line bg-accent-soft text-accent-strong', dot: 'bg-accent' },
  success: { box: 'border-success-line bg-success-soft text-success-strong', dot: 'bg-success' },
  warning: { box: 'border-warning-line bg-warning-soft text-warning', dot: 'bg-[#d08a1c]' },
  danger: { box: 'border-danger-line bg-danger-soft text-danger', dot: 'bg-danger' },
  info: { box: 'border-info-line bg-info-soft text-info', dot: 'bg-info' },
  orange: { box: 'border-orange-line bg-orange-soft text-orange', dot: 'bg-orange' },
  purple: { box: 'border-purple-line bg-purple-soft text-purple', dot: 'bg-purple' },
};

export function Badge({ tone = 'neutral', children, dot = true, className }: { tone?: BadgeTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11.5px] font-medium', tones[tone].box, className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', tones[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}

const statusTone: Record<EntryStatus, BadgeTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  posted: 'success',
  reversed: 'danger',
};

export function StatusBadge({ status }: { status: EntryStatus | VoucherStatus }) {
  const { t } = useTranslation();
  return <Badge tone={statusTone[status]}>{t(`status.${status}`)}</Badge>;
}

export function PeriodStatusBadge({ status }: { status: 'open' | 'closed' }) {
  const { t } = useTranslation();
  return <Badge tone={status === 'open' ? 'success' : 'neutral'}>{t(`periods.status.${status}`)}</Badge>;
}

/** One color per account type, used consistently across the app. */
export const ACCOUNT_TYPE_TONE: Record<'asset' | 'liability' | 'equity' | 'revenue' | 'expense', BadgeTone> = {
  asset: 'accent',
  liability: 'orange',
  equity: 'purple',
  revenue: 'success',
  expense: 'danger',
};

export function AccountTypeBadge({ type }: { type: keyof typeof ACCOUNT_TYPE_TONE }) {
  const { t } = useTranslation();
  return <Badge tone={ACCOUNT_TYPE_TONE[type]}>{t(`accountTypes.${type}`)}</Badge>;
}

const ENTRY_TYPE_TONE: Record<'standard' | 'opening' | 'adjusting' | 'closing' | 'reversing' | 'recurring', BadgeTone> = {
  standard: 'neutral',
  opening: 'info',
  adjusting: 'purple',
  closing: 'orange',
  reversing: 'danger',
  recurring: 'accent',
};

export function EntryTypeBadge({ type }: { type: keyof typeof ENTRY_TYPE_TONE }) {
  const { t } = useTranslation();
  return <Badge tone={ENTRY_TYPE_TONE[type]} dot={false}>{t(`entryTypes.${type}`)}</Badge>;
}

const VOUCHER_TYPE_TONE: Record<'receipt' | 'payment' | 'journal' | 'transfer', BadgeTone> = {
  receipt: 'success',
  payment: 'orange',
  journal: 'accent',
  transfer: 'info',
};

export function VoucherTypeBadge({ type }: { type: keyof typeof VOUCHER_TYPE_TONE }) {
  const { t } = useTranslation();
  return <Badge tone={VOUCHER_TYPE_TONE[type]} dot={false}>{t(`voucherTypes.${type}`)}</Badge>;
}
