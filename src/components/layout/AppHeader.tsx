import { Building2, ChevronDown, LogOut, Menu as MenuIcon, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { formatPeriodName } from '@/lib/formatting';
import { LanguageSwitcher, Logo } from './Brand';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

export function AppHeader({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const { user, signOut } = useAuth();
  const { company, companies, role, profile, switchCompany } = useCompany();
  const summary = useDashboardSummary();
  const navigate = useNavigate();
  const period = summary.data?.current_period;
  const displayName = profile?.full_name || user?.email || '';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/90 lg:px-6">
      <IconButton label={t('nav.openMenu')} className="lg:hidden" onClick={onOpenNavigation}>
        <MenuIcon size={18} />
      </IconButton>

      <Link to="/" className="flex shrink-0 items-center gap-3" aria-label={t('nav.overview')}>
        <Logo className="h-[22px]" />
      </Link>
      <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-[13.5px] font-semibold leading-tight text-ink">{name(company)}</p>
        <p className="truncate text-[11.5px] leading-tight text-muted">{t('app.productName')}</p>
      </div>

      <div className="ms-auto flex items-center gap-2 sm:gap-3">
        {period && (
          <Link
            to="/periods"
            className="hidden h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 text-[12.5px] text-ink-soft hover:bg-hover md:inline-flex"
            title={t('header.currentPeriod')}
          >
            <span className="text-muted">{t('header.period')}</span>
            <span className="font-medium text-ink">{formatPeriodName(period.name, language)}</span>
            <span className={period.status === 'open' ? 'h-1.5 w-1.5 rounded-full bg-accent' : 'h-1.5 w-1.5 rounded-full bg-faint'} aria-hidden="true" />
            <span className="sr-only">{t(`periods.status.${period.status}`)}</span>
          </Link>
        )}

        <LanguageSwitcher className="hidden sm:inline-flex" />

        <IconButton label={t('nav.settings')} onClick={() => navigate('/settings')} className="hidden sm:inline-flex">
          <Settings size={17} />
        </IconButton>

        <Menu
          align="end"
          header={
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{displayName}</p>
              <p className="truncate text-[12px] text-muted">{user?.email}</p>
              {role && <p className="mt-1 text-[11.5px] font-medium text-accent">{t(`roles.${role}`)}</p>}
            </div>
          }
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] ps-1 pe-2 hover:bg-hover"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-subtle text-[11px] font-semibold text-ink">
                {initials(displayName)}
              </span>
              <span className="hidden max-w-[140px] truncate text-[13px] font-medium text-ink md:block">{displayName}</span>
              <ChevronDown size={14} className="text-muted" />
            </button>
          )}
          items={[
            ...companies
              .filter((c) => c.id !== company.id)
              .map((c) => ({
                label: t('header.switchTo', { name: name(c) }),
                icon: <Building2 size={15} />,
                onSelect: () => void switchCompany(c.id),
              })),
            { label: t('nav.newCompany'), icon: <Building2 size={15} />, onSelect: () => navigate('/onboarding') },
            { label: t('nav.settings'), icon: <Settings size={15} />, onSelect: () => navigate('/settings') },
            {
              label: t('auth.signOut'),
              icon: <LogOut size={15} />,
              danger: true,
              onSelect: () => void signOut().then(() => navigate('/login')),
            },
          ]}
        />
      </div>
    </header>
  );
}
