import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import { useNavigationMode, type NavigationMode } from '@/features/dashboard/navigation';

/** Wireframe of the sidebar layout. */
function SidebarPreview() {
  return (
    <div className="flex h-[112px] flex-col overflow-hidden rounded-[8px] border border-line bg-surface" aria-hidden="true">
      <div className="h-3 shrink-0 border-b border-line" />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[28%] flex-col gap-1.5 border-e border-line p-2">
          <span className="h-1.5 rounded-full bg-accent" />
          <span className="h-1.5 rounded-full bg-line-strong" />
          <span className="h-1.5 rounded-full bg-line-strong" />
          <span className="h-1.5 rounded-full bg-line-strong" />
          <span className="h-1.5 w-2/3 rounded-full bg-line" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <span className="h-2 w-1/3 rounded-full bg-line-strong" />
          <span className="flex-1 rounded-[4px] border border-line bg-subtle" />
        </div>
      </div>
    </div>
  );
}

/** Wireframe of the home-screen layout. */
function HomePreview() {
  const colors = ['bg-accent-soft', 'bg-info-soft', 'bg-purple-soft', 'bg-success-soft', 'bg-orange-soft', 'bg-warning-soft', 'bg-accent-soft', 'bg-hover'];
  return (
    <div className="flex h-[112px] flex-col overflow-hidden rounded-[8px] border border-line bg-surface" aria-hidden="true">
      <div className="h-3 shrink-0 border-b border-line" />
      <div className="grid flex-1 grid-cols-4 gap-1.5 p-2">
        {colors.map((color, i) => (
          <span key={i} className="flex items-center justify-center rounded-[4px] border border-line">
            <span className={clsx('h-3 w-3 rounded-[3px]', color)} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Lets each user choose between the sidebar and the home-screen navigation layout. */
export function LayoutTab() {
  const { t } = useTranslation();
  const [mode, setMode] = useNavigationMode();

  const options: Array<{ value: NavigationMode; title: string; hint: string; preview: ReactNode }> = [
    { value: 'sidebar', title: t('settings.layout.sidebar'), hint: t('settings.layout.sidebarHint'), preview: <SidebarPreview /> },
    { value: 'home', title: t('settings.layout.home'), hint: t('settings.layout.homeHint'), preview: <HomePreview /> },
  ];

  return (
    <Card>
      <CardHeader title={t('settings.layout.title')} description={t('settings.layout.hint')} />
      <div role="radiogroup" aria-label={t('settings.layout.title')} className="grid max-w-3xl grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        {options.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option.value)}
              className={clsx(
                'flex flex-col overflow-hidden rounded-[12px] border text-start transition-colors',
                selected ? 'border-accent ring-2 ring-accent-line' : 'border-line hover:border-line-strong',
              )}
            >
              <div className="border-b border-line bg-subtle p-4">{option.preview}</div>
              <div className="flex items-start gap-3 p-4">
                <span
                  className={clsx(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-accent' : 'border-line-strong',
                  )}
                  aria-hidden="true"
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold text-ink">{option.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{option.hint}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
