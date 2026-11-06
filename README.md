# Vio Accounting — نظام فيو المحاسبي

A bilingual (English / Arabic, full RTL) double-entry accounting system built with **React, TypeScript, Vite and Supabase**.
All four rooms read and write one ledger in one PostgreSQL database; every report is generated from posted journal lines.

| Room | English | العربية |
|---|---|---|
| 01 | Daily Journal (entries, vouchers, recurring entries) | القيود اليومية |
| 02 | T-Accounts & General Ledger | حسابات الأستاذ / دفتر الأستاذ |
| 03 | Trial Balance | ميزان المراجعة |
| 04 | Statement of Financial Position | قائمة المركز المالي |

Supporting modules: Chart of Accounts (دليل الحسابات), Accounting Periods, Reports, Audit Log, Settings (company, accounting controls, users and roles).

---

## Features

**Journal (Room 1)**
- Simple entries (من حـ / إلى حـ) and compound entries with unlimited debit and credit lines.
- Entry types: standard, opening, adjusting, closing, reversing, recurring.
- Workflow: Draft → Pending approval → Posted → Reversed, with a configurable approval policy and no self-approval.
- Live balance indicator; posting is disabled until debits equal credits.
- Formal journal presentation — Arabic uses مدين / دائن columns first with “من حـ/ … / إلى حـ/ …” (and “من مذكورين / إلى مذكورين” for compound entries).
- Reversal creates a new posted entry with swapped sides; the original is preserved and linked.
- Receipt, payment, journal and transfer vouchers; posting a voucher creates its balanced journal entry exactly once.
- Recurring templates generate real, dated draft entries.
- Attachments in a private Supabase Storage bucket; search, filters, pagination, CSV export, PDF report.

**Ledger (Room 2)** — T-account (debit always left, credit always right, balance c/d and b/d) and detailed general ledger with running balance, opening/closing balances, parent-account aggregation, account ranges and drill-down to entries.

**Trial Balance (Room 3)** — opening / movement / closing debit and credit columns; unadjusted, adjusted and post-closing modes; detailed or summary (by level); zero-balance toggle; exact differences when out of balance; drill-down to the ledger.

**Financial Position (Room 4)** — assets, liabilities and equity as of any date from the chart's classifications; contra accounts shown in brackets; current-period profit or loss and unclosed prior results in equity without double counting closed income; comparative column; Assets = Liabilities + Equity check.

**PDF reporting engine** — A4 portrait/landscape reports in Arabic or English with embedded IBM Plex fonts (proper Arabic shaping and RTL), company letterhead, repeated table headers, page numbers, timestamps and optional signature fields: daily journal, journal entry, vouchers (with amount in words), voucher register, ledger statement, T-account, trial balance and statement of financial position.

**Demo data** — the top-bar switch opens a separate demo company with a year of sample transactions, and switching it off deletes that company. Sample data never enters a real company; `delete_demo_company` refuses any company not flagged `is_demo`.

---

## How integrity is enforced

Accounting rules live in the database, not only in the browser:

- **Trusted functions.** Every state change (save, submit, approve, post, reject, reverse, delete draft, vouchers, periods, recurring generation, members) is a `SECURITY DEFINER` PostgreSQL function that checks the caller's permission, takes row locks and validates the entry inside one transaction. Authenticated users have **no** insert/update/delete privilege on journal, voucher or audit tables, so validation cannot be bypassed through the API.
- **Triggers as a second line of defence.** Posted and reversed entries (and their lines) cannot be updated or deleted by anyone, entries cannot be inserted as posted, posting re-checks that debits equal credits, and the audit log is append-only.
- **Posting rules.** At least one debit and one credit line; debit total = credit total > 0; each line is either debit or credit, never both, never negative; only active posting accounts of the same company; amounts respect the currency's precision; the date must fall in an open period of an open fiscal year.
- **No double posting.** `journal_entries.voucher_id` is unique and vouchers are locked while posting.
- **Money** is stored as `NUMERIC(20,4)` and computed in the browser with exact `bigint` arithmetic (`src/lib/accounting/money.ts`).
- **One set of formulas.** Trial balance, ledger, T-account and statement calculations live in `src/lib/accounting` and are used by both the screens and the PDF reports.
- **Row Level Security** isolates companies; every table is readable only by members of its company.

### Roles

| Permission | Admin | Accountant | Reviewer | Viewer |
|---|:-:|:-:|:-:|:-:|
| Create entries / vouchers, edit drafts, submit | ● | ● | | |
| Approve | ● | | ● | |
| Post directly | ● | ● (when approval is not required) | ● | |
| Reverse posted entries | ● | | ● | |
| Manage chart of accounts | ● | ● | | |
| Export reports | ● | ● | ● | ● |
| View audit log | ● | | ● | |
| Manage users, periods, settings | ● | | | |

---

## Project structure

