import { clsx } from 'clsx';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import { AccountPicker } from '@/components/forms/AccountPicker';
import { Table, Td, Th, THead, TotalsRow } from '@/components/tables/Table';
import { Button } from '@/components/ui/Button';
import { Alert, Card, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { fiscalYearFor, useAccounts, useFiscalYears } from '@/hooks/useReferenceData';
import { useLanguage } from '@/hooks/useLanguage';
import { useReportIdentity } from '@/hooks/useReportIdentity';
import { absUnits, buildTAccount, formatUnits, type Account, type TAccountItem, type Units } from '@/lib/accounting';
import { downloadCsv } from '@/lib/csv';
import { formatDate, startOfYear, todayIso } from '@/lib/formatting';
import { errorMessage } from '@/lib/supabase/errors';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { useLedger, type LedgerSection, type LedgerSelection } from './useLedger';

export function RoomHeading({ number, roomKey }: { number: string; roomKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-5">
      <p className="num mb-1 text-[12px] font-medium tracking-[0.06em] text-faint">{t('dashboard.room')} {number}</p>
      <h1 className="text-[21px] font-semibold tracking-[-0.01em]">{t(`rooms.${roomKey}.title`)}</h1>
      <p className="mt-1 text-[13px] text-muted">{t(`rooms.${roomKey}.description`)}</p>
    </div>
  );
}

function useBalanceText() {
  const { t } = useTranslation();
  const { currency } = useCompany();
  return (net: Units) =>
    net === 0n ? formatUnits(0n, { decimals: currency.decimals }) : `${formatUnits(absUnits(net), { decimals: currency.decimals })} ${net > 0n ? t('ledger.dr') : t('ledger.cr')}`;
}

function SummaryStrip({ section }: { section: LedgerSection }) {
  const { t } = useTranslation();
  const { currency } = useCompany();
  const balance = useBalanceText();
  const s = section.statement;
  const items: Array<[string, ReactNode]> = [
    [t('ledger.openingBalance'), balance(s.openingNet)],
    [t('ledger.periodDebits'), formatUnits(s.periodDebit, { decimals: currency.decimals })],
    [t('ledger.periodCredits'), formatUnits(s.periodCredit, { decimals: currency.decimals })],
    [t('ledger.endingBalance'), balance(s.closingNet)],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-surface px-4 py-3">
          <p className="text-[12px] text-muted">{label}</p>
          <p className="num mt-0.5 text-[16px] font-semibold">{value}</p>
        </div>
      ))}
    </div>
  );
}

