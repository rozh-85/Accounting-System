import { CalendarRange, FileText, Gauge, History, ListTree, ReceiptText, Settings, type LucideIcon } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import type { Permission } from '@/types/database';
import { COLORS, ROOMS, type RoomColor } from './rooms';

/** How the app is navigated: a permanent sidebar, or a home screen of tiles. */
export type NavigationMode = 'sidebar' | 'home';

export type DestinationKey =
  | 'overview'
  | 'journal'
  | 'ledger'
  | 'trialBalance'
  | 'financialPosition'
  | 'accounts'
  | 'vouchers'
  | 'reports'
  | 'periods'
  | 'audit'
  | 'settings';

export interface Destination {
  key: DestinationKey;
  /** i18n key of the title. */
  titleKey: string;
  number?: string;
  path: string;
  icon: LucideIcon;
  color: RoomColor;
  permission?: Permission;
}

export interface DestinationGroup {
  key: 'workspace' | 'rooms' | 'management';
  /** Bar color beside the group heading. */
  bar: string;
  items: Destination[];
}

/** Every top-level page, grouped as on the home screen (same order as the sidebar). */
export const DESTINATION_GROUPS: DestinationGroup[] = [
  {
    key: 'workspace',
    bar: COLORS.teal.bar,
    items: [{ key: 'overview', titleKey: 'nav.overview', path: '/overview', icon: Gauge, color: COLORS.teal }],
  },
  {
    key: 'rooms',
    bar: COLORS.blue.bar,
    items: ROOMS.map((room) => ({
      key: room.key,
      titleKey: `rooms.${room.key}.title`,
      number: room.number,
      path: room.path,
      icon: room.icon,
      color: room.color,
    })),
  },
  {
    key: 'management',
    bar: COLORS.orange.bar,
    items: [
      { key: 'accounts', titleKey: 'nav.accounts', path: '/accounts', icon: ListTree, color: COLORS.orange },
      { key: 'vouchers', titleKey: 'nav.vouchers', path: '/journal/vouchers', icon: ReceiptText, color: COLORS.amber },
      { key: 'reports', titleKey: 'nav.reports', path: '/reports', icon: FileText, color: COLORS.blue },
      { key: 'periods', titleKey: 'nav.periods', path: '/periods', icon: CalendarRange, color: COLORS.teal },
      { key: 'audit', titleKey: 'nav.audit', path: '/audit', icon: History, color: COLORS.slate, permission: 'audit.view' },
      { key: 'settings', titleKey: 'nav.settings', path: '/settings', icon: Settings, color: COLORS.slate },
    ],
  },
];

const CHANGE_EVENT = 'vio:navigation-mode';

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The user's navigation layout. A personal preference kept in this browser
 * per user; defaults to the sidebar when storage is empty or unavailable.
 */
export function useNavigationMode(): [NavigationMode, (mode: NavigationMode) => void] {
  const { user } = useAuth();
  const storageKey = `vio.navigation.${user?.id ?? 'anonymous'}`;

  const stored = useSyncExternalStore(subscribe, () => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const mode: NavigationMode = stored === 'home' ? 'home' : 'sidebar';

  const setMode = useCallback(
    (next: NavigationMode) => {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Storage unavailable (private mode): keep the default layout.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [storageKey],
  );

  return [mode, setMode];
}
