import { clsx } from 'clsx';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Applies the typed search: on Enter and when the field loses focus. */
  onSearchCommit: () => void;
  searchPlaceholder: string;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** The one select that is always visible, normally status. */
  primary: ReactNode;
  /** Less-used filters, behind the Filters button. */
  more?: ReactNode;
  /** How many of the `more` filters are in use, shown on the button. */
  moreCount?: number;
  canClear: boolean;
  onClear: () => void;
}

function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative min-w-0">
      <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">{label}</span>
      <Input type="date" aria-label={label} className="num pe-2 ps-[2.9rem] max-sm:[&::-webkit-calendar-picker-indicator]:hidden" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** One line for list pages: search, date range and status, with the rest behind a button. */
export function FilterBar({
  search,
  onSearchChange,
  onSearchCommit,
  searchPlaceholder,
  from,
  to,
  onFromChange,
  onToChange,
  primary,
  more,
  moreCount = 0,
  canClear,
  onClear,
}: FilterBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(moreCount > 0);
  const hasTail = Boolean(more) || canClear;

  return (
    <Card className="mb-4 p-3">
      <div
        className={clsx(
          'grid grid-cols-2 gap-2.5 md:grid-cols-4',
          hasTail ? 'xl:grid-cols-[minmax(240px,1fr)_190px_190px_180px_auto]' : 'xl:grid-cols-[minmax(240px,1fr)_190px_190px_180px]',
        )}
      >
        <form
          className="relative col-span-2 md:col-span-4 xl:col-span-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchCommit();
          }}
        >
          <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            type="search"
            className="ps-10"
            placeholder={searchPlaceholder}
            aria-label={t('common.search')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={onSearchCommit}
          />
        </form>
        <DateFilter label={t('common.from')} value={from} onChange={onFromChange} />
        <DateFilter label={t('common.to')} value={to} onChange={onToChange} />
        <div className={clsx('min-w-0', !hasTail && 'col-span-2 xl:col-span-1')}>{primary}</div>
        {hasTail && (
          <div className="flex min-w-0 gap-2.5">
            {more && (
              <Button
                className="flex-1 xl:flex-none"
                icon={<SlidersHorizontal size={15} />}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                {t('common.filters')}
                {moreCount > 0 && (
                  <span className="num ms-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                    {moreCount}
                  </span>
                )}
              </Button>
            )}
            {canClear && (
              <IconButton label={t('common.clearFilters')} className="h-10 w-10 shrink-0 border border-line-strong bg-surface" onClick={onClear}>
                <X size={16} />
              </IconButton>
            )}
          </div>
        )}
      </div>
      {more && open && <div className="mt-2.5 grid grid-cols-1 gap-2.5 border-t border-line pt-2.5 sm:grid-cols-2 xl:grid-cols-4">{more}</div>}
    </Card>
  );
}