function TAccountView({ section, accountsById }: { section: LedgerSection; accountsById: Map<string, Account> }) {
  const { t } = useTranslation();
  const { name, isRtl } = useLanguage();
  const { currency } = useCompany();
  const fmt = (u: Units) => formatUnits(u, { decimals: currency.decimals });
  const tAccount = buildTAccount(section.statement, { opening: t('ledger.openingBd'), balanceCd: t('ledger.balanceCd') });

  // Debit-side items read "To <counter account>", credit-side items "By <counter account>".
  const label = (item: TAccountItem, side: 'debit' | 'credit') => {
    if (item.kind !== 'movement') return item.description;
    const prefix = t(side === 'debit' ? 'ledger.toPrefix' : 'ledger.byPrefix');
    const counter = item.counterLineCount === 1 && item.counterAccountId ? accountsById.get(item.counterAccountId) : undefined;
    return `${prefix} ${counter ? name(counter) : t('ledger.sundries')}`;
  };

  const side = (sideName: 'debit' | 'credit', items: TAccountItem[], carried: TAccountItem | null) => (
    <ul className="flex flex-col">
      {[...items, ...(carried ? [carried] : [])].map((item) => (
        <li key={item.key} className={clsx('grid grid-cols-[72px_1fr_auto] items-baseline gap-2 border-b border-line px-3 py-2 text-[13px]', item.kind !== 'movement' && 'bg-subtle/70 font-medium')}>
          <span className="num text-[12px] text-muted">{item.date ? formatDate(item.date) : ''}</span>
          <span className="min-w-0">
            <span className="block truncate text-ink">{label(item, sideName)}</span>
            {item.entryId && (
              <Link to={`/journal/entries/${item.entryId}`} className="num text-[11.5px] text-accent hover:underline">
                {item.entryNumber}
              </Link>
            )}
          </span>
          <span className="num text-end">{fmt(item.amount)}</span>
        </li>
      ))}
      {items.length === 0 && !carried && <li className="px-3 py-6 text-center text-[12.5px] text-faint">{t('ledger.noEntriesSide')}</li>}
    </ul>
  );

  const debitCarried = tAccount.balanceSide === 'credit' ? tAccount.balanceCarriedDown : null;
  const creditCarried = tAccount.balanceSide === 'debit' ? tAccount.balanceCarriedDown : null;

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pb-3 pt-5 text-center">
        <p className="text-[16px] font-semibold">{name(section.account)}</p>
        <p className="num text-[12.5px] text-muted">
          {section.account.code}
          {section.aggregated && ` · ${t('ledger.aggregated')}`}
        </p>
      </div>
      {/* Debit is always on the left and credit on the right, in both languages. */}
      <div dir="ltr" className="mx-5 mb-5 border-t-2 border-ink">
        <div className="grid grid-cols-2">
          <div className="border-e-2 border-ink">
            <p className="border-b border-line py-2 text-center text-[12.5px] font-semibold text-ink-soft">{t('ledger.debitSide')}</p>
            <div dir={isRtl ? 'rtl' : 'ltr'}>{side('debit', tAccount.debitItems, debitCarried)}</div>
          </div>
          <div>
            <p className="border-b border-line py-2 text-center text-[12.5px] font-semibold text-ink-soft">{t('ledger.creditSide')}</p>
            <div dir={isRtl ? 'rtl' : 'ltr'}>{side('credit', tAccount.creditItems, creditCarried)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className={clsx('px-3 py-2', i === 0 && 'border-e-2 border-ink')}>
              <p className="num border-b-[3px] border-double border-ink pb-1 text-end text-[13.5px] font-semibold">{fmt(tAccount.footing)}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-line bg-subtle px-5 py-3 text-center text-[13.5px] font-semibold">
        {tAccount.balanceSide === null ? (
          <span className="text-muted">{t('ledger.zeroBalance')}</span>
        ) : (
          <span className="text-accent-strong">
            {t(tAccount.balanceSide === 'debit' ? 'ledger.debitBalanceOf' : 'ledger.creditBalanceOf', { amount: fmt(tAccount.balance) })}
          </span>
        )}
        {tAccount.balanceSide && tAccount.balanceSide !== section.account.normal_balance && (
          <span className="ms-2 text-[12px] font-normal text-warning">({t('ledger.abnormalBalance')})</span>
        )}
      </div>
    </Card>
  );
}

