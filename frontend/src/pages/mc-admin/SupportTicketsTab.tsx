import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
type UiTicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED';
type LinkedType = 'listing' | 'transaction' | 'associate' | 'agent' | 'market_centre';

type SupportTicket = {
  id: string;
  ticket_number: string;
  source_market_center_id: string;
  source_market_center_name?: string | null;
  section: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_by_email: string;
  created_by_name: string | null;
  allocated_to_email?: string | null;
  allocated_to_name?: string | null;
  resolved_by_email?: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  linked_entity_type: LinkedType | null;
  linked_entity_id: string | null;
  linked_entity_label: string | null;
  linked_entity_path: string | null;
  created_at: string;
  updated_at: string;
};

type TicketActivity = {
  id: string;
  activity_type: string;
  body: string | null;
  status_from: string | null;
  status_to: string | null;
  actor_email: string | null;
  actor_name: string | null;
  created_at: string;
};

type TicketAttachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  file_size: string | null;
  file_url: string;
  note: string | null;
  uploaded_by_email: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

type LinkedSearchItem = {
  type: LinkedType;
  id: string;
  label: string;
  sourceMarketCenterId: string | null;
  path: string;
};

type DashboardMetric = {
  value: number;
  delta: number;
};

type DashboardData = {
  openTickets: DashboardMetric;
  pendingTickets: DashboardMetric;
  resolvedTickets: DashboardMetric;
  resolvedToday: DashboardMetric;
  averageResponseMinutes: DashboardMetric;
};

type RegionalAssignee = {
  email: string;
  name: string;
};

type DetailResponse = {
  ticket: SupportTicket;
  activity: TicketActivity[];
  attachments: TicketAttachment[];
};

const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUS_FILTER_OPTIONS: UiTicketStatus[] = ['OPEN', 'PENDING', 'RESOLVED'];
const LINK_TYPE_OPTIONS: Array<{ value: LinkedType; label: string }> = [
  { value: 'listing', label: 'Listing' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'associate', label: 'Associate' },
  { value: 'agent', label: 'Agent' },
  { value: 'market_centre', label: 'Market Centre' },
];
const SECTION_OPTIONS = [
  'Listings',
  'Transactions',
  'Associates',
  'Market Centres',
  'MC Admin Tools',
  'Reports',
  'Rentals',
  'Marketing',
  'Authentication',
  'Other',
];

const REQUIRED_LINK_TYPE_BY_SECTION: Partial<Record<string, LinkedType>> = {
  Listings: 'listing',
  Transactions: 'transaction',
  Associates: 'associate',
};

