import { Router } from 'express';
import multer from 'multer';
import { getRequiredPgPool } from '../config/db.js';
import { storageConfig } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';
import { generateCmaData } from '../services/openai-cma.js';
import { buildCmaDocument } from '../services/docx-cma.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
const router = Router();
// ---- DB setup ---------------------------------------------------------------
const ENSURE_CMA_TABLE = `
  CREATE TABLE IF NOT EXISTS public.cma_documents (
    id             SERIAL PRIMARY KEY,
    associate_email TEXT NOT NULL,
    associate_db_id TEXT,
    property_address TEXT,
    seller_name    TEXT,
    file_name      TEXT NOT NULL,
    file_url       TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
const CMA_ALTER_STATEMENTS = [
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_first_name TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_last_name TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_email TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_phone TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS loom_file_url TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS loom_original_name TEXT`,
];
let tableReady = false;
async function ensureTable() {
    if (tableReady)
        return;
    const pool = getRequiredPgPool();
    await pool.query(ENSURE_CMA_TABLE);
    for (const stmt of CMA_ALTER_STATEMENTS) {
        await pool.query(stmt);
    }
    tableReady = true;
}
// ---- Multer -----------------------------------------------------------------
const uploadLoom = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF files are accepted for the Loom report.'));
        }
    },
});
async function resolveAgentProfile(email, name) {
    const pool = getRequiredPgPool();
    const normalizedEmail = email.trim().toLowerCase();
    // Try email match first
    let assocResult = await pool.query(`SELECT id::text, full_name, email, kwsa_email, private_email, mobile_number, source_market_center_id
       FROM migration.core_associates
      WHERE LOWER(TRIM(COALESCE(kwsa_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(private_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(email, ''))) = $1
      ORDER BY CASE
        WHEN LOWER(TRIM(COALESCE(kwsa_email, ''))) = $1 THEN 0
        WHEN LOWER(TRIM(COALESCE(private_email, ''))) = $1 THEN 1
        ELSE 2
      END
      LIMIT 1`, [normalizedEmail]);
    // Fall back to full_name match if no email match and name provided
    if (!assocResult.rows[0] && name?.trim()) {
        assocResult = await pool.query(`SELECT id::text, full_name, email, kwsa_email, private_email, mobile_number, source_market_center_id
         FROM migration.core_associates
        WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1))
        LIMIT 1`, [name.trim()]);
    }
    if (!assocResult.rows[0])
        return null;
    const assoc = assocResult.rows[0];
    const [jobTitleResult, mcResult] = await Promise.all([
        pool.query(`SELECT job_title FROM migration.associate_job_titles
        WHERE associate_id = $1
        ORDER BY id ASC LIMIT 1`, [assoc.id]),
        assoc.source_market_center_id
            ? pool.query(`SELECT name, logo_image_url, document_logo_image_url
             FROM migration.core_market_centers
            WHERE source_market_center_id = $1
            LIMIT 1`, [assoc.source_market_center_id])
            : Promise.resolve({ rows: [] }),
    ]);
    return {
        associateDbId: assoc.id,
        agentName: assoc.full_name ?? email,
        agentEmail: assoc.kwsa_email ?? assoc.email ?? assoc.private_email ?? email,
        agentPhone: assoc.mobile_number ?? '',
        agentTitle: jobTitleResult.rows[0]?.job_title ?? 'Agent',
        marketCentre: mcResult.rows[0]?.name ?? '',
        logoUrl: mcResult.rows[0]?.document_logo_image_url ?? mcResult.rows[0]?.logo_image_url ?? null,
    };
}
// ---- Helper: fetch logo buffer from URL -------------------------------------
async function fetchLogoBuffer(url) {
    try {
        if (url.startsWith('/uploads/')) {
            const localPath = path.join(storageConfig.uploadsDir, url.replace(/^\/uploads\//, ''));
            if (!fs.existsSync(localPath))
                return null;
            return fs.readFileSync(localPath);
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok)
            return null;
        return Buffer.from(await res.arrayBuffer());
    }
    catch {
        return null;
    }
}
// ---- Helper: build safe filename --------------------------------------------
function buildFileName(propertyAddress) {
    const safeBase = (propertyAddress || 'kwsa-cma')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${safeBase || 'kwsa-cma'}-cma.docx`;
}
// ---- GET /api/cma/profile ---------------------------------------------------
// Returns the authenticated agent's pre-filled profile.
// Falls back to JWT data if no associate record is found, so any logged-in
// user can still use the CMA form.
router.get('/profile', async (req, res) => {
    const { email, name } = req.user;
    try {
        const profile = await resolveAgentProfile(email, name);
        if (profile) {
            res.json({ profile, partial: false });
            return;
        }
        // No associate record — return JWT data as a partial profile so the
        // user can still fill in the form manually.
        res.json({
            profile: {
                associateDbId: null,
                agentName: name ?? email,
                agentEmail: email,
                agentPhone: '',
                agentTitle: '',
                marketCentre: '',
                logoUrl: null,
            },
            partial: true,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load agent profile.' });
    }
});
// ---- POST /api/cma/generate -------------------------------------------------
// Accepts multipart/form-data with loomReport (PDF) + form fields.
// Agent details are auto-populated from DB using the authenticated user's email.
router.post('/generate', (req, res, next) => {
    uploadLoom.single('loomReport')(req, res, (err) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        next();
    });
}, async (req, res) => {
    await ensureTable();
    const loomFile = req.file;
    if (!loomFile?.buffer) {
        res.status(400).json({ error: 'Please upload the Loom property report as a PDF.' });
        return;
    }
    const email = req.user.email;
    try {
        // Agent profile from DB is used for logo and DB record; agent form fields
        // from the frontend body take precedence (the user may have edited them).
        const { name } = req.user;
        const profile = await resolveAgentProfile(email, name);
        const body = req.body;
        const formData = {
            propertyAddress: body.propertyAddress?.trim() ?? '',
            propertyType: body.propertyType?.trim() ?? '',
            bedrooms: body.bedrooms?.trim() ?? '',
            bathrooms: body.bathrooms?.trim() ?? '',
            parking: body.parking?.trim() ?? '',
            specialFeatures: body.specialFeatures?.trim() ?? '',
            sellerName: body.sellerName?.trim() ?? '',
            sellerSurname: body.sellerSurname?.trim() ?? '',
            sellerEmail: body.sellerEmail?.trim() ?? '',
            sellerPhone: body.sellerPhone?.trim() ?? '',
            // Agent fields: prefer the form body values (editable by user) and fall
            // back to the DB profile if not supplied.
            agentName: body.agentName?.trim() || profile?.agentName || email,
            agentTitle: body.agentTitle?.trim() || profile?.agentTitle || '',
            marketCentre: body.marketCentre?.trim() || profile?.marketCentre || '',
            agentPhone: body.agentPhone?.trim() || profile?.agentPhone || '',
            agentEmail: body.agentEmail?.trim() || profile?.agentEmail || email,
        };
        // Persist the uploaded LOOM report so it can be reused from History and Marketing Plan flows.
        let loomFileUrl;
        if (storageConfig.localUploadsEnabled) {
            const uploadsDir = path.join(storageConfig.uploadsDir, 'loom-reports');
            fs.mkdirSync(uploadsDir, { recursive: true });
            const safeLoomName = loomFile.originalname.replace(/[^a-zA-Z0-9._-]+/g, '-');
            const uniqueLoomName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeLoomName || 'loom-report.pdf'}`;
            const loomLocalPath = path.join(uploadsDir, uniqueLoomName);
            fs.writeFileSync(loomLocalPath, loomFile.buffer);
            loomFileUrl = `/uploads/loom-reports/${uniqueLoomName}`;
        }
        else {
            const loomUploadResult = await uploadToGcs(loomFile.buffer, loomFile.originalname || 'loom-report.pdf', 'loom-reports', loomFile.mimetype || 'application/pdf');
            loomFileUrl = loomUploadResult.publicUrl;
        }
        // Fetch MC logo buffer from profile (if available)
        const logoBuffer = profile?.logoUrl ? await fetchLogoBuffer(profile.logoUrl) : null;
        // Generate CMA via OpenAI
        const cmaData = await generateCmaData({
            formData,
            loomReportBuffer: loomFile.buffer,
            loomReportOriginalName: loomFile.originalname,
        });
        // Build the .docx
        const docxBuffer = await buildCmaDocument({ cmaData, formData, logoBuffer });
        const fileName = buildFileName(formData.propertyAddress);
        // Upload to GCS or save locally
        let fileUrl;
        if (storageConfig.localUploadsEnabled) {
            const uploadsDir = path.join(storageConfig.uploadsDir, 'cma');
            fs.mkdirSync(uploadsDir, { recursive: true });
            const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;
            const localPath = path.join(uploadsDir, uniqueName);
            fs.writeFileSync(localPath, docxBuffer);
            fileUrl = `/uploads/cma/${uniqueName}`;
        }
        else {
            const result = await uploadToGcs(docxBuffer, fileName, 'cma', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            fileUrl = result.publicUrl;
        }
        // Persist record to DB
        const pool = getRequiredPgPool();
        await pool.query(`INSERT INTO public.cma_documents (
           associate_email,
           associate_db_id,
           property_address,
           seller_name,
           seller_first_name,
           seller_last_name,
           seller_email,
           seller_phone,
           loom_file_url,
           loom_original_name,
           file_name,
           file_url
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
            email,
            profile?.associateDbId ?? null,
            formData.propertyAddress || null,
            [formData.sellerName, formData.sellerSurname].filter(Boolean).join(' ') || null,
            formData.sellerName || null,
            formData.sellerSurname || null,
            formData.sellerEmail || null,
            formData.sellerPhone || null,
            loomFileUrl,
            loomFile.originalname || 'loom-report.pdf',
            fileName,
            fileUrl,
        ]);
        // Stream .docx back as a download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(docxBuffer);
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to generate CMA.' });
    }
});
// ---- GET /api/cma/history ---------------------------------------------------
// Returns all CMAs generated by the authenticated user, newest first.
router.get('/history', async (req, res) => {
    await ensureTable();
    const email = req.user.email;
    try {
        const pool = getRequiredPgPool();
        const result = await pool.query(`SELECT id, property_address, seller_name, loom_file_url, loom_original_name, file_name, file_url, created_at::text
         FROM public.cma_documents
        WHERE LOWER(associate_email) = LOWER($1)
        ORDER BY created_at DESC
        LIMIT 50`, [email]);
        res.json({ items: result.rows });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load CMA history.' });
    }
});
export default router;
//# sourceMappingURL=cma.js.map