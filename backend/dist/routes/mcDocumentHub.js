/**
 * MC Document Hub Routes
 *
 * Allows Office Admins and Regional Admins to manage a market-centre-scoped
 * document library ("MC Document Hub").
 *
 * Endpoints:
 *   GET    /          – list all documents for the current market centre
 *   POST   /          – upload a new document (multipart/form-data: title, description?, file)
 *   DELETE /:id       – delete a document record (and clean up local file if applicable)
 *
 * Supported file types: PDF, JPEG, PNG (max 20 MB)
 * Storage: GCS when configured, local disk otherwise (same pattern as agents.ts)
 *
 * DB table: migration.mc_document_hub (auto-created on startup if absent)
 */
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getRequiredPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { storageConfig, resolveLocalUploadDir, ensureLocalUploadDirs } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';
const router = Router();
// ─────────────────────────────────────────────────────────────────────────────
// Storage setup (mirrors agents.ts pattern)
// ─────────────────────────────────────────────────────────────────────────────
const mcDocsDir = resolveLocalUploadDir('mc-docs');
await ensureLocalUploadDirs('mc-docs').catch(() => undefined);
const docStorageEngine = storageConfig.localUploadsEnabled
    ? multer.diskStorage({
        destination: mcDocsDir,
        filename: (_req, file, cb) => {
            const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
            const ext = path.extname(file.originalname);
            cb(null, `mcdoc-${uniqueSuffix}${ext}`);
        },
    })
    : multer.memoryStorage();
