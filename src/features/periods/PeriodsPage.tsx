import { useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, LockOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { PeriodStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Field, Input } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useFiscalYears, usePeriods } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { addDays, formatDate, formatDateTime, formatPeriodName, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { FiscalYear } from '@/types/database';
import { ReasonDialog } from '@/features/journal/components/ReasonDialog';

export function PeriodsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { companyId, can } = useCompany();
  const { fiscalYears, isLoading, error } = useFiscalYears();
  const { periods } = usePeriods();
  const [newYear, setNewYear] = useState<{ name: string; start: string; end: string; monthly: boolean } | null>(null);
  const [reopen, setReopen] = useState<{ kind: 'period' | 'year'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = can('periods.manage');

  const refresh = () =>
    Promise.all(['fiscal-years', 'periods', 'dashboard', 'audit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  };

  const openNewYear = () => {
    const latest = fiscalYears[0];
    const start = latest ? addDays(latest.end_date, 1) : `${todayIso().slice(0, 4)}-01-01`;
    const end = addDays(`${Number(start.slice(0, 4)) + 1}${start.slice(4)}`, -1);
    setNewYear({ name: start.slice(5) === '01-01' ? start.slice(0, 4) : `${start.slice(0, 4)}/${end.slice(0, 4)}`, start, end, monthly: true });
  };

  const createClosing = async (fy: FiscalYear) => {
    setBusy(`closing-${fy.id}`);
    try {
      const entryId = await rpc<string>('create_closing_entry', { p_fiscal_year_id: fy.id, p_description: t('periods.closingDescription', { name: fy.name }) });
      toast.success(t('periods.closingCreated'));
      await refresh();
      navigate(`/journal/entries/${entryId}`);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('periods.title')}
        subtitle={t('periods.subtitle')}
        actions={canManage && <Button variant="primary" icon={<Plus size={15} />} onClick={openNewYear}>{t('periods.newYear')}</Button>}
      />
      {!canManage && <Alert tone="info" className="mb-4">{t('periods.readOnly')}</Alert>}

      {isLoading ? (
        <PageLoader />
      ) : error ? (
        <Alert tone="danger">{errorMessage(error, t)}</Alert>
      ) : fiscalYears.length === 0 ? (
        <Card><EmptyState title={t('periods.empty')} description={t('periods.emptyHint')} /></Card>
      ) : (
        <div className="flex flex-col gap-5">
          {fiscalYears.map((fy) => {
            const list = periods.filter((p) => p.fiscal_year_id === fy.id);
            const open = list.filter((p) => p.status === 'open').length;
            return (
              <Card key={fy.id} className="overflow-hidden">
                <CardHeader
                  title={
                    <span className="flex items-center gap-3">
                      {t('periods.fiscalYear')} {fy.name}
                      <PeriodStatusBadge status={fy.status} />
                    </span>
                  }
                  description={`${formatDate(fy.start_date)} – ${formatDate(fy.end_date)} · ${t('periods.openCount', { open, total: list.length })}`}
                  actions={
                    <>
                      {can('entries.create') && fy.status === 'open' && (
                        <Button size="sm" icon={<FileText size={14} />} loading={busy === `closing-${fy.id}`} onClick={() => void createClosing(fy)}>
                          {t('periods.createClosing')}
                        </Button>
                      )}
                      {canManage && fy.status === 'open' && (
                        <Button
                          size="sm"
                          icon={<Lock size={14} />}
                          loading={busy === `fy-${fy.id}`}
                          onClick={() => window.confirm(t('periods.closeYearConfirm', { name: fy.name })) && void act(`fy-${fy.id}`, () => rpc('close_fiscal_year', { p_fiscal_year_id: fy.id }), t('periods.yearClosed'))}
                        >
                          {t('periods.closeYear')}
                        </Button>
                      )}
                      {canManage && fy.status === 'closed' && (
                        <Button size="sm" icon={<LockOpen size={14} />} onClick={() => setReopen({ kind: 'year', id: fy.id, name: fy.name })}>
                          {t('periods.reopenYear')}
                        </Button>
                      )}
                    </>
                  }
                />
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full min-w-[760px] border-collapse text-[13px]">
                    <thead className="bg-subtle text-[12px] text-muted">
                      <tr>
                        <th className="h-9 border-b border-line ps-5 text-start font-medium">#</th>
                        <th className="h-9 border-b border-line px-3 text-start font-medium">{t('periods.period')}</th>
                        <th className="h-9 border-b border-line px-3 text-start font-medium">{t('common.from')}</th>
                        <th className="h-9 border-b border-line px-3 text-start font-medium">{t('common.to')}</th>
                        <th className="h-9 border-b border-line px-3 text-start font-medium">{t('journal.status')}</th>
                        <th className="h-9 border-b border-line px-3 text-start font-medium">{t('periods.lastChange')}</th>
                        <th className="h-9 border-b border-line pe-5"><span className="sr-only">{t('common.actions')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => {
                        const current = p.start_date <= todayIso() && todayIso() <= p.end_date;
                        return (
                          <tr key={p.id} className={current ? 'bg-accent-soft/40' : undefined}>
                            <td className="num border-b border-line py-2 ps-5 text-muted">{p.period_number}</td>
                            <td className="border-b border-line px-3 py-2 font-medium">
                              {formatPeriodName(p.name, language)}
                              {current && <span className="ms-2 text-[11.5px] font-normal text-accent">{t('periods.current')}</span>}
                            </td>
                            <td className="num border-b border-line px-3 py-2 text-ink-soft">{formatDate(p.start_date)}</td>
                            <td className="num border-b border-line px-3 py-2 text-ink-soft">{formatDate(p.end_date)}</td>
                            <td className="border-b border-line px-3 py-2"><PeriodStatusBadge status={p.status} /></td>
                            <td className="num border-b border-line px-3 py-2 text-[12px] text-muted">
                              {p.status === 'closed' ? formatDateTime(p.closed_at) : p.reopened_at ? `${t('periods.reopened')} ${formatDateTime(p.reopened_at)}` : '—'}
                            </td>
                            <td className="border-b border-line py-1.5 pe-5 text-end">
                              {canManage && p.status === 'open' && fy.status === 'open' && (
                                <Button size="sm" variant="ghost" icon={<Lock size={13} />} loading={busy === p.id} onClick={() => void act(p.id, () => rpc('close_accounting_period', { p_period_id: p.id }), t('periods.periodClosed'))}>
                                  {t('periods.close')}
                                </Button>
                              )}
                              {canManage && p.status === 'closed' && fy.status === 'open' && (
                                <Button size="sm" variant="ghost" icon={<LockOpen size={13} />} onClick={() => setReopen({ kind: 'period', id: p.id, name: formatPeriodName(p.name, language) })}>
                                  {t('periods.reopen')}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={newYear !== null}
        onClose={() => setNewYear(null)}
        size="sm"
        title={t('periods.newYear')}
        description={t('periods.newYearHint')}
        footer={
          <>
            <Button onClick={() => setNewYear(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={busy === 'new-year'}
              onClick={() =>
                newYear &&
                void act(
                  'new-year',
                  () => rpc('create_fiscal_year', { p_company_id: companyId, p_name: newYear.name, p_start_date: newYear.start, p_end_date: newYear.end, p_monthly: newYear.monthly }),
                  t('periods.yearCreated'),
                ).then(() => setNewYear(null))
              }
            >
              {t('common.create')}
            </Button>
          </>
        }
      >
        {newYear && (
          <div className="flex flex-col gap-4">
            <Field label={t('periods.yearName')} required>
              {(p) => <Input {...p} value={newYear.name} onChange={(e) => setNewYear({ ...newYear, name: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('common.from')} required>
                {(p) => <Input {...p} type="date" className="num" value={newYear.start} onChange={(e) => setNewYear({ ...newYear, start: e.target.value })} />}
              </Field>
              <Field label={t('common.to')} required>
                {(p) => <Input {...p} type="date" className="num" value={newYear.end} onChange={(e) => setNewYear({ ...newYear, end: e.target.value })} />}
              </Field>
            </div>
            <Checkbox label={t('periods.monthly')} checked={newYear.monthly} onChange={(e) => setNewYear({ ...newYear, monthly: e.target.checked })} />
          </div>
        )}
      </Dialog>

      <ReasonDialog
        open={reopen !== null}
        onClose={() => setReopen(null)}
        title={reopen?.kind === 'year' ? t('periods.reopenYearTitle', { name: reopen?.name }) : t('periods.reopenTitle', { name: reopen?.name })}
        description={t('periods.reopenDescription')}
        confirmLabel={t('periods.reopen')}
        loading={busy === 'reopen'}
        onConfirm={(reason) =>
          reopen &&
          void act(
            'reopen',
            () =>
              reopen.kind === 'year'
                ? rpc('reopen_fiscal_year', { p_fiscal_year_id: reopen.id, p_reason: reason })
                : rpc('reopen_accounting_period', { p_period_id: reopen.id, p_reason: reason }),
            t('periods.reopenedToast'),
          ).then(() => setReopen(null))
        }
      />
    </>
  );
}