function requiredLinkedTypeForSection(section: string): LinkedType | null {
  return REQUIRED_LINK_TYPE_BY_SECTION[section] ?? null;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMinutesToDuration(rawMinutes: number): string {
  const minutes = Math.max(0, Math.round(rawMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function simplifyStatus(status: TicketStatus): UiTicketStatus {
  if (status === 'OPEN') return 'OPEN';
  if (status === 'IN_PROGRESS' || status === 'WAITING_CUSTOMER') return 'PENDING';
  return 'RESOLVED';
}

function uiStatusLabel(status: UiTicketStatus): string {
  if (status === 'OPEN') return 'Open';
  if (status === 'PENDING') return 'Pending';
  return 'Resolved';
}

function uiStatusToBackendStatus(status: UiTicketStatus): TicketStatus {
  if (status === 'OPEN') return 'OPEN';
  if (status === 'PENDING') return 'IN_PROGRESS';
  return 'CLOSED';
}

function linkedRecordLabel(type: LinkedType | null): string {
  if (type === 'listing') return 'Linked Listing';
  if (type === 'associate' || type === 'agent') return 'Linked Associate';
  if (type === 'transaction') return 'Linked Transaction';
  if (type === 'market_centre') return 'Linked Market Centre';
  return 'Linked Record';
}

function linkedRecordActionLabel(type: LinkedType | null): string {
  if (type === 'listing') return 'Open Listing';
  if (type === 'associate' || type === 'agent') return 'Open Associate';
  if (type === 'transaction') return 'Open Transaction';
  if (type === 'market_centre') return 'Open Market Centre';
  return 'Open Record';
}

function timelineActivityLabel(activityType: string): string {
  const normalized = String(activityType).trim().toUpperCase();
  if (normalized.includes('CREATE')) return 'Ticket created';
  if (normalized.includes('STATUS')) return 'Status updated';
  if (normalized.includes('EMAIL') || normalized.includes('NOTIF')) return 'Email notification sent';
  if (normalized.includes('COMMENT') || normalized.includes('NOTE')) return 'Regional Admin update';
  if (normalized.includes('ASSIGN')) return 'Ticket assignment updated';
  if (normalized.includes('RESOLV') || normalized.includes('CLOSE')) return 'Ticket resolved';
  return formatEnumLabel(activityType);
}

function normalizeLinkedPathForEdit(linkedPath: string | null): string | null {
  if (!linkedPath) return null;
  try {
    const url = new URL(linkedPath, window.location.origin);
    const pathname = url.pathname;
    const search = url.searchParams;

    if (pathname === '/listings' && search.get('search') && !search.get('review')) {
      search.set('review', search.get('search') ?? '');
      search.delete('search');
      return `${pathname}?${search.toString()}`;
    }

    if (pathname === '/transactions' && search.get('search') && !search.get('edit')) {
      search.set('edit', search.get('search') ?? '');
      search.delete('search');
      return `${pathname}?${search.toString()}`;
    }

    if (pathname === '/associates' && search.get('search')) {
      return `/agents?edit=${encodeURIComponent(search.get('search') ?? '')}`;
    }

    return linkedPath;
  } catch {
    return linkedPath;
  }
}

function statusLabelFromRaw(value: string): string {
  if (value === 'OPEN' || value === 'IN_PROGRESS' || value === 'WAITING_CUSTOMER' || value === 'RESOLVED' || value === 'CLOSED') {
    return uiStatusLabel(simplifyStatus(value));
  }
  return formatEnumLabel(value);
}

function severityBadge(status: UiTicketStatus): string {
  if (status === 'OPEN') return 'bg-red-100 text-red-700 border border-red-200';
  if (status === 'PENDING') return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
}

function priorityBadge(priority: TicketPriority): string {
  if (priority === 'URGENT') return 'bg-red-600 text-white border border-red-700';
  if (priority === 'HIGH') return 'bg-red-100 text-red-700 border border-red-200';
  if (priority === 'MEDIUM') return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

function priorityLabel(priority: TicketPriority): string {
  const raw = String(priority).trim().toLowerCase();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

function marketCentreLabel(ticket: Pick<SupportTicket, 'source_market_center_id' | 'source_market_center_name'>): string {
  return ticket.source_market_center_name?.trim() || ticket.source_market_center_id;
}

export default function SupportTicketsTab(): JSX.Element {
  const { token, activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'' | UiTicketStatus>('');
  const [priorityFilter, setPriorityFilter] = useState<'' | TicketPriority>('');
  const [searchFilter, setSearchFilter] = useState('');
  const [sourceMcFilter, setSourceMcFilter] = useState('');
  const [queueSection, setQueueSection] = useState<'ACTIVE' | 'RESOLVED'>('ACTIVE');
  const [panelMode, setPanelMode] = useState<'SUBMIT' | 'TICKETS'>(isOfficeAdmin ? 'SUBMIT' : 'TICKETS');

  const [createSection, setCreateSection] = useState('Listings');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPriority, setCreatePriority] = useState<TicketPriority>('MEDIUM');
  const [createSourceMc, setCreateSourceMc] = useState('');
  const [createLinkedType, setCreateLinkedType] = useState<'' | LinkedType>(requiredLinkedTypeForSection('Listings') ?? '');
  const [linkedSearchTerm, setLinkedSearchTerm] = useState('');
  const [linkedSearchBusy, setLinkedSearchBusy] = useState(false);
  const [linkedSearchItems, setLinkedSearchItems] = useState<LinkedSearchItem[]>([]);
  const [linkedSelected, setLinkedSelected] = useState<LinkedSearchItem | null>(null);
  const [creating, setCreating] = useState(false);
  const createAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [createAttachmentFiles, setCreateAttachmentFiles] = useState<File[]>([]);
  const [createAttachmentNote, setCreateAttachmentNote] = useState('');
  const [createDropActive, setCreateDropActive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [statusNext, setStatusNext] = useState<UiTicketStatus>('PENDING');
  const [statusNote, setStatusNote] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentNote, setAttachmentNote] = useState('');
  const [savingAttachment, setSavingAttachment] = useState(false);
  const [assignees, setAssignees] = useState<RegionalAssignee[]>([]);
  const [assignmentEmail, setAssignmentEmail] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);

  const canAccess = isOfficeAdmin || isRegionalAdmin;
  const requiredLinkedType = useMemo(() => requiredLinkedTypeForSection(createSection), [createSection]);
  const linkedRecordRequired = Boolean(requiredLinkedType);

  const authHeaders = useCallback(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (activeContext?.id) headers['x-active-context'] = activeContext.id;
    return headers;
  }, [token, activeContext]);

  const activeSourceMc = activeContext?.marketCenterId ?? '';

  useEffect(() => {
    setPanelMode(isOfficeAdmin ? 'SUBMIT' : 'TICKETS');
  }, [isOfficeAdmin, isRegionalAdmin]);

  useEffect(() => {
    if (isOfficeAdmin && !createSourceMc && activeSourceMc) {
      setCreateSourceMc(activeSourceMc);
    }
  }, [isOfficeAdmin, activeSourceMc, createSourceMc]);

  const loadDashboard = useCallback(async () => {
    if (!canAccess) return;
    const params = new URLSearchParams();
    if (isRegionalAdmin && sourceMcFilter.trim()) params.set('sourceMarketCenterId', sourceMcFilter.trim());
    const query = params.toString();
    const res = await fetch(`/api/support-tickets/dashboard${query ? `?${query}` : ''}`, { headers: authHeaders() });
    const body = await res.json() as DashboardData | { error?: string };
    if (!res.ok) {
      throw new Error((body as { error?: string }).error ?? 'Failed to load dashboard.');
    }
    setDashboard(body as DashboardData);
  }, [canAccess, isRegionalAdmin, sourceMcFilter, authHeaders]);

  const loadTickets = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (priorityFilter) params.set('priority', priorityFilter);
      if (searchFilter.trim()) params.set('q', searchFilter.trim());
      if (isRegionalAdmin && sourceMcFilter.trim()) params.set('sourceMarketCenterId', sourceMcFilter.trim());

      const res = await fetch(`/api/support-tickets?${params.toString()}`, { headers: authHeaders() });
      const body = await res.json() as { total?: number; items?: SupportTicket[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load tickets.');

      setTickets(body.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }, [canAccess, statusFilter, priorityFilter, searchFilter, sourceMcFilter, isRegionalAdmin, authHeaders]);

  const loadDetail = useCallback(async (ticketId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/support-tickets/${ticketId}`, { headers: authHeaders() });
      const body = await res.json() as DetailResponse | { error?: string };
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Failed to load ticket detail.');
      setDetail(body as DetailResponse);
      setStatusNext(simplifyStatus((body as DetailResponse).ticket.status));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load ticket detail.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadDashboard().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dashboard.'));
  }, [loadDashboard]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicketId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedTicketId);
  }, [selectedTicketId, loadDetail]);

  useEffect(() => {
    if (!isRegionalAdmin) {
      setAssignees([]);
      return;
    }

    const fetchAssignees = async () => {
      try {
        const res = await fetch('/api/support-tickets/regional-assignees', { headers: authHeaders() });
        const body = await res.json() as { items?: RegionalAssignee[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? 'Failed to load regional assignees.');
        setAssignees(body.items ?? []);
      } catch (loadAssigneesError) {
        setError(loadAssigneesError instanceof Error ? loadAssigneesError.message : 'Failed to load regional assignees.');
      }
    };

    void fetchAssignees();
  }, [isRegionalAdmin, authHeaders]);

  useEffect(() => {
    if (detail?.ticket.allocated_to_email) {
      setAssignmentEmail(detail.ticket.allocated_to_email);
    } else {
      setAssignmentEmail('');
    }
  }, [detail?.ticket.id, detail?.ticket.allocated_to_email]);

  useEffect(() => {
    if (!requiredLinkedType) return;
    if (createLinkedType !== requiredLinkedType) {
      setCreateLinkedType(requiredLinkedType);
      setLinkedSelected(null);
      setLinkedSearchItems([]);
    }
  }, [requiredLinkedType, createLinkedType]);

  async function searchLinkedRecords(): Promise<void> {
    if (!createLinkedType || linkedSearchTerm.trim().length < 2) {
      setLinkedSearchItems([]);
      return;
    }

    setLinkedSearchBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('type', createLinkedType);
      params.set('q', linkedSearchTerm.trim());
      if (isRegionalAdmin && createSourceMc.trim()) params.set('sourceMarketCenterId', createSourceMc.trim());
      params.set('limit', '12');

      const res = await fetch(`/api/support-tickets/linked-records/search?${params.toString()}`, { headers: authHeaders() });
      const body = await res.json() as { items?: LinkedSearchItem[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Linked record search failed.');
      setLinkedSearchItems(body.items ?? []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Linked record search failed.');
    } finally {
      setLinkedSearchBusy(false);
    }
  }

  async function createTicket(): Promise<void> {
    if (!createSection.trim() || !createTitle.trim() || !createDescription.trim()) {
      setError('MAPP Section, Ticket Title, and Description are required.');
      return;
    }

    if (requiredLinkedType && !linkedSelected) {
      const label = LINK_TYPE_OPTIONS.find((option) => option.value === requiredLinkedType)?.label ?? 'record';
      setError(`A linked ${label.toLowerCase()} is required for ${createSection} tickets.`);
      return;
    }

    if (requiredLinkedType && linkedSelected && linkedSelected.type !== requiredLinkedType) {
      const label = LINK_TYPE_OPTIONS.find((option) => option.value === requiredLinkedType)?.label ?? 'record';
      setError(`${createSection} tickets must be linked to a ${label.toLowerCase()}.`);
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: {
        sourceMarketCenterId?: string;
        sourceMarketCenterName?: string;
        section: string;
        title: string;
        description: string;
        priority: TicketPriority;
        linkedEntityType?: LinkedType;
        linkedEntityId?: string;
      } = {
        section: createSection,
        title: createTitle.trim(),
        description: createDescription.trim(),
        priority: createPriority,
      };

      if (createSourceMc.trim()) {
        payload.sourceMarketCenterId = createSourceMc.trim();
      }

      if (activeContext?.marketCenter) {
        payload.sourceMarketCenterName = activeContext.marketCenter;
      }

      if (linkedSelected) {
        payload.linkedEntityType = linkedSelected.type;
        payload.linkedEntityId = linkedSelected.id;
      }

      const res = await fetch('/api/support-tickets', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      const body = await res.json() as {
        ticket?: SupportTicket;
        error?: string;
        notification?: { sent?: boolean; error?: string };
        submitterNotification?: { sent?: boolean; error?: string };
      };
      if (!res.ok || !body.ticket) throw new Error(body.error ?? 'Failed to create ticket.');

      const notif = body.notification;
      const submitterNotif = body.submitterNotification;
      setSuccess(
        [
          `Ticket ${body.ticket.ticket_number} created.`,
          notif?.sent ? 'Support mailbox notified.' : `Support email notice: ${notif?.error ?? 'not sent'}.`,
          submitterNotif?.sent ? 'Submitter confirmation sent.' : `Submitter email notice: ${submitterNotif?.error ?? 'not sent'}.`,
        ].join(' '),
      );

      if (createAttachmentFiles.length > 0) {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (activeContext?.id) headers['x-active-context'] = activeContext.id;

        let failedUploads = 0;
        for (const file of createAttachmentFiles) {
          const formData = new FormData();
          formData.append('file', file);
          if (createAttachmentNote.trim()) formData.append('note', createAttachmentNote.trim());

          const uploadRes = await fetch(`/api/support-tickets/${body.ticket.id}/attachments`, {
            method: 'POST',
            headers,
            body: formData,
          });
          if (!uploadRes.ok) failedUploads += 1;
        }

        if (failedUploads > 0) {
          setSuccess((prev) => `${prev ?? ''} ${failedUploads} attachment upload(s) failed.`.trim());
        }
      }

      setCreateTitle('');
      setCreateDescription('');
      setCreatePriority('MEDIUM');
      setCreateLinkedType('');
      setLinkedSearchTerm('');
      setLinkedSearchItems([]);
      setLinkedSelected(null);
      setCreateAttachmentFiles([]);
      setCreateAttachmentNote('');
      setShowCreateForm(false);

      await loadTickets();
      await loadDashboard();
      setSelectedTicketId(body.ticket.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create ticket.');
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(): Promise<void> {
    if (!detail) return;
    setSavingStatus(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/support-tickets/${detail.ticket.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          status: uiStatusToBackendStatus(statusNext),
          note: statusNote.trim() || undefined,
        }),
      });

      const body = await res.json() as { error?: string; notification?: { sent?: boolean; error?: string } };
      if (!res.ok) throw new Error(body.error ?? 'Failed to update status.');

      const notif = body.notification;
      setSuccess(
        notif?.sent
          ? 'Status updated and submitter notified by email.'
          : `Status updated. Submitter email notice: ${notif?.error ?? 'not sent'}.`,
      );
      setStatusNote('');
      await loadTickets();
      await loadDashboard();
      setSelectedTicketId(null);
      setDetail(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to update status.');
    } finally {
      setSavingStatus(false);
    }
  }

  async function uploadAttachment(): Promise<void> {
    if (!detail || !attachmentFile) return;
    setSavingAttachment(true);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.append('file', attachmentFile);
      if (attachmentNote.trim()) formData.append('note', attachmentNote.trim());

      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (activeContext?.id) headers['x-active-context'] = activeContext.id;

      const res = await fetch(`/api/support-tickets/${detail.ticket.id}/attachments`, {
        method: 'POST',
        headers,
        body: formData,
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to upload attachment.');

      setAttachmentFile(null);
      setAttachmentNote('');
      setSuccess('Attachment uploaded.');
      await loadDetail(detail.ticket.id);
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : 'Failed to upload attachment.');
    } finally {
      setSavingAttachment(false);
    }
  }

  async function saveAssignment(): Promise<void> {
    if (!detail || !isRegionalAdmin) return;
    setSavingAssignment(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/support-tickets/${detail.ticket.id}/assignment`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ allocatedToEmail: assignmentEmail.trim() || null }),
      });
      const body = await res.json() as { ticket?: SupportTicket; error?: string };
      if (!res.ok || !body.ticket) throw new Error(body.error ?? 'Failed to save assignment.');
      setSuccess(assignmentEmail.trim() ? 'Ticket assignment updated.' : 'Ticket assignment cleared.');
      await loadTickets();
      await loadDetail(detail.ticket.id);
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : 'Failed to save assignment.');
    } finally {
      setSavingAssignment(false);
    }
  }

  const selectedLinkedPath = normalizeLinkedPathForEdit(linkedSelected?.path ?? null);
  const filteredTickets = useMemo(() => {
    const scopedByQueue = tickets.filter((ticket) => {
      const uiStatus = simplifyStatus(ticket.status);
      if (queueSection === 'RESOLVED') return uiStatus === 'RESOLVED';
      return uiStatus !== 'RESOLVED';
    });

    if (!statusFilter) return scopedByQueue;
    return scopedByQueue.filter((ticket) => simplifyStatus(ticket.status) === statusFilter);
  }, [tickets, queueSection, statusFilter]);

  function addCreateAttachmentFiles(files: FileList | File[]): void {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    setCreateAttachmentFiles((prev) => {
      const existingKeys = new Set(prev.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
      const next = [...prev];
      for (const file of incoming) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          next.push(file);
        }
      }
      return next;
    });
  }

  function removeCreateAttachment(index: number): void {
    setCreateAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function attachClipboardFiles(clipboardData: DataTransfer | null): boolean {
    if (!clipboardData?.items?.length) return false;
    const files: File[] = [];
    for (const item of Array.from(clipboardData.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length === 0) return false;
    addCreateAttachmentFiles(files);
    return true;
  }

  const cardTone = useMemo(() => ({
    open: 'bg-red-50 border-red-100 text-red-700',
    pending: 'bg-amber-50 border-amber-100 text-amber-700',
    resolved: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    response: 'bg-slate-50 border-slate-200 text-slate-700',
  }), []);

  if (!canAccess) {
    return <div className="surface-card p-6 text-sm text-slate-600">You do not have access to Support Tickets.</div>;
  }

  return (
    <section className="space-y-2.5">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</div>}

      {isOfficeAdmin && (
        <div className="surface-card rounded-xl border border-slate-200 p-1 shadow-sm">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setPanelMode('SUBMIT')}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-semibold',
                panelMode === 'SUBMIT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600',
              )}
            >
              Submit Ticket
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('TICKETS')}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-semibold',
                panelMode === 'TICKETS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600',
              )}
            >
              My Tickets
            </button>
          </div>
        </div>
      )}

      <div className={clsx('grid gap-2', isRegionalAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        {isRegionalAdmin && (
          <div className="lg:col-span-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket Dashboard</p>
          </div>
        )}
        <div className={clsx('rounded-xl border p-2.5 shadow-sm', cardTone.open)}>
          <p className="text-xs font-semibold uppercase tracking-wide">Open Tickets</p>
          <p className="mt-1 text-[26px] leading-none font-bold">{dashboard?.openTickets.value ?? 0}</p>
        </div>
        <div className={clsx('rounded-xl border p-2.5 shadow-sm', cardTone.pending)}>
          <p className="text-xs font-semibold uppercase tracking-wide">Pending Tickets</p>
          <p className="mt-1 text-[26px] leading-none font-bold">{dashboard?.pendingTickets.value ?? 0}</p>
        </div>
        <div className={clsx('rounded-xl border p-2.5 shadow-sm', cardTone.resolved)}>
          <p className="text-xs font-semibold uppercase tracking-wide">Resolved Tickets</p>
          <p className="mt-1 text-[26px] leading-none font-bold">{dashboard?.resolvedTickets?.value ?? dashboard?.resolvedToday.value ?? 0}</p>
        </div>
        {isRegionalAdmin && (
          <div className={clsx('rounded-xl border p-2.5 shadow-sm', cardTone.response)}>
            <p className="text-xs font-semibold uppercase tracking-wide">Average Response Time</p>
            <p className="mt-1 text-[26px] leading-none font-bold">{formatMinutesToDuration(dashboard?.averageResponseMinutes.value ?? 0)}</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {isOfficeAdmin && panelMode === 'SUBMIT' && (
        <div className="surface-card rounded-xl border border-slate-200 p-2.5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-slate-900">Create Support Ticket</h3>
            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700"
            >
              {showCreateForm ? 'Close Form' : 'Create Ticket'}
            </button>
          </div>

          {!showCreateForm && (
            <p className="mt-2 text-sm text-slate-500">
              Log a MAPP support issue and include as much detail as possible so the Regional Admin team can assist quickly.
            </p>
          )}
        </div>
        )}

        {isOfficeAdmin && panelMode === 'SUBMIT' && showCreateForm && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
            <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Create Support Ticket</h3>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">MAPP Section</label>
                  <select
                    value={createSection}
                    onChange={(e) => setCreateSection(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select section</option>
                    {SECTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ticket Title</label>
                  <input
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="Short summary of the issue"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Issue Description</label>
                  <p className="mt-1 text-xs text-slate-500">Please include a detailed description of the issue and expected behavior.</p>
                  <textarea
                    rows={4}
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    onPaste={(e) => {
                      if (attachClipboardFiles(e.clipboardData)) {
                        e.preventDefault();
                      }
                    }}
                    placeholder="Explain what happened and expected behavior"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2 md:col-span-2">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Priority</label>
                    <select
                      value={createPriority}
                      onChange={(e) => setCreatePriority(e.target.value as TicketPriority)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {PRIORITIES.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source MC</label>
                    <input
                      value={createSourceMc}
                      onChange={(e) => setCreateSourceMc(e.target.value)}
                      disabled={isOfficeAdmin && Boolean(activeSourceMc)}
                      placeholder={isOfficeAdmin ? activeSourceMc || 'From active context' : 'Enter source market centre id'}
                      className={clsx(
                        'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm',
                        isOfficeAdmin && Boolean(activeSourceMc) && 'bg-slate-100 text-slate-500',
                      )}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 md:col-span-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Record Type</label>
                  <select
                    value={createLinkedType}
                    onChange={(e) => {
                      if (requiredLinkedType) return;
                      setCreateLinkedType(e.target.value as '' | LinkedType);
                      setLinkedSelected(null);
                      setLinkedSearchItems([]);
                    }}
                    disabled={Boolean(requiredLinkedType)}
                    className={clsx(
                      'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm',
                      requiredLinkedType && 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {!requiredLinkedType && <option value="">None</option>}
                    {LINK_TYPE_OPTIONS.filter((option) => !requiredLinkedType || option.value === requiredLinkedType).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  {requiredLinkedType && (
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-selected from MAPP Section. Linking this record is required before creating the ticket.
                    </p>
                  )}

                  {createLinkedType && (
                    <>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={linkedSearchTerm}
                          onChange={(e) => setLinkedSearchTerm(e.target.value)}
                          placeholder={`Search ${LINK_TYPE_OPTIONS.find((item) => item.value === createLinkedType)?.label ?? 'record'}...`}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void searchLinkedRecords()}
                          disabled={linkedSearchBusy || linkedSearchTerm.trim().length < 2}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        >
                          {linkedSearchBusy ? 'Searching...' : 'Search'}
                        </button>
                      </div>

                      {linkedSearchItems.length > 0 && (
                        <div className="mt-2 max-h-36 overflow-auto rounded-lg border border-slate-200 bg-white">
                          {linkedSearchItems.map((item) => (
                            <button
                              key={`${item.type}-${item.id}`}
                              type="button"
                              onClick={() => {
                                setLinkedSelected(item);
                                setLinkedSearchItems([]);
                              }}
                              className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                            >
                              <div className="font-medium text-slate-800">{item.label}</div>
                              <div className="text-xs text-slate-500">{item.sourceMarketCenterId ?? 'No source MC'}</div>
                            </button>
                          ))}
                        </div>
                      )}

                      {linkedSelected && (
                        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                          {linkedRecordLabel(linkedSelected.type)}: {linkedSelected.label}
                          {selectedLinkedPath && (
                            <a className="ml-2 font-semibold underline" href={selectedLinkedPath} target="_blank" rel="noreferrer">{linkedRecordActionLabel(linkedSelected.type)}</a>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-2.5 md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attachments / Screenshots</label>
                    <button
                      type="button"
                      onClick={() => createAttachmentInputRef.current?.click()}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      Add Files
                    </button>
                  </div>
                  <input
                    ref={createAttachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) addCreateAttachmentFiles(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                  <div className="mt-2 rounded-lg border border-slate-300 bg-slate-50 p-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Paste Image Here</label>
                    <textarea
                      rows={1}
                      onPaste={(e) => {
                        if (attachClipboardFiles(e.clipboardData)) {
                          e.preventDefault();
                          setSuccess('Screenshot pasted and added to attachments.');
                        }
                      }}
                      placeholder="Click inside this box, then press Ctrl+V to paste a screenshot"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onPaste={(e) => {
                      if (attachClipboardFiles(e.clipboardData)) {
                        e.preventDefault();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setCreateDropActive(true);
                    }}
                    onDragLeave={() => setCreateDropActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setCreateDropActive(false);
                      if (e.dataTransfer.files?.length) addCreateAttachmentFiles(e.dataTransfer.files);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        createAttachmentInputRef.current?.click();
                      }
                    }}
                    className={clsx(
                      'mt-2 rounded-lg border border-dashed px-3 py-4 text-center text-sm transition-colors',
                      createDropActive ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-300 bg-slate-50 text-slate-600',
                    )}
                  >
                    Drag and drop screenshots/files here.
                  </div>
                  {createAttachmentFiles.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
                      {createAttachmentFiles.map((file, index) => (
                        <div key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800">{file.name}</div>
                            <div className="text-slate-500">{formatFileSize(file.size)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCreateAttachment(index)}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {createAttachmentFiles.length > 0 && (
                    <input
                      value={createAttachmentNote}
                      onChange={(e) => setCreateAttachmentNote(e.target.value)}
                      placeholder="Optional note for all attachments"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void createTicket()}
                  disabled={creating || !createSection.trim() || !createTitle.trim() || !createDescription.trim() || (linkedRecordRequired && !linkedSelected)}
                  className="md:col-span-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {creating ? 'Creating...' : 'Create Ticket'}
                </button>
              </div>
            </div>
          </div>
        )}

        {(isRegionalAdmin || panelMode === 'TICKETS') && (
        <div className="space-y-3">
          <div className="surface-card rounded-xl border border-slate-200 p-2.5 shadow-sm">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full sm:w-[170px]">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as '' | UiTicketStatus)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">All</option>
                  {STATUS_FILTER_OPTIONS.map((status) => <option key={status} value={status}>{uiStatusLabel(status)}</option>)}
                </select>
              </div>
              <div className="w-full sm:w-[170px]">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Priority</label>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value as '' | TicketPriority)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="">All</option>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </div>
              {isRegionalAdmin && (
                <div className="w-full sm:w-[170px]">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source MC</label>
                  <input
                    value={sourceMcFilter}
                    onChange={(e) => setSourceMcFilter(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    placeholder="All"
                  />
                </div>
              )}
              <div className="min-w-[240px] flex-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</label>
                <input
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Ticket number, title, linked record..."
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="w-full sm:w-auto">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</label>
                <button
                  type="button"
                  onClick={() => {
                    void loadTickets();
                    void loadDashboard();
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 sm:w-auto"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="surface-card rounded-xl border border-slate-200 p-2.5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{isRegionalAdmin ? 'All Tickets' : 'My Tickets'}</h3>
              <span className="text-xs text-slate-500">{filteredTickets.length} total</span>
            </div>

            <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setQueueSection('ACTIVE')}
                className={clsx('rounded-md px-3 py-1.5 text-xs font-semibold', queueSection === 'ACTIVE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setQueueSection('RESOLVED')}
                className={clsx('rounded-md px-3 py-1.5 text-xs font-semibold', queueSection === 'RESOLVED' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}
              >
                Resolved
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-slate-500">Loading tickets...</p>
            ) : filteredTickets.length === 0 ? (
              <p className="text-sm text-slate-500">No tickets found for current filters.</p>
            ) : queueSection === 'RESOLVED' ? (
              <div className="space-y-2">
                {filteredTickets.map((ticket) => {
                  const expanded = selectedTicketId === ticket.id;
                  const ticketMarketCentre = marketCentreLabel(ticket);
                  return (
                    <div key={ticket.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <button
                        type="button"
                        onClick={() => setSelectedTicketId(expanded ? null : ticket.id)}
                        className={clsx('w-full px-3 py-2.5 text-left hover:bg-slate-50', expanded && 'bg-slate-50')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900">{ticket.ticket_number} - {ticket.title}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Section: {ticket.section} | Market Centre: {ticketMarketCentre} | Submitted: {formatDate(ticket.created_at)} | Last updated: {formatDate(ticket.updated_at)}
                            </div>
                            {ticket.resolved_by_name && (
                              <div className="mt-1 text-xs text-slate-500">Resolved by: {ticket.resolved_by_name}</div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className={clsx('inline-flex min-w-[84px] justify-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-none', severityBadge(simplifyStatus(ticket.status)))}>{uiStatusLabel(simplifyStatus(ticket.status))}</span>
                            <span className={clsx('inline-flex min-w-[84px] justify-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-none', priorityBadge(ticket.priority))}>{priorityLabel(ticket.priority)}</span>
                          </div>
                        </div>
                      </button>
                      {expanded && detail?.ticket.id === ticket.id && (
                        <div className="border-t border-slate-200 bg-slate-50 p-3">
                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <p className="whitespace-pre-wrap text-sm text-slate-700">{detail.ticket.description}</p>
                            <div className="mt-2 text-xs text-slate-500">
                              Submitted by {detail.ticket.created_by_name ?? detail.ticket.created_by_email} on {formatDate(detail.ticket.created_at)}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">Market Centre: {marketCentreLabel(detail.ticket)}</div>
                            {detail.ticket.allocated_to_name && <div className="mt-1 text-xs text-slate-500">Allocated to: {detail.ticket.allocated_to_name}</div>}
                            {detail.ticket.resolved_by_name && (
                              <div className="mt-1 text-xs text-slate-500">
                                Resolved by: {detail.ticket.resolved_by_name}
                                {detail.ticket.resolved_at ? ` on ${formatDate(detail.ticket.resolved_at)}` : ''}
                              </div>
                            )}
                            {detail.ticket.linked_entity_label && (
                              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
                                <span className="font-semibold text-slate-800">{linkedRecordLabel(detail.ticket.linked_entity_type)}:</span> {detail.ticket.linked_entity_label}
                                {normalizeLinkedPathForEdit(detail.ticket.linked_entity_path) && (
                                  <a
                                    className="ml-2 font-semibold text-blue-700 underline"
                                    href={normalizeLinkedPathForEdit(detail.ticket.linked_entity_path) ?? '#'}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {linkedRecordActionLabel(detail.ticket.linked_entity_type)}
                                  </a>
                                )}
                              </div>
                            )}
                            {detail.attachments.length > 0 && (
                              <div className="mt-3 max-h-36 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
                                {detail.attachments.map((item) => (
                                  <div key={item.id} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                                    <a href={item.file_url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">{item.file_name}</a>
                                    <div className="text-xs text-slate-500">{item.file_size ? `${item.file_size} bytes` : 'size n/a'} | {formatDate(item.created_at)}</div>
                                    {item.note && <div className="text-xs text-slate-600">{item.note}</div>}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity Timeline</p>
                              <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white">
                                {detail.activity.map((event) => (
                                  <div key={event.id} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                                    <div className="font-semibold text-slate-800">{timelineActivityLabel(event.activity_type)}</div>
                                    {event.body && <div className="mt-1 whitespace-pre-wrap text-slate-700">{event.body}</div>}
                                    {event.status_from && event.status_to && (
                                      <div className="mt-1 text-xs text-slate-600">{statusLabelFromRaw(event.status_from)}{' -> '}{statusLabelFromRaw(event.status_to)}</div>
                                    )}
                                    <div className="mt-1 text-xs text-slate-500">{event.actor_name ?? event.actor_email ?? 'System'} | {formatDate(event.created_at)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="mt-3 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setSelectedTicketId(null)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                              >
                                Close up
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTickets.map((ticket) => {
                  const expanded = selectedTicketId === ticket.id;
                  return (
                    <div key={ticket.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <button
                        type="button"
                        onClick={() => setSelectedTicketId(expanded ? null : ticket.id)}
                        className={clsx('w-full px-3 py-3 text-left hover:bg-slate-50', expanded && 'bg-slate-50')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900">{ticket.ticket_number} - {ticket.title}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Section: {ticket.section} | Market Centre: {marketCentreLabel(ticket)} | Submitted: {formatDate(ticket.created_at)} | Last updated: {formatDate(ticket.updated_at)}
                            </div>
                            {ticket.allocated_to_name && (
                              <div className="mt-1 text-xs text-slate-500">Allocated to: {ticket.allocated_to_name}</div>
                            )}
                            {ticket.resolved_by_name && (
                              <div className="mt-1 text-xs text-slate-500">Resolved by: {ticket.resolved_by_name}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={clsx('inline-flex min-w-[84px] justify-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-none', severityBadge(simplifyStatus(ticket.status)))}>{uiStatusLabel(simplifyStatus(ticket.status))}</span>
                            <span className={clsx('inline-flex min-w-[84px] justify-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-none', priorityBadge(ticket.priority))}>{priorityLabel(ticket.priority)}</span>
                          </div>
                        </div>
                      </button>

                      {expanded && (
                        <div className="border-t border-slate-200 bg-slate-50 p-3">
                          {detailLoading && <p className="text-sm text-slate-500">Loading detail...</p>}

                          {detail?.ticket.id === ticket.id && (
                            <div className="space-y-3">
                              <div className="grid gap-2.5 md:grid-cols-2">
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issue Summary</p>
                                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{detail.ticket.description}</p>
                                  <div className="mt-2 text-xs text-slate-500">
                                    Submitted by {detail.ticket.created_by_name ?? detail.ticket.created_by_email} on {formatDate(detail.ticket.created_at)}
                                  </div>
                                </div>

                                {isRegionalAdmin && (
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Update Ticket Status</p>
                                    <p className="mt-1 text-xs text-slate-500">When you save a status update, the submitter will receive an email with your message.</p>
                                    <div className="mt-2">
                                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">New Status</label>
                                      <select
                                        value={statusNext}
                                        onChange={(e) => setStatusNext(e.target.value as UiTicketStatus)}
                                        disabled={savingStatus}
                                        className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2.5 text-sm disabled:bg-slate-100"
                                      >
                                        {STATUS_FILTER_OPTIONS.map((status) => <option key={status} value={status}>{uiStatusLabel(status)}</option>)}
                                      </select>
                                    </div>
                                    <textarea
                                      rows={3}
                                      value={statusNote}
                                      onChange={(e) => setStatusNote(e.target.value)}
                                      disabled={savingStatus}
                                      placeholder="Update message to submitter"
                                      className="mt-2 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm leading-5 disabled:bg-slate-100"
                                    />

                                    <div className="mt-3">
                                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Allocation</label>
                                      <select
                                        value={assignmentEmail}
                                        onChange={(e) => setAssignmentEmail(e.target.value)}
                                        className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-2.5 text-sm"
                                      >
                                        <option value="">Unassigned</option>
                                        {assignees.map((person) => (
                                          <option key={person.email} value={person.email}>{person.name} ({person.email})</option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() => void saveAssignment()}
                                        disabled={savingAssignment}
                                        className="mt-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                                      >
                                        {savingAssignment ? 'Saving...' : 'Save Assignment'}
                                      </button>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => void updateStatus()}
                                      disabled={savingStatus}
                                      className="mt-3 w-full rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
                                    >
                                      {savingStatus ? 'Saving...' : 'Save Update & Notify Submitter'}
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="grid gap-2.5 md:grid-cols-2">
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked Record</p>
                                  {detail.ticket.linked_entity_label ? (
                                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
                                      <span className="font-semibold text-slate-800">{linkedRecordLabel(detail.ticket.linked_entity_type)}:</span> {detail.ticket.linked_entity_label}
                                      {normalizeLinkedPathForEdit(detail.ticket.linked_entity_path) && (
                                        <a
                                          className="ml-2 font-semibold text-blue-700 underline"
                                          href={normalizeLinkedPathForEdit(detail.ticket.linked_entity_path) ?? '#'}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {linkedRecordActionLabel(detail.ticket.linked_entity_type)}
                                        </a>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-sm text-slate-500">No linked record.</p>
                                  )}

                                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attachments</p>
                                    <p className="mt-1 text-xs text-slate-500">Upload supporting screenshots or files for this ticket.</p>
                                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                                      <input
                                        type="file"
                                        onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void uploadAttachment()}
                                        disabled={!attachmentFile || savingAttachment}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                                      >
                                        {savingAttachment ? 'Uploading...' : 'Upload'}
                                      </button>
                                    </div>
                                    <input
                                      value={attachmentNote}
                                      onChange={(e) => setAttachmentNote(e.target.value)}
                                      placeholder="Optional attachment note"
                                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                  </div>

                                  {detail.attachments.length > 0 && (
                                    <div className="mt-3 max-h-36 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
                                      {detail.attachments.map((item) => (
                                        <div key={item.id} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                                          <a href={item.file_url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">{item.file_name}</a>
                                          <div className="text-xs text-slate-500">{item.file_size ? `${item.file_size} bytes` : 'size n/a'} | {formatDate(item.created_at)}</div>
                                          {item.note && <div className="text-xs text-slate-600">{item.note}</div>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity Timeline</p>
                                  <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
                                    {detail.activity.map((event) => (
                                      <div key={event.id} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                                        <div className="font-semibold text-slate-800">{timelineActivityLabel(event.activity_type)}</div>
                                        {event.body && <div className="mt-1 whitespace-pre-wrap text-slate-700">{event.body}</div>}
                                        {event.status_from && event.status_to && (
                                          <div className="mt-1 text-xs text-slate-600">{statusLabelFromRaw(event.status_from)}{' -> '}{statusLabelFromRaw(event.status_to)}</div>
                                        )}
                                        <div className="mt-1 text-xs text-slate-500">{event.actor_name ?? event.actor_email ?? 'System'} | {formatDate(event.created_at)}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setSelectedTicketId(null)}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                                >
                                  Close up
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
