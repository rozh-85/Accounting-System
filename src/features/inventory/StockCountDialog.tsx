import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AmountInput } from '@/components/forms/AmountInput';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, StaticField } from '@/components/ui/Field';
import { JournalPresentation } from '@/features/journal/components/JournalPresentation';
import { prefillState } from '@/features/journal/prefill';
import { useLanguage } from '@/hooks/useLanguage';
import { formatUnits, parseAmountInput, stockCountAdjustment, type Account, type InventoryChart, type InventoryRole, type Units } from '@/lib/accounting';
import { formatDate } from '@/lib/formatting';
import { useUnpostedStockEntries } from './useInventory';

function parseCount(value: string): Units | null {
  try {
    const units = parseAmountInput(value);
    return units !== null && units >= 0n ? units : null;
  } catch {
    return null;
  }
}

/**
 * Turns a counted stock value into the one entry that brings the books to it.
 * The entry opens in the normal entry form, so it is reviewed and posted there.
 */
export function StockCountDialog({
  open,
  onClose,
  date,
  bookStock,
  hasOpeningStock,
  chart,
  entryAccounts,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  bookStock: Units;
  hasOpeningStock: boolean;
  chart: InventoryChart;
  entryAccounts: Record<InventoryRole, Account | null>;
}) {
  const { t } = useTranslation();
  const { name } = useLanguage();
  const { currency } = useCompany();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const unposted = useUnpostedStockEntries(chart.postingIds.stock, open);

  const counted = parseCount(value);
  const adjustment = counted === null ? null : stockCountAdjustment(bookStock, counted);
  const money = (u: Units) => formatUnits(u, { decimals: currency.decimals });
  const codes = { stock: chart.accounts.stock?.code ?? '', change: chart.accounts.change?.code ?? '' };
  const waiting = unposted.data ?? [];

  const close = () => {
    setValue('');
    onClose();
  };

  const prepare = () => {
    if (!adjustment || counted === null) return;
    navigate('/journal/entries/new', {
      state: prefillState({
        entryDate: date,
        entryType: 'adjusting',
        description: t('inventory.countDescription', { date: formatDate(date), value: money(counted) }),
        debitAccountId: entryAccounts[adjustment.debit]?.id ?? null,
        creditAccountId: entryAccounts[adjustment.credit]?.id ?? null,
        amount: money(adjustment.amount),
      }),
    });
  };

  const line = (role: InventoryRole, side: 'debit' | 'credit', amount: Units) => {
    const account = entryAccounts[role] ?? chart.accounts[role];
    return {
      key: side,
      accountCode: account?.code ?? '',
      accountName: account ? name(account) : '',
      debit: side === 'debit' ? amount : 0n,
      credit: side === 'credit' ? amount : 0n,
    };
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={t('inventory.countTitle', { date: formatDate(date) })}
      description={t('inventory.countHint', codes)}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!adjustment} onClick={prepare}>{t('inventory.prepareEntry')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {waiting.length > 0 && (
          <Alert tone="warning" icon={<TriangleAlert size={16} />} title={t('inventory.unpostedTitle', { n: waiting.length })}>
            {t('inventory.unpostedBody')}{' '}
            {waiting.map((entry) => (
              <Link key={entry.id} to={`/journal/entries/${entry.id}`} className="num me-2 font-medium text-accent hover:underline">{entry.entry_number}</Link>
            ))}
          </Alert>
        )}
        {!hasOpeningStock && bookStock === 0n && <Alert tone="info">{t('inventory.countNotOpening')}</Alert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StaticField label={t('inventory.bookStock', codes)}>
            <span className="num font-semibold text-ink">{money(bookStock)}</span>
          </StaticField>
          <Field
            label={t('inventory.countedValue', { currency: currency.code })}
            required
            hint={t('inventory.countedHint')}
            error={value.trim() && counted === null ? t('inventory.countInvalid') : null}
          >
            {(p) => <AmountInput {...p} value={value} onChange={setValue} decimals={currency.decimals} />}
          </Field>
        </div>

        {counted !== null && !adjustment && (
          <Alert tone="success" icon={<CircleCheck size={16} />}>{t('inventory.countMatches')}</Alert>
        )}
        {adjustment && (
          <div className="overflow-hidden rounded-[12px] border border-line">
            <p className="border-b border-line bg-subtle px-4 py-2.5 text-[12.5px] font-medium text-ink-soft">{t('inventory.entryPreview')}</p>
            <JournalPresentation lines={[line(adjustment.debit, 'debit', adjustment.amount), line(adjustment.credit, 'credit', adjustment.amount)]} decimals={currency.decimals} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
