import { closingNet, openingNet, ZERO_SUMS } from './balances';
import { compareCodes } from './hierarchy';
import { sumUnits, type Units } from './money';
import type { Account, AccountCategory, AccountSums, StatementSection } from './types';

/**
 * Inputs for one statement column. `sums` must come from
 * account_balances(company, fiscalYearStart, asOfDate): opening columns hold
 * everything before the fiscal year, period columns the fiscal year to date.
 * When no fiscal year applies, pass sums with everything in the period columns.
 */
export interface StatementColumnInput {
  sums: ReadonlyMap<string, AccountSums>;
}

export type BalanceSheetSection = Exclude<StatementSection, 'revenue' | 'expenses'>;

export interface FPLine {
  key: string;
  kind: 'account' | 'prior_unclosed' | 'current_profit';
  account: Account | null;
  amount: Units;
  comparative: Units | null;
}

export interface FPGroup {
  key: string;
  category: AccountCategory;
  lines: FPLine[];
  total: Units;
  comparativeTotal: Units | null;
}

export interface FPSection {
  key: BalanceSheetSection;
  groups: FPGroup[];
  /** Equity only: unclosed results of prior years and profit/loss of the current period. */
  resultLines: FPLine[];
  total: Units;
  comparativeTotal: Units | null;
}

export interface FPTotals {
  totalAssets: Units;
  totalLiabilities: Units;
  totalEquity: Units;
  liabilitiesAndEquity: Units;
  /** Assets minus (liabilities + equity); zero when the statement balances. */
  difference: Units;
  currentProfit: Units;
  priorUnclosed: Units;
}

export interface FinancialPosition {
  sections: Record<BalanceSheetSection, FPSection>;
  totals: FPTotals;
  comparativeTotals: FPTotals | null;
  isBalanced: boolean;
  comparativeIsBalanced: boolean | null;
}

const SECTION_ORDER: BalanceSheetSection[] = [
  'current_assets',
  'non_current_assets',
  'current_liabilities',
  'non_current_liabilities',
  'equity',
];

function isAssetSection(section: BalanceSheetSection) {
  return section === 'current_assets' || section === 'non_current_assets';
}

/** Statement amount for an account: assets debit-positive, liabilities and equity credit-positive. */
function statementAmount(section: BalanceSheetSection, sums: AccountSums): Units {
  const net = closingNet(sums);
  return isAssetSection(section) ? net : -net;
}

function incomeSplit(accounts: readonly Account[], sums: ReadonlyMap<string, AccountSums>) {
  let prior = 0n;
  let current = 0n;
  for (const account of accounts) {
    if (account.account_type !== 'revenue' && account.account_type !== 'expense') continue;
    if (!account.is_posting) continue;
    const s = sums.get(account.id) ?? ZERO_SUMS;
    // Income is credit-positive: revenue increases it, expenses reduce it.
    prior += -openingNet(s);
    current += s.periodCredit - s.periodDebit;
  }
  return { prior, current };
}

function totalsFor(sections: Record<BalanceSheetSection, FPSection>, pick: 'total' | 'comparativeTotal', profit: { prior: Units; current: Units }): FPTotals {
  const value = (s: FPSection) => (pick === 'total' ? s.total : (s.comparativeTotal ?? 0n));
  const totalAssets = value(sections.current_assets) + value(sections.non_current_assets);
  const totalLiabilities = value(sections.current_liabilities) + value(sections.non_current_liabilities);
  const totalEquity = value(sections.equity);
  const liabilitiesAndEquity = totalLiabilities + totalEquity;
  return {
    totalAssets,
    totalLiabilities,
    totalEquity,
    liabilitiesAndEquity,
    difference: totalAssets - liabilitiesAndEquity,
    currentProfit: profit.current,
    priorUnclosed: profit.prior,
  };
}

