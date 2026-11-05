import { clsx } from 'clsx';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { absUnits, formatUnits, type Units } from '@/lib/accounting';

/** Totals with a clear balanced / out-of-balance status. */
export function BalanceIndicator({
  totalDebit,
  totalCredit,
  decimals,
  className,
}: {
  totalDebit: Units;
  totalCredit: Units;
  decimals: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const difference = totalDebit - totalCredit;
  const balanced = difference === 0n && totalDebit > 0n;
  const empty = totalDebit === 0n && totalCredit === 0n;

  return (
    <div className={clsx('flex flex-wrap items-stretch overflow-hidden rounded-[10px] border', balanced ? 'border-[#c4dcd9]' : empty ? 'border-line' : 'border-[#e8c6c3]', className)}>
      <div className="flex min-w-[140px] flex-1 flex-col justify-center px-4 py-2.5">
        <span className="text-[11.5px] text-muted">{t('journal.totalDebit')}</span>
        <span className="num text-[15px] font-semibold">{formatUnits(totalDebit, { decimals })}</span>
      </div>
      <div className="flex min-w-[140px] flex-1 flex-col justify-center border-s border-line px-4 py-2.5">
        <span className="text-[11.5px] text-muted">{t('journal.totalCredit')}</span>
        <span className="num text-[15px] font-semibold">{formatUnits(totalCredit, { decimals })}</span>
      </div>
      <div className="flex min-w-[140px] flex-1 flex-col justify-center border-s border-line px-4 py-2.5">
        <span className="text-[11.5px] text-muted">{t('journal.difference')}</span>
        <span className={clsx('num text-[15px] font-semibold', difference !== 0n && 'text-danger')}>{formatUnits(absUnits(difference), { decimals })}</span>
      </div>
      <div
        role="status"
        className={clsx(
          'flex min-w-[170px] items-center gap-2 px-4 py-2.5 text-[13px] font-semibold',
          balanced ? 'bg-accent-soft text-accent-strong' : empty ? 'bg-subtle text-muted' : 'bg-danger-soft text-danger',
        )}
      >
        {balanced ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
        {balanced ? t('journal.balanced') : empty ? t('journal.noAmounts') : t('journal.unbalanced')}
      </div>
    </div>
  );
}
