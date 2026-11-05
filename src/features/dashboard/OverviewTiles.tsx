import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { balancedColumns, type TileDefinition, type TileKey } from './tiles';

export interface TileMetric {
  value: ReactNode;
  label: string;
  /** Text color class for the value; defaults to the tile color. */
  tone?: string;
}

/** Smallest and largest tile edge, in pixels. */
const MIN_TILE = 150;
const MAX_TILE = 232;

function Tile({ tile, metric, compact }: { tile: TileDefinition; metric?: TileMetric; compact: boolean }) {
  const { t, i18n } = useTranslation();
  const other = i18n.language === 'ar' ? 'en' : 'ar';
  const Icon = tile.icon;

  return (
    <Link
      to={tile.path}
      className={clsx(
        'group flex aspect-square min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] transition-[border-color,box-shadow] hover:shadow-[var(--shadow-pop)] focus-visible:border-accent',
        tile.color.hoverBorder,
        compact ? 'p-3.5' : 'p-[18px]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('flex shrink-0 items-center justify-center rounded-[9px]', tile.color.soft, tile.color.text, compact ? 'h-8 w-8' : 'h-10 w-10')}>
          <Icon size={compact ? 16 : 19} strokeWidth={1.8} />
        </span>
        {tile.number && <span className="num text-[11.5px] font-semibold tracking-[0.06em] text-faint">{tile.number}</span>}
      </div>

      <div className={clsx('min-w-0', compact ? 'mt-2.5' : 'mt-3.5')}>
        <h3 className={clsx('line-clamp-2 font-semibold leading-snug text-ink', compact ? 'text-[13.5px]' : 'text-[15px]')}>{t(tile.titleKey)}</h3>
        {!compact && (
          <p lang={other} dir={other === 'ar' ? 'rtl' : 'ltr'} className={clsx('mt-0.5 truncate text-muted', other === 'ar' ? 'font-ar text-[12.5px]' : 'text-[12px]')}>
            {t(tile.titleKey, { lng: other })}
          </p>
        )}
      </div>

      {metric && (
        <div className="mt-auto min-w-0 pt-2">
          <p className={clsx('num truncate font-semibold leading-tight', metric.tone ?? tile.color.text, compact ? 'text-[17px]' : 'text-[21px]')}>{metric.value}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted">{metric.label}</p>
        </div>
      )}
    </Link>
  );
}

/**
 * Square tiles that size themselves to the available width: between MIN_TILE
 * and MAX_TILE per edge, with a column count that keeps rows even.
 */
export function TileGrid({ tiles, metrics }: { tiles: TileDefinition[]; metrics: Partial<Record<TileKey, TileMetric>> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const gap = width > 0 && width < 520 ? 12 : 16;
  const columns = width > 0 ? balancedColumns(tiles.length, width, MIN_TILE, gap) : Math.min(tiles.length, 2);
  const tileWidth = width > 0 ? Math.min(MAX_TILE, (width - gap * (columns - 1)) / columns) : MAX_TILE;
  const compact = tileWidth < 196;

  return (
    <div ref={ref} className="grid" style={{ gap, gridTemplateColumns: `repeat(${columns}, minmax(0, ${MAX_TILE}px))` }}>
      {tiles.map((tile) => (
        <Tile key={tile.key} tile={tile} metric={metrics[tile.key]} compact={compact} />
      ))}
    </div>
  );
}