/**
 * Builds the statement of financial position from the chart of accounts and
 * posted ledger sums. Revenue and expense accounts never appear as balance
 * sheet lines; their net effect is shown inside equity as the profit or loss
 * of the current fiscal period and any unclosed results of prior periods.
 * Contra accounts (e.g. accumulated depreciation, drawings) reduce their
 * section because amounts are signed by section, not by normal balance.
 */
export function buildFinancialPosition(
  accounts: readonly Account[],
  categories: readonly AccountCategory[],
  current: StatementColumnInput,
  comparative?: StatementColumnInput | null,
  options: { includeZero?: boolean } = {},
): FinancialPosition {
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));
  const sections = {} as Record<BalanceSheetSection, FPSection>;
  for (const key of SECTION_ORDER) {
    sections[key] = { key, groups: [], resultLines: [], total: 0n, comparativeTotal: comparative ? 0n : null };
  }

  const groups = new Map<string, FPGroup>();
  const postingAccounts = accounts
    .filter((a) => a.is_posting && a.category_code)
    .sort((a, b) => compareCodes(a.code, b.code));

  for (const account of postingAccounts) {
    const category = categoryByCode.get(account.category_code!);
    if (!category) continue;
    const section = category.statement_section;
    if (section === 'revenue' || section === 'expenses') continue;

    const amount = statementAmount(section, current.sums.get(account.id) ?? ZERO_SUMS);
    const comparativeAmount = comparative ? statementAmount(section, comparative.sums.get(account.id) ?? ZERO_SUMS) : null;
    if (!options.includeZero && amount === 0n && (comparativeAmount === null || comparativeAmount === 0n)) continue;

    let group = groups.get(category.code);
    if (!group) {
      group = { key: category.code, category, lines: [], total: 0n, comparativeTotal: comparative ? 0n : null };
      groups.set(category.code, group);
      sections[section].groups.push(group);
    }
    group.lines.push({ key: account.id, kind: 'account', account, amount, comparative: comparativeAmount });
  }

  for (const section of Object.values(sections)) {
    section.groups.sort((a, b) => a.category.sort_order - b.category.sort_order);
    for (const group of section.groups) {
      group.total = sumUnits(group.lines.map((l) => l.amount));
      if (comparative) group.comparativeTotal = sumUnits(group.lines.map((l) => l.comparative ?? 0n));
    }
  }

  const profit = incomeSplit(accounts, current.sums);
  const comparativeProfit = comparative ? incomeSplit(accounts, comparative.sums) : null;

  const equity = sections.equity;
  if (profit.prior !== 0n || (comparativeProfit && comparativeProfit.prior !== 0n)) {
    equity.resultLines.push({
      key: 'prior_unclosed',
      kind: 'prior_unclosed',
      account: null,
      amount: profit.prior,
      comparative: comparativeProfit ? comparativeProfit.prior : null,
    });
  }
  equity.resultLines.push({
    key: 'current_profit',
    kind: 'current_profit',
    account: null,
    amount: profit.current,
    comparative: comparativeProfit ? comparativeProfit.current : null,
  });

  for (const section of Object.values(sections)) {
    section.total = sumUnits(section.groups.map((g) => g.total)) + sumUnits(section.resultLines.map((l) => l.amount));
    if (comparative) {
      section.comparativeTotal =
        sumUnits(section.groups.map((g) => g.comparativeTotal ?? 0n)) +
        sumUnits(section.resultLines.map((l) => l.comparative ?? 0n));
    }
  }

  const totals = totalsFor(sections, 'total', profit);
  const comparativeTotals = comparative && comparativeProfit ? totalsFor(sections, 'comparativeTotal', comparativeProfit) : null;

  return {
    sections,
    totals,
    comparativeTotals,
    isBalanced: totals.difference === 0n,
    comparativeIsBalanced: comparativeTotals ? comparativeTotals.difference === 0n : null,
  };
}

export const BALANCE_SHEET_SECTIONS = SECTION_ORDER;
