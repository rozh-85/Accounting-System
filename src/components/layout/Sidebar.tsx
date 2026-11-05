import { clsx } from 'clsx';
import { CalendarRange, FileText, History, LayoutGrid, ListTree, ReceiptText, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { ROOMS } from '@/features/dashboard/rooms';
import { LanguageSwitcher } from './Brand';

function Item({ to, icon, label, end, badge, iconClass }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: string; iconClass?: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'group relative flex h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-[13.5px] transition-colors',
          isActive ? 'bg-accent-soft font-medium text-accent-strong' : 'text-ink-soft hover:bg-hover hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-accent" aria-hidden="true" />}
          <span className={clsx('shrink-0', isActive ? 'text-accent' : iconClass ?? 'text-muted group-hover:text-ink')}>{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge && <span className={clsx('num text-[11px]', isActive ? 'text-accent' : 'text-faint')}>{badge}</span>}
        </>
      )}
    </NavLink>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</p>
      {children}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { can } = useCompany();

  return (
    <nav aria-label={t('nav.main')} className="flex h-full flex-col px-3 pb-4 pt-2" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}>
      <Group label={t('nav.workspace')}>
        <Item to="/" end icon={<LayoutGrid size={16} />} label={t('nav.overview')} />
      </Group>
      <Group label={t('nav.rooms')}>
        {ROOMS.map((room) => (
          <Item key={room.key} to={room.path} icon={<room.icon size={16} />} iconClass={room.color.text} label={t(`rooms.${room.key}.title`)} badge={room.number} />
        ))}
      </Group>
      <Group label={t('nav.management')}>
        <Item to="/accounts" icon={<ListTree size={16} />} label={t('nav.accounts')} />
        <Item to="/journal/vouchers" icon={<ReceiptText size={16} />} label={t('nav.vouchers')} />
        <Item to="/reports" icon={<FileText size={16} />} label={t('nav.reports')} />
        <Item to="/periods" icon={<CalendarRange size={16} />} label={t('nav.periods')} />
        {can('audit.view') && <Item to="/audit" icon={<History size={16} />} label={t('nav.audit')} />}
        <Item to="/settings" icon={<Settings size={16} />} label={t('nav.settings')} />
      </Group>
      <div className="mt-auto pt-6 sm:hidden">
        <LanguageSwitcher side="top" align="start" />
      </div>
    </nav>
  );
}
