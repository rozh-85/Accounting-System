import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** Small dropdown menu with keyboard (Escape) and outside-click dismissal. */
export function Menu({
  trigger,
  items,
  align = 'end',
  header,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  header?: ReactNode;
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
            'absolute top-[calc(100%+6px)] z-40 min-w-[200px] overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-[var(--shadow-pop)]',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {header && <div className="border-b border-line px-3 py-2.5">{header}</div>}
          {visible.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] transition-colors hover:bg-hover disabled:opacity-40',
                item.danger ? 'text-danger' : 'text-ink',
              )}
            >
              {item.icon && <span className="text-muted">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
