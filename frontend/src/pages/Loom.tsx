import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoomStatus {
  connected: boolean;
  loomEmail: string | null;
}

interface SearchResult {
  // LOOM ABP response fields
  candidate?: string;
  category?: string;
  subcategory?: string;
  position?: { lat: number; lon: number };
  attributes?: {
    property_key?: string | null;
    scheme_id?: string | null;
    subplace_id?: string | null;
    address_id?: string | null;
    unit_number?: string | null;
    [key: string]: unknown;
  };
  // Legacy/fallback fields
  propertyKey?: string;
  address?: string;
  displayAddress?: string;
  suburb?: string;
  city?: string;
  unitCount?: number;
  [key: string]: unknown;
}

interface PropertyDetail {
  propertyKey?: string;
  address?: string;
  erfSize?: string | number;
  floorArea?: string | number;
  zoning?: string;
  municipality?: string;
  rates?: string | number;
  levies?: string | number;
  titleDeedNumber?: string;
  bondAmount?: string | number;
  bondHolder?: string;
  valuationAmount?: string | number;
  valuationDate?: string;
  ownerName?: string;
  [key: string]: unknown;
}

interface SaleRecord {
  saleDate?: string;
  salePrice?: string | number;
  buyerName?: string;
  registrationDate?: string;
  [key: string]: unknown;
}

interface ReportItem {
  id?: number;              // LOOM report ID (from PropertyReport/GetAll)
  name?: string;            // report name
  creationTime?: string;    // LOOM timestamp
  unitNumber?: string;
  propertyKey?: string;
  versionId?: string | number; // for PDF download (from Report/GetAll)
  reportType?: string;      // legacy
  status?: string;          // legacy
  createdDate?: string;     // legacy
  requestedDate?: string;   // legacy
  [key: string]: unknown;
}

interface SelectedProperty {
  key: string;
  address: string;
  unit?: string;
}

interface ContactOwner {
  name?: string;
  idNumber?: string;
  type?: string;
  maritalStatus?: string;
  cellNumber?: string;
  email?: string;
  hasConsent?: boolean;
  consentDate?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toZAR(val: unknown): string {
  const n = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.\-]/g, '')) : Number(val);
  if (!isFinite(n) || !n) return '—';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmt(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  return String(val);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-card flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="text-2xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--border-soft)' }}>
      <span className="text-sm font-medium shrink-0 w-40" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--brand)' }}>
      {children}
    </h2>
  );
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12">
      <span className="text-4xl">{icon}</span>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{message}</p>
    </div>
  );
}

function SpinnerRow({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--brand)', borderTopColor: 'transparent' }} />
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect Banner
// ---------------------------------------------------------------------------

function ConnectBanner({
  authHeaders,
  onConnected,
}: {
  authHeaders: Record<string, string>;
  onConnected: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/loom/auth/connect', {
        method: 'POST',
        headers: authHeaders,
      });
      if (!res.ok) {
        let detail = '';
        try {
          const data = (await res.json()) as { error?: string; message?: string };
          detail = data.error ?? data.message ?? '';
        } catch {
          try {
            detail = await res.text();
          } catch {
            detail = '';
          }
        }
        throw new Error(detail || `Connection failed (${res.status})`);
      }
      onConnected();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Connection failed';
      if (message === 'Failed to fetch') {
        setError('Could not reach the LOOM sign-in service. Please try again in a few minutes.');
      } else {
        setError(message);
      }
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20">
      <div className="surface-card p-10 max-w-lg w-full text-center shadow-md">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'var(--brand-soft)' }}>
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" style={{ color: 'var(--brand)' }}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16.5 16.5 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M8 11h6M11 8v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>
          Connect LOOM Account
        </h2>
        <p className="text-sm mb-6 leading-6" style={{ color: 'var(--text-muted)' }}>
          Link your LOOM account once to unlock full property intelligence — valuations,
          reports, comparables, owner contacts, and entity verification — all inside the console.
        </p>
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          className="primary-btn w-full py-3 text-base"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting ? 'Connecting to LOOM…' : 'Connect LOOM Account'}
        </button>
        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          Takes 30 seconds · One time only · Your credentials are encrypted and stored securely
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Tab
// ---------------------------------------------------------------------------

