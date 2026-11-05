import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Marks the item as the current choice (shows a check mark). */
  selected?: boolean;
  lang?: string;
  className?: string;
}

/** Small dropdown menu with keyboard (Escape) and outside-click dismissal. */
export function Menu({
  trigger,
  items,
  align = 'end',
  side = 'bottom',
  header,
  minWidth = 200,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  header?: ReactNode;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-40 overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-[var(--shadow-pop)]',
            side === 'bottom' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]',
            align === 'end' ? 'end-0' : 'start-0',
          )}
          style={{ minWidth }}
        >
          {header && <div className="border-b border-line px-3 py-2.5">{header}</div>}
          {visible.map((item, index) => (
            <button
              key={index}
              type="button"
              role={item.selected === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.selected}
              lang={item.lang}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] transition-colors hover:bg-hover disabled:opacity-40',
                item.danger ? 'text-danger' : 'text-ink',
                item.selected && 'font-medium',
                item.className,
              )}
            >
              {item.icon && <span className="text-muted">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.selected && <Check size={15} className="shrink-0 text-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
