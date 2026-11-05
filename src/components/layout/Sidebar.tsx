import { clsx } from 'clsx';
import {
  BookText,
  CalendarRange,
  FileText,
  History,
  Landmark,
  LayoutDashboard,
  ListTree,
  LogOut,
  NotebookPen,
  PanelLeftClose,
  ReceiptText,
  Scale,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { IconButton } from '@/components/ui/Button';
import { useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import type { Permission } from '@/types/database';
import { Logo } from './Brand';

interface NavItem {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
  permission?: Permission;
}

function initials(text: string) {
  const parts = text.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

function Item({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        clsx(
          'group relative flex h-10 items-center gap-3 rounded-[10px] text-[13.5px] font-medium transition-colors',
          collapsed ? 'justify-center px-0' : 'px-3',
          isActive ? 'bg-primary text-white shadow-[var(--shadow-primary)]' : 'text-ink-soft hover:bg-hover hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={19} strokeWidth={1.8} className={clsx('shrink-0', isActive ? 'text-white' : 'text-muted group-hover:text-ink')} />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
          {!collapsed && item.badge ? (
            <span
              className={clsx(
                'num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                isActive ? 'bg-white/20 text-white' : 'bg-primary-soft text-primary',
              )}
            >
              {item.badge}
            </span>
          ) : null}
          {collapsed && item.badge ? <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-surface" aria-hidden="true" /> : null}
        </>
      )}
    </NavLink>
  );
}

/**
 * Application sidebar: brand, menu search, grouped navigation with counts, and
 * the company card. `collapsed` shows icons only (desktop); `onClose` adds a
 * close button (mobile drawer); `shortcut` enables Ctrl/⌘+K to focus search.
 */
export function Sidebar({
  collapsed = false,
  onNavigate,
  onClose,
  onToggleCollapse,
  shortcut = false,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
  onToggleCollapse?: () => void;
  shortcut?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { name } = useLanguage();
  const { company, role, currency, can } = useCompany();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const summary = useDashboardSummary();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const other = i18n.language === 'ar' ? 'en' : 'ar';

  useEffect(() => {
    if (!shortcut || collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut, collapsed]);

  const groups = useMemo(() => {
    const pending = summary.data;
    const all: Array<{ key: string; label: string; items: NavItem[] }> = [
      {
        key: 'menu',
        label: t('nav.menu'),
        items: [
          { key: 'overview', to: '/', end: true, label: t('nav.overview'), icon: LayoutDashboard },
          { key: 'journal', to: '/journal', label: t('rooms.journal.title'), icon: NotebookPen, badge: pending?.entries.pending_approval },
          { key: 'ledger', to: '/ledger', label: t('rooms.ledger.title'), icon: BookText },
          { key: 'trialBalance', to: '/trial-balance', label: t('rooms.trialBalance.title'), icon: Scale },
          { key: 'financialPosition', to: '/financial-position', label: t('rooms.financialPosition.title'), icon: Landmark },
        ],
      },
      {
        key: 'management',
        label: t('nav.management'),
        items: [
          { key: 'accounts', to: '/accounts', label: t('nav.accounts'), icon: ListTree },
          { key: 'vouchers', to: '/journal/vouchers', label: t('nav.vouchers'), icon: ReceiptText, badge: pending?.vouchers.pending_approval },
          { key: 'reports', to: '/reports', label: t('nav.reports'), icon: FileText },
          { key: 'periods', to: '/periods', label: t('nav.periods'), icon: CalendarRange },
          { key: 'audit', to: '/audit', label: t('nav.audit'), icon: History, permission: 'audit.view' },
        ],
      },
    ];
    const q = query.trim().toLowerCase();
    return all
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.permission && !can(item.permission)) return false;
          if (!q) return true;
          const otherLabel = item.key === 'overview' ? t('nav.overview', { lng: other }) : '';
          return item.label.toLowerCase().includes(q) || otherLabel.toLowerCase().includes(q);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [t, summary.data, query, can, other]);

  return (
    <div className="flex h-full flex-col" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}>
      {/* Brand */}
      <div className={clsx('flex h-16 shrink-0 items-center gap-2 border-b border-line', collapsed ? 'justify-center px-3' : 'justify-between ps-5 pe-3')}>
        <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label={t('nav.overview')}>
          {collapsed ? (
            <img src="/brand/vio-icon-512.png" alt="Vio" className="h-9 w-9 rounded-[10px]" draggable={false} />
          ) : (
            <>
              <Logo className="h-[24px]" />
              <span className="truncate border-s border-line ps-2.5 text-[12.5px] font-medium leading-tight text-muted">{t('app.productName')}</span>
            </>
          )}
        </Link>
        {!collapsed && onToggleCollapse && (
          <IconButton label={t('nav.collapse')} onClick={onToggleCollapse}>
            <PanelLeftClose size={18} className="rtl:-scale-x-100" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label={t('nav.closeMenu')} onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-4 pt-4">
          <label className="relative block">
            <span className="sr-only">{t('nav.search')}</span>
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder={t('nav.search')}
              className="h-10 w-full rounded-[10px] border border-line bg-subtle ps-9 pe-14 text-[13px] text-ink placeholder:text-faint transition-colors focus:border-accent focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-accent/12"
            />
            {shortcut && (
              <kbd className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-muted lg:block">
                Ctrl K
              </kbd>
            )}
          </label>
        </div>
      )}

      {/* Navigation */}
      <nav aria-label={t('nav.main')} className={clsx('flex-1 overflow-y-auto py-4 scrollbar-thin', collapsed ? 'px-3' : 'px-4')}>
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-muted">{t('nav.noResults')}</p>
        ) : (
          groups.map((group, index) => (
            <div key={group.key} className={clsx('flex flex-col gap-1', index > 0 && 'mt-5')}>
              {collapsed ? (
                index > 0 && <span className="mx-auto mb-2 h-px w-8 bg-line" aria-hidden="true" />
              ) : (
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{group.label}</p>
              )}
              {group.items.map((item) => (
                <Item key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          ))
        )}
      </nav>

      {/* Footer */}
      <div className={clsx('flex flex-col gap-1 border-t border-line py-3', collapsed ? 'px-3' : 'px-4')}>
        <Item item={{ key: 'settings', to: '/settings', label: t('nav.settings'), icon: Settings }} collapsed={collapsed} />
        <button
          type="button"
          title={collapsed ? t('auth.signOut') : undefined}
          onClick={() => void signOut().then(() => navigate('/login'))}
          className={clsx(
            'group flex h-10 items-center gap-3 rounded-[10px] text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-danger-soft hover:text-danger',
            collapsed ? 'justify-center' : 'px-3',
          )}
        >
          <LogOut size={19} strokeWidth={1.8} className="shrink-0 text-muted group-hover:text-danger rtl:-scale-x-100" />
          {!collapsed && <span>{t('auth.signOut')}</span>}
        </button>

        {!collapsed && (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-subtle p-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-[12px] font-semibold text-primary">
              {initials(company.name_en)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{name(company)}</p>
              <p className="truncate text-[11.5px] text-muted">
                {role ? t(`roles.${role}`) : ''} · {currency.code}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