function SearchTab({
  authHeaders,
  onSelect,
}: {
  authHeaders: Record<string, string>;
  onSelect: (prop: SelectedProperty) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function doSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/loom/search?q=${encodeURIComponent(query)}`, { headers: authHeaders });
      if (!res.ok) {
        let detail = '';
        try {
          const maybeJson = (await res.json()) as { error?: string; message?: string };
          detail = maybeJson.error ?? maybeJson.message ?? '';
        } catch {
          try {
            detail = await res.text();
          } catch {
            detail = '';
          }
        }
        const suffix = detail ? ` - ${detail}` : '';
        throw new Error(`Search failed: ${res.status}${suffix}`);
      }
      const data = (await res.json()) as SearchResult[] | { result?: SearchResult[]; results?: SearchResult[]; items?: SearchResult[] };
      // Normalise different possible response shapes (LOOM uses 'result', others use 'results'/'items')
      if (Array.isArray(data)) setResults(data);
      else if ('result' in data && Array.isArray(data.result)) setResults(data.result);
      else if ('results' in data && Array.isArray(data.results)) setResults(data.results);
      else if ('items' in data && Array.isArray(data.items)) setResults(data.items);
      else setResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void doSearch();
  }

  function getAddress(r: SearchResult): string {
    return r.candidate ?? r.displayAddress ?? r.address ?? 'Unknown address';
  }

  function getPropertyKey(r: SearchResult): string {
    return (r.attributes?.property_key ?? r.attributes?.scheme_id ?? r.propertyKey ?? r['key'] ?? '') as string;
  }

  return (
    <div className="space-y-5">
      {/* Search input */}
      <div className="surface-card p-6">
        <SectionHeading>Property Search</SectionHeading>
        <p className="mb-5 text-sm" style={{ color: 'var(--text-muted)' }}>
          Search by address, suburb, erf number or property key. Select a result to load full property intelligence.
        </p>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <span
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            >
              🔎
            </span>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search by address, suburb, erf number or property key…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              className="w-full rounded-xl border pl-11 pr-4 py-3.5 text-lg focus:outline-none focus:ring-2"
              style={{
                borderColor: 'var(--border-soft)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <button
            className="primary-btn min-w-[100px] px-7 py-3 text-lg"
            onClick={() => void doSearch()}
            disabled={searching || !query.trim()}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      {searching && (
        <div className="surface-card p-5">
          <SpinnerRow message="Searching LOOM property database…" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {results !== null && !searching && (
        <div className="surface-card overflow-hidden">
          <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-soft)' }}>
            <SectionHeading>Results ({results.length})</SectionHeading>
          </div>
          {results.length === 0 ? (
            <EmptyState icon="🔍" message="No properties found for that search." />
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
              {results.map((r, i) => {
                const addr = getAddress(r);
                const key = getPropertyKey(r);
                return (
                  <button
                    key={key || i}
                    className="w-full text-left px-5 py-3.5 hover:bg-gray-50 transition-colors flex items-center justify-between group"
                    onClick={() => {
                      if (key) onSelect({ key, address: addr });
                    }}
                    disabled={!key}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{addr}</p>
                      {(r.suburb ?? r.city) && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {[r.suburb, r.city].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--brand)' }}>
                      Select →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {results === null && !searching && !error && (
        <EmptyState icon="🏡" message="Search for a property above to get started." />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property Tab
// ---------------------------------------------------------------------------

function PropertyTab({
  authHeaders,
  property,
}: {
  authHeaders: Record<string, string>;
  property: SelectedProperty;
}) {
  const params = `key=${encodeURIComponent(property.key)}${property.unit ? `&unit=${encodeURIComponent(property.unit)}` : ''}`;

  const { data: detail, isLoading: loadingDetail } = useQuery<PropertyDetail>({
    queryKey: ['loom-property', property.key, property.unit],
    queryFn: async () => {
      const res = await fetch(`/api/loom/property?${params}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`Property load failed: ${res.status}`);
      return res.json() as Promise<PropertyDetail>;
    },
  });

  const { data: sales, isLoading: loadingSales } = useQuery<SaleRecord[]>({
    queryKey: ['loom-sales', property.key, property.unit],
    queryFn: async () => {
      const res = await fetch(`/api/loom/property/sales?${params}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`Sales load failed: ${res.status}`);
      const data = (await res.json()) as SaleRecord[] | { sales?: SaleRecord[]; items?: SaleRecord[] };
      if (Array.isArray(data)) return data;
      if ('sales' in data && Array.isArray(data.sales)) return data.sales;
      if ('items' in data && Array.isArray(data.items)) return data.items;
      return [];
    },
  });

  const { data: owner } = useQuery<{ ownerName?: string; ownerNames?: string[]; [key: string]: unknown }>({
    queryKey: ['loom-owner', property.key, property.unit],
    queryFn: async () => {
      const res = await fetch(`/api/loom/property/owner?${params}`, { headers: authHeaders });
      if (!res.ok) return {};
      return res.json() as Promise<Record<string, unknown>>;
    },
  });

  if (loadingDetail) {
    return (
      <div className="surface-card p-5">
        <SpinnerRow message="Loading property details…" />
      </div>
    );
  }

  const lastSale = sales?.[0];
  const ownerDisplay =
    detail?.ownerName ??
    owner?.ownerName ??
    (Array.isArray(owner?.ownerNames) && owner.ownerNames[0]) ??
    null;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Valuation"
          value={toZAR(detail?.valuationAmount)}
          sub={detail?.valuationDate ? `LOOM est. ${fmt(detail.valuationDate)}` : 'LOOM estimate'}
        />
        <KpiCard
          label="Last Sale"
          value={toZAR(lastSale?.salePrice)}
          sub={lastSale?.saleDate ? fmt(lastSale.saleDate) : undefined}
        />
        <KpiCard
          label="Erf Size"
          value={detail?.erfSize ? `${fmt(detail.erfSize)} m²` : '—'}
          sub={detail?.floorArea ? `Floor: ${fmt(detail.floorArea)} m²` : undefined}
        />
        <KpiCard
          label="Bond"
          value={toZAR(detail?.bondAmount)}
          sub={detail?.bondHolder ? fmt(detail.bondHolder) : undefined}
        />
      </div>

      {/* Property detail */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="surface-card p-5">
          <SectionHeading>Property Details</SectionHeading>
          <div className="mt-3">
            <InfoRow label="Address" value={fmt(detail?.address ?? property.address)} />
            <InfoRow label="Title Deed" value={fmt(detail?.titleDeedNumber)} />
            <InfoRow label="Zoning" value={fmt(detail?.zoning)} />
            <InfoRow label="Municipality" value={fmt(detail?.municipality)} />
            <InfoRow label="Rates" value={toZAR(detail?.rates)} />
            <InfoRow label="Levies" value={toZAR(detail?.levies)} />
            {ownerDisplay && <InfoRow label="Owner" value={ownerDisplay} />}
          </div>
        </div>

        {/* Sales history */}
        <div className="surface-card p-5">
          <SectionHeading>Sales History</SectionHeading>
          {loadingSales ? (
            <SpinnerRow message="Loading sales history…" />
          ) : !sales || sales.length === 0 ? (
            <EmptyState icon="📊" message="No sales records available." />
          ) : (
            <div className="mt-3 space-y-2">
              {sales.slice(0, 8).map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ background: 'var(--surface-strong)' }}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {toZAR(s.salePrice)}
                    </p>
                    {s.buyerName && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(s.buyerName)}</p>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {fmt(s.saleDate ?? s.registrationDate)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports Tab
// ---------------------------------------------------------------------------

type ReportType = 'property' | 'area' | 'street';

const REPORT_LABELS: Record<ReportType, { title: string; icon: string }> = {
  property: { title: 'Property Report', icon: '🏠' },
  area: { title: 'Area Report', icon: '🗺️' },
  street: { title: 'Street Report', icon: '🛣️' },
};

function ReportSection({
  type,
  authHeaders,
  property,
}: {
  type: ReportType;
  authHeaders: Record<string, string>;
  property: SelectedProperty;
}) {
  const params = `key=${encodeURIComponent(property.key)}${property.unit ? `&unit=${encodeURIComponent(property.unit)}` : ''}`;
  const [requesting, setRequesting] = useState(false);
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string>('');
  const [streetId, setStreetId] = useState<string>('');
  const queryClient = useQueryClient();

  const { data: savedAreas } = useQuery<unknown[]>({
    queryKey: ['loom-area-saved'],
    enabled: type === 'area',
    queryFn: async () => {
      const res = await fetch('/api/loom/area/saved', { headers: authHeaders });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown[] | { items?: unknown[] };
      return Array.isArray(data) ? data : (data.items ?? []);
    },
  });

  type SavedAreaOption = { id: string; label: string };
  const areaOptions: SavedAreaOption[] = Array.isArray(savedAreas)
    ? savedAreas
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const idRaw = obj.id ?? obj.areaId ?? obj.Id;
        if (idRaw === undefined || idRaw === null || idRaw === '') return null;
        const id = String(idRaw);
        const label = String(obj.name ?? obj.areaName ?? `Area ${id}`);
        return { id, label };
      })
      .filter((x): x is SavedAreaOption => Boolean(x))
    : [];

  // Select the first saved area by default when area options load.
  useEffect(() => {
    if (type !== 'area') return;
    if (selectedAreaId) return;
    if (areaOptions.length > 0) setSelectedAreaId(areaOptions[0].id);
  }, [type, selectedAreaId, areaOptions]);

  const { data: reports, isLoading } = useQuery<ReportItem[]>({
    queryKey: ['loom-reports', type, property.key, property.unit],
    queryFn: async () => {
      const res = await fetch(`/api/loom/reports/${type}?${params}`, { headers: authHeaders });
      if (!res.ok) return [];
      const data = (await res.json()) as ReportItem[] | { reports?: ReportItem[]; items?: ReportItem[] };
      if (Array.isArray(data)) return data;
      if ('reports' in data && Array.isArray(data.reports)) return data.reports;
      if ('items' in data && Array.isArray(data.items)) return data.items;
      return [];
    },
  });

  function handleDownload(versionId: string) {
    const url = `/api/loom/reports/${type}/download?versionId=${encodeURIComponent(versionId)}`;
    const a = document.createElement('a');
    a.href = url;
    // Pass auth header via a form-submit trick isn't trivial — open in a new tab
    // The backend will validate the JWT from the Authorization header.
    // For a download, we create a temporary anchor with a signed URL approach.
    // Since our backend requires auth, we'll open a fetch + blob download:
    void (async () => {
      try {
        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        const disposition = res.headers.get('content-disposition') ?? '';
        const match = /filename="?([^";\n]+)"?/i.exec(disposition);
        a.download = match?.[1] ?? `loom-${type}-report.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Download failed');
      }
    })();
  }

  async function handleRequest() {
    setRequesting(true);
    setRequestMsg(null);
    try {
      let body: Record<string, unknown>;
      if (type === 'property') {
        body = { propertyKey: property.key, unitNumber: property.unit };
      } else if (type === 'area') {
        if (!selectedAreaId) {
          throw new Error('Select a saved area first.');
        }
        body = { id: selectedAreaId };
      } else {
        if (!streetId.trim()) {
          throw new Error('Enter a saved street id first.');
        }
        body = { id: streetId.trim() };
      }
      const res = await fetch(`/api/loom/reports/${type}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setRequestMsg('Report requested. Refresh in a moment to see it.');
      await queryClient.invalidateQueries({ queryKey: ['loom-reports', type, property.key, property.unit] });
    } catch (e) {
      setRequestMsg(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setRequesting(false);
    }
  }

  const { title, icon } = REPORT_LABELS[type];

  return (
    <div className="surface-card p-5">
      <div className="flex items-center justify-between mb-3">
        <SectionHeading>{icon} {title}</SectionHeading>
        <button
          className="primary-btn px-3 py-1.5 text-xs"
          onClick={() => void handleRequest()}
          disabled={requesting}
        >
          {requesting ? 'Requesting…' : '+ Request New'}
        </button>
      </div>
      {type === 'area' && (
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Saved Area
          </label>
          <select
            value={selectedAreaId}
            onChange={(e) => setSelectedAreaId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            {areaOptions.length === 0 && <option value="">No saved areas available</option>}
            {areaOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Area reports require a saved polygon area.
          </p>
        </div>
      )}
      {type === 'street' && (
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Saved Street Id
          </label>
          <input
            type="text"
            placeholder="Paste LOOM saved street id…"
            value={streetId}
            onChange={(e) => setStreetId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Street reports require a saved street id from LOOM.
          </p>
        </div>
      )}
      {requestMsg && (
        <p className="mb-3 text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
          {requestMsg}
        </p>
      )}
      {isLoading ? (
        <SpinnerRow message={`Loading ${title.toLowerCase()}s…`} />
      ) : !reports || reports.length === 0 ? (
        <EmptyState icon="📄" message={`No ${title.toLowerCase()}s available. Request one above.`} />
      ) : (
        <div className="space-y-2">
          {reports.map((r, i) => (
            <div
              key={(r as Record<string,unknown>).reportId as number ?? r.id ?? r.versionId ?? i}
              className="flex items-center justify-between rounded-lg px-4 py-3"
              style={{ background: 'var(--surface-strong)' }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {r.name ?? r.reportType ?? title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {r.creationTime
                    ? new Date(r.creationTime).toLocaleDateString()
                    : (r as Record<string,unknown>).createdAt
                      ? new Date(String((r as Record<string,unknown>).createdAt)).toLocaleDateString()
                      : (r.createdDate ?? r.requestedDate ?? '—')}
                </p>
              </div>
              {r.versionId ? (
                <button
                  className="primary-btn px-3 py-1.5 text-xs"
                  onClick={() => handleDownload(String(r.versionId!))}
                >
                  Download PDF
                </button>
              ) : (
                <span className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  Generating…
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportsTab({
  authHeaders,
  property,
}: {
  authHeaders: Record<string, string>;
  property: SelectedProperty;
}) {
  return (
    <div className="space-y-5">
      <ReportSection type="property" authHeaders={authHeaders} property={property} />
      <ReportSection type="area" authHeaders={authHeaders} property={property} />
      <ReportSection type="street" authHeaders={authHeaders} property={property} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area & Street Tab
// ---------------------------------------------------------------------------

function AreaTab({
  authHeaders,
}: {
  authHeaders: Record<string, string>;
}) {
  const { data: saved, isLoading: loadingSaved } = useQuery<unknown[]>({
    queryKey: ['loom-area-saved'],
    queryFn: async () => {
      const res = await fetch('/api/loom/area/saved', { headers: authHeaders });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown[] | { items?: unknown[] };
      return Array.isArray(data) ? data : (data.items ?? []);
    },
  });

  const [selectedArea, setSelectedArea] = useState<{ candidate: string; lat: string; lon: string } | null>(null);
  const [selectedStreet, setSelectedStreet] = useState<{ candidate: string; lat: string; lon: string } | null>(null);

  // Area search
  const [areaQuery, setAreaQuery] = useState('');
  const { data: areaResults, isLoading: searchingAreas } = useQuery<unknown[]>({
    queryKey: ['loom-area-search', areaQuery],
    enabled: areaQuery.trim().length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/loom/area/search?q=${encodeURIComponent(areaQuery)}`, { headers: authHeaders });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown[];
      return Array.isArray(data) ? data : [];
    },
  });

  // Street search
  const [streetQuery, setStreetQuery] = useState('');
  const { data: streetResults, isLoading: searchingStreets } = useQuery<unknown[]>({
    queryKey: ['loom-street-search', streetQuery],
    enabled: streetQuery.trim().length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/loom/street/search?q=${encodeURIComponent(streetQuery)}`, { headers: authHeaders });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown[];
      return Array.isArray(data) ? data : [];
    },
  });

  return (
    <div className="space-y-5">
      {/* Area search */}
      <div className="surface-card p-5">
        <SectionHeading>Area Search</SectionHeading>
        <p className="mb-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          Search for a suburb or area to generate area reports and insights.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Search suburb or area…"
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
        </div>
        {searchingAreas && <SpinnerRow message="Searching areas…" />}
        {areaResults && areaResults.length === 0 && !searchingAreas && areaQuery && (
          <EmptyState icon="🔍" message="No areas found for that search." />
        )}
      {selectedArea && (
          <div className="mt-3 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--accent-soft, #e8f4e8)', border: '1px solid var(--accent, #2d7a2d)' }}>
            <span style={{ color: 'var(--accent, #2d7a2d)', fontWeight: 600 }}>Selected area: </span>
            <span style={{ color: 'var(--text-primary)' }}>{selectedArea.candidate}</span>
            <button className="ml-3 text-xs" style={{ color: 'var(--text-muted)' }} onClick={() => setSelectedArea(null)}>Clear</button>
          </div>
        )}
      {areaResults && areaResults.length > 0 && (
          <div className="space-y-2">
            {areaResults.map((r, i) => {
              const item = r as Record<string, unknown>;
              const candidate = String(item.candidate ?? '');
              const pos = item.position as Record<string, unknown> | undefined;
              const lat = pos?.lat ? String(pos.lat) : '';
              const lon = pos?.lon ? String(pos.lon) : '';
              const isSelected = selectedArea?.candidate === candidate;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: isSelected ? 'var(--accent-soft, #e8f4e8)' : 'var(--surface-strong)', border: isSelected ? '1px solid var(--accent, #2d7a2d)' : '1px solid transparent' }}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {candidate.length > 0 ? candidate : String(item.category ?? 'Result').slice(0, 50)}
                    </p>
                    {(lat.length > 0 && lon.length > 0) && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {lat}, {lon}
                      </p>
                    )}
                  </div>
                  <button
                    className="primary-btn px-3 py-1.5 text-xs"
                    onClick={() => { setSelectedArea({ candidate, lat, lon }); setAreaQuery(''); }}
                  >
                    {isSelected ? 'Selected ✓' : 'Use'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Street search */}
      <div className="surface-card p-5">
        <SectionHeading>Street Search</SectionHeading>
        <p className="mb-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          Search for a street to generate street reports and comparables.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Search street name…"
            value={streetQuery}
            onChange={(e) => setStreetQuery(e.target.value)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
        </div>
        {searchingStreets && <SpinnerRow message="Searching streets…" />}
        {streetResults && streetResults.length === 0 && !searchingStreets && streetQuery && (
          <EmptyState icon="🔍" message="No streets found for that search." />
        )}
        {selectedStreet && (
          <div className="mt-3 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--accent-soft, #e8f4e8)', border: '1px solid var(--accent, #2d7a2d)' }}>
            <span style={{ color: 'var(--accent, #2d7a2d)', fontWeight: 600 }}>Selected street: </span>
            <span style={{ color: 'var(--text-primary)' }}>{selectedStreet.candidate}</span>
            <button className="ml-3 text-xs" style={{ color: 'var(--text-muted)' }} onClick={() => setSelectedStreet(null)}>Clear</button>
          </div>
        )}
        {streetResults && streetResults.length > 0 && (
          <div className="space-y-2">
            {streetResults.map((r, i) => {
              const item = r as Record<string, unknown>;
              const candidate = String(item.candidate ?? '');
              const pos = item.position as Record<string, unknown> | undefined;
              const lat = pos?.lat ? String(pos.lat) : '';
              const lon = pos?.lon ? String(pos.lon) : '';
              const isSelected = selectedStreet?.candidate === candidate;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: isSelected ? 'var(--accent-soft, #e8f4e8)' : 'var(--surface-strong)', border: isSelected ? '1px solid var(--accent, #2d7a2d)' : '1px solid transparent' }}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {candidate.length > 0 ? candidate : String(item.category ?? 'Result').slice(0, 50)}
                    </p>
                    {(lat.length > 0 && lon.length > 0) && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {lat}, {lon}
                      </p>
                    )}
                  </div>
                  <button
                    className="primary-btn px-3 py-1.5 text-xs"
                    onClick={() => { setSelectedStreet({ candidate, lat, lon }); setStreetQuery(''); }}
                  >
                    {isSelected ? 'Selected ✓' : 'Use'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Saved areas */}
      <div className="surface-card p-5">
        <SectionHeading>Your Watched Areas</SectionHeading>
        {loadingSaved ? (
          <SpinnerRow message="Loading saved areas…" />
        ) : !saved || saved.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            No watched areas yet. Search for an area above or create one via Area Report.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {saved.slice(0, 10).map((s, i) => (
              <div
                key={i}
                className="rounded-lg px-4 py-3 text-sm"
                style={{ background: 'var(--surface-strong)', color: 'var(--text-primary)' }}
              >
                {typeof s === 'object' && s !== null
                  ? (s as { name?: string; areaName?: string; address?: string }).name ??
                    (s as { areaName?: string }).areaName ??
                    JSON.stringify(s).slice(0, 80)
                  : String(s)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contacts & Consent Tab
// ---------------------------------------------------------------------------

function ContactsTab({
  authHeaders,
  property,
}: {
  authHeaders: Record<string, string>;
  property: SelectedProperty;
}) {
  const queryClient = useQueryClient();
  const [acceptingConsent, setAcceptingConsent] = useState(false);
  const [requestingContacts, setRequestingContacts] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const { data: consent, isLoading: loadingConsent } = useQuery<Record<string, unknown>>({
    queryKey: ['loom-consent'],
    queryFn: async () => {
      const res = await fetch('/api/loom/consent', { headers: authHeaders });
      if (!res.ok) return {};
      return res.json() as Promise<Record<string, unknown>>;
    },
  });

  const { data: terms } = useQuery<Record<string, unknown>>({
    queryKey: ['loom-consent-terms'],
    queryFn: async () => {
      const res = await fetch('/api/loom/consent/terms', { headers: authHeaders });
      if (!res.ok) return {};
      return res.json() as Promise<Record<string, unknown>>;
    },
  });

  const { data: contacts, isLoading: loadingContacts } = useQuery<{ items?: ContactOwner[]; totalCount?: number } | ContactOwner[]>({
    queryKey: ['loom-contacts', property.key, property.unit],
    queryFn: async () => {
      const params = `propertyKey=${encodeURIComponent(property.key)}${property.unit ? `&unit=${encodeURIComponent(property.unit)}` : ''}`;
      const res = await fetch(`/api/loom/contacts?${params}`, { headers: authHeaders });
      if (!res.ok) return { items: [], totalCount: 0 };
      return res.json() as Promise<{ items?: ContactOwner[]; totalCount?: number }>;
    },
  });

  async function acceptConsent() {
    setAcceptingConsent(true);
    setActionMsg(null);
    try {
      const body = terms ? { termsVersion: (terms as { version?: string }).version } : {};
      const res = await fetch('/api/loom/consent', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Could not accept consent');
      setActionMsg('Consent accepted.');
      await queryClient.invalidateQueries({ queryKey: ['loom-consent'] });
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setAcceptingConsent(false);
    }
  }

  async function requestContacts() {
    setRequestingContacts(true);
    setActionMsg(null);
    try {
      // Contacts are fetched via PropertyReport/Create — just invalidate the query to refresh
      await queryClient.invalidateQueries({ queryKey: ['loom-contacts', property.key] });
      setActionMsg('Contacts refreshed.');
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setRequestingContacts(false);
    }
  }

  const consentAccepted =
    consent?.accepted === true ||
    consent?.status === 'accepted' ||
    consent?.consentGiven === true;

  return (
    <div className="space-y-5">
      {/* Consent */}
      <div className="surface-card p-5">
        <SectionHeading>Consent Status</SectionHeading>
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          LOOM requires consent to share owner contact details. This is a POPIA-compliant, one-time acceptance per agent.
        </p>
        {loadingConsent ? (
          <SpinnerRow message="Checking consent status…" />
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`status-chip ${consentAccepted ? 'good' : 'warn'}`}>
                {consentAccepted ? '✓ Consent Accepted' : '⚠ Consent Required'}
              </span>
            </div>
            {!consentAccepted && (
              <button
                className="primary-btn px-4 py-2 text-sm"
                onClick={() => void acceptConsent()}
                disabled={acceptingConsent}
              >
                {acceptingConsent ? 'Accepting…' : 'Accept Consent'}
              </button>
            )}
          </div>
        )}
        {actionMsg && (
          <p className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            {actionMsg}
          </p>
        )}
      </div>

      {/* Contact details */}
      <div className="surface-card p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading>Owner Contact Details</SectionHeading>
          <button
            className="primary-btn px-3 py-1.5 text-xs"
            onClick={() => void requestContacts()}
            disabled={requestingContacts}
          >
            {requestingContacts ? 'Requesting…' : 'Refresh Contacts'}
          </button>
        </div>
        {loadingContacts ? (
          <SpinnerRow message="Loading contact details…" />
        ) : (() => {
          const ownerList: ContactOwner[] = Array.isArray(contacts)
            ? contacts
            : Array.isArray((contacts as { items?: ContactOwner[] } | null)?.items)
              ? ((contacts as { items: ContactOwner[] }).items)
              : [];
          if (ownerList.length === 0) {
            return <EmptyState icon="📞" message="No contact details available. Request contacts above." />;
          }
          return (
            <div className="space-y-4 mt-2">
              {ownerList.map((owner, i) => (
                <div key={i} className="rounded-lg px-4 py-3 space-y-1" style={{ background: 'var(--surface-strong)' }}>
                  {owner.name && <InfoRow label="Name" value={owner.name} />}
                  {owner.idNumber && <InfoRow label="ID Number" value={owner.idNumber} />}
                  {owner.type && <InfoRow label="Owner Type" value={owner.type} />}
                  {owner.maritalStatus && <InfoRow label="Marital Status" value={owner.maritalStatus} />}
                  {owner.cellNumber && <InfoRow label="Cell Number" value={owner.cellNumber} />}
                  {owner.email && <InfoRow label="Email" value={owner.email} />}
                  {owner.hasConsent !== undefined && (
                    <InfoRow label="Consent" value={owner.hasConsent ? '✓ Consented' : 'Not consented'} />
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity Verify Tab
// ---------------------------------------------------------------------------

function EntityTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [cipcQuery, setCipcQuery] = useState('');
  const [cipcResult, setCipcResult] = useState<Record<string, unknown> | null>(null);
  const [cipcLoading, setCipcLoading] = useState(false);
  const [cipcError, setCipcError] = useState<string | null>(null);

  const [trustQuery, setTrustQuery] = useState('');
  const [trustResult, setTrustResult] = useState<Record<string, unknown> | null>(null);
  const [trustLoading, setTrustLoading] = useState(false);
  const [trustError, setTrustError] = useState<string | null>(null);

  async function searchCIPC() {
    if (!cipcQuery.trim()) return;
    setCipcLoading(true);
    setCipcError(null);
    setCipcResult(null);
    try {
      const res = await fetch(`/api/loom/cipc/search?q=${encodeURIComponent(cipcQuery)}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`CIPC search failed: ${res.status}`);
      setCipcResult((await res.json()) as Record<string, unknown>);
    } catch (e) {
      setCipcError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setCipcLoading(false);
    }
  }

  async function searchTrust() {
    if (!trustQuery.trim()) return;
    setTrustLoading(true);
    setTrustError(null);
    setTrustResult(null);
    try {
      const res = await fetch(`/api/loom/trust/search?q=${encodeURIComponent(trustQuery)}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`Trust search failed: ${res.status}`);
      setTrustResult((await res.json()) as Record<string, unknown>);
    } catch (e) {
      setTrustError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setTrustLoading(false);
    }
  }

  function renderFields(data: Record<string, unknown>) {
    return (
      <div className="mt-3 space-y-0">
        {Object.entries(data)
          .filter(([, v]) => v !== null && v !== undefined && v !== '' && !Array.isArray(v) && typeof v !== 'object')
          .map(([k, v]) => (
            <InfoRow key={k} label={k.replace(/([A-Z])/g, ' $1').trim()} value={String(v)} />
          ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* CIPC */}
      <div className="surface-card p-5">
        <SectionHeading>CIPC — Company Verification</SectionHeading>
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Look up a company by registration number or name. Useful when the property is owned by an entity.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Company name or registration number…"
            value={cipcQuery}
            onChange={(e) => setCipcQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchCIPC()}
            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
          <button className="primary-btn px-4" onClick={() => void searchCIPC()} disabled={cipcLoading || !cipcQuery.trim()}>
            {cipcLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {cipcError && <p className="text-sm text-red-600">{cipcError}</p>}
        {cipcResult && renderFields(cipcResult)}
        {!cipcResult && !cipcLoading && !cipcError && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Search for a company above.</p>
        )}
      </div>

      {/* Trust */}
      <div className="surface-card p-5">
        <SectionHeading>Trust Verification</SectionHeading>
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Look up a trust by trust number or name. Useful when the property is held in a trust.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Trust name or trust number…"
            value={trustQuery}
            onChange={(e) => setTrustQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchTrust()}
            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
          <button className="primary-btn px-4" onClick={() => void searchTrust()} disabled={trustLoading || !trustQuery.trim()}>
            {trustLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {trustError && <p className="text-sm text-red-600">{trustError}</p>}
        {trustResult && renderFields(trustResult)}
        {!trustResult && !trustLoading && !trustError && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Search for a trust above.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = 'search' | 'property' | 'reports' | 'area' | 'contacts' | 'entity';

const TABS: { id: TabId; label: string }[] = [
  { id: 'search', label: 'Property Search' },
  { id: 'property', label: 'Property' },
  { id: 'reports', label: 'Reports' },
  { id: 'area', label: 'Area & Street' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'entity', label: 'Entity Verify' },
];

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function LoomPage() {
  const { token, activeContext } = useAuth();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabId>('search');
  const [selectedProperty, setSelectedProperty] = useState<SelectedProperty | null>(null);

  const authHeaders = {
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  };

  // Handle OAuth redirect params
  useEffect(() => {
    const connected = searchParams.get('loom_connected');
    const loomError = searchParams.get('loom_error');
    if (connected === 'true') {
      void queryClient.invalidateQueries({ queryKey: ['loom-status'] });
      // Clean up URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('loom_connected');
      window.history.replaceState({}, '', url.toString());
    }
    if (loomError) {
      const url = new URL(window.location.href);
      url.searchParams.delete('loom_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams, queryClient]);

  const {
    data: status,
    isLoading: checkingStatus,
  } = useQuery<LoomStatus>({
    queryKey: ['loom-status'],
    queryFn: async () => {
      const res = await fetch('/api/loom/auth/status', { headers: authHeaders });
      if (!res.ok) return { connected: false, loomEmail: null };
      return res.json() as Promise<LoomStatus>;
    },
    staleTime: 30_000,
  });

  function handlePropertySelect(prop: SelectedProperty) {
    setSelectedProperty(prop);
    setActiveTab('property');
  }

  const propertyTabsEnabled = Boolean(selectedProperty);

  if (checkingStatus) {
    return (
      <div className="w-full px-6 py-10">
        <div className="surface-card p-8 flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--brand)', borderTopColor: 'transparent' }} />
          <span style={{ color: 'var(--text-muted)' }}>Checking LOOM connection…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-8">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="page-title">LOOM Property Intelligence</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Full property search, valuations, reports, comparables, owner contacts, and entity verification.
        </p>
      </div>

      {/* Connected indicator */}
      {status?.connected && (
        <div className="mb-5 flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2">
            <span className="status-chip good">✓ LOOM Connected</span>
            {status.loomEmail && (
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{status.loomEmail}</span>
            )}
            <button
              className="text-xs underline ml-2"
              style={{ color: 'var(--text-muted)' }}
              onClick={async () => {
                await fetch('/api/loom/auth/disconnect', { method: 'DELETE', headers: authHeaders });
                void queryClient.invalidateQueries({ queryKey: ['loom-status'] });
              }}
            >
              Disconnect
            </button>
          </div>
          {selectedProperty && (
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                {selectedProperty.address}
              </span>
              <button
                className="text-xs"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => { setSelectedProperty(null); setActiveTab('search'); }}
              >
                Clear ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* Not connected — show banner */}
      {!status?.connected && (
        <ConnectBanner authHeaders={authHeaders} onConnected={() => {
          void queryClient.invalidateQueries({ queryKey: ['loom-status'] });
        }} />
      )}

      {/* Connected — show tabs */}
      {status?.connected && (
        <>
          {/* Tab navigation */}
          <div className="surface-card mb-5 overflow-x-auto p-2">
            <div className="flex gap-1 min-w-max">
            {TABS.map((tab) => {
              const disabled = !propertyTabsEnabled && tab.id !== 'search' && tab.id !== 'entity';
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => !disabled && setActiveTab(tab.id)}
                  disabled={disabled}
                  className="whitespace-nowrap rounded-lg px-5 py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: isActive ? 'var(--brand)' : 'transparent',
                    color: isActive ? '#fff' : disabled ? '#c7ced8' : 'var(--text-muted)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    boxShadow: isActive ? '0 2px 10px rgba(147, 20, 28, 0.28)' : 'none',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
            </div>
          </div>

          {/* Tab hint when no property selected */}
          {!selectedProperty && activeTab === 'search' && (
            <p className="mb-4 text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              Search and select a property to unlock all tabs.
            </p>
          )}

          {/* Tab content */}
          {activeTab === 'search' && (
            <SearchTab authHeaders={authHeaders} onSelect={handlePropertySelect} />
          )}
          {activeTab === 'property' && selectedProperty && (
            <PropertyTab authHeaders={authHeaders} property={selectedProperty} />
          )}
          {activeTab === 'reports' && selectedProperty && (
            <ReportsTab authHeaders={authHeaders} property={selectedProperty} />
          )}
          {activeTab === 'area' && selectedProperty && (
            <AreaTab authHeaders={authHeaders} />
          )}
          {activeTab === 'contacts' && selectedProperty && (
            <ContactsTab authHeaders={authHeaders} property={selectedProperty} />
          )}
          {activeTab === 'entity' && (
            <EntityTab authHeaders={authHeaders} />
          )}
        </>
      )}
    </div>
  );
}
