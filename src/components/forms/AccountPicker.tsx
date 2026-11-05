import { clsx } from 'clsx';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { controlClass } from '@/components/ui/Field';
import { useLanguage } from '@/hooks/useLanguage';
import type { Account } from '@/lib/accounting';

interface AccountPickerProps {
  accounts: readonly Account[];
  value: string | null;
  onChange: (accountId: string | null) => void;
  /** Restricts the list (e.g. posting accounts, cash and bank accounts). */
  filter?: (account: Account) => boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

/**
 * Searchable account selector (combobox). Matches account code and both the
 * Arabic and English names. Only accounts passing `filter` can be chosen.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  filter = (a) => a.is_posting && a.is_active,
  placeholder,
  id,
  invalid,
  disabled,
  className,
  ...aria
}: AccountPickerProps) {
  const { t } = useTranslation();
  const { name } = useLanguage();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = accounts.find((a) => a.id === value) ?? null;
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter(filter)
      .filter((a) => !q || a.code.toLowerCase().startsWith(q) || a.name_en.toLowerCase().includes(q) || a.name_ar.includes(query.trim()))
      .slice(0, 80);
  }, [accounts, filter, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (account: Account) => {
    onChange(account.id);
    setOpen(false);
    setQuery('');
  };

  const label = selected ? `${selected.code} · ${name(selected)}` : '';

  return (
    <div ref={wrapperRef} className={clsx('relative', className)}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder ?? t('accountPicker.placeholder')}
        value={open ? query : label}
        title={label}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Tab') {
            setOpen(false);
          }
        }}
        className={clsx(controlClass, 'h-9 truncate pe-8')}
        {...aria}
      />
      <ChevronsUpDown size={14} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
      {open && !disabled && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-[280px] w-full min-w-[300px] overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[var(--shadow-pop)] scrollbar-thin"
        >
          {options.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted">{t('accountPicker.noResults')}</li>}
          {options.map((account, index) => (
            <li
              key={account.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={account.id === value}
              data-index={index}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(account);
              }}
              onMouseEnter={() => setActive(index)}
              className={clsx(
                'flex cursor-pointer items-baseline gap-3 px-3 py-2 text-[13px]',
                index === active ? 'bg-hover' : '',
                account.id === value && 'font-medium',
              )}
            >
              <span className="num w-12 shrink-0 text-ink-soft">{account.code}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{name(account)}</span>
              <span className="shrink-0 text-[11.5px] text-faint">{t(`accountTypes.${account.account_type}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
