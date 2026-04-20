import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { findReportById } from './reportsConfig';

export default function ReportsPage() {
  const { reportId } = useParams();

  const selectedReport = useMemo(() => findReportById(reportId), [reportId]);

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
