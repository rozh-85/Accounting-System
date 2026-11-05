import { CalendarRange, FileText, History, ListTree, ReceiptText, Settings, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Permission } from '@/types/database';
import { useAuth } from '@/app/providers/AuthProvider';
import { COLORS, ROOMS, type RoomColor } from './rooms';

export type TileKey =
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

export interface TileDefinition {
  key: TileKey;
  group: 'rooms' | 'management';
  /** i18n key of the title. */
  titleKey: string;
  number?: string;
  path: string;
  icon: LucideIcon;
  color: RoomColor;
  /** Permission needed to see the tile. */
  permission?: Permission;
}

/** Every page that can be shown as a tile on the overview, in sidebar order. */
export const TILES: TileDefinition[] = [
  ...ROOMS.map((room) => ({
    key: room.key,
    group: 'rooms' as const,
    titleKey: `rooms.${room.key}.title`,
    number: room.number,
    path: room.path,
    icon: room.icon,
    color: room.color,
  })),
  { key: 'accounts', group: 'management', titleKey: 'nav.accounts', path: '/accounts', icon: ListTree, color: COLORS.orange },
  { key: 'vouchers', group: 'management', titleKey: 'nav.vouchers', path: '/journal/vouchers', icon: ReceiptText, color: COLORS.amber },
  { key: 'reports', group: 'management', titleKey: 'nav.reports', path: '/reports', icon: FileText, color: COLORS.blue },
  { key: 'periods', group: 'management', titleKey: 'nav.periods', path: '/periods', icon: CalendarRange, color: COLORS.teal },
  { key: 'audit', group: 'management', titleKey: 'nav.audit', path: '/audit', icon: History, color: COLORS.slate, permission: 'audit.view' },
  { key: 'settings', group: 'management', titleKey: 'nav.settings', path: '/settings', icon: Settings, color: COLORS.slate },
];

export const DEFAULT_TILES: TileKey[] = ['journal', 'ledger', 'trialBalance', 'financialPosition'];

const CHANGE_EVENT = 'vio:overview-tiles';
const VALID = new Set<string>(TILES.map((tile) => tile.key));

function parse(raw: string | null): TileKey[] {
  if (raw === null) return DEFAULT_TILES;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((k): k is TileKey => typeof k === 'string' && VALID.has(k)) : DEFAULT_TILES;
  } catch {
    return DEFAULT_TILES;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The tiles a user has chosen for the overview. A personal preference, kept in
 * this browser per user; falls back to the four rooms when storage is empty or
 * unavailable.
 */
export function useOverviewTiles() {
  const { user } = useAuth();
  const storageKey = `vio.overviewTiles.${user?.id ?? 'anonymous'}`;

  const raw = useSyncExternalStore(subscribe, () => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const selected = useMemo(() => parse(raw), [raw]);

  const write = useCallback(
    (value: string | null) => {
      try {
        if (value === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, value);
      } catch {
        // Storage unavailable (private mode): the choice lasts for this page only.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [storageKey],
  );

  const setSelected = useCallback((keys: TileKey[]) => write(JSON.stringify(keys)), [write]);
  const toggle = useCallback(
    (key: TileKey) => setSelected(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]),
    [selected, setSelected],
  );
  const reset = useCallback(() => write(null), [write]);

  return { selected, toggle, reset };
}

/**
 * Column count that keeps rows even: as many columns as fit, then spread the
 * tiles over the fewest rows so no row is left with a single orphan tile.
 */
export function balancedColumns(count: number, width: number, minTile: number, gap: number): number {
  if (count <= 0) return 1;
  const fit = Math.max(1, Math.floor((width + gap) / (minTile + gap)));
  const rows = Math.ceil(count / fit);
  return Math.ceil(count / rows);
}
