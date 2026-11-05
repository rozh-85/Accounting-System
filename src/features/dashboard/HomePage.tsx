import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { PageHeader } from '@/components/ui/Card';
import { useDashboardSummary } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { formatLongDate, formatPeriodName, todayIso } from '@/lib/formatting';
import { DESTINATION_GROUPS, type Destination, type DestinationKey } from './navigation';

function HomeTile({ item, count }: { item: Destination; count?: number }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      className={clsx(
        // Square by default (min height = width); a tile with a long title grows taller instead of clipping.
        'group relative flex min-h-[168px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface px-4 py-5 text-center shadow-[var(--shadow-card)] transition-[border-color,box-shadow] hover:shadow-[var(--shadow-pop)] focus-visible:border-accent sm:min-h-[164px] sm:w-[164px] lg:min-h-[188px] lg:w-[188px] 2xl:min-h-[204px] 2xl:w-[204px]',
        item.color.hoverBorder,
      )}
    >
      {item.number && <span className="num absolute start-3.5 top-3 text-[11px] font-semibold tracking-[0.06em] text-faint">{item.number}</span>}
      {count !== undefined && count > 0 && (
        <span className="num absolute end-3 top-3 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-warning-line bg-warning-soft px-1.5 text-[11.5px] font-semibold text-warning">
          {count}
        </span>
      )}
      <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] transition-transform group-hover:scale-105', item.color.soft, item.color.text)}>
        <Icon size={23} strokeWidth={1.7} />
      </span>
      <h3 className="mt-3.5 text-[14.5px] font-semibold leading-snug text-ink">{t(item.titleKey)}</h3>
      <p className="mt-1 line-clamp-2 max-w-[26ch] text-[12.5px] leading-relaxed text-muted">{t(`home.descriptions.${item.key}`)}</p>
    </Link>
  );
}

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
    journal: data?.entries.pending_approval,
    vouchers: data?.vouchers.pending_approval,
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

      {/* Groups flow side by side when they fit and wrap on narrower screens. */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-9">
        {DESTINATION_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`home-${group.key}`} className="w-full sm:w-auto sm:max-w-full">
              <div className="mb-4 flex items-center gap-3">
                <span className={clsx('h-[18px] w-1 shrink-0 rounded-full', group.bar)} aria-hidden="true" />
                <h2 id={`home-${group.key}`} className="text-[15px] font-semibold text-ink">
                  {t(`nav.${group.key}`)}
                </h2>
                <span className="num text-[12px] text-faint">{items.length}</span>
                <span className="h-px flex-1 bg-line" aria-hidden="true" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-4">
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
