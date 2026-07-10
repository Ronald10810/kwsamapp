import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isFeatureEnabled } from '../config/featureFlags';

type TrainingSeries = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
};

type TrainingVideo = {
  id: string;
  series_id: string;
  series_name: string;
  title: string;
  description: string | null;
  video_url: string;
  video_original_file_name: string;
  video_mime_type: string;
  video_file_size: string | null;
  thumbnail_url: string;
  thumbnail_original_file_name: string;
  thumbnail_mime_type: string;
  thumbnail_file_size: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
};

type TrainingHubResponse = {
  series?: TrainingSeries[];
  videos?: TrainingVideo[];
  error?: string;
};

type UploadSessionResponse = {
  video: {
    uploadUrl: string;
    publicUrl: string;
    objectName: string;
  };
  thumbnail: {
    uploadUrl: string;
    publicUrl: string;
    objectName: string;
  };
  error?: string;
};

async function uploadFileToResumableSession(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Storage upload failed (${response.status}).`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function TrainingHubPage() {
  const { token, activeContext, isRegionalAdmin } = useAuth();
  const [series, setSeries] = useState<TrainingSeries[]>([]);
  const [videos, setVideos] = useState<TrainingVideo[]>([]);
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<TrainingVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<TrainingVideo | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showSeries, setShowSeries] = useState(false);
  const [editingSeries, setEditingSeries] = useState<TrainingSeries | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seriesSaving, setSeriesSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadSeriesId, setUploadSeriesId] = useState('');
  const [uploadSortOrder, setUploadSortOrder] = useState('0');
  const [uploadVideoFile, setUploadVideoFile] = useState<File | null>(null);
  const [uploadThumbnailFile, setUploadThumbnailFile] = useState<File | null>(null);
  const [seriesName, setSeriesName] = useState('');
  const [seriesDescription, setSeriesDescription] = useState('');
  const [seriesSortOrder, setSeriesSortOrder] = useState('0');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSortOrder, setEditSortOrder] = useState('0');
  const [savingEdit, setSavingEdit] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const trainingHubEnabled = isFeatureEnabled('TRAINING_HUB_ENABLED');
  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (activeContext?.id) headers['X-Active-Context'] = activeContext.id;
    return headers;
  }, [token, activeContext]);

  async function loadTrainingHub() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/training-hub', { headers: authHeaders });
      const data = await response.json() as TrainingHubResponse;
      if (!response.ok || data.error) {
        throw new Error(data.error ?? 'Failed to load Training Hub.');
      }
      setSeries(data.series ?? []);
      setVideos(data.videos ?? []);
      setExpandedSeriesId((current) => current && (data.series ?? []).some((item) => item.id === current) ? current : null);
      if (!uploadSeriesId && (data.series ?? []).length > 0) {
        setUploadSeriesId(data.series![0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTrainingHub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const videosBySeries = useMemo(() => {
    const map = new Map<string, TrainingVideo[]>();
    for (const video of videos) {
      const list = map.get(video.series_id) ?? [];
      list.push(video);
      map.set(video.series_id, list);
    }
    return map;
  }, [videos]);

  function resetUploadForm() {
    setActionError(null);
    setUploadTitle('');
    setUploadDescription('');
    setUploadSortOrder('0');
    setUploadVideoFile(null);
    setUploadThumbnailFile(null);
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
  }

  function openUploadForSeries(seriesId: string) {
    setActionError(null);
    if (!uploadSeriesId) {
      setUploadSeriesId(seriesId);
    } else {
      setUploadSeriesId(seriesId);
    }
    setShowUpload(true);
  }

  async function handleUpload() {
    if (!uploadTitle.trim() || !uploadSeriesId || !uploadVideoFile || !uploadThumbnailFile) {
      setActionError('Title, series, video, and thumbnail are required.');
      return;
    }

    setUploading(true);
    setActionError(null);
    try {
      let uploaded: TrainingVideo | null = null;

      // Preferred flow for large files: upload directly to cloud storage via resumable sessions.
      const sessionResponse = await fetch('/api/training-hub/upload-session', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_original_file_name: uploadVideoFile.name,
          video_mime_type: uploadVideoFile.type || 'application/octet-stream',
          thumbnail_original_file_name: uploadThumbnailFile.name,
          thumbnail_mime_type: uploadThumbnailFile.type || 'application/octet-stream',
        }),
      });

      if (sessionResponse.ok) {
        const session = await sessionResponse.json() as UploadSessionResponse;
        if (session.error || !session.video?.uploadUrl || !session.thumbnail?.uploadUrl) {
          throw new Error(session.error ?? 'Could not start upload session.');
        }

        await uploadFileToResumableSession(session.video.uploadUrl, uploadVideoFile);
        await uploadFileToResumableSession(session.thumbnail.uploadUrl, uploadThumbnailFile);

        const finalizeResponse = await fetch('/api/training-hub/finalize', {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: uploadTitle.trim(),
            description: uploadDescription.trim(),
            series_id: uploadSeriesId,
            sort_order: uploadSortOrder.trim() || '0',
            video: {
              object_name: session.video.objectName,
              original_file_name: uploadVideoFile.name,
              mime_type: uploadVideoFile.type || 'application/octet-stream',
              file_size: uploadVideoFile.size,
            },
            thumbnail: {
              object_name: session.thumbnail.objectName,
              original_file_name: uploadThumbnailFile.name,
              mime_type: uploadThumbnailFile.type || 'application/octet-stream',
              file_size: uploadThumbnailFile.size,
            },
          }),
        });

        const finalized = await finalizeResponse.json() as TrainingVideo & { error?: string };
        if (!finalizeResponse.ok || finalized.error) {
          throw new Error(finalized.error ?? 'Upload finalization failed.');
        }
        uploaded = finalized;
      } else {
        // Fallback to existing multipart flow for environments where direct sessions are unavailable.
        const formData = new FormData();
        formData.append('title', uploadTitle.trim());
        formData.append('description', uploadDescription.trim());
        formData.append('series_id', uploadSeriesId);
        formData.append('sort_order', uploadSortOrder.trim() || '0');
        formData.append('video', uploadVideoFile);
        formData.append('thumbnail', uploadThumbnailFile);

        const response = await fetch('/api/training-hub', {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });
        const data = await response.json() as TrainingVideo & { error?: string };
        if (!response.ok || data.error) {
          throw new Error(data.error ?? 'Upload failed.');
        }
        uploaded = data;
      }

      if (!uploaded) {
        throw new Error('Upload failed before completion.');
      }

      setVideos((prev) => [uploaded!, ...prev]);
      setShowUpload(false);
      resetUploadForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/failed to fetch/i.test(message)) {
        setActionError('Upload failed while sending file data. This is usually caused by a network interruption or storage CORS policy. Please retry, or reduce file size and retry.');
      } else {
        setActionError(message);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateSeries() {
    if (!seriesName.trim()) {
      setActionError('Series name is required.');
      return;
    }

    setSeriesSaving(true);
    setActionError(null);
    try {
      const isEditing = Boolean(editingSeries);
      const response = await fetch(isEditing ? `/api/training-hub/series/${editingSeries!.id}` : '/api/training-hub/series', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: seriesName.trim(),
          description: seriesDescription.trim() || null,
          sort_order: Number(seriesSortOrder.trim() || '0'),
        }),
      });
      const data = await response.json() as TrainingSeries & { error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error ?? (isEditing ? 'Failed to update series.' : 'Failed to create series.'));
      }

      setSeries((prev) => {
        const next = isEditing
          ? prev.map((item) => (item.id === data.id ? data : item))
          : [...prev, data];
        return next.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      });
      setUploadSeriesId(data.id);
      setExpandedSeriesId(data.id);
      setShowSeries(false);
      setEditingSeries(null);
      setSeriesName('');
      setSeriesDescription('');
      setSeriesSortOrder('0');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeriesSaving(false);
    }
  }

  function openEditSeries(seriesItem: TrainingSeries) {
    setActionError(null);
    setEditingSeries(seriesItem);
    setSeriesName(seriesItem.name);
    setSeriesDescription(seriesItem.description ?? '');
    setSeriesSortOrder(String(seriesItem.sort_order ?? 0));
    setShowSeries(true);
  }

  async function handleDeleteSeries(seriesItem: TrainingSeries) {
    const linkedVideos = (videosBySeries.get(seriesItem.id) ?? []).length;
    const confirmText = linkedVideos > 0
      ? `Delete series "${seriesItem.name}"? It currently has ${linkedVideos} video${linkedVideos === 1 ? '' : 's'} and cannot be deleted until the series is empty.`
      : `Delete series "${seriesItem.name}"? This cannot be undone.`;

    if (!window.confirm(confirmText)) return;

    try {
      const response = await fetch(`/api/training-hub/series/${seriesItem.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Failed to delete series.');
      }

      setSeries((prev) => prev.filter((item) => item.id !== seriesItem.id));
      setVideos((prev) => prev.filter((video) => video.series_id !== seriesItem.id));
      if (expandedSeriesId === seriesItem.id) {
        setExpandedSeriesId(null);
      }
      if (uploadSeriesId === seriesItem.id) {
        const remaining = series.filter((item) => item.id !== seriesItem.id);
        setUploadSeriesId(remaining[0]?.id ?? '');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteVideo(videoId: string) {
    if (!window.confirm('Delete this training video?')) return;

    try {
      const response = await fetch(`/api/training-hub/${videoId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Failed to delete video.');
      }

      setVideos((prev) => prev.filter((video) => video.id !== videoId));
      if (selectedVideo?.id === videoId) {
        setSelectedVideo(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function openEditVideo(video: TrainingVideo) {
    setActionError(null);
    setEditingVideo(video);
    setEditTitle(video.title);
    setEditDescription(video.description ?? '');
    setEditSortOrder(String(video.sort_order ?? 0));
  }

  function sortVideos(list: TrainingVideo[]): TrainingVideo[] {
    return [...list].sort((left, right) => {
      if (left.series_id !== right.series_id) {
        return left.series_name.localeCompare(right.series_name) || left.series_id.localeCompare(right.series_id);
      }

      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }

  async function handleSaveEdit() {
    if (!editingVideo) return;
    if (!editTitle.trim()) {
      setActionError('Video title is required.');
      return;
    }

    setSavingEdit(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/training-hub/${editingVideo.id}`, {
        method: 'PATCH',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          sort_order: Number(editSortOrder.trim() || '0'),
        }),
      });
      const data = await response.json() as TrainingVideo & { error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error ?? 'Failed to save video.');
      }

      setVideos((prev) => sortVideos(prev.map((video) => (video.id === data.id ? data : video))));
      if (selectedVideo?.id === data.id) {
        setSelectedVideo(data);
      }
      setEditingVideo(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  if (!trainingHubEnabled) {
    return (
      <section className="surface-card p-6 sm:p-8">
        <h1 className="page-title text-2xl sm:text-3xl">Training Hub</h1>
        <p className="mt-2 text-sm text-slate-600">Training Hub is not enabled in this environment yet.</p>
      </section>
    );
  }

  const adminActions = isRegionalAdmin ? (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => {
          setActionError(null);
          setEditingSeries(null);
          setSeriesName('');
          setSeriesDescription('');
          setSeriesSortOrder('0');
          setShowSeries(true);
        }}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
      >
        Add Series
      </button>
      <button
        type="button"
        onClick={() => { resetUploadForm(); setShowUpload(true); }}
        className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
      >
        Upload Video
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <section className="surface-card p-6 sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">MAPP Training Hub</p>
            <h1 className="page-title mt-2 text-2xl sm:text-3xl lg:text-4xl">Training Hub</h1>
            <p className="mt-2 text-sm text-slate-600">
              A clean, internal library for MAPP tutorial videos, with Regional Admin-only uploads and thumbnail support.
            </p>
          </div>
          {adminActions}
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">{series.length} series</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">{videos.length} videos</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-500">Videos + thumbnails stored in Cloud Storage or local uploads</span>
        </div>
      </section>

      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
      )}

      {loading && (
        <div className="surface-card flex items-center justify-center gap-3 py-10 text-sm text-slate-500">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
          Loading Training Hub…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && series.map((seriesItem) => {
        const items = videosBySeries.get(seriesItem.id) ?? [];
        const isExpanded = expandedSeriesId === seriesItem.id;
        return (
          <section key={seriesItem.id} className="surface-card p-5 sm:p-6">
            <div className="flex w-full items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setExpandedSeriesId(isExpanded ? null : seriesItem.id)}
                className="min-w-0 flex-1 text-left"
                aria-expanded={isExpanded}
              >
                <h2 className="text-lg font-semibold text-slate-800">{seriesItem.name}</h2>
                {seriesItem.description ? <p className="mt-1 text-sm text-slate-500">{seriesItem.description}</p> : null}
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{items.length} video{items.length === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  onClick={() => setExpandedSeriesId(isExpanded ? null : seriesItem.id)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-transform duration-200"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  aria-label={isExpanded ? 'Collapse series' : 'Expand series'}
                >
                  ▼
                </button>
                {isRegionalAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditSeries(seriesItem)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Edit Series
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSeries(seriesItem)}
                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                    >
                      Delete Series
                    </button>
                    <button
                      type="button"
                      onClick={() => openUploadForSeries(seriesItem.id)}
                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                    >
                      Upload Video to Series
                    </button>
                  </>
                )}
              </div>
            </div>

            {isExpanded && (items.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No videos in this series yet.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((video) => {
                  const sizeBytes = video.video_file_size ? Number(video.video_file_size) : null;
                  return (
                    <article
                      key={video.id}
                      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <button type="button" onClick={() => setSelectedVideo(video)} className="block w-full text-left">
                        <div className="relative aspect-video overflow-hidden bg-slate-100">
                          <img
                            src={video.thumbnail_url}
                            alt={video.title}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                          <div className="absolute bottom-3 left-3 inline-flex items-center rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                            Watch
                          </div>
                        </div>

                        <div className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-slate-800 line-clamp-2">{video.title}</h3>
                            <span className="rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{video.series_name}</span>
                          </div>
                          {video.description ? <p className="text-xs leading-5 text-slate-500 line-clamp-2">{video.description}</p> : null}

                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span>{formatDate(video.created_at)}</span>
                            {sizeBytes !== null ? <span>{formatBytes(sizeBytes)}</span> : null}
                            <span>{video.video_mime_type.split('/')[1]?.toUpperCase() ?? 'VIDEO'}</span>
                          </div>
                        </div>
                      </button>

                      {isRegionalAdmin && (
                        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedVideo(video)}
                            className="text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900"
                          >
                            Preview
                          </button>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEditVideo(video)}
                              className="text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteVideo(video.id)}
                              className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}

      {!loading && !error && series.length === 0 && (
        <section className="surface-card p-10 text-center text-sm text-slate-500">
          No training series have been created yet.
        </section>
      )}

      {selectedVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[92vh] w-[min(96vw,1320px)] max-w-7xl overflow-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Training Video</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{selectedVideo.title}</h3>
              </div>
              <button type="button" onClick={() => setSelectedVideo(null)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(340px,0.75fr)] xl:gap-8 xl:p-6">
              <div>
                <video controls poster={selectedVideo.thumbnail_url} className="w-full rounded-2xl bg-black shadow-lg">
                  <source src={selectedVideo.video_url} type={selectedVideo.video_mime_type} />
                </video>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Series</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{selectedVideo.series_name}</p>
                </div>
                {selectedVideo.description ? <p className="text-sm leading-6 text-slate-600">{selectedVideo.description}</p> : null}
                <div className="grid gap-3 text-sm text-slate-600">
                  <div><span className="font-semibold text-slate-900">Uploaded:</span> {formatDate(selectedVideo.created_at)}</div>
                  <div><span className="font-semibold text-slate-900">Sort order:</span> {selectedVideo.sort_order}</div>
                  {selectedVideo.created_by ? <div><span className="font-semibold text-slate-900">Uploaded by:</span> {selectedVideo.created_by}</div> : null}
                </div>
                {isRegionalAdmin && (
                  <button
                    type="button"
                    onClick={() => openEditVideo(selectedVideo)}
                    className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Edit Details
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingVideo && isRegionalAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Edit Video Details</h3>
              <button type="button" onClick={() => setEditingVideo(null)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Title</span>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Description</span>
                <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Sort order</span>
                <input type="number" value={editSortOrder} onChange={(e) => setEditSortOrder(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setEditingVideo(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="button" onClick={() => void handleSaveEdit()} disabled={savingEdit} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSeries && isRegionalAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{editingSeries ? 'Edit Series' : 'Add Series'}</h3>
              <button type="button" onClick={() => { setShowSeries(false); setEditingSeries(null); }} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Series name</span>
                <input value={seriesName} onChange={(e) => setSeriesName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" placeholder="For example: MAPP Basics" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Description</span>
                <textarea value={seriesDescription} onChange={(e) => setSeriesDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" placeholder="Short explanation of this series" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Sort order</span>
                <input type="number" value={seriesSortOrder} onChange={(e) => setSeriesSortOrder(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => { setShowSeries(false); setEditingSeries(null); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="button" onClick={() => void handleCreateSeries()} disabled={seriesSaving} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {seriesSaving ? 'Saving…' : editingSeries ? 'Save Changes' : 'Save Series'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpload && isRegionalAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Upload Video</h3>
              <button type="button" onClick={() => setShowUpload(false)} className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Uploading to: <span className="font-semibold text-slate-900">{series.find((item) => item.id === uploadSeriesId)?.name ?? 'Select a series'}</span>
              </div>
              <label className="block space-y-1 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">Title</span>
                <input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" placeholder="Enter a clear video title" />
              </label>
              <label className="block space-y-1 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">Description</span>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={4} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" placeholder="Short summary of what the video covers" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Series</span>
                <select value={uploadSeriesId} onChange={(e) => setUploadSeriesId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200">
                  {series.map((seriesItem) => <option key={seriesItem.id} value={seriesItem.id}>{seriesItem.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Sort order</span>
                <input type="number" value={uploadSortOrder} onChange={(e) => setUploadSortOrder(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200" />
              </label>
              <label className="block space-y-1 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">Video file</span>
                <input ref={videoInputRef} type="file" accept="video/*" onChange={(e) => setUploadVideoFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200" />
              </label>
              <label className="block space-y-1 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">Thumbnail image</span>
                <input ref={thumbnailInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setUploadThumbnailFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200" />
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => { setShowUpload(false); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button type="button" onClick={() => void handleUpload()} disabled={uploading} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {uploading ? 'Uploading…' : 'Upload Video'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}