const upload = multer({
    storage: docStorageEngine,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF, JPEG, and PNG files are allowed.'));
        }
    },
});
async function runUpload(req, res, middleware) {
    await new Promise((resolve, reject) => {
        middleware(req, res, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function checkAdmin(perms) {
    return perms.isOfficeAdmin || perms.isRegionalAdmin;
}
// ─────────────────────────────────────────────────────────────────────────────
// DB table auto-create
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTable() {
    try {
        const pool = getRequiredPgPool();
        await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.mc_document_hub_folders (
        id                      BIGSERIAL    PRIMARY KEY,
        source_market_center_id TEXT         NOT NULL,
        name                    TEXT         NOT NULL,
        description             TEXT,
        created_by              TEXT,
        created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
        await pool.query(`
      CREATE INDEX IF NOT EXISTS mc_document_hub_folders_mc_idx
        ON migration.mc_document_hub_folders (source_market_center_id)
    `);
        await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.mc_document_hub (
        id                      BIGSERIAL    PRIMARY KEY,
        source_market_center_id TEXT         NOT NULL,
        folder_id               BIGINT,
        title                   TEXT         NOT NULL,
        description             TEXT,
        file_url                TEXT         NOT NULL,
        original_file_name      TEXT         NOT NULL,
        mime_type               TEXT         NOT NULL,
        file_size               BIGINT,
        gcs_object_name         TEXT,
        local_file_path         TEXT,
        uploaded_by             TEXT,
        created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
        await pool.query(`
      CREATE INDEX IF NOT EXISTS mc_document_hub_mc_idx
        ON migration.mc_document_hub (source_market_center_id)
    `);
        await pool.query(`
      ALTER TABLE migration.mc_document_hub
      ADD COLUMN IF NOT EXISTS folder_id BIGINT
    `);
        await pool.query(`
      CREATE INDEX IF NOT EXISTS mc_document_hub_folder_idx
        ON migration.mc_document_hub (folder_id)
    `);
    }
    catch {
        // Non-fatal — table may already exist or DB may not be ready yet
    }
}
ensureTable().catch(() => undefined);
// ─────────────────────────────────────────────────────────────────────────────
// GET /agent — read-only: list documents for the agent's own market centre.
// Accessible to all authenticated users (agents + admins).
// Scoped to the agent's source_market_center_id from their associate record.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/agent', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    // Use the market centre from the active context (works for agents + admins)
    const mcId = perms.marketCenterId ?? perms.homeMcId;
    if (!mcId) {
        return res.json({ documents: [] });
    }
    try {
        const foldersResult = await pool.query(`SELECT id::text, name, description, created_at::text
       FROM migration.mc_document_hub_folders
       WHERE source_market_center_id = $1
       ORDER BY name ASC, created_at DESC`, [mcId]);
        const result = await pool.query(`SELECT id::text, folder_id::text, title, description, file_url, original_file_name, mime_type,
              file_size::text, created_at::text
       FROM migration.mc_document_hub
       WHERE source_market_center_id = $1
       ORDER BY created_at DESC`, [mcId]);
        return res.json({ folders: foldersResult.rows, documents: result.rows });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET / — list documents for the current market centre (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context. Switch to a Market Centre context.' });
    }
    try {
        const foldersResult = await pool.query(`SELECT id::text, name, description, created_by, created_at::text
       FROM migration.mc_document_hub_folders
       WHERE source_market_center_id = $1
       ORDER BY name ASC, created_at DESC`, [mcId]);
        const result = await pool.query(`SELECT id::text, folder_id::text, title, description, file_url, original_file_name, mime_type,
              file_size::text, uploaded_by, created_at::text
       FROM migration.mc_document_hub
       WHERE source_market_center_id = $1
       ORDER BY created_at DESC`, [mcId]);
        return res.json({ folders: foldersResult.rows, documents: result.rows });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// POST / — upload a new document
// Body: multipart/form-data  { title: string, description?: string, file: File }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', resolvePermissions, async (req, res) => {
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context. Switch to a Market Centre context.' });
    }
    // Run multer to parse multipart body
    try {
        await runUpload(req, res, upload.single('file'));
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Only PDF') || msg.includes('file type')) {
            return res.status(415).json({ error: msg });
        }
        if (msg.toLowerCase().includes('large') || msg.toLowerCase().includes('limit')) {
            return res.status(413).json({ error: 'File too large. Maximum size is 20 MB.' });
        }
        return res.status(400).json({ error: msg });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
    }
    const title = (req.body?.title ?? '').toString().trim();
    const description = (req.body?.description ?? '').toString().trim() || null;
    const folderIdRaw = (req.body?.folder_id ?? '').toString().trim();
    const folderId = folderIdRaw ? Number(folderIdRaw) : null;
    if (!title) {
        if (req.file.path)
            await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({ error: 'Document title is required.' });
    }
    const isGcs = !storageConfig.localUploadsEnabled;
    const pool = getRequiredPgPool();
    try {
        if (folderId !== null) {
            if (!Number.isFinite(folderId) || folderId <= 0) {
                if (req.file.path)
                    await fs.unlink(req.file.path).catch(() => undefined);
                return res.status(400).json({ error: 'Invalid folder ID.' });
            }
            const folderRes = await pool.query(`SELECT id::text
         FROM migration.mc_document_hub_folders
         WHERE id = $1 AND source_market_center_id = $2
         LIMIT 1`, [folderId, mcId]);
            if (!folderRes.rows[0]) {
                if (req.file.path)
                    await fs.unlink(req.file.path).catch(() => undefined);
                return res.status(400).json({ error: 'Folder not found for this market centre.' });
            }
        }
        let fileUrl;
        let gcsObjectName = null;
        let localFilePath = null;
        if (isGcs) {
            const { publicUrl, objectName } = await uploadToGcs(req.file.buffer, req.file.originalname, 'mc-doc', req.file.mimetype);
            fileUrl = publicUrl;
            gcsObjectName = objectName;
        }
        else {
            fileUrl = `/uploads/mc-docs/${req.file.filename}`;
            localFilePath = req.file.path ?? null;
        }
        const result = await pool.query(`INSERT INTO migration.mc_document_hub
         (source_market_center_id, folder_id, title, description, file_url, original_file_name,
          mime_type, file_size, gcs_object_name, local_file_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id::text`, [
            mcId,
            folderId,
            title,
            description,
            fileUrl,
            req.file.originalname,
            req.file.mimetype,
            req.file.size ?? null,
            gcsObjectName,
            localFilePath,
            req.user?.email ?? 'unknown',
        ]);
        return res.status(201).json({
            id: result.rows[0].id,
            folder_id: folderId ? String(folderId) : null,
            title,
            description,
            file_url: fileUrl,
            original_file_name: req.file.originalname,
            mime_type: req.file.mimetype,
            file_size: String(req.file.size ?? 0),
            uploaded_by: req.user?.email ?? 'unknown',
            created_at: new Date().toISOString(),
        });
    }
    catch (err) {
        if (!isGcs && req.file.path)
            await fs.unlink(req.file.path).catch(() => undefined);
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
router.post('/folders', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context. Switch to a Market Centre context.' });
    }
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim() || null;
    if (!name)
        return res.status(400).json({ error: 'Folder name is required.' });
    try {
        const dup = await pool.query(`SELECT id::text
       FROM migration.mc_document_hub_folders
       WHERE source_market_center_id = $1
         AND LOWER(TRIM(name)) = LOWER(TRIM($2))
       LIMIT 1`, [mcId, name]);
        if (dup.rows[0]) {
            return res.status(409).json({ error: 'A folder with this name already exists.' });
        }
        const result = await pool.query(`INSERT INTO migration.mc_document_hub_folders
         (source_market_center_id, name, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text, name, description, created_by, created_at::text`, [mcId, name, description, req.user?.email ?? 'unknown']);
        return res.status(201).json(result.rows[0]);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
router.patch('/folders/:id', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context.' });
    }
    const folderId = Number(req.params.id);
    if (!Number.isFinite(folderId) || folderId <= 0) {
        return res.status(400).json({ error: 'Invalid folder ID.' });
    }
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim() || null;
    if (!name)
        return res.status(400).json({ error: 'Folder name is required.' });
    try {
        const folderRes = await pool.query(`SELECT id::text
       FROM migration.mc_document_hub_folders
       WHERE id = $1 AND source_market_center_id = $2
       LIMIT 1`, [folderId, mcId]);
        if (!folderRes.rows[0]) {
            return res.status(404).json({ error: 'Folder not found.' });
        }
        const dup = await pool.query(`SELECT id::text
       FROM migration.mc_document_hub_folders
       WHERE source_market_center_id = $1
         AND id <> $2
         AND LOWER(TRIM(name)) = LOWER(TRIM($3))
       LIMIT 1`, [mcId, folderId, name]);
        if (dup.rows[0]) {
            return res.status(409).json({ error: 'A folder with this name already exists.' });
        }
        const result = await pool.query(`UPDATE migration.mc_document_hub_folders
       SET name = $1,
           description = $2
       WHERE id = $3
       RETURNING id::text, name, description, created_by, created_at::text`, [name, description, folderId]);
        return res.json(result.rows[0]);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
router.delete('/folders/:id', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context.' });
    }
    const folderId = Number(req.params.id);
    if (!Number.isFinite(folderId) || folderId <= 0) {
        return res.status(400).json({ error: 'Invalid folder ID.' });
    }
    try {
        const folderRes = await pool.query(`SELECT id::text
       FROM migration.mc_document_hub_folders
       WHERE id = $1 AND source_market_center_id = $2
       LIMIT 1`, [folderId, mcId]);
        if (!folderRes.rows[0]) {
            return res.status(404).json({ error: 'Folder not found.' });
        }
        const docsRes = await pool.query(`SELECT COUNT(*)::text AS total
       FROM migration.mc_document_hub
       WHERE folder_id = $1`, [folderId]);
        if (Number(docsRes.rows[0]?.total ?? 0) > 0) {
            return res.status(409).json({ error: 'Folder is not empty. Move or delete documents first.' });
        }
        await pool.query(`DELETE FROM migration.mc_document_hub_folders WHERE id = $1`, [folderId]);
        return res.json({ success: true });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
router.patch('/:id/move', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context.' });
    }
    const docId = Number(req.params.id);
    if (!Number.isFinite(docId) || docId <= 0) {
        return res.status(400).json({ error: 'Invalid document ID.' });
    }
    const folderIdRaw = String(req.body?.folder_id ?? '').trim();
    const folderId = folderIdRaw ? Number(folderIdRaw) : null;
    if (folderIdRaw && (!Number.isFinite(folderId) || (folderId ?? 0) <= 0)) {
        return res.status(400).json({ error: 'Invalid folder ID.' });
    }
    try {
        const docRes = await pool.query(`SELECT id::text
       FROM migration.mc_document_hub
       WHERE id = $1 AND source_market_center_id = $2
       LIMIT 1`, [docId, mcId]);
        if (!docRes.rows[0]) {
            return res.status(404).json({ error: 'Document not found.' });
        }
        if (folderId !== null) {
            const folderRes = await pool.query(`SELECT id::text
         FROM migration.mc_document_hub_folders
         WHERE id = $1 AND source_market_center_id = $2
         LIMIT 1`, [folderId, mcId]);
            if (!folderRes.rows[0]) {
                return res.status(400).json({ error: 'Folder not found for this market centre.' });
            }
        }
        const result = await pool.query(`UPDATE migration.mc_document_hub
       SET folder_id = $1
       WHERE id = $2
       RETURNING folder_id::text`, [folderId, docId]);
        return res.json({ success: true, folder_id: result.rows[0]?.folder_id ?? null });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id — delete a document
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', resolvePermissions, async (req, res) => {
    const pool = getRequiredPgPool();
    const perms = req.permissions;
    if (!checkAdmin(perms)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const mcId = perms.marketCenterId;
    if (!mcId) {
        return res.status(400).json({ error: 'No market centre context.' });
    }
    const docId = Number(req.params.id);
    if (!Number.isFinite(docId) || docId <= 0) {
        return res.status(400).json({ error: 'Invalid document ID.' });
    }
    try {
        const docRes = await pool.query(`SELECT source_market_center_id, local_file_path
       FROM migration.mc_document_hub WHERE id = $1 LIMIT 1`, [docId]);
        if (!docRes.rows[0]) {
            return res.status(404).json({ error: 'Document not found.' });
        }
        // Office Admins can only delete from their own MC
        if (perms.isOfficeAdmin && !perms.isRegionalAdmin) {
            const normDoc = docRes.rows[0].source_market_center_id.toLowerCase().replace(/[^a-z0-9]+/g, '');
            const normOwn = mcId.toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (normDoc !== normOwn) {
                return res.status(403).json({ error: 'Permission denied.' });
            }
        }
        await pool.query(`DELETE FROM migration.mc_document_hub WHERE id = $1`, [docId]);
        // Best-effort local file cleanup
        if (docRes.rows[0].local_file_path) {
            fs.unlink(docRes.rows[0].local_file_path).catch(() => undefined);
        }
        return res.json({ success: true });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});
export default router;
//# sourceMappingURL=mcDocumentHub.js.map