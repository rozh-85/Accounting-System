import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { PageHeader } from '@/components/ui/Card';
import { useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { formatLongDate, formatPeriodName, todayIso } from '@/lib/formatting';
import { DESTINATION_GROUPS, type Destination, type DestinationGroup, type DestinationKey } from './navigation';

function HomeTile({ item, count }: { item: Destination; count?: number }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      className={clsx(
        // Square by default (min height = width); a tile with a long title grows taller instead of clipping.
        'group relative flex min-h-[168px] w-full min-w-0 flex-col items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface px-4 py-5 text-center shadow-[var(--shadow-card)] transition-[border-color,box-shadow] hover:shadow-[var(--shadow-pop)] focus-visible:border-accent lg:aspect-[4/3] 2xl:px-6',
        item.color.hoverBorder,
      )}
    >
      {item.number && <span className="num absolute start-3.5 top-3 text-[11px] font-semibold tracking-[0.06em] text-faint">{item.number}</span>}
      {count !== undefined && count > 0 && (
        <span className="num absolute end-3 top-3 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-warning-line bg-warning-soft px-1.5 text-[11.5px] font-semibold text-warning">
          {count}
        </span>
      )}
      <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] transition-transform group-hover:scale-105 2xl:h-14 2xl:w-14', item.color.soft, item.color.text)}>
        <Icon size={23} strokeWidth={1.7} />
      </span>
      <h3 className="mt-3.5 text-[14.5px] font-semibold leading-snug text-ink 2xl:text-[16px]">{t(item.titleKey)}</h3>
      <p className="mt-1 line-clamp-2 max-w-[30ch] text-[12.5px] leading-relaxed text-muted 2xl:text-[13.5px]">{t(`home.descriptions.${item.key}`)}</p>
    </Link>
  );
}

/**
 * One shared five-column grid on laptops and up: Workspace takes a column,
 * Rooms the other four, Management all five. Gaps match, so every tile lines up
 * and both rows reach the right edge at any screen width.
 */
const GROUP_LAYOUT: Record<DestinationGroup['key'], { section: string; tiles: string }> = {
  workspace: { section: 'lg:col-span-1', tiles: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-1' },
  rooms: { section: 'lg:col-span-4', tiles: 'grid-cols-2 md:grid-cols-4' },
  management: { section: 'lg:col-span-5', tiles: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' },
};

/** Home screen for the tile navigation layout: every room and page as a tile, grouped. */
export function HomePage() {
  const { t } = useTranslation();
  const { language, name } = useLanguage();
  const { company, can } = useCompany();
  const summary = useDashboardSummary();
  const data = summary.data;
  const period = data?.current_period;
  const today = todayIso();

  const counts: Partial<Record<DestinationKey, number>> = {
    journal: data ? data.entries.pending_approval + data.vouchers.pending_approval : undefined,
  };

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(today, language)}
        title={name(company)}
        subtitle={
          period
            ? t('dashboard.subtitle', { year: period.fiscal_year_name, period: formatPeriodName(period.name, language) })
            : t('dashboard.noPeriod')
        }
      />

      <div className="grid grid-cols-1 gap-x-3 gap-y-9 sm:gap-x-4 lg:grid-cols-5">
        {DESTINATION_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`home-${group.key}`} className={clsx('min-w-0', GROUP_LAYOUT[group.key].section)}>
              <div className="mb-4 flex items-center gap-3">
                <span className={clsx('h-[18px] w-1 shrink-0 rounded-full', group.bar)} aria-hidden="true" />
                <h2 id={`home-${group.key}`} className="text-[15px] font-semibold text-ink">
                  {t(`nav.${group.key}`)}
                </h2>
                <span className="num text-[12px] text-faint">{items.length}</span>
                <span className="h-px flex-1 bg-line" aria-hidden="true" />
              </div>
              <div className={clsx('grid gap-3 sm:gap-4', GROUP_LAYOUT[group.key].tiles)}>
                {items.map((item) => (
                  <HomeTile key={item.key} item={item} count={counts[item.key]} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
