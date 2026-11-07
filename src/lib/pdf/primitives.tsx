/**
 * Reusable building blocks for A4 accounting reports (react-pdf).
 *
 * Every component reads the report language from context and mirrors itself
 * for Arabic: rows flow right-to-left, text is right-aligned with an RTL base
 * direction, and amounts stay left-to-right with tabular alignment.
 */
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { createContext, useContext, type ReactNode } from 'react';
import type { PdfFontFamilies } from './fonts';

export type PdfLanguage = 'en' | 'ar';
export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ReportCompany {
  name_en: string;
  name_ar: string;
  address_en?: string | null;
  address_ar?: string | null;
  tax_number?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ReportContextValue {
  language: PdfLanguage;
  t: Translate;
  company: ReportCompany;
  logoSrc?: string | null;
  generatedAt: string;
  generatedBy?: string | null;
  /** Font families registered for this document (see registerPdfFonts). */
  fonts: PdfFontFamilies;
}

const ReportContext = createContext<ReportContextValue | null>(null);

export function useReport() {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error('Report components must be rendered inside <ReportDocument>');
  const rtl = ctx.language === 'ar';
  return {
    ...ctx,
    rtl,
    row: (rtl ? 'row-reverse' : 'row') as Style['flexDirection'],
    start: (rtl ? 'right' : 'left') as Style['textAlign'],
    end: (rtl ? 'left' : 'right') as Style['textAlign'],
    localName: (item: { name_en: string; name_ar: string }) => (rtl ? item.name_ar : item.name_en),
  };
}

export const colors = {
  ink: '#172438',
  inkSoft: '#3a4759',
  muted: '#637081',
  faint: '#96a0ab',
  line: '#d9dee3',
  lineStrong: '#aab3bc',
  subtle: '#f5f5f2',
  accent: '#176a67',
  accentSoft: '#e8f1f0',
  danger: '#a1342e',
  dangerSoft: '#f9eceb',
  brand: '#a7282c',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 54,
    paddingHorizontal: 40,
    fontSize: 8.6,
    color: colors.ink,
    lineHeight: 1.35,
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    borderTopWidth: 0.6,
    borderTopColor: colors.line,
    paddingTop: 6,
    fontSize: 7.2,
    color: colors.muted,
    justifyContent: 'space-between',
  },
  runningHeader: {
    position: 'absolute',
    top: 18,
    left: 40,
    right: 40,
    fontSize: 7.2,
    color: colors.muted,
    justifyContent: 'space-between',
  },
});

export interface ReportDocumentProps {
  context: ReportContextValue;
  title: string;
  children: ReactNode;
}

/** PDF document wrapper providing report context and metadata. */
export function ReportDocument({ context, title, children }: ReportDocumentProps) {
  return (
    <ReportContext.Provider value={context}>
      <Document
        title={title}
        author={context.language === 'ar' ? context.company.name_ar : context.company.name_en}
        creator="Vio Accounting"
        producer="Vio Accounting"
        language={context.language === 'ar' ? 'ar-IQ' : 'en'}
      >
        {children}
      </Document>
    </ReportContext.Provider>
  );
}

/** One A4 page flow with the running header and the page footer. */
export function ReportPage({
  title,
  orientation = 'portrait',
  children,
}: {
  title: string;
  orientation?: 'portrait' | 'landscape';
  children: ReactNode;
}) {
  const r = useReport();
  const family = r.rtl ? r.fonts.ar : [r.fonts.en, r.fonts.ar];
  return (
    <Page
      size="A4"
      orientation={orientation}
      style={[styles.page, { fontFamily: family as unknown as string, direction: r.rtl ? 'rtl' : 'ltr', textAlign: r.start, lineHeight: r.rtl ? 1.6 : 1.35 } as Style]}
      wrap
    >
      <View
        fixed
        style={[styles.runningHeader, { flexDirection: r.row }]}
        render={({ pageNumber }) =>
          pageNumber > 1 ? (
            <>
              <Text>{r.localName(r.company)}</Text>
              <Text>{title}</Text>
            </>
          ) : null
        }
      />
      {children}
      <View fixed style={[styles.footer, { flexDirection: r.row }]}>
        <Text>
          {r.t('pdf.generatedAt', { date: r.generatedAt })}
          {r.generatedBy ? ` · ${r.t('pdf.generatedBy', { name: r.generatedBy })}` : ''}
        </Text>
        <Text render={({ pageNumber, totalPages }) => r.t('pdf.pageOf', { page: pageNumber, total: totalPages })} />
      </View>
    </Page>
  );
}

