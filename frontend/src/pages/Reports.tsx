import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { findReportById, getAccessibleReports } from './reportsConfig';
import MonthEndReport from './reports/MonthEndReport';
import CappersReport from './reports/CappersReport';
import ListingsLocationReport from './reports/ListingsLocationReport';
import AssociateReport from './reports/AssociateReport';
import TopDownAgentReport from './reports/TopDownAgentReport';
import { useAuth } from '../contexts/AuthContext';
import { ReportState } from './reports/ReportUi';

export default function ReportsPage() {
  const { isOfficeAdmin, isRegionalAdmin, isAgent } = useAuth();
  const { reportId } = useParams();
  const accessibleReports = useMemo(
    () => getAccessibleReports({ isOfficeAdmin, isRegionalAdmin, isAgent }),
    [isOfficeAdmin, isRegionalAdmin, isAgent]
  );
  const canAccessReports = accessibleReports.length > 0;

  const selectedReport = useMemo(() => findReportById(reportId), [reportId]);

  if (!canAccessReports) {
    return (
      <section className="surface-card p-5">
        <h1 className="page-title">Reports</h1>
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50">
          <ReportState type="error" message="You do not have permission to access operational reports in this role." />
        </div>
      </section>
    );
  }

  if (selectedReport.type === 'native') {
    return (
      <div className="space-y-4">
        {selectedReport.id === 'month-end-report' && <MonthEndReport />}
        {selectedReport.id === 'top-down-performance' && <TopDownAgentReport />}
        {selectedReport.id === 'associate-report' && <AssociateReport />}
        {selectedReport.id === 'cappers-report' && <CappersReport />}
        {selectedReport.id === 'listings-location-report' && <ListingsLocationReport />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="surface-card p-3 md:p-4">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="mt-1 text-sm text-slate-600">{selectedReport.title}</p>
        </div>
      </div>

      <section className="surface-card overflow-hidden">
        <iframe
          title={selectedReport.title}
          src={selectedReport.embedUrl}
          className="h-[calc(100vh-180px)] min-h-[740px] w-full"
          allowFullScreen
        />
      </section>
    </div>
  );
}
