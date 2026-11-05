import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-2.5 rounded-[10px] border bg-surface px-3.5 py-3 text-[13px] shadow-[var(--shadow-pop)]',
              item.tone === 'error' ? 'border-[#ecc9c6]' : 'border-line',
            )}
            role={item.tone === 'error' ? 'alert' : 'status'}
          >
            {item.tone === 'error' ? (
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />
            ) : (
              <CircleCheck size={16} className="mt-0.5 shrink-0 text-accent" />
            )}
            <p className="min-w-0 flex-1 text-ink">{item.message}</p>
            <button type="button" onClick={() => dismiss(item.id)} className="text-faint hover:text-ink" aria-label="×">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
