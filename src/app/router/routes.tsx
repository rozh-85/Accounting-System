import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { useWorkspace, WorkspaceProvider } from '@/app/providers/WorkspaceProvider';
import { AppLayout } from '@/app/layouts/AppLayout';
import { Alert } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { errorMessage } from '@/lib/supabase/errors';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignUpPage } from '@/features/authentication/AuthPages';
import { AccountsPage } from '@/features/chart-of-accounts/AccountsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { FinancialPositionPage } from '@/features/financial-position/FinancialPositionPage';
import { EntriesListPage } from '@/features/journal/EntriesListPage';
import { EntryDetailPage } from '@/features/journal/EntryDetailPage';
import { EntryFormPage } from '@/features/journal/EntryFormPage';
import { JournalRoomLayout } from '@/features/journal/JournalRoomLayout';
import { LedgerPage } from '@/features/ledger/LedgerPage';
import { CreateCompanyPage } from '@/features/onboarding/CreateCompanyPage';
import { PeriodsPage } from '@/features/periods/PeriodsPage';
import { RecurringPage } from '@/features/recurring/RecurringPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TrialBalancePage } from '@/features/trial-balance/TrialBalancePage';
import { VoucherDetailPage } from '@/features/vouchers/VoucherDetailPage';
import { VoucherFormPage } from '@/features/vouchers/VoucherFormPage';
import { VouchersListPage } from '@/features/vouchers/VouchersListPage';

function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  );
}

/** Ensures the user belongs to at least one company before showing the app. */
function RequireCompany() {
  const { t } = useTranslation();
  const { company, loading, error } = useWorkspace();
  if (loading) return <PageLoader />;
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert tone="danger" title={t('errors.loadFailed')}>{errorMessage(error, t)}</Alert>
      </div>
    );
  }
  if (!company) return <Navigate to="/onboarding" replace />;
  return <AppLayout />;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="num text-[13px] text-faint">404</p>
      <h1 className="mt-2 text-[18px] font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="mt-1 text-[13px] text-muted">{t('errors.notFoundBody')}</p>
      <ButtonLink to="/" className="mt-5" variant="primary">{t('nav.overview')}</ButtonLink>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <CreateCompanyPage /> },
      {
        element: <RequireCompany />,
        children: [
          { path: '/', element: <DashboardPage /> },
          {
            path: '/journal',
            element: <JournalRoomLayout />,
            children: [
              { index: true, element: <EntriesListPage /> },
              { path: 'vouchers', element: <VouchersListPage /> },
              { path: 'recurring', element: <RecurringPage /> },
            ],
          },
          { path: '/journal/entries/new', element: <EntryFormPage /> },
          { path: '/journal/entries/:id', element: <EntryDetailPage /> },
          { path: '/journal/entries/:id/edit', element: <EntryFormPage /> },
          { path: '/journal/vouchers/new', element: <VoucherFormPage /> },
          { path: '/journal/vouchers/:id', element: <VoucherDetailPage /> },
          { path: '/journal/vouchers/:id/edit', element: <VoucherFormPage /> },
          { path: '/ledger', element: <LedgerPage /> },
          { path: '/trial-balance', element: <TrialBalancePage /> },
          { path: '/financial-position', element: <FinancialPositionPage /> },
          { path: '/accounts', element: <AccountsPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/periods', element: <PeriodsPage /> },
          { path: '/audit', element: <AuditLogPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
