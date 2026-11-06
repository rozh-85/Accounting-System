/**
 * PDF reporting engine entry point. Loaded lazily (dynamic import) so the PDF
 * renderer and fonts are only downloaded when a report is generated.
 */
import { pdf } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import i18n from '@/i18n';
import { formatDateTime } from '@/lib/formatting';
import { registerPdfFonts } from './fonts';
import type { PdfLanguage, ReportCompany, ReportContextValue, Translate } from './primitives';

export * from './reports/journalReport';
export * from './reports/ledgerReport';
export * from './reports/statementReports';
export * from './reports/documentReports';
export * from './reports/voucherRegisterReport';
export type { ReportCompany, ReportContextValue, PdfLanguage } from './primitives';

export function reportContext(language: PdfLanguage, company: ReportCompany, generatedBy?: string | null): ReportContextValue {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    fonts: registerPdfFonts(`${origin}/fonts/pdf/`),
    language,
    t: i18n.getFixedT(language) as unknown as Translate,
    company,
    logoSrc: `${origin}/brand/vio-logo-red.png`,
    generatedAt: formatDateTime(new Date().toISOString()),
    generatedBy: generatedBy ?? null,
  };
}

export async function renderToBlob(element: ReactElement): Promise<Blob> {
  // react-pdf's typings expect a <Document> element; our report components render one.
  return pdf(element as Parameters<typeof pdf>[0]).toBlob();
}
