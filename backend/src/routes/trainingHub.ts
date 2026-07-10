/**
 * Training Hub Routes
 *
 * Managed video library for MAPP training content.
 * Videos and thumbnails are stored in Cloud Storage when configured, or local
 * disk during development, while SQL stores only metadata and object references.
 */

import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { storageConfig, ensureLocalUploadDirs, resolveLocalUploadDir } from '../config/storage.js';
import { createResumableUploadSession, gcsObjectExists, getPublicUrlForObject, uploadToGcs } from '../services/gcsStorage.js';

const router = Router();

const videoUploadDir = resolveLocalUploadDir('training-hub/videos');
const thumbnailUploadDir = resolveLocalUploadDir('training-hub/thumbnails');
await ensureLocalUploadDirs('training-hub/videos', 'training-hub/thumbnails').catch(() => undefined);

type MediaFieldName = 'video' | 'thumbnail';

type StoredMedia = {
  url: string;
  objectName: string | null;
  localPath: string | null;
};

type UploadedFile = Express.Multer.File & {
  path?: string;
  buffer?: Buffer;
};

type UploadedAssetInput = {
  object_name: string;
  original_file_name: string;
  mime_type: string;
  file_size: number | null;
};

function isTrainingHubEnabled(): boolean {
  return env.trainingHub.enabled;
}

function isRegionalAdminOnly(perms: { isRegionalAdmin: boolean }): boolean {
  return perms.isRegionalAdmin;
}

function sanitizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseOptionalInt(value: unknown): number | null {
  const raw = sanitizeText(value);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalBigInt(value: unknown): number | null {
  const raw = sanitizeText(value);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function getSingleFile(req: unknown, fieldName: MediaFieldName): UploadedFile | null {
  const files = (req as { files?: Record<string, UploadedFile[]> }).files;
  const file = files?.[fieldName]?.[0];
  return file ?? null;
}

function uploadFieldNameAllowed(fieldName: string, mimetype: string): boolean {
  if (fieldName === 'video') {
    return mimetype.startsWith('video/');
  }

  if (fieldName === 'thumbnail') {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(mimetype);
  }

  return false;
}

const storageEngine = storageConfig.localUploadsEnabled
  ? multer.diskStorage({
      destination: (_req, file, cb) => {
        cb(null, file.fieldname === 'video' ? videoUploadDir : thumbnailUploadDir);
      },
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
      },
    })
  : multer.memoryStorage();

const upload = multer({
  storage: storageEngine,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!uploadFieldNameAllowed(file.fieldname, file.mimetype)) {
      cb(new Error('Only video files plus JPEG, PNG, or WEBP thumbnails are allowed.'));
      return;
    }
    cb(null, true);
  },
});

