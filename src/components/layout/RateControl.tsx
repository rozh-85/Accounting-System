import { clsx } from 'clsx';
import { DollarSign } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AmountInput, amountToUnits } from '@/components/forms/AmountInput';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { unitsToDecimalString } from '@/lib/accounting';
import { formatRate } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import { FOREIGN_CURRENCY } from '@/features/journal/api';

/**
 * The company's dollar rate, in the top bar. New entries typed in dollars start
 * with it; each entry can still use its own rate, and saved entries keep theirs.
 */
export function RateControl() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { companyId, currency, settings, can } = useCompany();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rate = settings?.default_exchange_rate ? Number(settings.default_exchange_rate) : null;
  const editable = can('entries.create');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (currency.code === FOREIGN_CURRENCY.code) return null;

  const save = async () => {
    const units = amountToUnits(value);
    if (units <= 0n) {
      toast.error(t('errors.EXCHANGE_RATE_INVALID'));
      return;
    }
    setSaving(true);
    try {
      await rpc('set_default_exchange_rate', { p_company_id: companyId, p_rate: unitsToDecimalString(units) });
      await queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      toast.success(t('header.rateSaved'));
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!editable && rate === null}
        title={t('header.rateTitle')}
        onClick={() => {
          if (!editable) return;
          setValue(rate ? formatRate(rate) : '');
          setOpen((v) => !v);
        }}
        className={clsx(
          'inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border px-2.5 text-[12.5px] transition-colors',
          rate === null ? 'border-dashed border-line-strong text-muted hover:bg-hover' : 'border-line text-ink-soft hover:bg-hover',
          !editable && 'cursor-default hover:bg-transparent',
        )}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-success-strong" aria-hidden="true">
          <DollarSign size={13} strokeWidth={2.4} />
        </span>
        {rate === null ? (
          <span className="font-medium">{t('header.rateNotSet')}</span>
        ) : (
          <span dir="ltr" className="num flex items-baseline gap-1">
            <span className="hidden text-muted lg:inline">1 {FOREIGN_CURRENCY.code} =</span>
            <span className="font-semibold text-ink">{formatRate(rate)}</span>
            <span className="hidden text-muted sm:inline">{currency.code}</span>
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('header.rateTitle')}
          className="fixed inset-x-4 top-[72px] z-40 rounded-[12px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:end-0 sm:top-[calc(100%+6px)] sm:w-[320px]"
        >
          <p className="text-[14px] font-semibold text-ink">{t('header.rateTitle')}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t('header.rateHint')}</p>
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="text-[12px] font-medium text-ink-soft" htmlFor="vio-default-rate">
              {t('journal.rateField', { foreign: FOREIGN_CURRENCY.code, base: currency.code })}
            </label>
            {/* The whole sum reads left to right in both languages: 1 USD = [ 1,680 ] IQD */}
            <div className="relative mt-1" dir="ltr">
              <span className="num pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">
                1 {FOREIGN_CURRENCY.code} =
              </span>
              <AmountInput id="vio-default-rate" autoFocus className="h-10 ps-[4.5rem] pe-12" value={value} onChange={setValue} decimals={0} />
              <span className="num pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">{currency.code}</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" variant="accent" loading={saving}>{t('common.save')}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
