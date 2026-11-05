import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryStatus, VoucherStatus } from '@/lib/accounting';

export type BadgeTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'info';

const tones: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: 'border-line-strong bg-subtle text-ink-soft', dot: 'bg-faint' },
  accent: { box: 'border-[#c4dcd9] bg-accent-soft text-accent-strong', dot: 'bg-accent' },
  warning: { box: 'border-[#ead8b4] bg-warning-soft text-warning', dot: 'bg-[#c08a2c]' },
  danger: { box: 'border-[#e8c6c3] bg-danger-soft text-danger', dot: 'bg-danger' },
  info: { box: 'border-[#d3dceb] bg-info-soft text-info', dot: 'bg-info' },
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
  posted: 'accent',
  reversed: 'danger',
};

export function StatusBadge({ status }: { status: EntryStatus | VoucherStatus }) {
  const { t } = useTranslation();
  return <Badge tone={statusTone[status]}>{t(`status.${status}`)}</Badge>;
}

export function PeriodStatusBadge({ status }: { status: 'open' | 'closed' }) {
  const { t } = useTranslation();
  return <Badge tone={status === 'open' ? 'accent' : 'neutral'}>{t(`periods.status.${status}`)}</Badge>;
}