export interface MetaItem {
  label: string;
  value: string;
}

/** First-page report header: company identity, title and report parameters. */
export function ReportHeader({ title, subtitle, meta = [], compact = false }: { title: string; subtitle?: string; meta?: MetaItem[]; compact?: boolean }) {
  const r = useReport();
  const company = r.company;
  const otherName = r.rtl ? company.name_en : company.name_ar;
  const address = r.rtl ? company.address_ar || company.address_en : company.address_en || company.address_ar;
  const contact = [company.phone, company.email].filter(Boolean).join('  ·  ');

  return (
    <View style={{ marginBottom: compact ? 8 : 14 }}>
      <View style={{ flexDirection: r.row, justifyContent: 'space-between', alignItems: compact ? 'center' : 'flex-start', paddingBottom: compact ? 6 : 10, borderBottomWidth: 1.4, borderBottomColor: colors.ink }}>
        <View style={{ maxWidth: '62%' }}>
          <Text style={{ fontSize: compact ? 11 : 13, fontWeight: 600, textAlign: r.start, lineHeight: 1.55 }}>{r.localName(company)}</Text>
          {otherName ? <Text style={{ fontSize: 9, color: colors.muted, marginTop: 2, lineHeight: 1.5, textAlign: r.start, fontFamily: r.rtl ? r.fonts.en : r.fonts.ar, direction: r.rtl ? 'ltr' : 'rtl' } as Style}>{otherName}</Text> : null}
          {address ? <Text style={{ fontSize: 7.6, color: colors.muted, marginTop: 4, textAlign: r.start }}>{address}</Text> : null}
          {company.tax_number ? (
            <Text style={{ fontSize: 7.6, color: colors.muted, marginTop: 1, textAlign: r.start }}>
              {r.t('pdf.taxNumber')}: {company.tax_number}
            </Text>
          ) : null}
          {contact ? <Text style={{ fontSize: 7.6, color: colors.muted, marginTop: 1, textAlign: r.start, direction: 'ltr' } as Style}>{contact}</Text> : null}
        </View>
        {r.logoSrc ? <Image src={r.logoSrc} style={{ height: compact ? 22 : 30, objectFit: 'contain' }} /> : null}
      </View>

      <View style={{ flexDirection: r.row, justifyContent: 'space-between', alignItems: compact ? 'center' : 'flex-end', marginTop: compact ? 7 : 12 }}>
        <View style={compact ? { flexGrow: 1, flexDirection: r.row, justifyContent: 'space-between', alignItems: 'center' } : { maxWidth: '55%' }}>
          <Text style={{ fontSize: compact ? 12.5 : 15, fontWeight: 600, textAlign: r.start, lineHeight: 1.55 }}>{title}</Text>
          {subtitle ? <Text style={{ fontSize: compact ? 10 : 9, fontWeight: compact ? 600 : 400, color: colors.inkSoft, marginTop: compact ? 0 : 3, textAlign: r.start, lineHeight: 1.5 }}>{subtitle}</Text> : null}
        </View>
        {meta.length > 0 && (
          <View style={{ minWidth: 180 }}>
            {meta.map((item) => (
              <View key={item.label} style={{ flexDirection: r.row, justifyContent: 'space-between', gap: 10, marginTop: 1.5 }}>
                <Text style={{ color: colors.muted, fontSize: 8 }}>{item.label}</Text>
                <Text style={{ fontSize: 8, fontWeight: 500 }}>{item.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export interface PdfColumn {
  key: string;
  header: string;
  /** Fixed width in points; omit for a flexible column. */
  width?: number;
  flex?: number;
  align?: 'start' | 'end' | 'center';
  /** Numeric cells keep LTR direction and tabular alignment. */
  numeric?: boolean;
}

export type PdfRowVariant = 'normal' | 'group' | 'subtotal' | 'total' | 'muted' | 'section' | 'band';

export interface PdfRow {
  key: string;
  cells: Record<string, string | null | undefined>;
  variant?: PdfRowVariant;
  /** Indentation level applied to the first flexible text column. */
  indent?: number;
  indentColumn?: string;
}

function cellStyle(column: PdfColumn, r: ReturnType<typeof useReport>): Style {
  const align = column.align ?? (column.numeric ? 'end' : 'start');
  return {
    width: column.width,
    flexGrow: column.width ? 0 : (column.flex ?? 1),
    flexShrink: column.width ? 0 : 1,
    flexBasis: column.width ? column.width : 0,
    paddingHorizontal: 4,
    textAlign: align === 'center' ? 'center' : align === 'end' ? r.end : r.start,
    ...(column.numeric ? { direction: 'ltr' } : {}),
  } as Style;
}

const variantStyles: Record<PdfRowVariant, Style> = {
  normal: {},
  muted: { color: colors.muted },
  group: { fontWeight: 600, backgroundColor: colors.subtle },
  section: { fontWeight: 600, fontSize: 9.2, paddingTop: 7 },
  subtotal: { fontWeight: 600, borderTopWidth: 0.6, borderTopColor: colors.lineStrong },
  total: { fontWeight: 700, backgroundColor: colors.subtle, borderTopWidth: 1, borderTopColor: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ink },
  band: { fontWeight: 700, color: '#ffffff', backgroundColor: colors.ink },
};

export interface PdfColumnGroup {
  label: string;
  /** Keys of adjacent fixed-width columns covered by the group. */
  columns: string[];
}

export function PdfTable({
  columns,
  rows,
  repeatHeader = true,
  headerBand = false,
  emptyLabel,
  groups,
}: {
  columns: PdfColumn[];
  rows: PdfRow[];
  repeatHeader?: boolean;
  /** Dark header band with white text. */
  headerBand?: boolean;
  emptyLabel?: string;
  groups?: PdfColumnGroup[];
}) {
  const r = useReport();

  // Upper header row for grouped columns (e.g. Opening / Movement / Closing).
  const groupCells: Array<{ key: string; label: string; style: Style }> = [];
  if (groups?.length) {
    let i = 0;
    while (i < columns.length) {
      const column = columns[i];
      const group = groups.find((g) => g.columns[0] === column.key);
      if (group) {
        const width = group.columns.reduce((sum, key) => sum + (columns.find((c) => c.key === key)?.width ?? 0), 0);
        groupCells.push({ key: group.label, label: group.label, style: { width, flexGrow: 0, flexShrink: 0, textAlign: 'center', borderBottomWidth: 0.6, borderBottomColor: colors.lineStrong, marginHorizontal: 2 } });
        i += group.columns.length;
      } else {
        groupCells.push({ key: column.key, label: '', style: cellStyle(column, r) });
        i += 1;
      }
    }
  }

  return (
    <View>
      <View fixed={repeatHeader} style={{ borderTopWidth: 1, borderTopColor: colors.ink, borderBottomWidth: 0.8, borderBottomColor: colors.ink, backgroundColor: headerBand ? colors.ink : colors.subtle }}>
        {groupCells.length > 0 && (
          <View style={{ flexDirection: r.row, paddingTop: 4 }}>
            {groupCells.map((cell) => (
              <Text key={cell.key} style={[cell.style, { fontWeight: 600, fontSize: 7.8, color: colors.inkSoft, paddingBottom: 2 }]}>
                {cell.label}
              </Text>
            ))}
          </View>
        )}
        <View style={{ flexDirection: r.row, paddingVertical: 4.5 }}>
          {columns.map((column) => (
            <Text key={column.key} style={[cellStyle(column, r), { fontWeight: 600, fontSize: 7.8, color: headerBand ? '#ffffff' : colors.inkSoft }]}>
              {column.header}
            </Text>
          ))}
        </View>
      </View>
      {rows.length === 0 && emptyLabel ? (
        <Text style={{ paddingVertical: 12, textAlign: 'center', color: colors.muted }}>{emptyLabel}</Text>
      ) : null}
      {rows.map((row) => (
        <View
          key={row.key}
          wrap={false}
          style={[
            { flexDirection: r.row, paddingVertical: 3.6, borderBottomWidth: 0.4, borderBottomColor: colors.line },
            variantStyles[row.variant ?? 'normal'],
          ]}
        >
          {columns.map((column) => {
            const indent = row.indent && (row.indentColumn ?? columns.find((c) => !c.numeric && !c.width)?.key) === column.key ? row.indent * 9 : 0;
            return (
              <Text key={column.key} style={[cellStyle(column, r), indent ? (r.rtl ? { paddingRight: 4 + indent } : { paddingLeft: 4 + indent }) : {}]}>
                {row.cells[column.key] ?? ''}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** A labelled status line, e.g. "Balanced" or "Out of balance — difference 5,000". */
export function StatusLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  const r = useReport();
  return (
    <View
      wrap={false}
      style={{
        flexDirection: r.row,
        marginTop: 10,
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderWidth: 0.8,
        borderColor: ok ? '#9cc4c0' : '#dba7a2',
        backgroundColor: ok ? colors.accentSoft : colors.dangerSoft,
      }}
    >
      <Text style={{ fontWeight: 600, color: ok ? colors.accent : colors.danger, textAlign: r.start }}>{children}</Text>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const r = useReport();
  return <Text style={{ marginTop: 6, fontSize: 7.4, color: colors.muted, textAlign: r.start }}>{children}</Text>;
}

/** Signature fields (prepared by / reviewed by / approved by …). */
export function SignatureBlock({ labels, names = [] }: { labels: string[]; names?: Array<string | null | undefined> }) {
  const r = useReport();
  return (
    <View wrap={false} style={{ flexDirection: r.row, gap: 18, marginTop: 34 }}>
      {labels.map((label, i) => (
        <View key={label} style={{ flex: 1 }}>
          <Text style={{ fontSize: 8, color: colors.muted, textAlign: r.start }}>{label}</Text>
          <View style={{ borderBottomWidth: 0.8, borderBottomColor: colors.lineStrong, height: 26 }} />
          <Text style={{ fontSize: 7.6, color: colors.inkSoft, marginTop: 3, textAlign: r.start }}>
            {names[i] ? names[i] : `${r.t('pdf.name')}: ............................`}
          </Text>
          <Text style={{ fontSize: 7.6, color: colors.muted, marginTop: 2, textAlign: r.start }}>{r.t('pdf.date')}: ......../......../............</Text>
        </View>
      ))}
    </View>
  );
}

/** Compact strip of document facts. Empty values are left out, so it stays short. */
export function KeyValueGrid({ items, columns = 4 }: { items: MetaItem[]; columns?: number }) {
  const r = useReport();
  const filled = items.filter((item) => item.value && item.value !== '—');
  return (
    <View style={{ flexDirection: r.row, flexWrap: 'wrap', backgroundColor: colors.subtle, paddingHorizontal: 2, paddingTop: 5 }}>
      {filled.map((item) => (
        <View key={item.label} style={{ width: `${100 / columns}%`, paddingHorizontal: 5, paddingBottom: 5 }}>
          <Text style={{ fontSize: 7, color: colors.muted, textAlign: r.start }}>{item.label}</Text>
          <Text style={{ fontSize: 8.4, fontWeight: 500, textAlign: r.start }}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}
