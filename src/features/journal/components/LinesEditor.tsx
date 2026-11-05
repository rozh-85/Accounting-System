import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AccountPicker } from '@/components/forms/AccountPicker';
import { AmountInput, amountToUnits } from '@/components/forms/AmountInput';
import { Button, IconButton } from '@/components/ui/Button';
import { controlClass } from '@/components/ui/Field';
import { isValidAmountInput, type Account, type JournalLineDraft } from '@/lib/accounting';

export interface LineInput {
  key: string;
  accountId: string | null;
  debit: string;
  credit: string;
  description: string;
}

export function newLine(partial: Partial<LineInput> = {}): LineInput {
  return { key: crypto.randomUUID(), accountId: null, debit: '', credit: '', description: '', ...partial };
}

export function lineInputsToDrafts(lines: readonly LineInput[]): JournalLineDraft[] {
  return lines.map((l) => ({ accountId: l.accountId, debit: amountToUnits(l.debit), credit: amountToUnits(l.credit), description: l.description }));
}

/** Per-line problems shown inline while editing. */
export function lineProblem(line: LineInput): string | null {
  const blank = !line.accountId && !line.debit.trim() && !line.credit.trim() && !line.description.trim();
  if (blank) return null;
  if (!isValidAmountInput(line.debit) || !isValidAmountInput(line.credit)) return 'LINE_INVALID_AMOUNT';
  const debit = amountToUnits(line.debit);
  const credit = amountToUnits(line.credit);
  if (debit < 0n || credit < 0n || (debit > 0n) === (credit > 0n)) return 'LINE_INVALID_AMOUNT';
  if (!line.accountId) return 'LINE_ACCOUNT_REQUIRED';
  return null;
}

/**
 * Compound entry editor: unlimited debit and credit lines, each with its own
 * account, description and amount. Entering a debit clears the credit of the
 * same line (a line is either debit or credit, never both).
 */
export function LinesEditor({
  value,
  onChange,
  accounts,
  decimals,
  showErrors,
}: {
  value: LineInput[];
  onChange: (lines: LineInput[]) => void;
  accounts: readonly Account[];
  decimals: number;
  showErrors?: boolean;
}) {
  const { t } = useTranslation();
  const update = (key: string, patch: Partial<LineInput>) => onChange(value.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead className="bg-subtle">
            <tr className="text-[12px] text-muted">
              <th scope="col" className="h-10 w-10 border-b border-line ps-4 text-start font-medium">#</th>
              <th scope="col" className="h-10 w-[32%] border-b border-line px-2 text-start font-medium">{t('journal.account')}</th>
              <th scope="col" className="h-10 border-b border-line px-2 text-start font-medium">{t('journal.lineDescription')}</th>
              <th scope="col" className="h-10 w-[150px] border-b border-line px-2 text-end font-medium">{t('journal.debit')}</th>
              <th scope="col" className="h-10 w-[150px] border-b border-line px-2 text-end font-medium">{t('journal.credit')}</th>
              <th scope="col" className="h-10 w-12 border-b border-line pe-3"><span className="sr-only">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {value.map((line, index) => {
              const problem = showErrors ? lineProblem(line) : null;
              return (
                <tr key={line.key} className="align-top">
                  <td className="num border-b border-line ps-4 pt-4 text-[12px] text-faint">{index + 1}</td>
                  <td className="border-b border-line px-2 py-2">
                    <AccountPicker
                      accounts={accounts}
                      value={line.accountId}
                      onChange={(accountId) => update(line.key, { accountId })}
                      invalid={problem === 'LINE_ACCOUNT_REQUIRED'}
                      aria-label={`${t('journal.account')} ${index + 1}`}
                    />
                    {problem && <p className="mt-1 text-[11.5px] text-danger">{t(`errors.${problem}`, { detail: index + 1 })}</p>}
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    <input
                      className={`${controlClass} h-9`}
                      value={line.description}
                      maxLength={300}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      aria-label={`${t('journal.lineDescription')} ${index + 1}`}
                    />
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    <AmountInput
                      value={line.debit}
                      decimals={decimals}
                      onChange={(debit) => update(line.key, { debit, credit: debit.trim() ? '' : line.credit })}
                      aria-label={`${t('journal.debit')} ${index + 1}`}
                      aria-invalid={problem === 'LINE_INVALID_AMOUNT' || undefined}
                    />
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    <AmountInput
                      value={line.credit}
                      decimals={decimals}
                      onChange={(credit) => update(line.key, { credit, debit: credit.trim() ? '' : line.debit })}
                      aria-label={`${t('journal.credit')} ${index + 1}`}
                      aria-invalid={problem === 'LINE_INVALID_AMOUNT' || undefined}
                    />
                  </td>
                  <td className="border-b border-line pe-3 pt-2">
                    <IconButton
                      label={t('journal.removeLine')}
                      disabled={value.length <= 2}
                      onClick={() => onChange(value.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button size="sm" icon={<Plus size={14} />} onClick={() => onChange([...value, newLine()])}>
          {t('journal.addLine')}
        </Button>
      </div>
    </div>
  );
}