function LedgerTable({ section, accountsById }: { section: LedgerSection; accountsById: Map<string, Account> }) {
  const { t } = useTranslation();
  const { currency } = useCompany();
  const balance = useBalanceText();
  const s = section.statement;
  const fmt = (u: Units) => (u === 0n ? '' : formatUnits(u, { decimals: currency.decimals }));
  return (
    <Card className="overflow-hidden">
      <Table minWidth={960}>
        <THead>
          <tr>
            <Th>{t('ledger.transactionDate')}</Th>
            <Th>{t('journal.entryNumber')}</Th>
            <Th>{t('journal.voucherNumber')}</Th>
            {section.aggregated && <Th>{t('journal.account')}</Th>}
            <Th className="w-[34%]">{t('journal.description')}</Th>
            <Th numeric>{t('journal.debit')}</Th>
            <Th numeric>{t('journal.credit')}</Th>
            <Th numeric>{t('ledger.runningBalance')}</Th>
          </tr>
        </THead>
        <tbody>
          <tr className="bg-subtle/60 text-ink-soft">
            <Td colSpan={section.aggregated ? 7 : 6} className="font-medium">{t('ledger.openingBalance')}</Td>
            <Td numeric className="font-medium">{balance(s.openingNet)}</Td>
          </tr>
          {s.movements.map((m) => (
            <tr key={m.lineId} className="hover:bg-subtle">
              <Td className="num text-ink-soft">{formatDate(m.entryDate)}</Td>
              <Td>
                <Link to={`/journal/entries/${m.entryId}`} className="num font-medium text-accent hover:underline">{m.entryNumber}</Link>
              </Td>
              <Td className="num text-ink-soft">{m.voucherNumber ?? ''}</Td>
              {section.aggregated && <Td className="num text-ink-soft">{accountsById.get(m.accountId)?.code}</Td>}
              <Td><span className="line-clamp-2">{m.description}</span></Td>
              <Td numeric>{fmt(m.debit)}</Td>
              <Td numeric>{fmt(m.credit)}</Td>
              <Td numeric className="text-ink-soft">{balance(m.runningNet)}</Td>
            </tr>
          ))}
          {s.movements.length === 0 && (
            <tr><Td colSpan={8} className="py-8 text-center text-muted">{t('ledger.noMovements')}</Td></tr>
          )}
          <TotalsRow>
            <Td colSpan={section.aggregated ? 5 : 4}>{t('ledger.periodTotals')}</Td>
            <Td numeric>{formatUnits(s.periodDebit, { decimals: currency.decimals })}</Td>
            <Td numeric>{formatUnits(s.periodCredit, { decimals: currency.decimals })}</Td>
            <Td numeric>{balance(s.closingNet)}</Td>
          </TotalsRow>
        </tbody>
      </Table>
    </Card>
  );
}