async function runUpload(req: unknown, res: unknown, middleware: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (middleware as (req: unknown, res: unknown, next: (err?: unknown) => void) => void)(
      req,
      res,
      (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function removeFileIfExists(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => undefined);
}

async function storeUploadedMedia(file: UploadedFile, prefix: string, localSubdir: string): Promise<StoredMedia> {
  if (storageConfig.localUploadsEnabled) {
    const localPath = file.path ?? path.join(resolveLocalUploadDir(localSubdir), file.filename);
    const url = `/uploads/${localSubdir}/${file.filename}`;
    return { url, objectName: null, localPath };
  }

  if (!file.buffer) {
    throw new Error('Upload buffer is missing.');
  }

  const { publicUrl, objectName } = await uploadToGcs(file.buffer, file.originalname, prefix, file.mimetype);
  return { url: publicUrl, objectName, localPath: null };
}

async function ensureTables(): Promise<void> {
  try {
    const pool = getRequiredPgPool();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.training_hub_series (
        id           BIGSERIAL   PRIMARY KEY,
        name         TEXT        NOT NULL,
        description  TEXT,
        sort_order   INTEGER     NOT NULL DEFAULT 0,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS training_hub_series_sort_idx
        ON migration.training_hub_series (sort_order, created_at DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.training_hub_videos (
        id                         BIGSERIAL   PRIMARY KEY,
        series_id                  BIGINT      NOT NULL REFERENCES migration.training_hub_series(id) ON DELETE RESTRICT,
        title                      TEXT        NOT NULL,
        description                TEXT,
        video_url                  TEXT        NOT NULL,
        video_object_name          TEXT,
        video_local_path           TEXT,
        video_original_file_name   TEXT        NOT NULL,
        video_mime_type            TEXT        NOT NULL,
        video_file_size            BIGINT,
        thumbnail_url              TEXT        NOT NULL,
        thumbnail_object_name      TEXT,
        thumbnail_local_path       TEXT,
        thumbnail_original_file_name TEXT      NOT NULL,
        thumbnail_mime_type        TEXT        NOT NULL,
        thumbnail_file_size        BIGINT,
        sort_order                 INTEGER     NOT NULL DEFAULT 0,
        created_by                 TEXT,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS training_hub_videos_series_idx
        ON migration.training_hub_videos (series_id, sort_order, created_at DESC)
    `);

    await pool.query(`
      INSERT INTO migration.training_hub_series (name, description, sort_order, created_by)
      SELECT 'MAPP Tutorials', 'Starter training content for MAPP users.', 1, 'system'
      WHERE NOT EXISTS (
        SELECT 1 FROM migration.training_hub_series WHERE LOWER(TRIM(name)) = LOWER(TRIM('MAPP Tutorials'))
      )
    `);
  } catch {
    // Non-fatal during startup; the route will still fail safely if the DB is unavailable.
  }
}

function getCreatedByName(req: { user?: { name?: string; email?: string } | null }): string {
  const displayName = String(req.user?.name ?? '').trim();
  if (displayName) return displayName;
  return String(req.user?.email ?? 'unknown').trim() || 'unknown';
}

ensureTables().catch(() => undefined);

router.post('/upload-session', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  if (storageConfig.localUploadsEnabled) {
    return res.status(400).json({ error: 'Large upload sessions are unavailable when local upload mode is enabled.' });
  }

  const videoOriginalName = sanitizeText(req.body?.video_original_file_name);
  const videoMimeType = sanitizeText(req.body?.video_mime_type);
  const thumbnailOriginalName = sanitizeText(req.body?.thumbnail_original_file_name);
  const thumbnailMimeType = sanitizeText(req.body?.thumbnail_mime_type);

  if (!videoOriginalName || !videoMimeType.startsWith('video/')) {
    return res.status(400).json({ error: 'A valid video file name and mime type are required.' });
  }

  if (!thumbnailOriginalName || !['image/jpeg', 'image/png', 'image/webp'].includes(thumbnailMimeType)) {
    return res.status(400).json({ error: 'A valid thumbnail file name and mime type are required.' });
  }

  try {
    const [video, thumbnail] = await Promise.all([
      createResumableUploadSession(videoOriginalName, 'training-hub-video', videoMimeType),
      createResumableUploadSession(thumbnailOriginalName, 'training-hub-thumbnail', thumbnailMimeType),
    ]);

    return res.status(201).json({ video, thumbnail });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.post('/finalize', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const title = sanitizeText(req.body?.title);
  const description = sanitizeText(req.body?.description) || null;
  const seriesId = parseOptionalInt(req.body?.series_id);
  const sortOrder = parseOptionalInt(req.body?.sort_order) ?? 0;

  const video: UploadedAssetInput = {
    object_name: sanitizeText(req.body?.video?.object_name),
    original_file_name: sanitizeText(req.body?.video?.original_file_name),
    mime_type: sanitizeText(req.body?.video?.mime_type),
    file_size: parseOptionalBigInt(req.body?.video?.file_size),
  };
  const thumbnail: UploadedAssetInput = {
    object_name: sanitizeText(req.body?.thumbnail?.object_name),
    original_file_name: sanitizeText(req.body?.thumbnail?.original_file_name),
    mime_type: sanitizeText(req.body?.thumbnail?.mime_type),
    file_size: parseOptionalBigInt(req.body?.thumbnail?.file_size),
  };

  if (!title) {
    return res.status(400).json({ error: 'Video title is required.' });
  }

  if (!seriesId || seriesId <= 0) {
    return res.status(400).json({ error: 'A training series is required.' });
  }

  if (!video.object_name || !video.original_file_name || !video.mime_type.startsWith('video/')) {
    return res.status(400).json({ error: 'Uploaded video metadata is invalid.' });
  }

  if (!thumbnail.object_name || !thumbnail.original_file_name || !['image/jpeg', 'image/png', 'image/webp'].includes(thumbnail.mime_type)) {
    return res.status(400).json({ error: 'Uploaded thumbnail metadata is invalid.' });
  }

  const pool = getRequiredPgPool();

  try {
    const seriesResult = await pool.query<{ id: string }>(
      `SELECT id::text
       FROM migration.training_hub_series
       WHERE id = $1
       LIMIT 1`,
      [seriesId]
    );

    if (!seriesResult.rows[0]) {
      return res.status(400).json({ error: 'Training series not found.' });
    }

    if (!storageConfig.localUploadsEnabled) {
      const [videoExists, thumbnailExists] = await Promise.all([
        gcsObjectExists(video.object_name),
        gcsObjectExists(thumbnail.object_name),
      ]);
      if (!videoExists || !thumbnailExists) {
        return res.status(400).json({ error: 'Uploaded files were not found in storage. Please retry the upload.' });
      }
    }

    const result = await pool.query<{
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
    }>(
      `INSERT INTO migration.training_hub_videos (
         series_id, title, description, video_url, video_object_name, video_local_path,
         video_original_file_name, video_mime_type, video_file_size,
         thumbnail_url, thumbnail_object_name, thumbnail_local_path,
         thumbnail_original_file_name, thumbnail_mime_type, thumbnail_file_size,
         sort_order, created_by
       )
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, NULL, $11, $12, $13, $14, $15)
       RETURNING id::text, series_id::text,
         (SELECT name FROM migration.training_hub_series WHERE id = series_id) AS series_name,
         title, description, video_url, video_original_file_name, video_mime_type,
         video_file_size::text, thumbnail_url, thumbnail_original_file_name,
         thumbnail_mime_type, thumbnail_file_size::text, sort_order, created_by, created_at::text`,
      [
        seriesId,
        title,
        description,
        getPublicUrlForObject(video.object_name),
        video.object_name,
        video.original_file_name,
        video.mime_type,
        video.file_size,
        getPublicUrlForObject(thumbnail.object_name),
        thumbnail.object_name,
        thumbnail.original_file_name,
        thumbnail.mime_type,
        thumbnail.file_size,
        sortOrder,
        getCreatedByName(req),
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.get('/', resolvePermissions, async (_req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const pool = getRequiredPgPool();

  try {
    const [seriesResult, videosResult] = await Promise.all([
      pool.query<{
        id: string;
        name: string;
        description: string | null;
        sort_order: number;
        created_at: string;
      }>(
        `SELECT id::text, name, description, sort_order, created_at::text
         FROM migration.training_hub_series
         ORDER BY sort_order ASC, name ASC, created_at ASC`
      ),
      pool.query<{
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
      }>(
        `SELECT v.id::text,
                v.series_id::text,
                s.name AS series_name,
                v.title,
                v.description,
                v.video_url,
                v.video_original_file_name,
                v.video_mime_type,
                v.video_file_size::text,
                v.thumbnail_url,
                v.thumbnail_original_file_name,
                v.thumbnail_mime_type,
                v.thumbnail_file_size::text,
                v.sort_order,
                v.created_by,
                v.created_at::text
         FROM migration.training_hub_videos v
         JOIN migration.training_hub_series s ON s.id = v.series_id
         ORDER BY s.sort_order ASC, s.name ASC, v.sort_order ASC, v.created_at DESC`
      ),
    ]);

    return res.json({ series: seriesResult.rows, videos: videosResult.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.post('/series', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const name = sanitizeText(req.body?.name);
  const description = sanitizeText(req.body?.description) || null;
  const sortOrder = parseOptionalInt(req.body?.sort_order) ?? 0;

  if (!name) {
    return res.status(400).json({ error: 'Series name is required.' });
  }

  const pool = getRequiredPgPool();

  try {
    const duplicate = await pool.query<{ id: string }>(
      `SELECT id::text
       FROM migration.training_hub_series
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
       LIMIT 1`,
      [name]
    );

    if (duplicate.rows[0]) {
      return res.status(409).json({ error: 'A series with this name already exists.' });
    }

    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      sort_order: number;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO migration.training_hub_series (name, description, sort_order, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text, name, description, sort_order, created_by, created_at::text, updated_at::text`,
      [name, description, sortOrder, getCreatedByName(req)]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.patch('/series/:id', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const seriesId = Number(req.params.id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    return res.status(400).json({ error: 'Invalid series ID.' });
  }

  const name = sanitizeText(req.body?.name);
  const description = sanitizeText(req.body?.description) || null;
  const sortOrder = parseOptionalInt(req.body?.sort_order) ?? 0;

  if (!name) {
    return res.status(400).json({ error: 'Series name is required.' });
  }

  const pool = getRequiredPgPool();

  try {
    const duplicate = await pool.query<{ id: string }>(
      `SELECT id::text
       FROM migration.training_hub_series
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND id <> $2
       LIMIT 1`,
      [name, seriesId]
    );

    if (duplicate.rows[0]) {
      return res.status(409).json({ error: 'A series with this name already exists.' });
    }

    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      sort_order: number;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE migration.training_hub_series
       SET name = $1,
           description = $2,
           sort_order = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id::text, name, description, sort_order, created_by, created_at::text, updated_at::text`,
      [name, description, sortOrder, seriesId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Training series not found.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.delete('/series/:id', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const seriesId = Number(req.params.id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    return res.status(400).json({ error: 'Invalid series ID.' });
  }

  const pool = getRequiredPgPool();

  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id::text
       FROM migration.training_hub_series
       WHERE id = $1
       LIMIT 1`,
      [seriesId]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Training series not found.' });
    }

    const linkedVideos = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM migration.training_hub_videos
       WHERE series_id = $1`,
      [seriesId]
    );
    const videoCount = Number(linkedVideos.rows[0]?.count ?? '0');
    if (videoCount > 0) {
      return res.status(409).json({ error: 'Cannot delete a series that still has videos. Delete or move the videos first.' });
    }

    await pool.query(`DELETE FROM migration.training_hub_series WHERE id = $1`, [seriesId]);
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.post('/', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  try {
    await runUpload(req, res, upload.fields([
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('large') || message.toLowerCase().includes('limit')) {
      return res.status(413).json({ error: 'One of the uploaded files is too large.' });
    }
    return res.status(400).json({ error: message });
  }

  const title = sanitizeText(req.body?.title);
  const description = sanitizeText(req.body?.description) || null;
  const seriesId = parseOptionalInt(req.body?.series_id);
  const sortOrder = parseOptionalInt(req.body?.sort_order) ?? 0;
  const videoFile = getSingleFile(req, 'video');
  const thumbnailFile = getSingleFile(req, 'thumbnail');

  if (!title) {
    await removeFileIfExists(videoFile?.path);
    await removeFileIfExists(thumbnailFile?.path);
    return res.status(400).json({ error: 'Video title is required.' });
  }

  if (!seriesId || seriesId <= 0) {
    await removeFileIfExists(videoFile?.path);
    await removeFileIfExists(thumbnailFile?.path);
    return res.status(400).json({ error: 'A training series is required.' });
  }

  if (!videoFile || !thumbnailFile) {
    await removeFileIfExists(videoFile?.path);
    await removeFileIfExists(thumbnailFile?.path);
    return res.status(400).json({ error: 'Both a video file and a thumbnail image are required.' });
  }

  const pool = getRequiredPgPool();

  try {
    const seriesResult = await pool.query<{ id: string }>(
      `SELECT id::text
       FROM migration.training_hub_series
       WHERE id = $1
       LIMIT 1`,
      [seriesId]
    );

    if (!seriesResult.rows[0]) {
      await removeFileIfExists(videoFile.path);
      await removeFileIfExists(thumbnailFile.path);
      return res.status(400).json({ error: 'Training series not found.' });
    }

    const storedVideo = await storeUploadedMedia(videoFile, 'training-hub-video', 'training-hub/videos');
    const storedThumbnail = await storeUploadedMedia(thumbnailFile, 'training-hub-thumbnail', 'training-hub/thumbnails');

    const result = await pool.query<{
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
    }>(
      `INSERT INTO migration.training_hub_videos (
         series_id, title, description, video_url, video_object_name, video_local_path,
         video_original_file_name, video_mime_type, video_file_size,
         thumbnail_url, thumbnail_object_name, thumbnail_local_path,
         thumbnail_original_file_name, thumbnail_mime_type, thumbnail_file_size,
         sort_order, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id::text, series_id::text,
         (SELECT name FROM migration.training_hub_series WHERE id = series_id) AS series_name,
         title, description, video_url, video_original_file_name, video_mime_type,
         video_file_size::text, thumbnail_url, thumbnail_original_file_name,
         thumbnail_mime_type, thumbnail_file_size::text, sort_order, created_by, created_at::text`,
      [
        seriesId,
        title,
        description,
        storedVideo.url,
        storedVideo.objectName,
        storedVideo.localPath,
        videoFile.originalname,
        videoFile.mimetype,
        videoFile.size ?? null,
        storedThumbnail.url,
        storedThumbnail.objectName,
        storedThumbnail.localPath,
        thumbnailFile.originalname,
        thumbnailFile.mimetype,
        thumbnailFile.size ?? null,
        sortOrder,
        getCreatedByName(req),
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (storageConfig.localUploadsEnabled) {
      await removeFileIfExists(videoFile?.path);
      await removeFileIfExists(thumbnailFile?.path);
    }

    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.patch('/:id', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const videoId = Number(req.params.id);
  if (!Number.isFinite(videoId) || videoId <= 0) {
    return res.status(400).json({ error: 'Invalid video ID.' });
  }

  const title = sanitizeText(req.body?.title);
  const description = sanitizeText(req.body?.description) || null;
  const sortOrder = parseOptionalInt(req.body?.sort_order) ?? 0;

  if (!title) {
    return res.status(400).json({ error: 'Video title is required.' });
  }

  const pool = getRequiredPgPool();

  try {
    const result = await pool.query<{
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
    }>(
      `UPDATE migration.training_hub_videos v
       SET title = $1,
           description = $2,
           sort_order = $3,
           updated_at = NOW()
         WHERE id = $4
       RETURNING v.id::text,
                 v.series_id::text,
                 (SELECT s.name FROM migration.training_hub_series s WHERE s.id = v.series_id) AS series_name,
                 v.title,
                 v.description,
                 v.video_url,
                 v.video_original_file_name,
                 v.video_mime_type,
                 v.video_file_size::text,
                 v.thumbnail_url,
                 v.thumbnail_original_file_name,
                 v.thumbnail_mime_type,
                 v.thumbnail_file_size::text,
                 v.sort_order,
                 v.created_by,
                 v.created_at::text`,
      [title, description, sortOrder, videoId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Training video not found.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.delete('/:id', resolvePermissions, async (req, res) => {
  if (!isTrainingHubEnabled()) {
    return res.status(404).json({ error: 'Training Hub is disabled.' });
  }

  const perms = req.permissions!;
  if (!isRegionalAdminOnly(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const videoId = Number(req.params.id);
  if (!Number.isFinite(videoId) || videoId <= 0) {
    return res.status(400).json({ error: 'Invalid video ID.' });
  }

  const pool = getRequiredPgPool();

  try {
    const existing = await pool.query<{
      video_local_path: string | null;
      thumbnail_local_path: string | null;
    }>(
      `SELECT video_local_path, thumbnail_local_path
       FROM migration.training_hub_videos
       WHERE id = $1
       LIMIT 1`,
      [videoId]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Training video not found.' });
    }

    await pool.query(`DELETE FROM migration.training_hub_videos WHERE id = $1`, [videoId]);

    if (storageConfig.localUploadsEnabled) {
      await removeFileIfExists(existing.rows[0].video_local_path);
      await removeFileIfExists(existing.rows[0].thumbnail_local_path);
    }

    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;