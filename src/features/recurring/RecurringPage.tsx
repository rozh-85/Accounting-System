import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { Table, Td, Th, THead } from '@/components/tables/Table';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, Card, EmptyState } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAccounts } from '@/hooks/useReferenceData';
import { formatUnits, linesToPayload, summarizeLines, toUnits, validateLines, type JournalIssue } from '@/lib/accounting';
import { formatAmount, formatDate, todayIso } from '@/lib/formatting';
import { supabase } from '@/lib/supabase/client';
import { errorMessage, unwrap } from '@/lib/supabase/errors';
import { rpc } from '@/lib/supabase/rpc';
import type { RecurringTemplate } from '@/types/database';
import { useInvalidateLedger } from '@/features/journal/api';
import { BalanceIndicator } from '@/features/journal/components/BalanceIndicator';
import { LinesEditor, lineInputsToDrafts, newLine, type LineInput } from '@/features/journal/components/LinesEditor';

const FREQUENCIES: RecurringTemplate['frequency'][] = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'];

function useTemplates() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ['recurring', companyId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('recurring_entry_templates')
          .select('*, recurring_template_lines(*)')
          .eq('company_id', companyId)
          .order('name'),
      ) as RecurringTemplate[],
  });
}

interface DraftTemplate {
  id: string | null;
  name: string;
  description: string;
  frequency: RecurringTemplate['frequency'];
  startDate: string;
  endDate: string;
  isActive: boolean;
  lines: LineInput[];
}

