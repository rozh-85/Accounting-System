import { clsx } from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { controlClass } from '@/components/ui/Field';
import { formatUnits, parseAmountInput } from '@/lib/accounting';

interface AmountInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  decimals: number;
}

/**
 * Money input. Accepts Latin or Arabic-Indic digits with or without grouping,
 * and reformats to the currency's precision (e.g. 1,000,000) when focus leaves.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onChange, decimals, className, onBlur, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      dir="ltr"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        try {
          const units = parseAmountInput(value);
          if (units !== null && units >= 0n) onChange(formatUnits(units, { decimals: Math.max(decimals, countDecimals(value)) }));
        } catch {
          /* leave invalid input for validation to report */
        }
        onBlur?.(e);
      }}
      className={clsx(controlClass, 'num h-9 text-end', className)}
      {...rest}
    />
  );
});

function countDecimals(value: string) {
  const i = value.indexOf('.');
  return i === -1 ? 0 : Math.min(4, value.length - i - 1);
}

/** Converts an AmountInput string to units (0 for empty or invalid input). */
export function amountToUnits(value: string): bigint {
  try {
    return parseAmountInput(value) ?? 0n;
  } catch {
    return 0n;
  }
}
