import { clsx } from 'clsx';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useDemoMode } from './useDemoMode';

/** Top-bar switch: on adds a demo company of sample data, off deletes it. */
export function DemoSwitch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { enabled, busy, toggle } = useDemoMode();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={busy}
      onClick={toggle}
      title={t('demo.hint')}
      className={clsx(
        'h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-hover disabled:cursor-wait',
        className,
      )}
    >
      {t('demo.label')}
      {busy ? (
        <Spinner size={14} />
      ) : (
        <span className={clsx('relative h-[18px] w-8 rounded-full transition-colors', enabled ? 'bg-warning' : 'bg-line-strong')} aria-hidden="true">
          <span className={clsx('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all', enabled ? 'start-[16px]' : 'start-0.5')} />
        </span>
      )}
    </button>
  );
}

/** Always-visible notice while the demo company is open. */
export function DemoBanner() {
  const { t } = useTranslation();
  const { viewing, busy, turnOff } = useDemoMode();
  if (!viewing) return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-2.5 text-[13px]">
      <p className="flex min-w-0 items-center gap-2.5 text-ink-soft">
        <FlaskConical size={16} className="shrink-0 text-warning" aria-hidden="true" />
        <span>
          <span className="font-semibold text-warning">{t('demo.bannerTitle')}</span> {t('demo.bannerBody')}
        </span>
      </p>
      <Button size="sm" onClick={turnOff} loading={busy}>
        {t('demo.turnOff')}
      </Button>
    </div>
  );
}
