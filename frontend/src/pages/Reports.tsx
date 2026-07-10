import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { findReportById } from './reportsConfig';
import MonthEndReport from './reports/MonthEndReport';
import CappersReport from './reports/CappersReport';
import ListingsLocationReport from './reports/ListingsLocationReport';
import AssociateReport from './reports/AssociateReport';
import TopDownAgentReport from './reports/TopDownAgentReport';

export default function ReportsPage() {
  const { reportId } = useParams();

  const selectedReport = useMemo(() => findReportById(reportId), [reportId]);

  if (selectedReport.type === 'native') {
    return (
      <div className="space-y-4">
        {selectedReport.id === 'month-end-report' && <MonthEndReport />}
        {(selectedReport.id === 'top-down-performance' || selectedReport.id === 'top-down-agent-native') && <TopDownAgentReport />}
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
