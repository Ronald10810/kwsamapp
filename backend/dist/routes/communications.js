import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { env } from '../config/env.js';
import { getRequiredPgPool } from '../config/db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { buildGmailAuthUrl, exchangeCodeForTokens, fetchGoogleUserInfo, isGmailOAuthConfigured, loadGmailToken, removeGmailToken, saveGmailToken, sendGmailHtmlEmail } from '../services/gmailOAuth.js';
const router = Router();
const communicationsImagesDir = path.join(env.storage.uploadsDir, 'communications');
if (!fs.existsSync(communicationsImagesDir)) {
    fs.mkdirSync(communicationsImagesDir, { recursive: true });
}
const communicationsImageUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, communicationsImagesDir),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
            const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
            cb(null, `comm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
        },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!/^image\//i.test(file.mimetype)) {
            cb(new Error('Only image uploads are allowed.'));
            return;
        }
        cb(null, true);
    },
});
function runCommunicationsUpload(req, res) {
    return new Promise((resolve, reject) => {
        // The backend and workspace-level Express type packages can diverge in this repo layout.
        // Cast at the middleware boundary so the runtime upload path stays intact.
        communicationsImageUpload.single('image')(req, res, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
const COMMUNICATIONS_TABLES_SQL = `
  CREATE SCHEMA IF NOT EXISTS app;

  CREATE TABLE IF NOT EXISTS app.communications_templates (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    is_shared BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_email TEXT NOT NULL,
    updated_by_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS communications_templates_active_idx
    ON app.communications_templates (updated_at DESC)
    WHERE archived_at IS NULL;

  CREATE TABLE IF NOT EXISTS app.communications_drafts (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    template_id BIGINT REFERENCES app.communications_templates(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    audience_filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft',
    scheduled_for TIMESTAMPTZ,
    last_test_sent_at TIMESTAMPTZ,
    created_by_email TEXT NOT NULL,
    updated_by_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS communications_drafts_active_idx
    ON app.communications_drafts (updated_at DESC)
    WHERE archived_at IS NULL;

  CREATE TABLE IF NOT EXISTS app.communications_events (
    id BIGSERIAL PRIMARY KEY,
    draft_id BIGINT REFERENCES app.communications_drafts(id) ON DELETE SET NULL,
    template_id BIGINT REFERENCES app.communications_templates(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    recipient_email TEXT,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS communications_events_type_created_idx
    ON app.communications_events (event_type, created_at DESC);
`;
let communicationsTablesReady = false;
async function ensureCommunicationsTables() {
    if (communicationsTablesReady)
        return;
    await getRequiredPgPool().query(COMMUNICATIONS_TABLES_SQL);
    communicationsTablesReady = true;
}
function normalizeDraftStatus(raw) {
    const normalized = String(raw ?? '').trim().toLowerCase();
    return normalized === 'scheduled' ? 'scheduled' : 'draft';
}
function parseCsvParam(raw) {
    return String(raw ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}
function normalizeEmails(values) {
    const source = Array.isArray(values) ? values : [];
    return Array.from(new Set(source
        .map((value) => String(value).trim().toLowerCase())
        .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))));
}
function guessMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg')
        return 'image/jpeg';
    if (ext === '.png')
        return 'image/png';
    if (ext === '.gif')
        return 'image/gif';
    if (ext === '.webp')
        return 'image/webp';
    if (ext === '.svg')
        return 'image/svg+xml';
    return 'application/octet-stream';
}
function resolveUploadsPathFromSrc(src) {
    if (!src)
        return null;
    if (src.startsWith('/uploads/')) {
        return path.join(env.storage.uploadsDir, src.replace(/^\/uploads\//, ''));
    }
    try {
        const parsed = new URL(src);
        if (parsed.pathname.startsWith('/uploads/')) {
            return path.join(env.storage.uploadsDir, parsed.pathname.replace(/^\/uploads\//, ''));
        }
    }
    catch {
        // Not a URL; ignore.
    }
    return null;
}
function inlineUploadsAsDataUris(html) {
    if (!html.includes('<img')) {
        return html;
    }
    return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (_full, before, src, after) => {
        const localPath = resolveUploadsPathFromSrc(src);
        if (!localPath || !fs.existsSync(localPath)) {
            return `${before}${src}${after}`;
        }
        try {
            const bytes = fs.readFileSync(localPath);
            const mime = guessMimeType(localPath);
            const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
            return `${before}${dataUrl}${after}`;
        }
        catch {
            return `${before}${src}${after}`;
        }
    });
}
async function resolveMergeValuesByEmail(email) {
    const normalized = email.trim().toLowerCase();
    const result = await getRequiredPgPool().query(`SELECT full_name
       FROM migration.core_associates
      WHERE LOWER(TRIM(COALESCE(kwsa_email, private_email, email))) = $1
      LIMIT 1`, [normalized]);
    const fullName = String(result.rows[0]?.full_name ?? '').trim();
    const [firstName = '', ...lastParts] = fullName.split(/\s+/).filter(Boolean);
    const lastName = lastParts.join(' ').trim();
    return {
        firstName: firstName || 'there',
        lastName,
        email: normalized,
    };
}
function applyMergeValues(template, values) {
    const replacements = [
        [/\{\{\s*firstName\s*\}\}/gi, values.firstName || ''],
        [/\{\{\s*FirstName\s*\}\}/g, values.firstName || ''],
        [/\{\{\s*lastName\s*\}\}/gi, values.lastName || ''],
        [/\{\{\s*LastName\s*\}\}/g, values.lastName || ''],
        [/\{\{\s*email\s*\}\}/gi, values.email || ''],
    ];
    return replacements.reduce((output, [pattern, value]) => output.replace(pattern, value), template);
}
async function resolveAudienceEmails(filterJson, options) {
    const filter = filterJson ?? {};
    const query = String(filter.query ?? '').trim();
    const limit = Math.max(1, Math.min(10000, Number(options?.limit ?? 5000) || 5000));
    const roles = Array.isArray(filter.role)
        ? filter.role.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
        : parseCsvParam(filter.role).map((value) => value.toUpperCase());
    const marketCenterIds = Array.isArray(filter.marketCenterId)
        ? filter.marketCenterId.map((value) => String(value).trim()).filter(Boolean)
        : parseCsvParam(filter.marketCenterId);
    const result = await getRequiredPgPool().query(`SELECT DISTINCT LOWER(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email))) AS email
       FROM migration.core_associates a
       LEFT JOIN migration.associate_roles ar ON ar.associate_id = a.id
      WHERE LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
        AND COALESCE(NULLIF(TRIM(a.kwsa_email), ''), NULLIF(TRIM(a.private_email), ''), NULLIF(TRIM(a.email), '')) IS NOT NULL
        AND (COALESCE(array_length($2::text[], 1), 0) = 0 OR a.source_market_center_id = ANY($2::text[]))
        AND (
          $1 = ''
          OR a.full_name ILIKE '%' || $1 || '%'
          OR COALESCE(a.kwsa_email, a.private_email, a.email) ILIKE '%' || $1 || '%'
        )
      GROUP BY a.id, a.kwsa_email, a.private_email, a.email
      HAVING (
        COALESCE(array_length($3::text[], 1), 0) = 0
        OR (
          COALESCE(
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT UPPER(TRIM(ar.role_name))), NULL),
            ARRAY[]::TEXT[]
          ) && $3::text[]
        )
      )
      LIMIT $4`, [query, marketCenterIds, roles, limit]);
    return normalizeEmails(result.rows.map((row) => row.email));
}
async function sendDraftToRecipients(input) {
    let sentCount = 0;
    let failedCount = 0;
    const htmlWithInlinedUploads = inlineUploadsAsDataUris(input.htmlContent);
    for (const recipient of input.recipients) {
        try {
            const mergeValues = await resolveMergeValuesByEmail(recipient);
            await sendGmailHtmlEmail({
                userEmail: input.senderEmail,
                to: recipient,
                subject: applyMergeValues(input.subject, mergeValues),
                html: applyMergeValues(htmlWithInlinedUploads, mergeValues),
            });
            await getRequiredPgPool().query(`INSERT INTO app.communications_events
           (draft_id, template_id, event_type, recipient_email, meta_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`, [
                input.draftId,
                input.templateId,
                `${input.eventTypePrefix}-sent`,
                recipient,
                JSON.stringify({ requestedBy: input.senderEmail }),
            ]);
            sentCount += 1;
        }
        catch (error) {
            await getRequiredPgPool().query(`INSERT INTO app.communications_events
           (draft_id, template_id, event_type, recipient_email, meta_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`, [
                input.draftId,
                input.templateId,
                `${input.eventTypePrefix}-failed`,
                recipient,
                JSON.stringify({ requestedBy: input.senderEmail, reason: extractErrorReason(error) }),
            ]);
            failedCount += 1;
        }
    }
    return { sentCount, failedCount };
}
function extractErrorReason(error) {
    if (error instanceof Error) {
        const maybe = error;
        const apiMessage = maybe.response?.data?.error?.message;
        const apiStatus = maybe.response?.data?.error?.status;
        if (apiMessage && apiStatus) {
            return `${apiMessage} (${apiStatus})`;
        }
        if (apiMessage) {
            return apiMessage;
        }
        return error.message;
    }
    return 'Unknown error';
}
let scheduleWorkerActive = false;
async function processScheduledDrafts() {
    if (scheduleWorkerActive || !env.communications.enabled) {
        return;
    }
    scheduleWorkerActive = true;
    try {
        await ensureCommunicationsTables();
        const dueDrafts = await getRequiredPgPool().query(`SELECT id::text, template_id::text, subject, html_content, audience_filter_json, updated_by_email
         FROM app.communications_drafts
        WHERE archived_at IS NULL
          AND status = 'scheduled'
          AND scheduled_for IS NOT NULL
          AND scheduled_for <= NOW()
        ORDER BY scheduled_for ASC
        LIMIT 20`);
        for (const draft of dueDrafts.rows) {
            const draftId = Number(draft.id);
            const templateId = draft.template_id ? Number(draft.template_id) : null;
            const filterJson = draft.audience_filter_json ?? {};
            const selected = normalizeEmails(filterJson.selectedEmails);
            const manual = normalizeEmails(filterJson.manualRecipients);
            const explicitRecipients = Array.from(new Set([...selected, ...manual]));
            const filteredAudience = explicitRecipients.length > 0
                ? []
                : await resolveAudienceEmails(filterJson);
            const recipients = (explicitRecipients.length > 0 ? explicitRecipients : filteredAudience).slice(0, 500);
            if (recipients.length === 0) {
                await getRequiredPgPool().query(`INSERT INTO app.communications_events
             (draft_id, template_id, event_type, recipient_email, meta_json)
           VALUES ($1, $2, 'scheduled-send-skipped', NULL, $3::jsonb)`, [draftId, templateId, JSON.stringify({ reason: 'No recipients resolved from schedule filters.' })]);
            }
            else {
                await sendDraftToRecipients({
                    senderEmail: draft.updated_by_email,
                    draftId,
                    templateId,
                    subject: draft.subject,
                    htmlContent: draft.html_content,
                    recipients,
                    eventTypePrefix: 'scheduled-send',
                });
            }
            await getRequiredPgPool().query(`UPDATE app.communications_drafts
            SET status = 'draft',
                scheduled_for = NULL,
                updated_at = NOW()
          WHERE id = $1`, [draftId]);
        }
    }
    catch {
        // Scheduling should not crash request handling.
    }
    finally {
        scheduleWorkerActive = false;
    }
}
setInterval(() => {
    void processScheduledDrafts();
}, 60000);
function frontendBaseUrl() {
    return env.communications.frontendBaseUrl
        ?? env.corsOrigins.find((origin) => origin.startsWith('http'))
        ?? 'http://localhost:5173';
}
function buildFrontendRedirect(returnPath, params) {
    const url = new URL(returnPath.startsWith('http') ? returnPath : `${frontendBaseUrl()}${returnPath}`);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
    return url.toString();
}
function ensureRegionalAdminAccess(req, res) {
    const perms = req.permissions;
    if (!perms || !perms.isRegionalAdmin || perms.scope !== 'GLOBAL') {
        res.status(403).json({
            error: 'Only Regional Admin users in Regional Admin context can access Communications.',
        });
        return false;
    }
    return true;
}
router.get('/gmail/callback', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    const rawState = typeof req.query.state === 'string' ? req.query.state : '';
    let state;
    try {
        state = jwt.verify(rawState, env.jwtSecret);
    }
    catch {
        return res.redirect(buildFrontendRedirect('/mc-admin-tools', {
            tab: 'communications',
            gmail: 'state-invalid',
        }));
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    if (error) {
        return res.redirect(buildFrontendRedirect(state.returnPath, {
            gmail: 'denied',
            reason: error,
        }));
    }
    if (!code) {
        return res.redirect(buildFrontendRedirect(state.returnPath, {
            gmail: 'missing-code',
        }));
    }
    try {
        const token = await exchangeCodeForTokens(code);
        const profile = await fetchGoogleUserInfo(token.accessToken);
        if (profile.email.trim().toLowerCase() !== state.email.trim().toLowerCase()) {
            return res.redirect(buildFrontendRedirect(state.returnPath, {
                gmail: 'email-mismatch',
            }));
        }
        await saveGmailToken({
            userEmail: state.email,
            googleSubject: profile.sub,
            connectedEmail: profile.email,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiryDate: token.expiryDate,
            scope: token.scope,
        });
        return res.redirect(buildFrontendRedirect(state.returnPath, {
            gmail: 'connected',
        }));
    }
    catch (callbackError) {
        return res.redirect(buildFrontendRedirect(state.returnPath, {
            gmail: 'callback-failed',
            reason: callbackError instanceof Error ? callbackError.message : 'Unknown error',
        }));
    }
});
router.use(requireAuth);
router.use(resolvePermissions);
router.get('/status', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await ensureCommunicationsTables();
        const token = await loadGmailToken(req.user.email);
        return res.json({
            enabled: true,
            phase: 'templates-and-drafts-foundation',
            capabilities: {
                gmailOAuth: true,
                templates: true,
                draftCrud: true,
                scheduling: false,
                analytics: false,
            },
            gmail: {
                configured: isGmailOAuthConfigured(),
                connected: Boolean(token),
                connectedEmail: token?.connectedEmail ?? null,
                expectedEmail: req.user.email,
                updatedAt: token?.updatedAt ?? null,
            },
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load communications status.',
        });
    }
});
router.post('/gmail/connect', (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    if (!isGmailOAuthConfigured()) {
        return res.status(500).json({ error: 'Communications Gmail OAuth is not configured.' });
    }
    const returnPath = typeof req.body?.returnPath === 'string' && req.body.returnPath.trim().length > 0
        ? req.body.returnPath.trim()
        : '/mc-admin-tools?tab=communications';
    const state = jwt.sign({
        email: req.user.email,
        returnPath,
    }, env.jwtSecret, { expiresIn: '10m' });
    return res.json({
        url: buildGmailAuthUrl(state),
    });
});
router.delete('/gmail/disconnect', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await removeGmailToken(req.user.email);
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to disconnect Gmail.',
        });
    }
});
router.post('/images/upload', async (req, res, next) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await runCommunicationsUpload(req, res);
    }
    catch (error) {
        return next(error);
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
    }
    return res.json({
        imageUrl: `/uploads/communications/${req.file.filename}`,
    });
});
router.get('/templates', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await ensureCommunicationsTables();
        const result = await getRequiredPgPool().query(`SELECT id::text, name, subject, html_content, is_shared, created_by_email, updated_by_email, updated_at::text
         FROM app.communications_templates
        WHERE archived_at IS NULL
        ORDER BY updated_at DESC`);
        return res.json({ templates: result.rows });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load templates.',
        });
    }
});
router.post('/templates', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const name = String(req.body?.name ?? '').trim();
    const subject = String(req.body?.subject ?? '').trim();
    const htmlContent = String(req.body?.htmlContent ?? '').trim();
    if (!name || !subject || !htmlContent) {
        return res.status(400).json({ error: 'name, subject, and htmlContent are required.' });
    }
    try {
        await ensureCommunicationsTables();
        const insertResult = await getRequiredPgPool().query(`INSERT INTO app.communications_templates
         (name, subject, html_content, is_shared, created_by_email, updated_by_email, updated_at)
       VALUES ($1, $2, $3, TRUE, $4, $4, NOW())
       RETURNING id::text`, [name, subject, htmlContent, req.user.email]);
        return res.status(201).json({ id: insertResult.rows[0]?.id });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to create template.',
        });
    }
});
router.put('/templates/:templateId', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const templateId = Number(req.params.templateId);
    const name = String(req.body?.name ?? '').trim();
    const subject = String(req.body?.subject ?? '').trim();
    const htmlContent = String(req.body?.htmlContent ?? '').trim();
    if (!Number.isFinite(templateId) || templateId <= 0) {
        return res.status(400).json({ error: 'Invalid template ID.' });
    }
    if (!name || !subject || !htmlContent) {
        return res.status(400).json({ error: 'name, subject, and htmlContent are required.' });
    }
    try {
        await ensureCommunicationsTables();
        const updateResult = await getRequiredPgPool().query(`UPDATE app.communications_templates
          SET name = $2,
              subject = $3,
              html_content = $4,
              updated_by_email = $5,
              updated_at = NOW()
        WHERE id = $1
          AND archived_at IS NULL`, [templateId, name, subject, htmlContent, req.user.email]);
        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Template not found.' });
        }
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to update template.',
        });
    }
});
router.delete('/templates/:templateId', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const templateId = Number(req.params.templateId);
    if (!Number.isFinite(templateId) || templateId <= 0) {
        return res.status(400).json({ error: 'Invalid template ID.' });
    }
    try {
        await ensureCommunicationsTables();
        const deleteResult = await getRequiredPgPool().query(`UPDATE app.communications_templates
          SET archived_at = NOW(),
              updated_by_email = $2,
              updated_at = NOW()
        WHERE id = $1
          AND archived_at IS NULL`, [templateId, req.user.email]);
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ error: 'Template not found.' });
        }
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to archive template.',
        });
    }
});
router.get('/drafts', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await ensureCommunicationsTables();
        await processScheduledDrafts();
        const result = await getRequiredPgPool().query(`SELECT id::text,
              template_id::text,
              name,
              subject,
              html_content,
              audience_filter_json,
              status,
              scheduled_for::text,
              updated_at::text,
              updated_by_email
         FROM app.communications_drafts
        WHERE archived_at IS NULL
        ORDER BY updated_at DESC`);
        return res.json({ drafts: result.rows });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load drafts.',
        });
    }
});
router.post('/drafts', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const name = String(req.body?.name ?? '').trim();
    const subject = String(req.body?.subject ?? '').trim();
    const htmlContent = String(req.body?.htmlContent ?? '').trim();
    const templateId = req.body?.templateId ? Number(req.body.templateId) : null;
    const audienceFilter = req.body?.audienceFilter && typeof req.body.audienceFilter === 'object'
        ? req.body.audienceFilter
        : {};
    const status = normalizeDraftStatus(req.body?.status);
    const scheduledFor = typeof req.body?.scheduledFor === 'string' && req.body.scheduledFor.trim().length > 0
        ? req.body.scheduledFor.trim()
        : null;
    if (!name || !subject || !htmlContent) {
        return res.status(400).json({ error: 'name, subject, and htmlContent are required.' });
    }
    if (status === 'scheduled' && !scheduledFor) {
        return res.status(400).json({ error: 'scheduledFor is required when status is scheduled.' });
    }
    try {
        await ensureCommunicationsTables();
        const insertResult = await getRequiredPgPool().query(`INSERT INTO app.communications_drafts
         (name, template_id, subject, html_content, audience_filter_json, status, scheduled_for, created_by_email, updated_by_email, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8, NOW())
       RETURNING id::text`, [
            name,
            Number.isFinite(templateId) && (templateId ?? 0) > 0 ? templateId : null,
            subject,
            htmlContent,
            JSON.stringify(audienceFilter),
            status,
            scheduledFor,
            req.user.email,
        ]);
        return res.status(201).json({ id: insertResult.rows[0]?.id });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to create draft.',
        });
    }
});
router.put('/drafts/:draftId', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const draftId = Number(req.params.draftId);
    const name = String(req.body?.name ?? '').trim();
    const subject = String(req.body?.subject ?? '').trim();
    const htmlContent = String(req.body?.htmlContent ?? '').trim();
    const templateId = req.body?.templateId ? Number(req.body.templateId) : null;
    const audienceFilter = req.body?.audienceFilter && typeof req.body.audienceFilter === 'object'
        ? req.body.audienceFilter
        : {};
    const status = normalizeDraftStatus(req.body?.status);
    const scheduledFor = typeof req.body?.scheduledFor === 'string' && req.body.scheduledFor.trim().length > 0
        ? req.body.scheduledFor.trim()
        : null;
    if (!Number.isFinite(draftId) || draftId <= 0) {
        return res.status(400).json({ error: 'Invalid draft ID.' });
    }
    if (!name || !subject || !htmlContent) {
        return res.status(400).json({ error: 'name, subject, and htmlContent are required.' });
    }
    try {
        await ensureCommunicationsTables();
        const updateResult = await getRequiredPgPool().query(`UPDATE app.communications_drafts
          SET name = $2,
              template_id = $3,
              subject = $4,
              html_content = $5,
              audience_filter_json = $6::jsonb,
              status = $7,
              scheduled_for = $8,
              updated_by_email = $9,
              updated_at = NOW()
        WHERE id = $1
          AND archived_at IS NULL`, [
            draftId,
            name,
            Number.isFinite(templateId) && (templateId ?? 0) > 0 ? templateId : null,
            subject,
            htmlContent,
            JSON.stringify(audienceFilter),
            status,
            scheduledFor,
            req.user.email,
        ]);
        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Draft not found.' });
        }
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to update draft.',
        });
    }
});
router.delete('/drafts/:draftId', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const draftId = Number(req.params.draftId);
    if (!Number.isFinite(draftId) || draftId <= 0) {
        return res.status(400).json({ error: 'Invalid draft ID.' });
    }
    try {
        await ensureCommunicationsTables();
        const deleteResult = await getRequiredPgPool().query(`UPDATE app.communications_drafts
          SET archived_at = NOW(),
              updated_by_email = $2,
              updated_at = NOW()
        WHERE id = $1
          AND archived_at IS NULL`, [draftId, req.user.email]);
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ error: 'Draft not found.' });
        }
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to archive draft.',
        });
    }
});
router.post('/drafts/:draftId/test-send', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const draftId = Number(req.params.draftId);
    const recipients = normalizeEmails(req.body?.recipients);
    if (!Number.isFinite(draftId) || draftId <= 0) {
        return res.status(400).json({ error: 'Invalid draft ID.' });
    }
    if (recipients.length === 0) {
        return res.status(400).json({ error: 'At least one recipient email is required.' });
    }
    if (recipients.length > 20) {
        return res.status(400).json({ error: 'Maximum 20 test recipients are allowed.' });
    }
    try {
        await ensureCommunicationsTables();
        const token = await loadGmailToken(req.user.email);
        if (!token) {
            return res.status(400).json({ error: 'Connect Gmail before requesting a test send.' });
        }
        const draftResult = await getRequiredPgPool().query(`SELECT id::text, template_id::text, subject, html_content
         FROM app.communications_drafts
        WHERE id = $1
          AND archived_at IS NULL`, [draftId]);
        if (!draftResult.rows[0]) {
            return res.status(404).json({ error: 'Draft not found.' });
        }
        const templateId = draftResult.rows[0].template_id ? Number(draftResult.rows[0].template_id) : null;
        const sendSummary = await sendDraftToRecipients({
            senderEmail: req.user.email,
            draftId,
            templateId,
            subject: draftResult.rows[0].subject,
            htmlContent: draftResult.rows[0].html_content,
            recipients,
            eventTypePrefix: 'test-send',
        });
        await getRequiredPgPool().query(`UPDATE app.communications_drafts
          SET last_test_sent_at = NOW(),
              updated_by_email = $2,
              updated_at = NOW()
        WHERE id = $1`, [draftId, req.user.email]);
        return res.json({
            ok: true,
            sent: sendSummary.sentCount,
            failed: sendSummary.failedCount,
            queuedEvents: recipients.length,
            message: sendSummary.failedCount > 0
                ? `Sent ${sendSummary.sentCount} test emails, ${sendSummary.failedCount} failed.`
                : `Sent ${sendSummary.sentCount} test emails successfully.`,
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to request test send.',
        });
    }
});
router.post('/drafts/:draftId/send-now', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const draftId = Number(req.params.draftId);
    const recipients = normalizeEmails(req.body?.recipients);
    if (!Number.isFinite(draftId) || draftId <= 0) {
        return res.status(400).json({ error: 'Invalid draft ID.' });
    }
    if (recipients.length === 0) {
        return res.status(400).json({ error: 'Select at least one recipient to send now.' });
    }
    if (recipients.length > 500) {
        return res.status(400).json({ error: 'Maximum 500 recipients are allowed for send now.' });
    }
    try {
        await ensureCommunicationsTables();
        const token = await loadGmailToken(req.user.email);
        if (!token) {
            return res.status(400).json({ error: 'Connect Gmail before sending.' });
        }
        const draftResult = await getRequiredPgPool().query(`SELECT id::text, template_id::text, subject, html_content
         FROM app.communications_drafts
        WHERE id = $1
          AND archived_at IS NULL`, [draftId]);
        if (!draftResult.rows[0]) {
            return res.status(404).json({ error: 'Draft not found.' });
        }
        const templateId = draftResult.rows[0].template_id ? Number(draftResult.rows[0].template_id) : null;
        const sendSummary = await sendDraftToRecipients({
            senderEmail: req.user.email,
            draftId,
            templateId,
            subject: draftResult.rows[0].subject,
            htmlContent: draftResult.rows[0].html_content,
            recipients,
            eventTypePrefix: 'send-now',
        });
        await getRequiredPgPool().query(`UPDATE app.communications_drafts
          SET updated_by_email = $2,
              updated_at = NOW()
        WHERE id = $1`, [draftId, req.user.email]);
        return res.json({
            ok: true,
            sent: sendSummary.sentCount,
            failed: sendSummary.failedCount,
            recipients: recipients.length,
            message: sendSummary.failedCount > 0
                ? `Sent ${sendSummary.sentCount} emails, ${sendSummary.failedCount} failed.`
                : `Sent ${sendSummary.sentCount} emails successfully.`,
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to send now.',
        });
    }
});
router.get('/audience/associates', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const query = String(req.query.query ?? '').trim();
    const roles = parseCsvParam(req.query.role).map((role) => role.toUpperCase());
    const marketCenterIds = parseCsvParam(req.query.marketCenterId);
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit ?? 1500) || 1500));
    try {
        await ensureCommunicationsTables();
        const result = await getRequiredPgPool().query(`SELECT
         a.id::text AS associate_id,
         a.full_name,
         COALESCE(NULLIF(TRIM(a.kwsa_email), ''), NULLIF(TRIM(a.private_email), ''), NULLIF(TRIM(a.email), '')) AS email,
         a.source_market_center_id AS market_center_id,
         mc.name AS market_center_name,
         COALESCE(
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT UPPER(TRIM(ar.role_name))), NULL),
           ARRAY[]::TEXT[]
         ) AS roles
       FROM migration.core_associates a
       LEFT JOIN migration.associate_roles ar ON ar.associate_id = a.id
       LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = a.source_market_center_id
       WHERE LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
         AND COALESCE(NULLIF(TRIM(a.kwsa_email), ''), NULLIF(TRIM(a.private_email), ''), NULLIF(TRIM(a.email), '')) IS NOT NULL
         AND (COALESCE(array_length($2::text[], 1), 0) = 0 OR a.source_market_center_id = ANY($2::text[]))
         AND (
           $1 = ''
           OR a.full_name ILIKE '%' || $1 || '%'
           OR COALESCE(a.kwsa_email, a.private_email, a.email) ILIKE '%' || $1 || '%'
         )
       GROUP BY a.id, a.full_name, a.kwsa_email, a.private_email, a.email, a.source_market_center_id, mc.name
       HAVING (
         COALESCE(array_length($3::text[], 1), 0) = 0
         OR (
           COALESCE(
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT UPPER(TRIM(ar.role_name))), NULL),
             ARRAY[]::TEXT[]
           ) && $3::text[]
         )
       )
       ORDER BY a.full_name NULLS LAST
       LIMIT $4`, [query, marketCenterIds, roles, limit]);
        return res.json({ associates: result.rows });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load associate audience.',
        });
    }
});
router.get('/audience/associates/emails', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const query = String(req.query.query ?? '').trim();
    const roles = parseCsvParam(req.query.role).map((role) => role.toUpperCase());
    const marketCenterIds = parseCsvParam(req.query.marketCenterId);
    const limit = Math.max(1, Math.min(10000, Number(req.query.limit ?? 5000) || 5000));
    try {
        await ensureCommunicationsTables();
        const emails = await resolveAudienceEmails({
            query,
            role: roles,
            marketCenterId: marketCenterIds,
        }, { limit });
        return res.json({
            emails,
            total: emails.length,
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load audience emails.',
        });
    }
});
router.get('/audience/options', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await ensureCommunicationsTables();
        const [rolesResult, marketCentersResult] = await Promise.all([
            getRequiredPgPool().query(`SELECT DISTINCT UPPER(TRIM(role_name)) AS role_name
           FROM migration.associate_roles
          WHERE role_name IS NOT NULL
            AND TRIM(role_name) <> ''
          ORDER BY 1`),
            getRequiredPgPool().query(`SELECT source_market_center_id, name
           FROM migration.core_market_centers
          WHERE source_market_center_id IS NOT NULL
            AND TRIM(source_market_center_id) <> ''
            AND EXISTS (
              SELECT 1
                FROM migration.core_associates a
               WHERE a.source_market_center_id = migration.core_market_centers.source_market_center_id
                 AND LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
            )
          ORDER BY name NULLS LAST, source_market_center_id`),
        ]);
        return res.json({
            roles: rolesResult.rows.map((row) => row.role_name),
            marketCenters: marketCentersResult.rows,
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load audience filter options.',
        });
    }
});
router.get('/analytics/summary', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    try {
        await ensureCommunicationsTables();
        const totals = await getRequiredPgPool().query(`SELECT event_type, COUNT(*)::text AS total
         FROM app.communications_events
        WHERE created_at >= NOW() - INTERVAL '24 months'
        GROUP BY event_type`);
        return res.json({
            retentionMonths: 24,
            totals: totals.rows,
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load analytics summary.',
        });
    }
});
router.get('/events/recent', async (req, res) => {
    if (!env.communications.enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res)) {
        return;
    }
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20) || 20));
    try {
        await ensureCommunicationsTables();
        await processScheduledDrafts();
        const result = await getRequiredPgPool().query(`SELECT id::text,
              draft_id::text,
              event_type,
              recipient_email,
              created_at::text,
              meta_json
         FROM app.communications_events
        ORDER BY id DESC
        LIMIT $1`, [limit]);
        return res.json({ events: result.rows });
    }
    catch (error) {
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to load recent communications events.',
        });
    }
});
const communicationsUploadErrorHandler = (error, _req, res, next) => {
    if (!error) {
        return next();
    }
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Image file is too large. Maximum size is 10MB.' });
        }
        return res.status(400).json({ error: error.message || 'Invalid upload payload.' });
    }
    if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Unexpected upload error.' });
};
router.use(communicationsUploadErrorHandler);
export default router;
//# sourceMappingURL=communications.js.map