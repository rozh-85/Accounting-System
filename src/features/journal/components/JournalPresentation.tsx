import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { formatUnits, orderForPresentation, summarizeLines, type Units } from '@/lib/accounting';

export interface PresentedLine {
  key: string;
  accountCode: string;
  accountName: string;
  debit: Units;
  credit: Units;
  description?: string | null;
}

/**
 * Formal journal presentation.
 *
 * Arabic (RTL): the amount columns مدين / دائن come first (rightmost), followed
 * by البيان with "من حـ/ …" for debit accounts and an indented "إلى حـ/ …" for
 * credit accounts; several accounts on one side are introduced by
 * "من مذكورين" / "إلى مذكورين".
 *
 * English: Account, Debit, Credit with credit accounts indented and prefixed
 * by "To", as in a traditional general journal.
 */
export function JournalPresentation({ lines, decimals, emptyLabel }: { lines: PresentedLine[]; decimals: number; emptyLabel?: string }) {
  const { t, i18n } = useTranslation();
  const arabic = i18n.language === 'ar';
  const ordered = orderForPresentation(lines);
  const debits = ordered.filter((l) => l.debit > 0n);
  const credits = ordered.filter((l) => l.debit === 0n);
  const summary = summarizeLines(lines.map((l) => ({ accountId: l.key, debit: l.debit, credit: l.credit })));
  const fmt = (u: Units) => (u === 0n ? '' : formatUnits(u, { decimals }));

  const amountCells = (line: PresentedLine) => (
    <>
      <td className="num w-[150px] border-b border-line px-4 py-2.5 text-end align-top">{fmt(line.debit)}</td>
      <td className="num w-[150px] border-b border-line px-4 py-2.5 text-end align-top">{fmt(line.credit)}</td>
    </>
  );

  const accountLabel = (line: PresentedLine, side: 'debit' | 'credit', grouped: boolean) => {
    const prefix = grouped ? t('journal.notation.account') : side === 'debit' ? t('journal.notation.from') : t('journal.notation.to');
    return (
      <div className={clsx(side === 'credit' && 'ps-10')}>
        <span className="text-ink">
          {prefix && <span className="text-muted">{prefix} </span>}
          {line.accountName}
        </span>
        <span className="num ms-2 text-[12px] text-faint">{line.accountCode}</span>
        {line.description && <p className="mt-0.5 text-[12px] text-muted">{line.description}</p>}
      </div>
    );
  };

  const groupHeader = (side: 'debit' | 'credit') => (
    <tr>
      {arabic && <td className="border-b border-line" colSpan={2} />}
      <td className={clsx('border-b border-line px-4 py-2 text-[12.5px] font-medium text-ink-soft', side === 'credit' && 'ps-10')}>
        {side === 'debit' ? t('journal.notation.fromSundries') : t('journal.notation.toSundries')}
      </td>
      {!arabic && <td className="border-b border-line" colSpan={2} />}
    </tr>
  );

  const renderSide = (side: 'debit' | 'credit', list: PresentedLine[]) => {
    const grouped = list.length > 1;
    return (
      <>
        {grouped && groupHeader(side)}
        {list.map((line) => (
          <tr key={line.key}>
            {arabic && amountCells(line)}
            <td className="border-b border-line px-4 py-2.5 align-top">{accountLabel(line, side, grouped)}</td>
            {!arabic && amountCells(line)}
          </tr>
        ))}
      </>
    );
  };

  const headerAmount = (
    <>
      <th scope="col" className="h-10 w-[150px] border-b border-line px-4 text-end text-[12px] font-medium text-muted">
        {t('journal.debit')}
      </th>
      <th scope="col" className="h-10 w-[150px] border-b border-line px-4 text-end text-[12px] font-medium text-muted">
        {t('journal.credit')}
      </th>
    </>
  );

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead className="bg-subtle">
          <tr>
            {arabic && headerAmount}
            <th scope="col" className="h-10 border-b border-line px-4 text-start text-[12px] font-medium text-muted">
              {arabic ? t('journal.statement') : t('journal.account')}
            </th>
            {!arabic && headerAmount}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-muted">
                {emptyLabel ?? t('journal.noLines')}
              </td>
            </tr>
          ) : (
            <>
              {renderSide('debit', debits)}
              {renderSide('credit', credits)}
            </>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-subtle font-semibold">
            {arabic && (
              <>
                <td className="num border-t border-line-strong px-4 py-2.5 text-end">{formatUnits(summary.totalDebit, { decimals })}</td>
                <td className="num border-t border-line-strong px-4 py-2.5 text-end">{formatUnits(summary.totalCredit, { decimals })}</td>
              </>
            )}
            <td className="border-t border-line-strong px-4 py-2.5">{t('common.total')}</td>
            {!arabic && (
              <>
                <td className="num border-t border-line-strong px-4 py-2.5 text-end">{formatUnits(summary.totalDebit, { decimals })}</td>
                <td className="num border-t border-line-strong px-4 py-2.5 text-end">{formatUnits(summary.totalCredit, { decimals })}</td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
