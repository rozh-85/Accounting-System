import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { NavTabs } from '@/components/ui/Tabs';

/** Room 1 — Daily Journal: entries, vouchers and recurring templates. */
export function JournalRoomLayout() {
  const { t } = useTranslation();
  return (
    <>
      <div className="mb-5">
        <p className="num mb-1 text-[12px] font-medium tracking-[0.06em] text-faint">{t('dashboard.room')} 01</p>
        <h1 className="text-[21px] font-semibold tracking-[-0.01em]">{t('rooms.journal.title')}</h1>
        <p className="mt-1 text-[13px] text-muted">{t('rooms.journal.description')}</p>
      </div>
      <NavTabs
        className="mb-5"
        items={[
          { to: '/journal', label: t('journal.tabs.entries'), end: true },
          { to: '/journal/vouchers', label: t('journal.tabs.vouchers') },
          { to: '/journal/recurring', label: t('journal.tabs.recurring') },
        ]}
      />
      <Outlet />
    </>
  );
}
