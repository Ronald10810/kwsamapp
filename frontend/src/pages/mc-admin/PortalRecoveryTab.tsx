import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

type RecoveryMode = 'fix-owner-publish' | 'force-withdraw';

type RecoveryItem = {
  input: string;
  normalizedInput: string;
  status: string;
  success: boolean;
  message: string;
  localListingNumber?: string | null;
  localListingId?: string | null;
  targetKwuid?: string | null;
  remote?: {
    listId: string | null;
    listKey: string | null;
    ownerKwuid: string | null;
    listStatus: string | null;
  };
  actions?: string[];
};

type RecoveryResponse = {
  mode: RecoveryMode;
  dryRun: boolean;
  validateOnly: boolean;
  total: number;
  counts: Record<string, number>;
  results: RecoveryItem[];
};

function parsePastedValues(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/g)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function statusClass(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'success' || normalized === 'already-correct') return 'bg-emerald-100 text-emerald-800';
  if (normalized === 'dry-run') return 'bg-blue-100 text-blue-800';
  if (normalized === 'forbidden') return 'bg-amber-100 text-amber-800';
  if (normalized === 'not-found' || normalized === 'validation-error') return 'bg-slate-200 text-slate-700';
  return 'bg-red-100 text-red-700';
}

function statusCardClass(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'success' || normalized === 'already-correct') return 'border-emerald-200 bg-emerald-50';
  if (normalized === 'dry-run') return 'border-blue-200 bg-blue-50';
  if (normalized === 'forbidden') return 'border-amber-200 bg-amber-50';
  if (normalized === 'not-found' || normalized === 'validation-error') return 'border-slate-200 bg-slate-50';
  return 'border-red-200 bg-red-50';
}

export default function PortalRecoveryTab(): JSX.Element {
  const { token, activeContext } = useAuth();

  const [mode, setMode] = useState<RecoveryMode>('fix-owner-publish');
  const [bulkInput, setBulkInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<RecoveryResponse | null>(null);

  const parsedInputs = useMemo(() => parsePastedValues(bulkInput), [bulkInput]);
  const modeLabel = mode === 'fix-owner-publish' ? 'Fix Owner + Publish' : 'Force Withdraw';
  const modeHint = mode === 'fix-owner-publish'
    ? 'Repairs owner alignment first, then attempts a publish and verification cycle.'
    : 'Forces legacy records into withdrawn state when direct cleanup is required.';

  async function run(modeRun: { dryRun: boolean; validateOnly: boolean }): Promise<void> {
    setError(null);
    setResponse(null);

    if (parsedInputs.length === 0) {
      setError('Paste at least one listing number before running.');
      return;
    }

    if (!token) {
      setError('You are not authenticated. Please sign in again.');
      return;
    }

    setIsRunning(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      if (activeContext?.id) {
        headers['x-active-context'] = activeContext.id;
      }

      const res = await fetch('/api/portal-recovery/run', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode,
          listingNumbers: parsedInputs,
          dryRun: modeRun.dryRun,
          validateOnly: modeRun.validateOnly,
        }),
      });

      const body = await res.json() as RecoveryResponse & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `Portal Recovery failed (${res.status})`);
      }

      setResponse(body);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Portal Recovery request failed.');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="surface-card p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Portal Recovery</h2>
        <p className="mt-1 text-sm text-slate-500">
          Regional Admin workflow for KWW owner repair and legacy forced withdrawals.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
            Active Mode
          </span>
          <span className="text-sm font-semibold text-slate-900">{modeLabel}</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">{modeHint}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode('fix-owner-publish')}
          className={mode === 'fix-owner-publish'
            ? 'rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-left shadow-sm'
            : 'rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50'}
        >
          <p className="text-sm font-semibold text-slate-900">Fix Owner + Publish</p>
          <p className="mt-1 text-xs text-slate-600">Use KWL numbers to align owner and trigger publish.</p>
        </button>

        <button
          type="button"
          onClick={() => setMode('force-withdraw')}
          className={mode === 'force-withdraw'
            ? 'rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-left shadow-sm'
            : 'rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50'}
        >
          <p className="text-sm font-semibold text-slate-900">Force Withdraw</p>
          <p className="mt-1 text-xs text-slate-600">Use legacy numeric list IDs or KWL numbers to withdraw on KWW.</p>
        </button>
      </div>

      <div className="space-y-2">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Listing Numbers</label>
        <textarea
          value={bulkInput}
          onChange={(event) => setBulkInput(event.target.value)}
          placeholder={mode === 'fix-owner-publish' ? 'KWL298436\nKWL220637' : '53254298\n47367056\nKWL220637'}
          rows={8}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Detected unique inputs: {parsedInputs.length}</span>
          <span className="text-slate-300">|</span>
          <span>Accepted separators: newline, comma, semicolon, space</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <button
          type="button"
          onClick={() => void run({ dryRun: true, validateOnly: true })}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          disabled={isRunning}
        >
          {isRunning ? 'Running...' : 'Validate'}
        </button>

        <button
          type="button"
          onClick={() => void run({ dryRun: true, validateOnly: false })}
          className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
          disabled={isRunning}
        >
          {isRunning ? 'Running...' : 'Dry Run'}
        </button>

        <button
          type="button"
          onClick={() => void run({ dryRun: false, validateOnly: false })}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          disabled={isRunning}
        >
          {isRunning ? 'Executing...' : 'Execute Live'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {response && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total</p>
              <p className="text-xl font-semibold text-slate-900">{response.total}</p>
            </div>
            {Object.entries(response.counts).map(([key, value]) => (
              <div key={key} className={`rounded-lg border p-3 ${statusCardClass(key)}`}>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">{key}</p>
                <p className="text-xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Input</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Local Listing</th>
                  <th className="px-3 py-2">Remote</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {response.results.map((row) => (
                  <tr key={`${row.normalizedInput}-${row.status}-${row.message}`} className="align-top odd:bg-white even:bg-slate-50/40">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.normalizedInput}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{row.message}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.localListingNumber ?? row.localListingId ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.remote?.listKey ?? row.remote?.listId ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
