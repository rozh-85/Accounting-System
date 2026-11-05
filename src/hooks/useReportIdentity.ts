import { useAuth } from '@/app/providers/AuthProvider';
import { useCompany } from '@/app/providers/WorkspaceProvider';
import type { ReportCompany } from '@/lib/pdf/primitives';

/** Company letterhead and the current user's name for generated reports. */
export function useReportIdentity(): { company: ReportCompany; generatedBy: string | null; signatures: boolean } {
  const { company, profile, settings } = useCompany();
  const { user } = useAuth();
  return {
    company: {
      name_en: company.name_en,
      name_ar: company.name_ar,
      address_en: company.address_en,
      address_ar: company.address_ar,
      tax_number: company.tax_number,
      phone: company.phone,
      email: company.email,
    },
    generatedBy: profile?.full_name || user?.email || null,
    signatures: settings?.report_show_signatures ?? true,
  };
}