function TemplateDialog({ template, onClose }: { template: DraftTemplate | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { companyId, currency } = useCompany();
  const { accounts, byId } = useAccounts();
  const [draft, setDraft] = useState<DraftTemplate | null>(template);
  const [issues, setIssues] = useState<JournalIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [lastTemplate, setLastTemplate] = useState(template);
  if (template !== lastTemplate) {
    setLastTemplate(template);
    setDraft(template);
    setIssues([]);
    setError(null);
    setTouched(false);
  }

  const save = useMutation({
    mutationFn: (d: DraftTemplate) =>
      rpc<string>('save_recurring_template', {
        p_company_id: companyId,
        p_template_id: d.id,
        p_data: { name: d.name.trim(), description: d.description.trim(), frequency: d.frequency, start_date: d.startDate, end_date: d.endDate || null, is_active: d.isActive },
        p_lines: linesToPayload(lineInputsToDrafts(d.lines)),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });

  if (!draft) return null;
  const drafts = lineInputsToDrafts(draft.lines);
  const summary = summarizeLines(drafts);
  const set = (patch: Partial<DraftTemplate>) => setDraft({ ...draft, ...patch });

  return (
    <Dialog
      open={Boolean(template)}
      onClose={onClose}
      size="xl"
      title={draft.id ? t('recurring.editTitle') : t('recurring.newTitle')}
      description={t('recurring.dialogHint')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={async () => {
              setTouched(true);
              const found = validateLines(drafts, { forPosting: true, decimals: currency.decimals, accounts: byId });
              setIssues(found);
              if (found.length || !draft.name.trim() || !draft.description.trim() || !draft.startDate) return;
              try {
                await save.mutateAsync(draft);
                toast.success(t('recurring.savedToast'));
                onClose();
              } catch (e) {
                setError(errorMessage(e, t));
              }
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label={t('recurring.name')} required error={touched && !draft.name.trim() ? t('validation.required') : null}>
            {(p) => <Input {...p} value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label={t('recurring.frequency')} required>
            {(p) => (
              <Select {...p} value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as DraftTemplate['frequency'] })}>
                {FREQUENCIES.map((f) => <option key={f} value={f}>{t(`recurring.frequencies.${f}`)}</option>)}
              </Select>
            )}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label={t('recurring.active')} checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          </div>
          <Field label={t('recurring.startDate')} required hint={t('recurring.startDateHint')}>
            {(p) => <Input {...p} type="date" className="num" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
          </Field>
          <Field label={t('recurring.endDate')} hint={t('recurring.endDateHint')}>
            {(p) => <Input {...p} type="date" className="num" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
          </Field>
        </div>
        <Field label={t('journal.description')} required error={touched && !draft.description.trim() ? t('validation.descriptionRequired') : null}>
          {(p) => <Textarea {...p} rows={2} value={draft.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
        <div className="overflow-hidden rounded-[12px] border border-line">
          <LinesEditor value={draft.lines} onChange={(lines) => set({ lines })} accounts={accounts} decimals={currency.decimals} showErrors={touched} />
        </div>
        <BalanceIndicator totalDebit={summary.totalDebit} totalCredit={summary.totalCredit} decimals={currency.decimals} />
        {(issues.length > 0 || error) && (
          <Alert tone="danger">
            <ul className="list-disc ps-5">
              {error && <li>{error}</li>}
              {[...new Set(issues.map((i) => i.code))].map((code) => <li key={code}>{t(`errors.${code}`, { detail: '' })}</li>)}
            </ul>
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

export function RecurringPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLedger();
  const { currency, can } = useCompany();
  const templates = useTemplates();
  const [editing, setEditing] = useState<DraftTemplate | null>(null);
  const [generateFor, setGenerateFor] = useState<RecurringTemplate | null>(null);
  const [until, setUntil] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const fmt = (v: number | string) => (toUnits(v) ? formatUnits(toUnits(v), { decimals: currency.decimals }) : '');
  const openTemplate = (tpl?: RecurringTemplate) =>
    setEditing(
      tpl
        ? {
            id: tpl.id,
            name: tpl.name,
            description: tpl.description,
            frequency: tpl.frequency,
            startDate: tpl.start_date,
            endDate: tpl.end_date ?? '',
            isActive: tpl.is_active,
            lines: [...tpl.recurring_template_lines]
              .sort((a, b) => a.line_number - b.line_number)
              .map((l) => newLine({ accountId: l.account_id, debit: fmt(l.debit_amount), credit: fmt(l.credit_amount), description: l.description ?? '' })),
          }
        : { id: null, name: '', description: '', frequency: 'monthly', startDate: todayIso(), endDate: '', isActive: true, lines: [newLine(), newLine()] },
    );

  const rows = templates.data ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted">{t('recurring.intro')}</p>
        {can('entries.create') && (
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => openTemplate()}>
            {t('recurring.new')}
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {templates.isLoading ? (
          <PageLoader />
        ) : templates.error ? (
          <div className="p-5"><Alert tone="danger">{errorMessage(templates.error, t)}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('recurring.empty')} description={t('recurring.emptyHint')} />
        ) : (
          <Table minWidth={900}>
            <THead>
              <tr>
                <Th>{t('recurring.name')}</Th>
                <Th>{t('journal.description')}</Th>
                <Th>{t('recurring.frequency')}</Th>
                <Th numeric>{t('journal.amount')}</Th>
                <Th>{t('recurring.nextRun')}</Th>
                <Th numeric>{t('recurring.generated')}</Th>
                <Th>{t('journal.status')}</Th>
                <Th><span className="sr-only">{t('common.actions')}</span></Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((tpl) => {
                const total = tpl.recurring_template_lines.reduce((sum, l) => sum + toUnits(l.debit_amount), 0n);
                const ended = tpl.end_date !== null && tpl.next_run_date > tpl.end_date;
                return (
                  <tr key={tpl.id}>
                    <Td className="font-medium">{tpl.name}</Td>
                    <Td className="text-ink-soft"><span className="line-clamp-1">{tpl.description}</span></Td>
                    <Td className="text-ink-soft">{t(`recurring.frequencies.${tpl.frequency}`)}</Td>
                    <Td numeric>{formatAmount(total, currency.decimals)}</Td>
                    <Td className="num text-ink-soft">{ended ? t('recurring.ended') : formatDate(tpl.next_run_date)}</Td>
                    <Td numeric>{tpl.generated_count}</Td>
                    <Td>{tpl.is_active ? <Badge tone="accent">{t('recurring.active')}</Badge> : <Badge>{t('recurring.inactive')}</Badge>}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        {can('entries.create') && tpl.is_active && !ended && (
                          <Button size="sm" icon={<Play size={13} />} onClick={() => { setUntil(todayIso()); setGenerateFor(tpl); }}>
                            {t('recurring.generate')}
                          </Button>
                        )}
                        {can('entries.create') && (
                          <IconButton label={t('common.edit')} onClick={() => openTemplate(tpl)}><Pencil size={15} /></IconButton>
                        )}
                        {can('entries.edit_draft') && (
                          <IconButton
                            label={t('common.delete')}
                            onClick={async () => {
                              if (!window.confirm(t('recurring.deleteConfirm', { name: tpl.name }))) return;
                              try {
                                await rpc('delete_recurring_template', { p_template_id: tpl.id });
                                await queryClient.invalidateQueries({ queryKey: ['recurring'] });
                              } catch (e) {
                                toast.error(errorMessage(e, t));
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <TemplateDialog template={editing} onClose={() => setEditing(null)} />

      <Dialog
        open={Boolean(generateFor)}
        onClose={() => setGenerateFor(null)}
        size="sm"
        title={t('recurring.generateTitle', { name: generateFor?.name ?? '' })}
        description={t('recurring.generateHint')}
        footer={
          <>
            <Button onClick={() => setGenerateFor(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!generateFor) return;
                setBusy(true);
                try {
                  const count = await rpc<number>('generate_recurring_entries', { p_template_id: generateFor.id, p_until: until });
                  await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ['recurring'] })]);
                  toast.success(t('recurring.generatedToast', { count }));
                  setGenerateFor(null);
                } catch (e) {
                  toast.error(errorMessage(e, t));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('recurring.generate')}
            </Button>
          </>
        }
      >
        <Field label={t('recurring.generateUntil')} hint={generateFor ? t('recurring.nextDue', { date: formatDate(generateFor.next_run_date) }) : undefined}>
          {(p) => <Input {...p} type="date" className="num" value={until} onChange={(e) => setUntil(e.target.value)} />}
        </Field>
      </Dialog>
    </>
  );
}
