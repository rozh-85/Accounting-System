import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const widths = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[min(1200px,96vw)]',
};

/**
 * Modal dialog built on the native <dialog> element, which provides focus
 * trapping, Escape-to-close and an accessible modal role.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={clsx(
        'm-auto w-[calc(100%-2rem)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-[rgb(23_36_56/0.32)]',
        widths[size],
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
            </div>
            <IconButton label={t('common.close')} onClick={onClose} className="-me-1.5 -mt-1">
              <X size={16} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
