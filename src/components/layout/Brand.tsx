import { clsx } from 'clsx';
import { ChevronDown, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@/components/ui/Menu';

/** Company wordmark (Vio brand red). */
export function Logo({ className, variant = 'red' }: { className?: string; variant?: 'red' | 'ink' | 'white' }) {
  return <img src={`/brand/vio-logo-${variant}.png`} alt="Vio" className={clsx('h-6 w-auto select-none', className)} draggable={false} />;
}

const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ar', label: 'العربية', short: 'ع' },
] as const;

/** Language selector: a compact dropdown showing the current language. */
export function LanguageSwitcher({ className, side = 'bottom', align = 'end' }: { className?: string; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  const { i18n, t } = useTranslation();
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];
  return (
    <div className={className}>
      <Menu
        side={side}
        align={align}
        minWidth={168}
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label={`${t('common.language')}: ${current.label}`}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-hover"
          >
            <Languages size={16} className="text-muted" aria-hidden="true" />
            <span lang={current.code} className={clsx('hidden sm:inline', current.code === 'ar' && 'font-ar')}>{current.label}</span>
            <span lang={current.code} className="num text-[12px] font-semibold sm:hidden">{current.short}</span>
            <ChevronDown size={14} className="hidden text-muted sm:block" aria-hidden="true" />
          </button>
        )}
        items={LANGUAGES.map((l) => ({
          label: l.label,
          lang: l.code,
          className: l.code === 'ar' ? 'font-ar' : undefined,
          icon: <span className="inline-block w-5 text-center text-[11px] font-semibold">{l.short}</span>,
          selected: l.code === current.code,
          onSelect: () => void i18n.changeLanguage(l.code),
        }))}
      />
    </div>
  );
}
