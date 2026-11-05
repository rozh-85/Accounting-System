import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher, Logo } from '@/components/layout/Brand';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh bg-surface">
      <aside className="relative hidden w-[42%] max-w-[560px] flex-col justify-between bg-brand px-12 py-10 text-white lg:flex">
        <img src="/brand/vio-logo-white.png" alt="Vio" className="h-9 w-auto self-start" />
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">{t('app.productName')}</p>
          <p className="mt-3 max-w-sm text-[22px] font-semibold leading-snug">{t('auth.panelTitle')}</p>
          <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-white/80">{t('auth.panelBody')}</p>
          <dl className="mt-10 grid max-w-sm grid-cols-2 gap-x-6 gap-y-3 border-t border-white/20 pt-6 text-[12.5px]">
            {(['journal', 'ledger', 'trialBalance', 'financialPosition'] as const).map((key, i) => (
              <div key={key} className="flex gap-2">
                <dt className="num text-white/60">0{i + 1}</dt>
                <dd className="text-white/90">{t(`rooms.${key}.title`)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-[12px] text-white/60">{t('auth.panelFooter')}</p>
      </aside>

      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-6 py-5 sm:px-10">
          <Logo className="h-6 lg:invisible" />
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
          <div className="w-full max-w-[380px]">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[13.5px] text-muted">{subtitle}</p>}
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-6 border-t border-line pt-5 text-[13px] text-muted">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