```
src/
  app/            router, providers (auth, workspace), layouts
  features/       dashboard, journal, vouchers, recurring, ledger, trial-balance,
                  financial-position, chart-of-accounts, periods, reports,
                  settings, audit, authentication, onboarding
  components/     ui (buttons, fields, dialogs, tabs…), tables, forms, layout
  lib/
    accounting/   money, journal validation, ledger, T-account, trial balance,
                  financial position, amount in words (+ unit tests)
    pdf/          report engine, fonts, report templates (+ PDF tests)
    supabase/     client, RPC helper, error mapping
    formatting/   dates (dd/MM/yyyy), periods, amounts
  i18n/           en / ar dictionaries (+ completeness tests)
supabase/
  migrations/     schema, security and integrity, workflow, reporting, storage and grants
  tests/          database tests (PGlite) for accounting rules, RLS and permissions
public/
  brand/          Vio logo variants
  fonts/pdf/      IBM Plex Sans / Sans Arabic (SIL OFL) embedded in PDFs
```

---

## Getting started

### Prerequisites
- Node.js 20.19+ (tested with Node 24)
- Either the Supabase CLI with Docker (local development) or a Supabase project

### 1. Install
```bash
npm install
```

### 2. Database

**Local (Supabase CLI + Docker)**
```bash
npx supabase start
npx supabase db reset
```
`db reset` applies everything in `supabase/migrations`. Copy the printed `API URL` and `anon key` into `.env.local`.

**Hosted Supabase project**
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
Then in the Supabase dashboard → Authentication → URL configuration, set the Site URL to your app URL (for development `http://localhost:5173`) and add it to the redirect URLs.

### 3. Environment
Copy `.env.example` to `.env.local`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
Only the public anon key belongs in the browser. Never put the service-role key in this file or in frontend code.

### 4. Run
```bash
npm run dev
```
Open http://localhost:5173, create an account, then **Create company**. This creates the company, makes you its administrator, opens a fiscal year with twelve monthly periods and installs a standard bilingual chart of accounts (1000 Assets … 5900 Other Expenses). Invite colleagues after they sign up from **Settings → Users and roles**.

---

## Tests

```bash
npm test            # everything
npm run test:unit   # accounting domain, i18n, PDF generation
npm run test:db     # database rules, RLS and permissions on PGlite
```

- **Database tests** run the real migrations on PGlite (PostgreSQL in WebAssembly) with a small shim for Supabase `auth` and `storage`, and execute calls as the `authenticated` role, so RLS, grants and functions are exercised as in production. They cover posting balanced, unbalanced and compound entries, all four voucher types, double-posting prevention, drafts not affecting balances, reversals, closed periods, approval workflow and self-approval, company isolation, direct-table bypass attempts, the audit trail, trial balance agreement, Assets = Liabilities + Equity and year-end closing.
- **PDF tests** generate every report in Arabic and English with long, mixed-language descriptions and multi-page tables into `test-output/pdf/` for inspection.

---

## Deployment

### Supabase (hosted) + Vercel — quick path
1. **Database:** Supabase Dashboard → SQL Editor → New query → paste the whole of [`supabase/setup.sql`](supabase/setup.sql) → Run (once, on a fresh project). It contains every migration in order; regenerate it with `npm run db:setup-sql` after changing migrations.
2. **Auth URLs:** Authentication → URL Configuration → set *Site URL* to your Vercel URL and add `https://<your-app>.vercel.app/**` to *Redirect URLs*.
3. **Vercel:** import the GitHub repository; `vercel.json` sets the Vite build, `dist` output and SPA rewrites. The public Supabase URL and publishable key ship in `.env.production`; project environment variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` override them if set.

### Updating an existing database
Run new files from `supabase/migrations` in order in the SQL Editor; `setup.sql` is only for a fresh project. `20261106000100_demo_company.sql` adds the demo data switch.

### General

```bash
npm run build
```
Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, Nginx) with a single-page-app fallback to `index.html` (`vercel.json` and `public/_redirects` are included). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's build environment, apply the migrations to the production database with `npx supabase db push`, and add the production URL to Supabase Auth's redirect URLs.

When adding new database functions in later migrations, revoke `EXECUTE` from `anon` (and from `authenticated` for internal `_`-prefixed helpers) as done in `20261105000500_storage_and_grants.sql`.

---

## Notes

- Dates display as `dd/MM/yyyy` everywhere. Slashes keep dates in order inside Arabic text; hyphenated digits after Arabic letters are reordered by the Unicode bidi algorithm.
- All entries are recorded in the company's base currency (IQD has no decimals by default). The schema keeps `currency_code` and `exchange_rate` for future multi-currency support.
- A balanced trial balance does not prove that every entry is correct — review remains essential.
- Fonts: IBM Plex Sans and IBM Plex Sans Arabic (SIL Open Font License), Inter (UI).
