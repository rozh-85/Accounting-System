import { FileDown, FileSpreadsheet, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AccountPicker } from '@/components/forms/AccountPicker';
import { FilterBar } from '@/components/tables/FilterBar';
import { Pagination, Table, Td, Th, THead, Tr } from '@/components/tables/Table';
import { EntryTypeBadge, StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Alert, Card, EmptyState } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAccounts, useMembers } from '@/hooks/useReferenceData';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import { downloadCsv } from '@/lib/csv';
import { formatAmount, formatDate } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { EntryStatus, EntryType, VoucherType } from '@/lib/accounting';
import { ReportDialog } from '@/features/reports/ReportDialog';
import type { JournalListRow } from '@/types/database';
import { emptyJournalFilters, entryDeletable, entryEditable, entryHasLinks, fetchAllJournalEntries, useEntryAction, useJournalEntries, type JournalFilters } from './api';

export const ENTRY_STATUSES: EntryStatus[] = ['draft', 'pending_approval', 'posted', 'reversed'];
export const ENTRY_TYPES: EntryType[] = ['standard', 'opening', 'adjusting', 'closing', 'reversing', 'recurring'];
export const VOUCHER_TYPES: VoucherType[] = ['receipt', 'payment', 'journal', 'transfer'];

const PAGE_SIZE = 25;

function filtersFromParams(params: URLSearchParams): JournalFilters {
  return {
    search: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    status: (params.get('status') as EntryStatus) ?? '',
    entryType: (params.get('type') as EntryType) ?? '',
    accountId: params.get('account'),
    voucherType: (params.get('voucher') as VoucherType) ?? '',
    createdBy: params.get('user') ?? '',
  };
}

function filtersToParams(f: JournalFilters, page: number) {
  const p = new URLSearchParams();
  if (f.search) p.set('q', f.search);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.status) p.set('status', f.status);
  if (f.entryType) p.set('type', f.entryType);
  if (f.accountId) p.set('account', f.accountId);
  if (f.voucherType) p.set('voucher', f.voucherType);
  if (f.createdBy) p.set('user', f.createdBy);
  if (page) p.set('page', String(page));
  return p;
}

