import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

/** Company wordmark (Vio brand red). */
export function Logo({ className, variant = 'red' }: { className?: string; variant?: 'red' | 'ink' | 'white' }) {
  return <img src={`/brand/vio-logo-${variant}.png`} alt="Vio" className={clsx('h-6 w-auto select-none', className)} draggable={false} />;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = i18n.language === 'ar' ? 'ar' : 'en';
  return (
    <div role="group" aria-label={t('common.language')} className={clsx('inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface p-0.5 text-[12.5px]', className)}>
      {(['en', 'ar'] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          lang={lng}
          aria-pressed={current === lng}
          onClick={() => void i18n.changeLanguage(lng)}
          className={clsx(
            'h-full rounded-[6px] px-2.5 font-medium transition-colors',
            current === lng ? 'bg-ink text-white' : 'text-muted hover:text-ink',
            lng === 'ar' && 'font-ar',
          )}
        >
          {lng === 'en' ? 'English' : 'العربية'}
        </button>
      ))}
    </div>
  );
}
