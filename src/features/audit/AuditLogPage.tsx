import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Pagination, Table, Td, Th, THead } from '@/components/tables/Table';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { formatDateTime } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { AuditLogRow } from '@/types/database';

const PAGE_SIZE = 50;
const ENTITY_TYPES = ['journal_entry', 'voucher', 'accounts', 'accounting_periods', 'fiscal_years', 'user_roles', 'company_settings', 'companies', 'recurring_template'];

function summarize(details: Record<string, unknown>, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (typeof details.reason === 'string') return details.reason;
  if (details.changes && typeof details.changes === 'object') {
    return Object.keys(details.changes as object)
      .map((k) => t(`audit.fields.${k}`, { defaultValue: k }))
      .join(', ');
  }
  if (typeof details.reversal_entry === 'string') return String(details.reversal_entry);
  if (typeof details.journal_entry === 'string') return String(details.journal_entry);
  if (typeof details.file === 'string') return String(details.file);
  return '';
}

export function AuditLogPage() {
  const { t } = useTranslation();
  const { companyId, can } = useCompany();
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['audit', companyId, entityType, from, to, search, page],
    enabled: can('audit.view'),
    queryFn: () =>
      rpc<AuditLogRow[]>('search_audit_logs', {
        p_company_id: companyId,
        p_entity_type: entityType || null,
        p_action: null,
        p_from: from || null,
        p_to: to || null,
        p_search: search || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  });

  if (!can('audit.view')) return <Alert tone="warning">{t('errors.PERMISSION_DENIED')}</Alert>;
  const rows = query.data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  const link = (row: AuditLogRow) => {
    if (!row.entity_id) return null;
    if (row.entity_type === 'journal_entry') return `/journal/entries/${row.entity_id}`;
    if (row.entity_type === 'voucher') return `/journal/vouchers/${row.entity_id}`;
    return null;
  };

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <Card className="mb-4 px-4 py-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('audit.entity')}
            <Select className="h-8" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0); }}>
              <option value="">{t('common.all')}</option>
              {ENTITY_TYPES.map((e) => <option key={e} value={e}>{t(`audit.entities.${e}`)}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.from')}
            <Input type="date" className="num h-8" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.to')}
            <Input type="date" className="num h-8" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.search')}
            <Input type="search" className="h-8" value={search} placeholder={t('audit.searchPlaceholder')} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </label>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <PageLoader />
        ) : query.error ? (
          <div className="p-5"><Alert tone="danger">{errorMessage(query.error, t)}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('audit.empty')} />
        ) : (
          <>
            <Table minWidth={900}>
              <THead>
                <tr>
                  <Th>{t('audit.when')}</Th>
                  <Th>{t('audit.user')}</Th>
                  <Th>{t('audit.entity')}</Th>
                  <Th>{t('audit.record')}</Th>
                  <Th>{t('audit.action')}</Th>
                  <Th>{t('audit.details')}</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((row) => {
                  const href = link(row);
                  return (
                    <tr key={row.id} className="hover:bg-subtle">
                      <Td className="num whitespace-nowrap text-ink-soft">{formatDateTime(row.created_at)}</Td>
                      <Td>{row.actor_name ?? t('audit.system')}</Td>
                      <Td className="text-ink-soft">{t(`audit.entities.${row.entity_type}`, { defaultValue: row.entity_type })}</Td>
                      <Td className="num">{href ? <Link to={href} className="text-accent hover:underline">{row.entity_label}</Link> : row.entity_label}</Td>
                      <Td className="font-medium">{t(`history.actions.${row.action}`, { defaultValue: row.action })}</Td>
                      <Td className="text-[12.5px] text-muted"><span className="line-clamp-2">{summarize(row.details, t)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
