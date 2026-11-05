import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { TILES, useOverviewTiles, type TileDefinition } from '@/features/dashboard/tiles';

/** Lets each user choose which pages appear as square tiles on the overview. */
export function OverviewTilesTab() {
  const { t } = useTranslation();
  const { can } = useCompany();
  const { selected, toggle, reset } = useOverviewTiles();
  const available = TILES.filter((tile) => !tile.permission || can(tile.permission));
  const selectedCount = available.filter((tile) => selected.includes(tile.key)).length;

  const groups: Array<{ key: TileDefinition['group']; label: string }> = [
    { key: 'rooms', label: t('nav.rooms') },
    { key: 'management', label: t('nav.management') },
  ];

  return (
    <Card>
      <CardHeader
        title={t('settings.overview.title')}
        description={t('settings.overview.hint')}
        actions={<span className="num text-[12.5px] text-muted">{t('settings.overview.selected', { count: selectedCount })}</span>}
      />
      <div className="flex flex-col gap-6 p-5">
        {groups.map((group) => (
          <fieldset key={group.key}>
            <legend className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{group.label}</legend>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {available
                .filter((tile) => tile.group === group.key)
                .map((tile) => {
                  const checked = selected.includes(tile.key);
                  const Icon = tile.icon;
                  return (
                    <label
                      key={tile.key}
                      className={clsx(
                        'flex cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-3 transition-colors',
                        checked ? 'border-accent-line bg-accent-soft/60' : 'border-line hover:bg-subtle',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-line-strong accent-[var(--color-accent)]"
                        checked={checked}
                        onChange={() => toggle(tile.key)}
                      />
                      <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', tile.color.soft, tile.color.text)}>
                        <Icon size={16} strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{t(tile.titleKey)}</span>
                        {tile.number && (
                          <span className="num block text-[11.5px] text-faint">
                            {t('dashboard.room')} {tile.number}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-subtle px-5 py-3">
        <Button onClick={reset}>{t('settings.overview.reset')}</Button>
        <ButtonLink to="/" variant="primary">
          {t('settings.overview.view')}
        </ButtonLink>
      </div>
    </Card>
  );
}
