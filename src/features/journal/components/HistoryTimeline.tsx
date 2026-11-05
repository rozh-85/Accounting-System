import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatDateTime } from '@/lib/formatting';
import type { HistoryItem } from '@/types/database';

/** Audit trail of a document: who created, submitted, approved, posted or reversed it, and when. */
export function HistoryTimeline({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t('history.title')} />
      {items.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">{t('history.empty')}</p>
      ) : (
        <ol className="px-5 py-4">
          {items.map((item, i) => {
            const reason = typeof item.details?.reason === 'string' ? item.details.reason : null;
            const related = (item.details?.reversal_entry ?? item.details?.journal_entry ?? item.details?.reversal_of) as string | undefined;
            return (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {i < items.length - 1 && <span className="absolute start-[5px] top-3 h-full w-px bg-line" aria-hidden="true" />}
                <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-surface bg-ink-soft ring-1 ring-line-strong" aria-hidden="true" />
                <div className="min-w-0 text-[13px]">
                  <p className="text-ink">
                    <span className="font-medium">{t(`history.actions.${item.action}`, { defaultValue: item.action })}</span>
                    {item.actor_name && <span className="text-muted"> · {item.actor_name}</span>}
                    {related && <span className="num text-muted"> · {related}</span>}
                  </p>
                  <p className="num text-[12px] text-muted">{formatDateTime(item.created_at)}</p>
                  {reason && <p className="mt-0.5 text-[12.5px] text-ink-soft">{reason}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
