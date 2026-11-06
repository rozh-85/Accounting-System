import { FileDown, FileSpreadsheet, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Pagination, Table, Td, Th, THead, Tr } from '@/components/tables/Table';
import { StatusBadge, VoucherTypeBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Menu } from '@/components/ui/Menu';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import { downloadCsv } from '@/lib/csv';
import { formatAmount, formatDate } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { VoucherStatus, VoucherType } from '@/lib/accounting';
import type { VoucherListRow } from '@/types/database';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { fetchVouchersForReport, voucherSearchArgs, useVouchers, type VoucherFilters } from './api';

const PAGE_SIZE = 25;
export const VOUCHER_TYPE_LIST: VoucherType[] = ['receipt', 'payment', 'journal', 'transfer'];
const STATUSES: VoucherStatus[] = ['draft', 'pending_approval', 'posted', 'reversed'];

export function VouchersListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { companyId, currency, can } = useCompany();
  const [params, setParams] = useSearchParams();
  const filters: VoucherFilters = useMemo(
    () => ({
      search: params.get('q') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      type: (params.get('type') as VoucherType) ?? '',
      status: (params.get('status') as VoucherStatus) ?? '',
    }),
    [params],
  );
  const page = Number(params.get('page') ?? 0);
  const [searchText, setSearchText] = useState(filters.search);
  const [reportOpen, setReportOpen] = useState(false);
  const identity = useReportIdentity();
  const list = useVouchers(filters, page, PAGE_SIZE);
  const rows = list.data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  const setFilters = (patch: Partial<VoucherFilters>, nextPage = 0) => {
    const f = { ...filters, ...patch };
    const p = new URLSearchParams();
    if (f.search) p.set('q', f.search);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (f.type) p.set('type', f.type);
    if (f.status) p.set('status', f.status);
    if (nextPage) p.set('page', String(nextPage));
    setParams(p, { replace: true });
  };
  const hasFilters = Boolean(filters.search || filters.from || filters.to || filters.type || filters.status);
  // Like the daily journal report: posted documents unless a status is chosen.
  const reportStatuses: VoucherStatus[] = filters.status ? [filters.status] : ['posted', 'reversed'];

  const exportCsv = async () => {
    try {
      const all = await rpc<VoucherListRow[]>('search_vouchers', voucherSearchArgs(companyId, filters, 1000, 0));
      downloadCsv(
        `vouchers-${new Date().toISOString().slice(0, 10)}`,
        [t('vouchers.number'), t('vouchers.date'), t('vouchers.type'), t('vouchers.party'), t('journal.description'), t('vouchers.amount'), t('journal.status'), t('vouchers.journalEntry'), t('journal.createdBy')],
        all.map((r) => [r.voucher_number, formatDate(r.voucher_date), t(`voucherTypes.${r.voucher_type}`), r.party_name ?? '', r.description, formatAmount(r.amount, currency.decimals), t(`status.${r.status}`), r.journal_entry_number ?? '', r.created_by_name ?? '']),
      );
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('vouchers.type')}
          value={filters.type || 'all'}
          onChange={(v) => setFilters({ type: v === 'all' ? '' : (v as VoucherType) })}
          options={[{ value: 'all', label: t('common.all') }, ...VOUCHER_TYPE_LIST.map((type) => ({ value: type, label: t(`voucherTypes.${type}`) }))]}
        />
        <div className="flex flex-wrap gap-2">
          <Button icon={<FileSpreadsheet size={15} />} onClick={() => void exportCsv()}>
            {t('common.exportCsv')}
          </Button>
          {can('reports.export') && (
            <Button icon={<FileDown size={15} />} onClick={() => setReportOpen(true)}>
              {t('common.exportPdf')}
            </Button>
          )}
          {can('entries.create') && (
            <Menu
              trigger={(props) => (
                <Button variant="primary" icon={<Plus size={15} />} {...props}>
                  {t('vouchers.new')}
                </Button>
              )}
              items={VOUCHER_TYPE_LIST.map((type) => ({
                label: (
                  <span className="flex flex-col">
                    <span>{t(`voucherTypes.${type}`)}</span>
                    <span className="text-[11.5px] text-muted">{t(`vouchers.typeHints.${type}`)}</span>
                  </span>
                ),
                onSelect: () => navigate(`/journal/vouchers/new?type=${type}`),
              }))}
            />
          )}
        </div>
      </div>

      <Card className="mb-4 px-4 py-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <form
            className="col-span-2 flex flex-col gap-1 text-[12px] text-muted md:col-span-1"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ search: searchText.trim() });
            }}
          >
            {t('common.search')}
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input type="search" className="h-8 ps-8" value={searchText} placeholder={t('vouchers.searchPlaceholder')} onChange={(e) => setSearchText(e.target.value)} onBlur={() => searchText.trim() !== filters.search && setFilters({ search: searchText.trim() })} />
            </div>
          </form>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.from')}
            <Input type="date" className="num h-8" value={filters.from} onChange={(e) => setFilters({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.to')}
            <Input type="date" className="num h-8" value={filters.to} onChange={(e) => setFilters({ to: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('journal.status')}
            <Select className="h-8" value={filters.status} onChange={(e) => setFilters({ status: e.target.value as VoucherStatus | '' })}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`status.${s}`)}</option>
              ))}
            </Select>
          </label>
        </div>
        {hasFilters && (
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => { setSearchText(''); setParams(new URLSearchParams(), { replace: true }); }}>
              {t('common.clearFilters')}
            </Button>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <PageLoader />
        ) : list.error ? (
          <div className="p-5"><Alert tone="danger">{errorMessage(list.error, t)}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState title={hasFilters ? t('vouchers.noMatches') : t('vouchers.empty')} description={hasFilters ? t('common.adjustFilters') : t('vouchers.emptyHint')} />
        ) : (
          <>
            <Table minWidth={1040}>
              <THead>
                <tr>
                  <Th>{t('vouchers.number')}</Th>
                  <Th>{t('vouchers.date')}</Th>
                  <Th>{t('vouchers.type')}</Th>
                  <Th>{t('vouchers.party')}</Th>
                  <Th className="w-[28%]">{t('journal.description')}</Th>
                  <Th numeric>{t('vouchers.amount')}</Th>
                  <Th>{t('journal.status')}</Th>
                  <Th>{t('vouchers.journalEntry')}</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row.id} interactive tabIndex={0} onClick={() => navigate(`/journal/vouchers/${row.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/journal/vouchers/${row.id}`)}>
                    <Td className="num font-medium">{row.voucher_number}</Td>
                    <Td className="num text-ink-soft">{formatDate(row.voucher_date)}</Td>
                    <Td><VoucherTypeBadge type={row.voucher_type} /></Td>
                    <Td className="text-ink-soft">{row.party_name ?? <span className="text-faint">—</span>}</Td>
                    <Td><span className="line-clamp-1">{row.description}</span></Td>
                    <Td numeric>{formatAmount(row.amount, currency.decimals)}</Td>
                    <Td><StatusBadge status={row.status} /></Td>
                    <Td className="num text-ink-soft">{row.journal_entry_number ?? <span className="text-faint">—</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setFilters({}, p)} />
          </>
        )}
      </Card>

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t('pdf.voucherRegister.title')}
        fileName="voucher-register"
        defaultSignatures={identity.signatures}
        generate={async ({ language, signatures }) => {
          const vouchers = await fetchVouchersForReport(companyId, filters, reportStatuses);
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(
            <pdf.VoucherRegisterReport
              context={pdf.reportContext(language, identity.company, identity.generatedBy)}
              decimals={currency.decimals}
              currencyCode={currency.code}
              from={filters.from || null}
              to={filters.to || null}
              typeLabel={filters.type ? t(`voucherTypes.${filters.type}`, { lng: language }) : t('common.all', { lng: language })}
              statusLabel={reportStatuses.map((s) => t(`status.${s}`, { lng: language })).join(', ')}
              vouchers={vouchers}
              signatures={signatures}
            />,
          );
        }}
      />
    </>
  );
}