export function LedgerPage() {
  const { t } = useTranslation();
  const { name } = useLanguage();
  const { currency, can } = useCompany();
  const identity = useReportIdentity();
  const { accounts, byId, isLoading } = useAccounts();
  const { fiscalYears } = useFiscalYears();
  const [params, setParams] = useSearchParams();
  const [report, setReport] = useState<'t' | 'gl' | null>(null);

  const today = todayIso();
  const defaultFrom = fiscalYearFor(fiscalYears, today)?.start_date ?? startOfYear(today);
  const selection: LedgerSelection = useMemo(
    () => ({
      mode: params.get('mode') === 'range' ? 'range' : 'single',
      accountId: params.get('account'),
      fromAccountId: params.get('fromAccount'),
      toAccountId: params.get('toAccount'),
      from: params.get('from') ?? defaultFrom,
      to: params.get('to') ?? today,
    }),
    [params, defaultFrom, today],
  );
  const view = params.get('view') === 'gl' ? 'gl' : 't';
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const ready = selection.mode === 'single' ? Boolean(selection.accountId) : Boolean(selection.fromAccountId && selection.toAccountId);
  const ledger = useLedger(accounts, selection, ready);
  const sections = ledger.data ?? [];
  const anyAccount = (a: Account) => a.is_active || a.is_posting;

  const counterLabel = (lng: 'en' | 'ar') => (accountId: string | null, count: number) => {
    if (count === 1 && accountId) {
      const a = byId.get(accountId);
      if (a) return lng === 'ar' ? a.name_ar : a.name_en;
    }
    return t('ledger.sundries', { lng });
  };

  const exportCsv = () => {
    const rows: Array<Array<string>> = [];
    for (const section of sections) {
      const s = section.statement;
      rows.push([section.account.code, name(section.account), '', '', t('ledger.openingBalance'), '', '', formatUnits(s.openingNet, { decimals: currency.decimals })]);
      for (const m of s.movements) {
        rows.push([section.account.code, name(section.account), formatDate(m.entryDate), m.entryNumber, m.description, formatUnits(m.debit, { decimals: currency.decimals }), formatUnits(m.credit, { decimals: currency.decimals }), formatUnits(m.runningNet, { decimals: currency.decimals })]);
      }
    }
    downloadCsv(`general-ledger-${selection.from}-${selection.to}`, [t('accounts.code'), t('accounts.name'), t('ledger.transactionDate'), t('journal.entryNumber'), t('journal.description'), t('journal.debit'), t('journal.credit'), t('ledger.runningBalanceSigned')], rows);
  };

  return (
    <>
      <RoomHeading number="02" roomKey="ledger" />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">{t('ledger.selection')}</span>
            <Segmented
              value={selection.mode}
              onChange={(mode) => update({ mode: mode === 'range' ? 'range' : null })}
              options={[
                { value: 'single', label: t('ledger.singleAccount') },
                { value: 'range', label: t('ledger.accountRange') },
              ]}
            />
          </div>
          {selection.mode === 'single' ? (
            <div className="flex min-w-[280px] flex-1 flex-col gap-1">
              <span className="text-[12px] text-muted">{t('journal.account')}</span>
              <AccountPicker accounts={accounts} filter={anyAccount} value={selection.accountId} onChange={(id) => update({ account: id })} placeholder={t('ledger.chooseAccount')} aria-label={t('journal.account')} />
            </div>
          ) : (
            <>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[12px] text-muted">{t('ledger.fromAccount')}</span>
                <AccountPicker accounts={accounts} value={selection.fromAccountId} onChange={(id) => update({ fromAccount: id })} aria-label={t('ledger.fromAccount')} />
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[12px] text-muted">{t('ledger.toAccount')}</span>
                <AccountPicker accounts={accounts} value={selection.toAccountId} onChange={(id) => update({ toAccount: id })} aria-label={t('ledger.toAccount')} />
              </div>
            </>
          )}
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.from')}
            <Input type="date" className="num w-[150px]" value={selection.from} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t('common.to')}
            <Input type="date" className="num w-[150px]" value={selection.to} onChange={(e) => update({ to: e.target.value })} />
          </label>
        </div>
      </Card>

      {!ready ? (
        <Card><EmptyState title={t('ledger.selectPrompt')} description={t('ledger.selectHint')} /></Card>
      ) : isLoading || ledger.isLoading ? (
        <PageLoader />
      ) : ledger.error ? (
        <Alert tone="danger">{errorMessage(ledger.error, t)}</Alert>
      ) : sections.length === 0 ? (
        <Card><EmptyState title={t('ledger.noAccountsInRange')} /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={view}
              onChange={(v) => update({ view: v === 'gl' ? 'gl' : null })}
              options={[
                { value: 't', label: t('ledger.tAccountView') },
                { value: 'gl', label: t('ledger.generalLedgerView') },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button icon={<FileSpreadsheet size={15} />} onClick={exportCsv}>{t('common.exportCsv')}</Button>
              {can('reports.export') && (
                <>
                  <Button icon={<FileDown size={15} />} onClick={() => setReport('t')}>{t('ledger.tAccountPdf')}</Button>
                  <Button icon={<FileDown size={15} />} onClick={() => setReport('gl')}>{t('ledger.ledgerPdf')}</Button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <section key={section.key} className="flex flex-col gap-3" aria-label={`${section.account.code} ${name(section.account)}`}>
                {sections.length > 1 && (
                  <h2 className="text-[14.5px] font-semibold">
                    <span className="num me-2 text-muted">{section.account.code}</span>
                    {name(section.account)}
                  </h2>
                )}
                <SummaryStrip section={section} />
                {view === 't' ? <TAccountView section={section} accountsById={byId} /> : <LedgerTable section={section} accountsById={byId} />}
              </section>
            ))}
          </div>
        </>
      )}

      <ReportDialog
        open={report !== null}
        onClose={() => setReport(null)}
        title={report === 't' ? t('pdf.tAccount.title') : t('pdf.ledger.title')}
        fileName={report === 't' ? 't-account' : 'ledger-statement'}
        defaultSignatures={identity.signatures}
        generate={async ({ language, signatures }) => {
          const pdf = await import('@/lib/pdf');
          const input = {
            context: pdf.reportContext(language, identity.company, identity.generatedBy),
            decimals: currency.decimals,
            currencyCode: currency.code,
            from: selection.from,
            to: selection.to,
            accounts: sections.map((s) => ({ code: s.account.code, name_en: s.account.name_en, name_ar: s.account.name_ar, aggregated: s.aggregated, statement: s.statement })),
            accountLabel: counterLabel(language),
            signatures,
          };
          return pdf.renderToBlob(report === 't' ? <pdf.TAccountReport {...input} /> : <pdf.LedgerStatementReport {...input} />);
        }}
      />
    </>
  );
}
