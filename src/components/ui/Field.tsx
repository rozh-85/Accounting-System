import { clsx } from 'clsx';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const controlClass =
  'block w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 text-[13.5px] text-ink shadow-[var(--shadow-xs)] placeholder:text-faint transition-colors hover:border-[#b6bdc8] focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/12 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[12.5px] font-medium text-ink-soft">
          {label}
          {required && <span className="ms-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(controlClass, 'h-10', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx(controlClass, 'select-control h-10 pe-10', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={clsx(controlClass, 'py-2 leading-relaxed', className)} {...rest} />;
});

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft select-none', className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-line-strong accent-[var(--color-accent)]" {...rest} />
      {label}
    </label>
  );
}

/** Read-only value displayed in the same rhythm as form fields. */
export function StaticField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <span className="text-[12.5px] font-medium text-ink-soft">{label}</span>
      <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-dashed border-line bg-subtle px-3 text-[13.5px] text-ink-soft">
        {children}
      </div>
    </div>
  );
}
