import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPeriodName } from '@/lib/formatting';
import { useLanguage } from './useLanguage';
import { useFiscalYears, usePeriods } from './useReferenceData';

export interface PeriodOption {
  value: string;
  label: string;
  from: string;
  to: string;
}

/** Fiscal years, each followed by its periods, for the period select of a report. */
export function usePeriodOptions(): PeriodOption[] {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { fiscalYears } = useFiscalYears();
  const { periods } = usePeriods();
  return useMemo(
    () =>
      fiscalYears.flatMap((fy) => [
        { value: `fy:${fy.id}`, label: `${t('trialBalance.fiscalYear')} ${fy.name}`, from: fy.start_date, to: fy.end_date },
        ...periods
          .filter((p) => p.fiscal_year_id === fy.id)
          .map((p) => ({ value: `p:${p.id}`, label: `— ${formatPeriodName(p.name, language)}`, from: p.start_date, to: p.end_date })),
      ]),
    [fiscalYears, periods, language, t],
  );
}