export function EntriesListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const page = Number(params.get('page') ?? 0);
  const [searchText, setSearchText] = useState(filters.search);
  const [reportOpen, setReportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<JournalListRow | null>(null);
  const action = useEntryAction();
  const { companyId, currency, can } = useCompany();
  const { accounts } = useAccounts();
  const { members } = useMembers();
  const identity = useReportIdentity();
  const list = useJournalEntries(filters, page, PAGE_SIZE);
  const rows = list.data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  const setFilters = (patch: Partial<JournalFilters>) => setParams(filtersToParams({ ...filters, ...patch }, 0), { replace: true });
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(emptyJournalFilters);

  const exportCsv = async () => {
    try {
      const all = await fetchAllJournalEntries(companyId, filters);
      downloadCsv(
        `journal-entries-${new Date().toISOString().slice(0, 10)}`,
        [t('journal.entryNumber'), t('journal.date'), t('journal.entryType'), t('journal.voucherNumber'), t('journal.description'), t('journal.totalDebit'), t('journal.totalCredit'), t('journal.status'), t('journal.createdBy')],
        all.map((r) => [
          r.entry_number,
          formatDate(r.entry_date),
          t(`entryTypes.${r.entry_type}`),
          r.voucher_number ?? '',
          r.description,
          formatAmount(r.total_debit, currency.decimals),
          formatAmount(r.total_credit, currency.decimals),
          t(`status.${r.status}`),
          r.created_by_name ?? '',
        ]),
      );
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  const statuses: EntryStatus[] = filters.status ? [filters.status] : ['posted', 'reversed'];

  const deleteEntry = async () => {
    if (!toDelete) return;
    try {
      await action.mutateAsync({ type: 'delete', id: toDelete.id });
      toast.success(t(toDelete.status === 'draft' ? 'journal.deletedToast' : 'journal.entryDeletedToast'));
      setToDelete(null);
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="num text-[13px] text-muted">{list.data ? t('journal.count', { count: total }) : ''}</p>
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
            <ButtonLink to="/journal/entries/new" variant="primary" icon={<Plus size={15} />}>
              {t('journal.newEntry')}
            </ButtonLink>
          )}
        </div>
      </div>

      <FilterBar
        search={searchText}
        onSearchChange={setSearchText}
        onSearchCommit={() => searchText.trim() !== filters.search && setFilters({ search: searchText.trim() })}
        searchPlaceholder={t('journal.searchPlaceholder')}
        from={filters.from}
        to={filters.to}
        onFromChange={(from) => setFilters({ from })}
        onToChange={(to) => setFilters({ to })}
        primary={
          <Select aria-label={t('journal.status')} value={filters.status} onChange={(e) => setFilters({ status: e.target.value as EntryStatus | '' })}>
            <option value="">{t('common.allStatuses')}</option>
            {ENTRY_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        moreCount={[filters.entryType, filters.voucherType, filters.accountId, filters.createdBy].filter(Boolean).length}
        more={
          <>
            <Select aria-label={t('journal.entryType')} value={filters.entryType} onChange={(e) => setFilters({ entryType: e.target.value as EntryType | '' })}>
              <option value="">{t('journal.allEntryTypes')}</option>
              {ENTRY_TYPES.map((s) => (
                <option key={s} value={s}>{t(`entryTypes.${s}`)}</option>
              ))}
            </Select>
            <Select aria-label={t('journal.voucherType')} value={filters.voucherType} onChange={(e) => setFilters({ voucherType: e.target.value as VoucherType | '' })}>
              <option value="">{t('journal.allVoucherTypes')}</option>
              {VOUCHER_TYPES.map((s) => (
                <option key={s} value={s}>{t(`voucherTypes.${s}`)}</option>
              ))}
            </Select>
            <AccountPicker accounts={accounts} value={filters.accountId} onChange={(accountId) => setFilters({ accountId })} placeholder={t('journal.allAccounts')} className="[&_input]:h-10" aria-label={t('journal.account')} />
            <Select aria-label={t('journal.createdBy')} value={filters.createdBy} onChange={(e) => setFilters({ createdBy: e.target.value })}>
              <option value="">{t('journal.allUsers')}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
              ))}
            </Select>
          </>
        }
        canClear={hasFilters}
        onClear={() => {
          setSearchText('');
          setParams(new URLSearchParams(), { replace: true });
        }}
      />

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <PageLoader />
        ) : list.error ? (
          <div className="p-5">
            <Alert tone="danger">{errorMessage(list.error, t)}</Alert>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? t('journal.noMatches') : t('journal.empty')}
            description={hasFilters ? t('common.adjustFilters') : t('journal.emptyHint')}
            action={
              !hasFilters && can('entries.create') ? (
                <ButtonLink to="/journal/entries/new" variant="primary" icon={<Plus size={15} />}>
                  {t('journal.newEntry')}
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table minWidth={1160}>
              <THead>
                <tr>
                  <Th>{t('journal.entryNumber')}</Th>
                  <Th>{t('journal.date')}</Th>
                  <Th>{t('journal.entryType')}</Th>
                  <Th>{t('journal.voucherNumber')}</Th>
                  <Th className="w-[30%]">{t('journal.description')}</Th>
                  <Th numeric>{t('journal.totalDebit')}</Th>
                  <Th numeric>{t('journal.totalCredit')}</Th>
                  <Th>{t('journal.status')}</Th>
                  <Th>{t('journal.createdBy')}</Th>
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((row) => (
                  <Tr
                    key={row.id}
                    interactive
                    tabIndex={0}
                    onClick={() => navigate(`/journal/entries/${row.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/journal/entries/${row.id}`)}
                  >
                    <Td className="num font-medium text-ink">{row.entry_number}</Td>
                    <Td className="num text-ink-soft">{formatDate(row.entry_date)}</Td>
                    <Td><EntryTypeBadge type={row.entry_type} /></Td>
                    <Td className="num text-ink-soft">{row.voucher_number ?? <span className="text-faint">—</span>}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="line-clamp-1">{row.description}</span>
                        {Number(row.attachment_count) > 0 && <Paperclip size={13} className="shrink-0 text-faint" aria-label={t('attachments.title')} />}
                      </div>
                    </Td>
                    <Td numeric>{formatAmount(row.total_debit, currency.decimals)}</Td>
                    <Td numeric>{formatAmount(row.total_credit, currency.decimals)}</Td>
                    <Td><StatusBadge status={row.status} /></Td>
                    <Td className="text-ink-soft">{row.created_by_name ?? '—'}</Td>
                    <Td className="w-[88px] whitespace-nowrap py-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5">
                        {entryEditable(row, can) && (
                          <IconButton label={t('common.edit')} onClick={() => navigate(`/journal/entries/${row.id}/edit`)}>
                            <Pencil size={15} />
                          </IconButton>
                        )}
                        {entryDeletable(row, can) && (
                          <IconButton label={t('common.delete')} className="hover:!bg-danger-soft hover:!text-danger" onClick={() => setToDelete(row)}>
                            <Trash2 size={15} />
                          </IconButton>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setParams(filtersToParams(filters, p), { replace: true })} />
          </>
        )}
      </Card>

      <Dialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title={toDelete ? t(toDelete.status === 'draft' ? 'journal.deleteTitle' : 'journal.deletePostedTitle', { number: toDelete.entry_number }) : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={action.isPending} onClick={() => void deleteEntry()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-soft">{t(toDelete && toDelete.status !== 'draft' ? 'journal.deletePostedBody' : 'journal.deleteBody')}</p>
        {toDelete && entryHasLinks(toDelete) && <p className="mt-2 text-[13.5px] font-medium text-ink">{t('journal.deleteLinkedNote')}</p>}
      </Dialog>

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t('pdf.journal.title')}
        fileName="daily-journal"
        defaultSignatures={identity.signatures}
        generate={async ({ language, signatures }) => {
          const lines = await rpc<import('@/lib/pdf').JournalReportLine[]>('journal_report_lines', {
            p_company_id: companyId,
            p_from: filters.from || null,
            p_to: filters.to || null,
            p_statuses: statuses,
          });
          const filtered = filters.accountId || filters.voucherType || filters.entryType || filters.search || filters.createdBy
            ? (() => {
                return fetchAllJournalEntries(companyId, filters).then((entries) => {
                  const ids = new Set(entries.map((e) => e.id));
                  return lines.filter((l) => ids.has(l.entry_id));
                });
              })()
            : Promise.resolve(lines);
          const pdf = await import('@/lib/pdf');
          return pdf.renderToBlob(
            <pdf.JournalReport
              context={pdf.reportContext(language, identity.company, identity.generatedBy)}
              decimals={currency.decimals}
              currencyCode={currency.code}
              from={filters.from || null}
              to={filters.to || null}
              statusLabel={statuses.map((s) => t(`status.${s}`, { lng: language })).join(', ')}
              lines={await filtered}
              signatures={signatures}
            />,
          );
        }}
      />
    </>
  );
}
