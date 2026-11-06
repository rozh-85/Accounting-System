import { Download, ExternalLink, Printer, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { errorMessage } from '@/lib/supabase/errors';
import type { PdfLanguage } from '@/lib/pdf/primitives';

export interface ReportOptions {
  language: PdfLanguage;
  signatures: boolean;
}

/**
 * Report preview with download and print. `generate` builds the PDF from live
 * database data each time options change, so the document always reflects the
 * same figures as the screen.
 */
export function ReportDialog({
  open,
  onClose,
  title,
  fileName,
  generate,
  signaturesOption = true,
  defaultSignatures = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fileName: string;
  generate: (options: ReportOptions) => Promise<Blob>;
  signaturesOption?: boolean;
  defaultSignatures?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [options, setOptions] = useState<ReportOptions>({ language: i18n.language === 'ar' ? 'ar' : 'en', signatures: defaultSignatures });
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const generateRef = useRef(generate);
  generateRef.current = generate;

  const run = useCallback(
    async (opts: ReportOptions) => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const blob = await generateRef.current(opts);
        if (request !== requestRef.current) return;
        setUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return URL.createObjectURL(blob);
        });
      } catch (e) {
        console.error('Report generation failed', e);
        if (request === requestRef.current) setError(errorMessage(e, t));
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (open) {
      const initial = { language: (i18n.language === 'ar' ? 'ar' : 'en') as PdfLanguage, signatures: defaultSignatures };
      setOptions(initial);
      void run(initial);
    } else {
      requestRef.current++;
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (patch: Partial<ReportOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    void run(next);
  };

  const fullName = `${fileName}-${options.language}.pdf`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={t('reports.previewHint')}
      size="full"
      footer={
        <>
          <Button icon={<RefreshCw size={14} />} onClick={() => void run(options)} disabled={loading}>
            {t('reports.regenerate')}
          </Button>
          <Button
            icon={<ExternalLink size={14} />}
            disabled={!url}
            onClick={() => url && window.open(url, '_blank', 'noopener')}
          >
            {t('reports.openInTab')}
          </Button>
          <Button
            icon={<Printer size={14} />}
            disabled={!url}
            onClick={() => {
              const frame = document.getElementById('report-preview-frame') as HTMLIFrameElement | null;
              try {
                frame?.contentWindow?.focus();
                frame?.contentWindow?.print();
              } catch {
                if (url) window.open(url, '_blank', 'noopener');
              }
            }}
          >
            {t('common.print')}
          </Button>
          <a
            href={url ?? undefined}
            download={fullName}
            aria-disabled={!url}
            className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-ink bg-ink px-4 text-[13.5px] font-medium text-white hover:bg-[#0f1a2b] ${!url ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Download size={14} />
            {t('reports.download')}
          </a>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-ink-soft">{t('reports.language')}</span>
          <Segmented
            label={t('reports.language')}
            value={options.language}
            onChange={(language) => update({ language })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: <span className="font-ar">العربية</span> },
            ]}
          />
        </div>
        {signaturesOption && (
          <Checkbox label={t('reports.includeSignatures')} checked={options.signatures} onChange={(e) => update({ signatures: e.target.checked })} />
        )}
      </div>
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <div className="relative h-[68vh] overflow-hidden rounded-[10px] border border-line bg-[#525659]">
        {url && <iframe id="report-preview-frame" title={title} src={url} className="h-full w-full" />}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/85">
            <PageLoader label={t('reports.generating')} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
