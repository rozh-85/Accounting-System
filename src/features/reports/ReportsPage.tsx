import { ArrowLeft, ArrowRight, BookText, FileText, Landmark, NotebookPen, ReceiptText, Scale, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, PageHeader } from '@/components/ui/Card';
import { useLanguage } from '@/hooks/useLanguage';

interface ReportItem {
  key: string;
  icon: LucideIcon;
  to: string;
  format: 'portrait' | 'landscape';
}

const REPORTS: ReportItem[] = [
  { key: 'journal', icon: NotebookPen, to: '/journal', format: 'portrait' },
  { key: 'entry', icon: FileText, to: '/journal', format: 'portrait' },
  { key: 'voucher', icon: ReceiptText, to: '/journal/vouchers', format: 'portrait' },
  { key: 'voucherRegister', icon: ReceiptText, to: '/journal/vouchers', format: 'portrait' },
  { key: 'ledger', icon: BookText, to: '/ledger?view=gl', format: 'portrait' },
  { key: 'tAccount', icon: BookText, to: '/ledger', format: 'portrait' },
  { key: 'trialBalance', icon: Scale, to: '/trial-balance', format: 'landscape' },
  { key: 'financialPosition', icon: Landmark, to: '/financial-position', format: 'portrait' },
];

export function ReportsPage() {
  const { t } = useTranslation();
  const { isRtl } = useLanguage();
  const Arrow = isRtl ? ArrowLeft : ArrowRight;
  return (
    <>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <Card key={report.key} className="flex flex-col p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-line text-ink-soft">
                <report.icon size={17} strokeWidth={1.7} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[14.5px] font-semibold">{t(`reports.catalog.${report.key}.title`)}</h2>
                <p lang={isRtl ? 'en' : 'ar'} className={isRtl ? 'text-[12px] text-muted' : 'font-ar text-[13px] text-muted'}>
                  {t(`reports.catalog.${report.key}.title`, { lng: isRtl ? 'en' : 'ar' })}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{t(`reports.catalog.${report.key}.description`)}</p>
            <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[12.5px]">
              <span className="text-muted">A4 · {t(`reports.${report.format}`)} · {t('reports.bilingual')}</span>
              <Link to={report.to} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {t(`reports.catalog.${report.key}.action`)} <Arrow size={14} />
              </Link>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-5 max-w-3xl text-[12.5px] text-muted">{t('reports.footnote')}</p>
    </>
  );
}
