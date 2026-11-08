import { clsx } from 'clsx';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { controlClass } from '@/components/ui/Field';
import { useLanguage } from '@/hooks/useLanguage';
import type { Account } from '@/lib/accounting';
import { normalizeSearch } from '@/lib/formatting';

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
 * Arabic and English names. Only accounts passing `filter` can be chosen; group
 * accounts appear as headings so the whole chart can be read in order.
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
  const { rows, options, optionIndex } = useMemo(() => {
    if (!open) return { rows: [], options: [], optionIndex: new Map<string, number>() };
    const q = normalizeSearch(query);
    const matches = (a: Account) =>
      !q || a.code.toLowerCase().startsWith(q) || normalizeSearch(a.name_en).includes(q) || normalizeSearch(a.name_ar).includes(q);
    const byCode = new Map(accounts.map((a) => [a.id, a]));
    const choosable = new Set(accounts.filter((a) => filter(a) && matches(a)).map((a) => a.id));

    // Each choosable account brings its group accounts along as headings.
    const shown = new Set(choosable);
    for (const id of choosable) {
      let parent = byCode.get(byCode.get(id)?.parent_id ?? '');
      while (parent && !shown.has(parent.id)) {
        shown.add(parent.id);
        parent = byCode.get(parent.parent_id ?? '');
      }
    }
    if (q) for (const a of accounts) if (!a.is_posting && a.is_active && matches(a)) shown.add(a.id);

    // Text order puts every group directly above its own accounts: 1, 11, 111, 1111, 112...
    const visible = accounts.filter((a) => shown.has(a.id)).sort((a, b) => (a.code < b.code ? -1 : 1));
    const selectable = visible.filter((a) => choosable.has(a.id));
    return { rows: visible, options: selectable, optionIndex: new Map(selectable.map((a, i) => [a.id, i])) };
  }, [accounts, filter, query, open]);

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

  // A group cannot take entries: open it, or take its account if it has only one.
  const openGroup = (group: Account) => {
    const under = accounts.filter((a) => a.code !== group.code && a.code.startsWith(group.code) && filter(a));
    if (under.length === 1) {
      choose(under[0]);
      return;
    }
    setQuery(group.code);
    setActive(0);
    listRef.current?.scrollTo({ top: 0 });
  };
  const insideGroup = rows.some((a) => a.code === query.trim() && !optionIndex.has(a.id));

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
          {rows.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted">{t('accountPicker.noResults')}</li>}
          {insideGroup && (
            <li role="presentation" className="px-3 pb-1.5 pt-1 text-[12px] leading-snug text-accent-strong">
              {t('accountPicker.groupHint')}
            </li>
          )}
          {rows.map((account) => {
            const index = optionIndex.get(account.id);
            if (index === undefined) {
              return (
                <li
                  key={account.id}
                  role="presentation"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openGroup(account);
                  }}
                  className="flex cursor-pointer items-baseline gap-3 bg-subtle/70 px-3 py-1.5 text-[12px] font-semibold text-muted hover:bg-hover hover:text-ink"
                >
                  <span className="num w-14 shrink-0">{account.code}</span>
                  <span className="min-w-0 flex-1 truncate">{name(account)}</span>
                </li>
              );
            }
            return (
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
                <span className="num w-14 shrink-0 text-ink-soft">{account.code}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{name(account)}</span>
                <span className="shrink-0 text-[11.5px] text-faint">{t(`accountTypes.${account.account_type}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
