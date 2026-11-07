import { clsx } from 'clsx';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Card } from '@/components/ui/Card';
import { useLanguage } from '@/hooks/useLanguage';
import { buildDailyLedger, formatUnits, type LedgerStatement, type Units } from '@/lib/accounting';
import { formatDate, formatPeriodName } from '@/lib/formatting';

const cell = 'border border-line px-3 py-2 sm:px-4';
const amountCell = clsx(cell, 'num text-end whitespace-nowrap');
const band = 'bg-ink px-3 py-2.5 text-[12.5px] font-semibold text-white sm:px-4';

/**
 * Daily ledger (سجل الأستاذ): one row per day with the day's debit and credit
 * totals side by side and the running balance, so every row shows both sides.
 */
export function DailyLedgerTable({
  statement,
  title,
  from,
  to,
  onOpenDay,
}: {
  statement: LedgerStatement;
  title: string;
  from: string;
  to: string;
  onOpenDay: (date: string) => void;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { currency } = useCompany();
  const daily = useMemo(() => buildDailyLedger(statement), [statement]);
  const fmt = (u: Units) => formatUnits(u, { decimals: currency.decimals });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4 sm:px-6">
        <h2 className="text-[15.5px] font-semibold text-ink">{title}</h2>
        <p className="num text-[12.5px] text-muted">{t('dashboard.range', { from: formatDate(from), to: formatDate(to) })}</p>
      </div>
      <div className="relative overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={clsx(band, 'w-12 text-center')}>#</th>
              <th scope="col" className={clsx(band, 'text-start')}>{t('ledger.transactionDate')}</th>
              <th scope="col" className={clsx(band, 'text-end')}>{t('ledger.totalDebit')}</th>
              <th scope="col" className={clsx(band, 'text-end')}>{t('ledger.totalCredit')}</th>
              <th scope="col" className={clsx(band, 'text-end')}>{t('ledger.debitBalance')}</th>
              <th scope="col" className={clsx(band, 'text-end')}>{t('ledger.creditBalance')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-subtle font-semibold">
              <td colSpan={4} className={clsx(cell, 'text-end text-ink-soft')}>{t('ledger.previousBalance')}</td>
              <td className={amountCell}>{fmt(daily.openingDebit)}</td>
              <td className={amountCell}>{fmt(daily.openingCredit)}</td>
            </tr>
            {daily.months.length === 0 && (
              <tr>
                <td colSpan={6} className="border border-line py-8 text-center text-muted">{t('ledger.noMovements')}</td>
              </tr>
            )}
            {daily.months.map((month) => (
              <Fragment key={month.key}>
                <tr>
                  <td colSpan={6} className={clsx(cell, 'bg-surface font-semibold text-ink')}>{formatPeriodName(month.key, language)}</td>
                </tr>
                {month.rows.map((row) => (
                  <tr key={row.date} tabIndex={0} title={t('ledger.openDay')} onClick={() => onOpenDay(row.date)} onKeyDown={(e) => e.key === 'Enter' && onOpenDay(row.date)} className="cursor-pointer transition-colors hover:bg-subtle">
                    <td className={clsx(cell, 'num text-center text-muted')}>{row.serial}</td>
                    <td className={clsx(cell, 'num whitespace-nowrap text-ink-soft')}>{formatDate(row.date)}</td>
                    <td className={amountCell}>{fmt(row.debit)}</td>
                    <td className={amountCell}>{fmt(row.credit)}</td>
                    <td className={clsx(amountCell, 'font-medium')}>{fmt(row.balanceDebit)}</td>
                    <td className={clsx(amountCell, 'font-medium')}>{fmt(row.balanceCredit)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className={band}>{t('common.total')}</td>
              <td className={clsx(band, 'num text-end whitespace-nowrap')}>{fmt(daily.totalDebit)}</td>
              <td className={clsx(band, 'num text-end whitespace-nowrap')}>{fmt(daily.totalCredit)}</td>
              <td className={clsx(band, 'num text-end whitespace-nowrap')}>{fmt(daily.closingDebit)}</td>
              <td className={clsx(band, 'num text-end whitespace-nowrap')}>{fmt(daily.closingCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
