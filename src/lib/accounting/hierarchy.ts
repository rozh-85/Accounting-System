import type { Account } from './types';

export interface AccountNode {
  account: Account;
  children: AccountNode[];
  depth: number;
}

export function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** Builds a code-ordered tree. Accounts whose parent is missing become roots. */
export function buildAccountTree(accounts: readonly Account[]): AccountNode[] {
  const byId = new Map<string, AccountNode>();
  for (const account of accounts) byId.set(account.id, { account, children: [], depth: 0 });

  const roots: AccountNode[] = [];
  for (const node of byId.values()) {
    const parent = node.account.parent_id ? byId.get(node.account.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortAndDepth = (nodes: AccountNode[], depth: number) => {
    nodes.sort((x, y) => compareCodes(x.account.code, y.account.code));
    for (const node of nodes) {
      node.depth = depth;
      sortAndDepth(node.children, depth + 1);
    }
  };
  sortAndDepth(roots, 0);
  return roots;
}

/** Depth-first (pre-order) flattening of the tree. */
export function flattenTree(nodes: readonly AccountNode[]): AccountNode[] {
  const out: AccountNode[] = [];
  const walk = (list: readonly AccountNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Returns the ids of the account and all of its descendants. */
export function descendantIds(accounts: readonly Account[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const account of accounts) {
    if (!account.parent_id) continue;
    const list = childrenOf.get(account.parent_id) ?? [];
    list.push(account.id);
    childrenOf.set(account.parent_id, list);
  }
  const result = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of childrenOf.get(id) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

/** Posting (leaf) accounts under an account, or the account itself if it posts. */
export function postingAccountsUnder(accounts: readonly Account[], rootId: string): Account[] {
  const ids = descendantIds(accounts, rootId);
  return accounts
    .filter((a) => ids.has(a.id) && a.is_posting)
    .sort((a, b) => compareCodes(a.code, b.code));
}

/** Posting accounts whose code falls within an inclusive code range. */
export function postingAccountsInRange(accounts: readonly Account[], fromCode: string, toCode: string): Account[] {
  const [low, high] = compareCodes(fromCode, toCode) <= 0 ? [fromCode, toCode] : [toCode, fromCode];
  return accounts
    .filter((a) => a.is_posting && compareCodes(a.code, low) >= 0 && compareCodes(a.code, high) <= 0)
    .sort((a, b) => compareCodes(a.code, b.code));
}

export function accountName(account: { name_en: string; name_ar: string }, language: 'en' | 'ar'): string {
  return language === 'ar' ? account.name_ar : account.name_en;
}
