import { clsx } from 'clsx';
import { Building2, ChevronDown, ChevronRight, FlaskConical, LogOut, Menu as MenuIcon, PanelLeftOpen, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { formatPeriodName } from '@/lib/formatting';
import type { NavigationMode } from '@/features/dashboard/navigation';
import { DemoSwitch } from '@/features/demo/DemoSwitch';
import { useDemoMode } from '@/features/demo/useDemoMode';
import { LanguageSwitcher, Logo } from './Brand';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

/** Page names for the breadcrumb, most specific path first. */
const PAGE_TITLES: Array<[prefix: string, title: string, inJournalRoom?: boolean]> = [
  ['/journal/vouchers', 'journal.tabs.vouchers', true],
  ['/journal/recurring', 'journal.tabs.recurring', true],
  ['/journal', 'rooms.journal.title'],
  ['/ledger', 'rooms.ledger.title'],
  ['/trial-balance', 'rooms.trialBalance.title'],
  ['/financial-position', 'rooms.financialPosition.title'],
  ['/accounts', 'nav.accounts'],
  ['/reports', 'nav.reports'],
  ['/periods', 'nav.periods'],
  ['/audit', 'nav.audit'],
  ['/settings', 'nav.settings'],
  ['/overview', 'nav.overview'],
];

export function AppHeader({
  mode,
  onOpenNavigation,
  sidebarCollapsed,
  onExpandSidebar,
}: {
  mode: NavigationMode;
  onOpenNavigation: () => void;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}) {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const { user, signOut } = useAuth();
  const { company, companies, role, profile, switchCompany } = useCompany();
  const summary = useDashboardSummary();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const period = summary.data?.current_period;
  const demo = useDemoMode();
  const displayName = profile?.full_name || user?.email || '';

  const page = PAGE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const pageKey = page?.[1] ?? (mode === 'home' ? 'nav.home' : 'nav.overview');

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:gap-3 sm:px-6">
      {mode === 'sidebar' && (
        <>
          <IconButton label={t('nav.openMenu')} className="border border-line lg:hidden" onClick={onOpenNavigation}>
            <MenuIcon size={18} />
          </IconButton>
          {sidebarCollapsed && (
            <IconButton label={t('nav.expand')} className="hidden border border-line lg:inline-flex" onClick={onExpandSidebar}>
              <PanelLeftOpen size={18} className="rtl:-scale-x-100" />
            </IconButton>
          )}
        </>
      )}

      {/* Logo: always in the home-screen layout; on small screens in the sidebar layout. */}
      <Link to="/" className={clsx('flex shrink-0 items-center', mode === 'sidebar' && 'lg:hidden')} aria-label={t('nav.overview')}>
        <Logo className="h-[22px]" />
      </Link>

      {mode === 'home' && <span className="ms-1 hidden h-6 w-px bg-line md:block" aria-hidden="true" />}

      {/* Breadcrumb */}
      <nav aria-label={t('nav.breadcrumb')} className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex md:ps-1">
        <span className="truncate text-muted">{name(company)}</span>
        <ChevronRight size={14} className="shrink-0 text-faint rtl:-scale-x-100" aria-hidden="true" />
        {page?.[2] && (
          <>
            <Link to="/journal" className="truncate text-muted hover:text-ink">
              {t('rooms.journal.title')}
            </Link>
            <ChevronRight size={14} className="shrink-0 text-faint rtl:-scale-x-100" aria-hidden="true" />
          </>
        )}
        <span className="truncate font-medium text-ink">{t(pageKey)}</span>
      </nav>

      <div className="ms-auto flex items-center gap-2 sm:gap-3">
        {period && (
          <Link
            to="/periods"
            className="hidden h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-hover xl:inline-flex"
            title={t('header.currentPeriod')}
          >
            <span className={period.status === 'open' ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-faint'} aria-hidden="true" />
            <span className="text-muted">{t('header.period')}</span>
            <span className="font-medium text-ink">{formatPeriodName(period.name, language)}</span>
            <span className="sr-only">{t(`periods.status.${period.status}`)}</span>
          </Link>
        )}

        <DemoSwitch className="hidden lg:inline-flex" />

        <LanguageSwitcher />

        <IconButton label={t('nav.settings')} onClick={() => navigate('/settings')} className="hidden border border-line sm:inline-flex">
          <Settings size={17} />
        </IconButton>

        <Menu
          align="end"
          header={
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{displayName}</p>
              <p className="truncate text-[12px] text-muted">{user?.email}</p>
              {role && <p className="mt-1 text-[11.5px] font-medium text-primary">{t(`roles.${role}`)}</p>}
            </div>
          }
          trigger={(props) => (
            <button type="button" {...props} className="flex h-10 items-center gap-2 rounded-full ps-0.5 pe-2 transition-colors hover:bg-hover sm:rounded-[var(--radius-control)]">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary">
                {initials(displayName)}
              </span>
              <span className="hidden max-w-[150px] truncate text-[13px] font-medium text-ink md:block">{displayName}</span>
              <ChevronDown size={15} className="hidden text-muted sm:block" />
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
            { label: demo.enabled ? t('demo.turnOff') : t('demo.turnOn'), icon: <FlaskConical size={15} />, disabled: demo.busy, onSelect: demo.toggle },
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
