import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/Button';

export function Table({ className, children, minWidth }: { className?: string; children: ReactNode; minWidth?: number }) {
  return (
    <div className={clsx('overflow-x-auto scrollbar-thin', className)}>
      <table className="w-full border-collapse text-[13px]" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children, className }: { children: ReactNode; className?: string }) {
  return <thead className={clsx('bg-subtle', className)}>{children}</thead>;
}

export function Th({ numeric, className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={clsx(
        'h-10 border-b border-line px-3 text-[12px] font-medium whitespace-nowrap text-muted first:ps-5 last:pe-5',
        numeric ? 'text-end' : 'text-start',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ numeric, className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={clsx(
        'border-b border-line px-3 py-2.5 align-middle first:ps-5 last:pe-5',
        numeric ? 'num text-end whitespace-nowrap' : 'text-start',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({ className, interactive, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={clsx(interactive && 'cursor-pointer transition-colors hover:bg-subtle', className)} {...rest} />;
}

export function TotalsRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={clsx('bg-subtle font-semibold text-ink [&>td]:border-b-0 [&>td]:border-t [&>td]:border-t-line-strong', className)}>{children}</tr>;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const rtl = i18n.language === 'ar';
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-[12.5px] text-muted">
      <span className="num">{t('table.showing', { from, to, total })}</span>
      <div className="flex items-center gap-1">
        <IconButton label={t('table.previous')} disabled={page === 0} onClick={() => onPage(page - 1)}>
          {rtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </IconButton>
        <span className="num px-2">
          {page + 1} / {pages}
        </span>
        <IconButton label={t('table.next')} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          {rtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </IconButton>
      </div>
    </div>
  );
}
