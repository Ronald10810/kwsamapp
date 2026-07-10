import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

interface CmaHistoryItem {
  id: number;
  property_address: string | null;
  seller_name: string | null;
  loom_file_url: string | null;
  loom_original_name: string | null;
  file_name: string;
  file_url: string;
  created_at: string;
}

interface MarketingHistoryItem {
  id: number;
  property_address: string | null;
  seller_name: string | null;
  file_name: string;
  file_url: string;
  created_at: string;
}

// ---- Icon Helper ------------------------------------------------------------------

function UiIcon({
  kind,
  className = 'h-4 w-4',
}: {
  kind: 'file-pdf' | 'document' | 'download' | 'folder' | 'calendar';
  className?: string;
}) {
  if (kind === 'file-pdf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 2v7h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor" dominantBaseline="middle">PDF</text>
      </svg>
    );
  }
  if (kind === 'document') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 2v7h7M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'download') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 2v12m5-5-5 5-5-5M2 20h20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2H12L9.41 4.59C9.05 4.23 8.55 4 8 4H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M8 3v4M16 3v4M4 9h16M5 5h14c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AIToolsHistoryPage() {
  const { token, activeContext } = useAuth();

  const authHeaders = {
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  };

  const { data: cmaHistory, isLoading: cmaLoading } = useQuery({
    queryKey: ['ai-tools-history-cma', token],
    queryFn: async () => {
      const res = await fetch('/api/cma/history', { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load CMA history.');
      return (await res.json() as { items: CmaHistoryItem[] }).items;
    },
    enabled: Boolean(token),
  });

  const { data: marketingHistory, isLoading: marketingLoading } = useQuery({
    queryKey: ['ai-tools-history-marketing', token],
    queryFn: async () => {
      const res = await fetch('/api/marketing/history', { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load marketing history.');
      return (await res.json() as { items: MarketingHistoryItem[] }).items;
    },
    enabled: Boolean(token),
  });

  const loomHistory = (cmaHistory ?? []).filter((item) => Boolean(item.loom_file_url));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Document Library</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          All your LOOM reports, CMA documents, and Marketing Plans in one organized place. Download any file anytime.
        </p>
      </div>

      <HistoryTableCard
        icon={<UiIcon kind="file-pdf" className="h-5 w-5" />}
        title="LOOM Reports"
        count={loomHistory.length}
        loading={cmaLoading}
        emptyMessage="No LOOM reports uploaded yet. They'll appear here when you generate CMAs."
        headers={['Property', 'Seller', 'Uploaded', 'Download']}
        rows={loomHistory.map((item) => ({
          id: `loom-${item.id}`,
          property: item.property_address ?? 'Property name not available',
          seller: item.seller_name ?? 'N/A',
          generated: formatDate(item.created_at),
          fileName: item.loom_original_name ?? 'LOOM_Report.pdf',
          fileUrl: item.loom_file_url ?? '#',
        }))}
      />

      <HistoryTableCard
        icon={<UiIcon kind="document" className="h-5 w-5" />}
        title="CMA Documents"
        count={cmaHistory?.length ?? 0}
        loading={cmaLoading}
        emptyMessage="No CMA documents generated yet. Start creating CMAs to build your library."
        headers={['Property', 'Seller', 'Generated', 'Download']}
        rows={(cmaHistory ?? []).map((item) => ({
          id: `cma-${item.id}`,
          property: item.property_address ?? '-',
          seller: item.seller_name ?? '-',
          generated: formatDate(item.created_at),
          fileName: item.file_name,
          fileUrl: item.file_url,
          source: item.seller_name ?? '-',
        }))}
      />

      <HistoryTableCard
        icon={<UiIcon kind="document" className="h-5 w-5" />}
        title="Marketing Plans"
        count={marketingHistory?.length ?? 0}
        loading={marketingLoading}
        emptyMessage="No Marketing Plans generated yet. Generate Marketing Plans based on your CMAs."
        headers={['Property', 'Seller', 'Generated', 'Download']}
        rows={(marketingHistory ?? []).map((item) => ({
          id: `marketing-${item.id}`,
          property: item.property_address ?? '-',
          seller: item.seller_name ?? '-',
          generated: formatDate(item.created_at),
          fileName: item.file_name,
          fileUrl: item.file_url,
          source: item.seller_name ?? '-',
        }))}
      />
    </div>
  );
}

function HistoryTableCard({
  icon,
  title,
  count,
  loading,
  emptyMessage,
  headers,
  rows,
}: {
  icon?: React.ReactNode;
  title: string;
  count: number;
  loading: boolean;
  emptyMessage: string;
  headers: [string, string, string, string];
  rows: Array<{
    id: string;
    property: string;
    seller: string;
    generated: string;
    fileName: string;
    fileUrl: string;
  }>;
}) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center gap-3">
          {icon && <div style={{ color: 'var(--brand)' }}>{icon}</div>}
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        </div>
        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
          {count} {count === 1 ? 'file' : 'files'}
        </span>
      </div>

      {loading && (
        <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {!loading && rows.length === 0 && (
        <div className="px-5 py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{emptyMessage}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-strong)' }}>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{headers[0]}</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{headers[1]}</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{headers[2]}</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{headers[3]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className="border-b hover:bg-slate-50 transition-colors"
                  style={{
                    borderColor: 'var(--border-soft)',
                    background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-strong)',
                  }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{row.property}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{row.seller}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{row.generated}</td>
                  <td className="px-5 py-3 text-right">
                    <a
                      href={row.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      download={row.fileName}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                      style={{ background: 'var(--brand-soft)', color: 'var(--brand)', border: '1px solid var(--brand)' }}
                    >
                      <UiIcon kind="download" className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}