/**
 * Security tests: company isolation through RLS, role permissions, and
 * attempts to bypass the posting rules with direct API (table) access.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { accountId, asUser, createTestDatabase, createUser, expectDbError, header, line, rpc, type TestUser } from './helpers/db';

const j = (value: unknown) => JSON.stringify(value);

let db: PGlite;
let ownerA: TestUser;
let ownerB: TestUser;
let reviewerA: TestUser;
let viewerA: TestUser;
let outsider: TestUser;
let companyA: string;
let companyB: string;
let entryA: string;
let cashA: string;
let capitalA: string;

beforeAll(async () => {
  db = await createTestDatabase();
  ownerA = await createUser(db, 'Owner A');
  ownerB = await createUser(db, 'Owner B');
  reviewerA = await createUser(db, 'Reviewer A');
  viewerA = await createUser(db, 'Viewer A');
  outsider = await createUser(db, 'Outsider');

  companyA = await rpc<string>(db, ownerA, 'create_company', ['Company A', 'الشركة أ', 'IQD', '2026-01-01', true]);
  companyB = await rpc<string>(db, ownerB, 'create_company', ['Company B', 'الشركة ب', 'IQD', '2026-01-01', true]);
  await rpc(db, ownerA, 'add_company_member', [companyA, reviewerA.email, 'reviewer']);
  await rpc(db, ownerA, 'add_company_member', [companyA, viewerA.email, 'viewer']);

  cashA = await accountId(db, companyA, '1811');
  capitalA = await accountId(db, companyA, '211');
  entryA = await rpc<string>(db, ownerA, 'save_journal_entry', [
    companyA, null, j(header('2026-01-10', 'Capital A')), j([line(cashA, 500_000, 0), line(capitalA, 0, 500_000)]),
  ]);
  await rpc(db, ownerA, 'post_journal_entry', [entryA]);
});

describe('company isolation (RLS)', () => {
  it('members only see their own company data', async () => {
    const seenByB = await asUser(db, ownerB, (tx) => tx.query(`select id from journal_entries where company_id = $1`, [companyA]));
    expect(seenByB.rows).toHaveLength(0);
    const linesByB = await asUser(db, ownerB, (tx) => tx.query(`select id from journal_entry_lines where company_id = $1`, [companyA]));
    expect(linesByB.rows).toHaveLength(0);
    const accountsByB = await asUser(db, ownerB, (tx) => tx.query<{ company_id: string }>(`select distinct company_id from accounts`));
    expect(accountsByB.rows.map((r) => r.company_id)).toEqual([companyB]);
    const companiesByOutsider = await asUser(db, outsider, (tx) => tx.query(`select id from companies`));
    expect(companiesByOutsider.rows).toHaveLength(0);
  });

  it('reporting functions refuse other companies', async () => {
    await expectDbError(asUser(db, ownerB, (tx) => tx.query(`select * from account_balances($1, null, null, 'all')`, [companyA])), 'PERMISSION_DENIED');
    await expectDbError(asUser(db, ownerB, (tx) => tx.query(`select * from ledger_lines($1, $2, null, null)`, [companyA, [cashA]])), 'PERMISSION_DENIED');
    await expectDbError(rpc(db, ownerB, 'get_journal_entry', [entryA]), 'ENTRY_NOT_FOUND');
    await expectDbError(rpc(db, ownerB, 'dashboard_summary', [companyA, null]), 'PERMISSION_DENIED');
  });

  it('users cannot write into another company', async () => {
    await expectDbError(
      rpc(db, ownerB, 'save_journal_entry', [companyA, null, j(header('2026-01-11', 'Intrusion')), j([line(cashA, 1, 0), line(capitalA, 0, 1)])]),
      'PERMISSION_DENIED',
    );
    const cashB = await accountId(db, companyB, '1811');
    // Company B cannot reference company A accounts in its own entries either.
    await expectDbError(
      rpc(db, ownerB, 'save_journal_entry', [companyB, null, j(header('2026-01-11', 'Cross-company')), j([line(cashB, 1, 0), line(capitalA, 0, 1)])]),
      'ACCOUNT_NOT_FOUND',
    );
    await expectDbError(rpc(db, ownerB, 'reverse_journal_entry', [entryA, '2026-01-12', 'x']), 'ENTRY_NOT_FOUND');
  });

  it('anonymous requests see nothing and cannot call functions', async () => {
    await expectDbError(asUser(db, null, (tx) => tx.query(`select * from journal_entries`)), /permission denied/i);
    await expectDbError(rpc(db, null, 'dashboard_summary', [companyA, null]), /permission denied/i);
  });
});

describe('role permissions', () => {
  it('viewers and reviewers cannot create entries', async () => {
    for (const user of [viewerA, reviewerA]) {
      await expectDbError(
        rpc(db, user, 'save_journal_entry', [companyA, null, j(header('2026-01-12', 'x')), j([line(cashA, 1, 0), line(capitalA, 0, 1)])]),
        'PERMISSION_DENIED',
      );
    }
  });

  it('viewers cannot approve, post, reverse, manage accounts or users', async () => {
    await expectDbError(rpc(db, viewerA, 'post_journal_entry', [entryA]), 'PERMISSION_DENIED');
    await expectDbError(rpc(db, viewerA, 'approve_journal_entry', [entryA]), 'PERMISSION_DENIED');
    await expectDbError(rpc(db, viewerA, 'reverse_journal_entry', [entryA, null, 'x']), 'PERMISSION_DENIED');
    await expectDbError(rpc(db, viewerA, 'add_company_member', [companyA, outsider.email, 'admin']), 'PERMISSION_DENIED');
    await expectDbError(
      asUser(db, viewerA, (tx) => tx.query(
        `insert into accounts (company_id, code, name_en, name_ar, account_type, category_code, normal_balance) values ($1, '1199', 'X', 'س', 'asset', 'cash', 'debit')`,
        [companyA])),
      /row-level security|permission denied/i,
    );
    const updated = await asUser(db, viewerA, (tx) => tx.query(`update accounts set name_en = 'Hacked' where company_id = $1 returning id`, [companyA]));
    expect(updated.rows).toHaveLength(0);
  });

  it('audit log is visible to reviewers and admins, not viewers', async () => {
    const asViewer = await asUser(db, viewerA, (tx) => tx.query(`select id from audit_logs where company_id = $1`, [companyA]));
    expect(asViewer.rows).toHaveLength(0);
    const asReviewer = await asUser(db, reviewerA, (tx) => tx.query(`select id from audit_logs where company_id = $1`, [companyA]));
    expect(asReviewer.rows.length).toBeGreaterThan(0);
    await expectDbError(rpc(db, viewerA, 'search_audit_logs', [companyA, null, null, null, null, null, 10, 0]), 'PERMISSION_DENIED');
  });

  it('the last administrator cannot be removed or demoted', async () => {
    await expectDbError(rpc(db, ownerA, 'update_member_role', [companyA, ownerA.id, 'viewer']), 'LAST_ADMIN');
    await expectDbError(rpc(db, ownerA, 'remove_company_member', [companyA, ownerA.id]), 'LAST_ADMIN');
  });
});

describe('no bypass through direct table access', () => {
  it('cannot insert, update or delete journal entries directly', async () => {
    await expectDbError(
      asUser(db, ownerA, (tx) => tx.query(
        `insert into journal_entries (company_id, entry_number, entry_date, currency_code) values ($1, 'JE-HACK', '2026-01-01', 'IQD')`, [companyA])),
      /permission denied/i,
    );
    await expectDbError(
      asUser(db, ownerA, (tx) => tx.query(`update journal_entries set status = 'draft' where id = $1`, [entryA])),
      /permission denied/i,
    );
    await expectDbError(
      asUser(db, ownerA, (tx) => tx.query(`insert into journal_entry_lines (journal_entry_id, company_id, line_number, account_id, debit_amount) values ($1, $2, 9, $3, 1)`, [entryA, companyA, cashA])),
      /permission denied/i,
    );
    await expectDbError(asUser(db, ownerA, (tx) => tx.query(`delete from journal_entries where id = $1`, [entryA])), /permission denied/i);
    await expectDbError(asUser(db, ownerA, (tx) => tx.query(`update vouchers set status = 'posted'`)), /permission denied/i);
    await expectDbError(asUser(db, ownerA, (tx) => tx.query(`insert into audit_logs (company_id, entity_type, action) values ($1, 'x', 'x')`, [companyA])), /permission denied/i);
  });

  it('cannot call internal helper functions', async () => {
    await expectDbError(rpc(db, ownerA, '_post_entry', [entryA, true]), /permission denied/i);
    await expectDbError(rpc(db, ownerA, '_next_document_number', [companyA, 'JE', '2026-01-01']), /permission denied/i);
  });

  it('cannot escalate own role or move into another company', async () => {
    await expectDbError(asUser(db, viewerA, (tx) => tx.query(`update user_roles set role = 'admin' where user_id = $1`, [viewerA.id])), /permission denied/i);
    await expectDbError(
      asUser(db, outsider, (tx) => tx.query(`insert into user_roles (company_id, user_id, role) values ($1, $2, 'admin')`, [companyA, outsider.id])),
      /permission denied/i,
    );
  });

  it('cannot change the company base currency or approval policy without permission', async () => {
    const r = await asUser(db, viewerA, (tx) => tx.query(`update company_settings set require_approval = false where company_id = $1 returning company_id`, [companyA]));
    expect(r.rows).toHaveLength(0);
    await expectDbError(asUser(db, ownerA, (tx) => tx.query(`update companies set base_currency = 'USD' where id = $1`, [companyA])), /permission denied/i);
  });
});

describe('attachment storage policies', () => {
  it('only members with permission can upload into their company folder', async () => {
    await asUser(db, ownerA, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${companyA}/journal_entry/${entryA}/invoice.pdf`]));
    await expectDbError(
      asUser(db, ownerB, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${companyA}/journal_entry/${entryA}/evil.pdf`])),
      /row-level security/i,
    );
    await expectDbError(
      asUser(db, viewerA, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${companyA}/journal_entry/${entryA}/v.pdf`])),
      /row-level security/i,
    );
    const visibleToB = await asUser(db, ownerB, (tx) => tx.query(`select name from storage.objects`));
    expect(visibleToB.rows).toHaveLength(0);
    const visibleToViewer = await asUser(db, viewerA, (tx) => tx.query(`select name from storage.objects`));
    expect(visibleToViewer.rows).toHaveLength(1);
  });

  it('attachments of posted entries cannot be removed', async () => {
    const path = `${companyA}/journal_entry/${entryA}/invoice.pdf`;
    const attachmentId = await rpc<string>(db, ownerA, 'register_attachment', [companyA, 'journal_entry', entryA, 'invoice.pdf', path, 'application/pdf', 1024]);
    await expectDbError(rpc(db, ownerA, 'delete_attachment', [attachmentId]), 'ATTACHMENT_LOCKED');
    const deleted = await asUser(db, ownerA, (tx) => tx.query(`delete from storage.objects where name = $1 returning name`, [path]));
    expect(deleted.rows).toHaveLength(0);
    await expectDbError(
      rpc(db, ownerA, 'register_attachment', [companyA, 'journal_entry', entryA, 'x.pdf', `${companyB}/x.pdf`, 'application/pdf', 1]),
      'ATTACHMENT_PATH_INVALID',
    );
  });
});
