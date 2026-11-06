import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { NavTabs } from '@/components/ui/Tabs';
import { useDashboardSummary } from '@/hooks/useReferenceData';

function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {count ? (
        <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">{count}</span>
      ) : null}
    </span>
  );
}

/** Room 1 — Daily Journal: entries, vouchers and recurring templates. */
export function JournalRoomLayout() {
  const { t } = useTranslation();
  const summary = useDashboardSummary().data;
  return (
    <>
      <div className="mb-5">
        <p className="num mb-1 text-[12.5px] font-medium text-muted">{t('dashboard.room')} 01</p>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink sm:text-[24px]">{t('rooms.journal.title')}</h1>
        <p className="mt-1 text-[13px] text-muted">{t('rooms.journal.description')}</p>
      </div>
      <NavTabs
        className="mb-5"
        items={[
          { to: '/journal', label: <TabLabel label={t('journal.tabs.entries')} count={summary?.entries.pending_approval} />, end: true },
          { to: '/journal/vouchers', label: <TabLabel label={t('journal.tabs.vouchers')} count={summary?.vouchers.pending_approval} /> },
          { to: '/journal/recurring', label: t('journal.tabs.recurring') },
        ]}
      />
      <Outlet />
    </>
  );
}
