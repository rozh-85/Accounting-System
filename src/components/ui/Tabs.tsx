import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Underlined tab bar for switching views inside a page. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx('flex gap-1 border-b border-line', className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={clsx(
              '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-[13.5px] font-medium transition-colors',
              selected ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="num rounded bg-hover px-1.5 text-[11px] text-ink-soft">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Route-based tabs (each tab is a URL). */
export function NavTabs({ items, className }: { items: Array<{ to: string; label: ReactNode; end?: boolean }>; className?: string }) {
  return (
    <nav className={clsx('flex gap-1 border-b border-line', className)}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            clsx(
              '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13.5px] font-medium transition-colors',
              isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Compact two/three-way switch, e.g. Simple | Compound. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex rounded-[var(--radius-control)] border border-line-strong bg-subtle p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'h-7 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors',
            option.value === value ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(23_36_56/0.08)]' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
