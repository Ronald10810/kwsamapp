import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ReportIconKind =
  | 'file-check'
  | 'layers'
  | 'wallet'
  | 'users'
  | 'check-circle'
  | 'calendar'
  | 'gauge'
  | 'trending-up'
  | 'target'
  | 'home'
  | 'chart'
  | 'filter';

export function ReportIcon({ kind, className = 'h-4 w-4' }: { kind: ReportIconKind; className?: string }) {
  if (kind === 'file-check') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.7" />
        <path d="m9 14 1.7 1.7 3.3-3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'layers') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="m12 4 8 4-8 4-8-4 8-4ZM4 12l8 4 8-4M4 16l8 4 8-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'wallet') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M21 10h-6a2 2 0 0 0 0 4h6" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (kind === 'users') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M14 20c.1-1.8 1.7-3.2 4-3.2 1.1 0 2.1.3 2.9.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'check-circle') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="m8.8 12.2 2.1 2.1 4.3-4.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'gauge') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 15a8 8 0 1 1 16 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="m12 12 4-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'trending-up') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 16.5 10 10.5l4 4L20 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 8h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'target') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'home') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (kind === 'chart') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="10" width="3.5" height="10" stroke="currentColor" strokeWidth="1.7" rx="0.5" />
        <rect x="10.25" y="6" width="3.5" height="14" stroke="currentColor" strokeWidth="1.7" rx="0.5" />
        <rect x="16.5" y="13" width="3.5" height="7" stroke="currentColor" strokeWidth="1.7" rx="0.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ReportHeader({
  title,
  subtitle,
  context,
  actions,
}: {
  title: string;
  subtitle: string;
  context?: string;
  actions?: ReactNode;
}) {
  return (
    <section className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="page-title">{title}</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
          {context ? (
            <p className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--surface-strong)', color: 'var(--text-muted)' }}>
              {context}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
    </section>
  );
}

export function ReportKpiCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--border-soft)' }}>
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--brand)' }}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: 'var(--brand)' }}>
        {value}
      </div>
    </div>
  );
}

export function FilterPanel({ children }: { children: ReactNode }) {
  return (
    <section className="surface-card p-4">
      <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--brand)' }}><ReportIcon kind="filter" className="h-3.5 w-3.5" /></span>
        <span>Filters</span>
      </div>
      {children}
    </section>
  );
}

type MultiSelectOption = {
  value: string;
  label: string;
};

function summarizeSelection(selected: string[], options: MultiSelectOption[], allLabel: string): string {
  if (selected.length === 0) return allLabel;

  const labels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);

  if (labels.length === 0) return allLabel;
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
}

type ReportActionButtonVariant = 'default' | 'primary';

export function ReportActionButton({
  label,
  onClick,
  disabled,
  variant = 'default',
  className = '',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: ReportActionButtonVariant;
  className?: string;
}) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold transition-opacity disabled:opacity-40 ${className}`.trim()}
      style={{
        borderColor: isPrimary ? 'var(--brand-soft)' : 'var(--border-soft)',
        color: isPrimary ? '#fff' : 'var(--text-muted)',
        background: isPrimary ? 'var(--brand)' : 'var(--surface-strong)',
      }}
    >
      {label}
    </button>
  );
}

export function SortableHeaderButton({
  label,
  active = false,
  direction = 'asc',
  align = 'left',
  onClick,
}: {
  label: string;
  active?: boolean;
  direction?: 'asc' | 'desc';
  align?: 'left' | 'right';
  onClick: () => void;
}) {
  const indicator = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-full items-center gap-1.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}
      style={{ color: 'inherit' }}
    >
      <span>{label}</span>
      <span className="inline-flex w-3 justify-center" style={{ color: active ? 'var(--brand)' : 'inherit', opacity: active ? 1 : 0.65 }}>{indicator}</span>
    </button>
  );
}

export function ReportPagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  if (totalItems === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
      <div>
        Showing {start}-{end} of {totalItems}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)', background: 'var(--surface)' }}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <ReportActionButton label="Prev" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="h-8 px-2.5" />
        <span>Page {page} of {Math.max(totalPages, 1)}</span>
        <ReportActionButton label="Next" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="h-8 px-2.5" />
      </div>
    </div>
  );
}

export function MultiSelectFilter({
  label,
  selected,
  options,
  onChange,
  allLabel = 'All',
}: {
  label: string;
  selected: string[];
  options: MultiSelectOption[];
  onChange: (next: string[]) => void;
  allLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent): void {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, []);

  const summary = useMemo(() => summarizeSelection(selected, options, allLabel), [selected, options, allLabel]);

  function toggleValue(value: string): void {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }
    onChange([...selected, value]);
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
        style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
      >
        <span className="truncate text-left">{summary}</span>
        <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen ? (
        <div
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border shadow-lg"
          style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)' }}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className="block w-full border-b px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}
          >
            {allLabel}
          </button>

          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-2 text-sm last:border-b-0"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleValue(option.value)}
                />
                <span className="truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ReportState({ type, message }: { type: 'loading' | 'empty' | 'error'; message: string }) {
  const color = type === 'error' ? '#b91c1c' : 'var(--text-muted)';
  const background = type === 'error' ? '#fef2f2' : 'transparent';
  const border = type === 'error' ? '1px solid #fecaca' : 'none';

  return (
    <div className="px-4 py-16 text-center text-sm" style={{ color, background, border }}>
      {message}
    </div>
  );
}

export function statusBadgeClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'active') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'inactive') return 'bg-slate-200 text-slate-700';
  if (normalized === 'registered') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'submitted') return 'bg-blue-100 text-blue-700';
  if (normalized === 'pending') return 'bg-amber-100 text-amber-700';
  if (normalized === 'withdrawn') return 'bg-rose-100 text-rose-700';
  if (normalized === 'capped') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'not capped') return 'bg-amber-100 text-amber-700';
  if (normalized === 'system cap') return 'bg-blue-100 text-blue-700';
  if (normalized === 'manual cap') return 'bg-violet-100 text-violet-700';
  return 'bg-slate-100 text-slate-700';
}

export function StatusChip({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(value)}`}>{value}</span>;
}
