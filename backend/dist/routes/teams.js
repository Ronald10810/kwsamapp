import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
const router = Router();
const pool = getOptionalPgPool();
// ─── Schema ───────────────────────────────────────────────────────────────────
/** Extra columns we need on migration.core_teams (added idempotently). */
const REQUIRED_TEAM_COLUMNS = {
    registered_name: 'TEXT',
    contact_number: 'TEXT',
    contact_email: 'TEXT',
    logo_url: 'TEXT',
    address_line1: 'TEXT',
    address_suburb: 'TEXT',
    address_city: 'TEXT',
    address_province: 'TEXT',
    address_postal_code: 'TEXT',
};
let teamSchemaPromise = null;
let teamColumnCache = null;
async function ensureTeamSchema() {
    if (!pool)
        return;
    // core_teams extra columns
    const existingResult = await pool.query(`SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'migration' AND table_name = 'core_teams'`);
    const existing = new Set(existingResult.rows.map((r) => r.column_name));
    const additions = Object.entries(REQUIRED_TEAM_COLUMNS)
        .filter(([col]) => !existing.has(col))
        .map(([col, type]) => `ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    if (additions.length > 0) {
        await pool.query(`ALTER TABLE migration.core_teams\n    ${additions.join(',\n    ')}`);
        teamColumnCache = null;
    }
    // team_caps
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.team_caps (
      id            BIGSERIAL PRIMARY KEY,
      team_id       BIGINT NOT NULL REFERENCES migration.core_teams(id) ON DELETE CASCADE,
      commission_split_to_team NUMERIC(5,2),
      team_cap_amount          NUMERIC(18,2),
      manual_cap               BOOLEAN NOT NULL DEFAULT FALSE,
      cap_year                 INT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (team_id, cap_year)
    )
  `);
    // team_cap_history
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.team_cap_history (
      id            BIGSERIAL PRIMARY KEY,
      team_id       BIGINT NOT NULL REFERENCES migration.core_teams(id) ON DELETE CASCADE,
      commission_split_to_team NUMERIC(5,2),
      team_cap_amount          NUMERIC(18,2),
      manual_cap               BOOLEAN NOT NULL DEFAULT FALSE,
      start_date    DATE,
      end_date      DATE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // team_associate_commissions
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.team_associate_commissions (
      id                    BIGSERIAL PRIMARY KEY,
      team_id               BIGINT NOT NULL UNIQUE REFERENCES migration.core_teams(id) ON DELETE CASCADE,
      has_individual_cap    BOOLEAN NOT NULL DEFAULT FALSE,
      associate_default_cap NUMERIC(18,2),
      associate_default_split NUMERIC(5,2),
      productivity_coach    TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // team_dates
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.team_dates (
      id                  BIGSERIAL PRIMARY KEY,
      team_id             BIGINT NOT NULL UNIQUE REFERENCES migration.core_teams(id) ON DELETE CASCADE,
      open_date           DATE,
      close_date          DATE,
      cap_date            DATE,
      anniversary_date    DATE,
      anniversary_comment TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // team_portal_settings
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.team_portal_settings (
      id                       BIGSERIAL PRIMARY KEY,
      team_id                  BIGINT NOT NULL UNIQUE REFERENCES migration.core_teams(id) ON DELETE CASCADE,
      use_mc_account_p24       BOOLEAN NOT NULL DEFAULT TRUE,
      p24_agency_id            TEXT,
      feed_to_p24              BOOLEAN NOT NULL DEFAULT TRUE,
      p24_auction_approved     BOOLEAN NOT NULL DEFAULT FALSE,
      use_mc_account_entegral  BOOLEAN NOT NULL DEFAULT TRUE,
      entegral_url             TEXT,
      feed_to_entegral         BOOLEAN NOT NULL DEFAULT TRUE,
      entegral_portals         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // team_notes
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.team_notes (
      id         BIGSERIAL PRIMARY KEY,
      team_id    BIGINT NOT NULL REFERENCES migration.core_teams(id) ON DELETE CASCADE,
      note_text  TEXT NOT NULL,
      note_type  TEXT NOT NULL DEFAULT 'general',
      created_by TEXT NOT NULL DEFAULT 'console-user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
function runEnsureTeamSchema() {
    if (!teamSchemaPromise) {
        teamSchemaPromise = ensureTeamSchema().catch((err) => {
            teamSchemaPromise = null;
            throw err;
        });
    }
    return teamSchemaPromise;
}
async function getTeamColumns() {
    if (!pool)
        return new Set();
    await runEnsureTeamSchema();
    if (teamColumnCache)
        return teamColumnCache;
    const result = await pool.query(`SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'migration' AND table_name = 'core_teams'`);
    teamColumnCache = new Set(result.rows.map((r) => r.column_name));
    return teamColumnCache;
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function toText(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const n = Number(value.trim());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function toDate(value) {
    const text = toText(value);
    if (!text)
        return null;
    const d = new Date(text);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toISOString().slice(0, 10);
}
function toBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string') {
        const n = value.trim().toLowerCase();
        return n === '1' || n === 'true' || n === 'yes' || n === 'on';
    }
    if (typeof value === 'number')
        return value === 1;
    return false;
}
function toStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((e) => toText(e)).filter((e) => Boolean(e));
}
function optCol(columns, col) {
    return columns.has(col) ? `t.${col}` : `NULL::text AS ${col}`;
}
function normalizeTitle(value) {
    return String(value ?? '').trim().toLowerCase();
}
async function getTeamEditorContext(email) {
    if (!pool)
        return null;
    const assocResult = await pool.query(`SELECT id::text, source_team_id, source_market_center_id
     FROM migration.core_associates
     WHERE LOWER(TRIM(COALESCE(kwsa_email, ''))) = LOWER($1)
        OR LOWER(TRIM(COALESCE(private_email, ''))) = LOWER($1)
        OR LOWER(TRIM(COALESCE(email, ''))) = LOWER($1)
     ORDER BY CASE
       WHEN LOWER(TRIM(COALESCE(kwsa_email, ''))) = LOWER($1) THEN 0
       WHEN LOWER(TRIM(COALESCE(private_email, ''))) = LOWER($1) THEN 1
       ELSE 2
     END
     LIMIT 1`, [email]);
    if (!assocResult.rows[0])
        return null;
    const assoc = assocResult.rows[0];
    const [titlesResult, adminTeamsResult] = await Promise.all([
        pool.query(`SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1`, [assoc.id]),
        pool.query(`SELECT source_team_id FROM migration.associate_admin_teams WHERE associate_id = $1`, [assoc.id]),
    ]);
    return {
        sourceTeamId: assoc.source_team_id,
        sourceMarketCenterId: assoc.source_market_center_id,
        jobTitles: new Set(titlesResult.rows.map((r) => normalizeTitle(r.job_title)).filter(Boolean)),
        adminTeams: new Set(adminTeamsResult.rows.map((r) => r.source_team_id).filter(Boolean)),
    };
}
function canEditTeamDetails(permissions, editor, teamSourceMarketCenterId, teamSourceTeamId) {
    // Permissions are context-driven: GLOBAL context may edit any team.
    if (permissions.scope === 'GLOBAL')
        return true;
    if (permissions.scope === 'MARKET_CENTRE') {
        // Market Centre admin context: any team inside the active MC context.
        const withinMc = Boolean(permissions.marketCenterId
            && teamSourceMarketCenterId
            && permissions.marketCenterId === teamSourceMarketCenterId);
        return withinMc;
    }
    if (!editor || !teamSourceTeamId)
        return false;
    // OWN scope: Lead Agent or Team Admin, on their own/admin teams.
    const isLeadAgent = editor.jobTitles.has('lead agent');
    const isTeamAdmin = editor.jobTitles.has('team admin');
    if (!isLeadAgent && !isTeamAdmin)
        return false;
    return editor.sourceTeamId === teamSourceTeamId || editor.adminTeams.has(teamSourceTeamId);
}
function canEditTeamCap(permissions) {
    // Cap edits are only allowed in admin contexts.
    return permissions.scope === 'GLOBAL' || permissions.scope === 'MARKET_CENTRE';
}
function canEditTeamDates(permissions) {
    // Dates follow the same admin-only rule as cap edits.
    return permissions.scope === 'GLOBAL' || permissions.scope === 'MARKET_CENTRE';
}
// ─── GET /options — lightweight list for dropdowns ───────────────────────────
router.get('/options', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const tableCheck = await pool.query(`SELECT to_regclass('migration.core_teams') AS exists`);
        if (!tableCheck.rows[0]?.exists)
            return res.json({ items: [] });
        const sourceMarketCenterId = toText(req.query.source_market_center_id);
        const params = [];
        const whereClauses = [
            `(LOWER(TRIM(COALESCE(t.status_name, ''))) = 'active' OR TRIM(COALESCE(t.status_name, '')) = '1')`,
        ];
        if (sourceMarketCenterId) {
            params.push(sourceMarketCenterId);
            whereClauses.push(`t.source_market_center_id = $${params.length}`);
        }
        const result = await pool.query(`SELECT
         t.id::text,
         t.source_team_id,
         t.name,
         t.status_name,
         t.market_center_id::text,
         mc.name AS market_center_name,
         t.source_market_center_id,
         cap.team_cap_amount::text,
         cap.commission_split_to_team::text,
         cap.manual_cap,
         cap.cap_year
       FROM migration.core_teams t
       LEFT JOIN migration.core_market_centers mc ON mc.id = t.market_center_id
       LEFT JOIN LATERAL (
         SELECT team_cap_amount, commission_split_to_team, manual_cap, cap_year
         FROM migration.team_caps
         WHERE team_id = t.id
         ORDER BY cap_year DESC NULLS LAST
         LIMIT 1
       ) cap ON TRUE
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY t.name ASC NULLS LAST`, params);
        return res.json({
            items: result.rows.map((r) => ({
                id: r.id,
                source_team_id: r.source_team_id,
                name: r.name,
                status_name: r.status_name,
                market_center_id: r.market_center_id,
                market_center_name: r.market_center_name,
                source_market_center_id: r.source_market_center_id,
                team_cap_amount: r.team_cap_amount,
                commission_split_to_team: r.commission_split_to_team,
                manual_cap: r.manual_cap,
                cap_year: r.cap_year,
            })),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ─── GET /permissions — team edit capabilities for current user ─────────────
router.get('/permissions', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    // Permissions depend on active context; never cache across contexts.
    res.setHeader('Vary', 'Origin, X-Active-Context');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const permissions = req.permissions;
    const userEmail = req.user?.email;
    if (!permissions || !userEmail)
        return res.status(401).json({ error: 'Unauthorised' });
    try {
        const editor = await getTeamEditorContext(userEmail);
        const isLeadAgent = editor?.jobTitles.has('lead agent') ?? false;
        const isTeamAgent = editor?.jobTitles.has('team agent') ?? false;
        if (permissions.scope === 'GLOBAL') {
            return res.json({
                can_create_team: true,
                can_edit_team_details: true,
                can_edit_team_cap: true,
                can_edit_team_dates: true,
                can_edit_any_team: true,
                editable_source_team_ids: [],
                scope: permissions.scope,
            });
        }
        if (permissions.scope === 'MARKET_CENTRE') {
            let editableIds = [];
            if (permissions.marketCenterId) {
                const scopedResult = await pool.query(`SELECT source_team_id
           FROM migration.core_teams
           WHERE source_market_center_id = $1`, [permissions.marketCenterId]);
                editableIds = scopedResult.rows.map((r) => r.source_team_id).filter(Boolean);
            }
            return res.json({
                can_create_team: true,
                can_edit_team_details: true,
                can_edit_team_cap: true,
                can_edit_team_dates: true,
                can_edit_any_team: false,
                editable_source_team_ids: editableIds,
                scope: permissions.scope,
            });
        }
        const isTeamAdmin = editor?.jobTitles.has('team admin') ?? false;
        const canEditDetails = isLeadAgent || isTeamAdmin;
        const ownEditableIds = canEditDetails
            ? Array.from(new Set([editor?.sourceTeamId ?? null, ...(editor ? Array.from(editor.adminTeams) : [])]
                .filter((v) => Boolean(v && v.length > 0))))
            : [];
        return res.json({
            can_create_team: false,
            can_edit_team_details: canEditDetails,
            can_edit_team_cap: false,
            can_edit_team_dates: false,
            can_edit_any_team: false,
            editable_source_team_ids: ownEditableIds,
            scope: permissions.scope,
            is_lead_agent: isLeadAgent,
            is_team_admin: isTeamAdmin,
            is_team_agent: isTeamAgent,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ─── GET / — paginated list ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const limitInput = Number(req.query.limit ?? 25);
    const offsetInput = Number(req.query.offset ?? 0);
    const searchInput = String(req.query.search ?? '').trim();
    const statusInput = String(req.query.status ?? '').trim().toLowerCase();
    const mcInput = toText(req.query.market_center_id);
    const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 250) : 25;
    const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;
    try {
        const tableCheck = await pool.query(`SELECT to_regclass('migration.core_teams') AS exists`);
        if (!tableCheck.rows[0]?.exists) {
            return res.json({ total: 0, limit, offset, items: [] });
        }
        const teamColumns = await getTeamColumns();
        const whereClauses = [];
        const params = [];
        if (searchInput.length > 0) {
            params.push(`%${searchInput}%`);
            const p = `$${params.length}`;
            const searchCols = ['name', 'registered_name', 'source_team_id', 'status_name', 'contact_email', 'address_city']
                .filter((c) => teamColumns.has(c));
            if (searchCols.length > 0) {
                whereClauses.push(`(${searchCols.map((c) => `t.${c} ILIKE ${p}`).join(' OR ')})`);
            }
        }
        if (statusInput === 'active') {
            whereClauses.push(`(LOWER(TRIM(COALESCE(t.status_name, ''))) = 'active' OR TRIM(COALESCE(t.status_name, '')) = '1')`);
        }
        else if (statusInput === 'inactive') {
            whereClauses.push(`(LOWER(TRIM(COALESCE(t.status_name, ''))) = 'inactive' OR TRIM(COALESCE(t.status_name, '')) = '2')`);
        }
        if (mcInput) {
            params.push(mcInput);
            whereClauses.push(`t.market_center_id = (SELECT id FROM migration.core_market_centers WHERE source_market_center_id = $${params.length} LIMIT 1)`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const totalResult = await pool.query(`SELECT COUNT(*)::text AS total FROM migration.core_teams t ${whereSql}`, params);
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const dataResult = await pool.query(`SELECT
         t.id::text,
         t.source_team_id,
         t.name,
         ${optCol(teamColumns, 'registered_name')},
         t.status_name,
         ${optCol(teamColumns, 'contact_number')},
         ${optCol(teamColumns, 'contact_email')},
         ${optCol(teamColumns, 'address_city')},
         ${optCol(teamColumns, 'logo_url')},
         t.market_center_id::text,
         mc.name AS market_center_name,
         mc.logo_image_url AS market_center_logo_url,
         COALESCE(agent_totals.agent_count, 0)::text AS agent_count,
         COALESCE(active_listings.listing_count, 0)::text AS active_listing_count,
         lead_agent.full_name AS lead_agent_name,
         lead_agent.email AS lead_agent_email,
         lead_agent.mobile_number AS lead_agent_mobile,
         lead_agent.image_url AS lead_agent_image_url,
         t.updated_at::text
       FROM migration.core_teams t
       LEFT JOIN migration.core_market_centers mc ON mc.id = t.market_center_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS agent_count
         FROM migration.core_associates a
         WHERE (
           a.team_id = t.id
           OR NULLIF(TRIM(COALESCE(a.source_team_id, '')), '') = NULLIF(TRIM(COALESCE(t.source_team_id, '')), '')
         )
           AND (LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
                OR TRIM(COALESCE(a.status_name, '')) = '1')
       ) agent_totals ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT cl.id) AS listing_count
         FROM migration.core_listings cl
         JOIN migration.listing_agents la ON la.listing_id = cl.id
         JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE (
           a.team_id = t.id
           OR NULLIF(TRIM(COALESCE(a.source_team_id, '')), '') = NULLIF(TRIM(COALESCE(t.source_team_id, '')), '')
         )
           AND LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'
       ) active_listings ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           a.full_name,
           a.email,
           a.mobile_number,
           a.image_url
         FROM migration.core_associates a
         LEFT JOIN migration.associate_job_titles jt ON jt.associate_id = a.id
         WHERE (
           a.team_id = t.id
           OR NULLIF(TRIM(COALESCE(a.source_team_id, '')), '') = NULLIF(TRIM(COALESCE(t.source_team_id, '')), '')
         )
           AND (LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
                OR TRIM(COALESCE(a.status_name, '')) = '1')
         GROUP BY a.id, a.full_name, a.email, a.mobile_number, a.image_url
         ORDER BY
           CASE
             WHEN BOOL_OR(LOWER(TRIM(COALESCE(jt.job_title, ''))) = 'lead agent') THEN 0
             WHEN BOOL_OR(LOWER(TRIM(COALESCE(jt.job_title, ''))) = 'team admin') THEN 1
             ELSE 2
           END,
           a.full_name ASC NULLS LAST
         LIMIT 1
       ) lead_agent ON TRUE
       ${whereSql}
       ORDER BY t.name ASC NULLS LAST
       LIMIT ${limitParam} OFFSET ${offsetParam}`, params);
        return res.json({
            total: Number(totalResult.rows[0]?.total ?? 0),
            limit,
            offset,
            items: dataResult.rows,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ─── GET /:id — full team detail ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const idParam = Number(req.params.id);
    if (!Number.isFinite(idParam))
        return res.status(400).json({ error: 'Invalid team id.' });
    try {
        const teamColumns = await getTeamColumns();
        const teamResult = await pool.query(`SELECT
         t.id::text,
         t.source_team_id,
         t.name,
         ${optCol(teamColumns, 'registered_name')},
         t.status_name,
         ${optCol(teamColumns, 'contact_number')},
         ${optCol(teamColumns, 'contact_email')},
         ${optCol(teamColumns, 'logo_url')},
         ${optCol(teamColumns, 'address_line1')},
         ${optCol(teamColumns, 'address_suburb')},
         ${optCol(teamColumns, 'address_city')},
         ${optCol(teamColumns, 'address_province')},
         ${optCol(teamColumns, 'address_postal_code')},
         t.market_center_id::text,
         mc.name AS market_center_name,
         mc.source_market_center_id,
         t.created_at::text,
         t.updated_at::text
       FROM migration.core_teams t
       LEFT JOIN migration.core_market_centers mc ON mc.id = t.market_center_id
       WHERE t.id = $1`, [idParam]);
        if (teamResult.rows.length === 0)
            return res.status(404).json({ error: 'Team not found.' });
        const team = teamResult.rows[0];
        // Cap (current)
        const capResult = await pool.query(`SELECT
         commission_split_to_team::text,
         team_cap_amount::text,
         manual_cap,
         cap_year
       FROM migration.team_caps
       WHERE team_id = $1
       ORDER BY cap_year DESC NULLS LAST
       LIMIT 1`, [idParam]).catch(() => ({ rows: [] }));
        // Cap history
        const capHistResult = await pool.query(`SELECT
         id::text,
         commission_split_to_team::text,
         team_cap_amount::text,
         manual_cap,
         start_date::text,
         end_date::text,
         created_at::text
       FROM migration.team_cap_history
       WHERE team_id = $1
       ORDER BY start_date DESC NULLS LAST`, [idParam]).catch(() => ({ rows: [] }));
        // Associate commissions
        const commResult = await pool.query(`SELECT has_individual_cap, associate_default_cap::text, associate_default_split::text, productivity_coach
       FROM migration.team_associate_commissions
       WHERE team_id = $1`, [idParam]).catch(() => ({ rows: [] }));
        // Dates
        const datesResult = await pool.query(`SELECT open_date::text, close_date::text, cap_date::text, anniversary_date::text, anniversary_comment
       FROM migration.team_dates
       WHERE team_id = $1`, [idParam]).catch(() => ({ rows: [] }));
        // Portal settings
        const portalResult = await pool.query(`SELECT use_mc_account_p24, p24_agency_id, feed_to_p24, p24_auction_approved,
              use_mc_account_entegral, entegral_url, feed_to_entegral, entegral_portals
       FROM migration.team_portal_settings
       WHERE team_id = $1`, [idParam]).catch(() => ({ rows: [] }));
        // Notes
        const notesResult = await pool.query(`SELECT id::text, note_text, note_type, created_by, created_at::text
       FROM migration.team_notes
       WHERE team_id = $1
       ORDER BY created_at DESC`, [idParam]).catch(() => ({ rows: [] }));
        // Members
        const membersResult = await pool.query(`SELECT
         a.id::text,
         a.source_associate_id,
         a.full_name,
         a.status_name,
         COALESCE(
           ARRAY(SELECT role_name FROM migration.associate_roles WHERE associate_id = a.id ORDER BY role_name),
           ARRAY[]::text[]
         ) AS role_names
       FROM migration.core_associates a
       WHERE a.team_id = $1
       ORDER BY a.full_name ASC NULLS LAST`, [idParam]).catch(() => ({ rows: [] }));
        return res.json({
            ...team,
            cap: capResult.rows[0] ?? null,
            cap_history: capHistResult.rows,
            associate_commissions: commResult.rows[0] ?? null,
            dates: datesResult.rows[0] ?? null,
            portal_settings: portalResult.rows[0] ?? null,
            notes: notesResult.rows,
            members: membersResult.rows,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ─── POST / — create team ─────────────────────────────────────────────────────
router.post('/', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const body = req.body;
    const name = toText(body.name);
    if (!name)
        return res.status(400).json({ error: 'Team name is required.' });
    const sourceMarketCenterId = toText(body.source_market_center_id);
    const permissions = req.permissions;
    if (!permissions)
        return res.status(403).json({ error: 'Permission denied.' });
    if (permissions.scope === 'OWN') {
        return res.status(403).json({ error: 'Permission denied: only Regional and Market Centre admins can create teams.' });
    }
    if (permissions.scope === 'MARKET_CENTRE' && permissions.marketCenterId && sourceMarketCenterId && permissions.marketCenterId !== sourceMarketCenterId) {
        return res.status(403).json({ error: 'Permission denied: you can only create teams in your market centre.' });
    }
    try {
        await runEnsureTeamSchema();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Resolve market_center_id
            let marketCenterId = null;
            if (sourceMarketCenterId) {
                const mcResult = await client.query(`SELECT id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId]);
                marketCenterId = mcResult.rows[0] ? Number(mcResult.rows[0].id) : null;
            }
            // Build source_team_id
            const sourceTeamId = toText(body.source_team_id) ?? `MAN-TEAM-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
            const teamInsert = await client.query(`INSERT INTO migration.core_teams
           (source_team_id, source_market_center_id, market_center_id, name, status_name,
            registered_name, contact_number, contact_email, logo_url,
            address_line1, address_suburb, address_city, address_province, address_postal_code,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
         RETURNING id::text`, [
                sourceTeamId,
                sourceMarketCenterId,
                marketCenterId,
                name,
                toText(body.status_name) ?? 'Active',
                toText(body.registered_name),
                toText(body.contact_number),
                toText(body.contact_email),
                toText(body.logo_url),
                toText(body.address_line1),
                toText(body.address_suburb),
                toText(body.address_city),
                toText(body.address_province),
                toText(body.address_postal_code),
            ]);
            const teamId = Number(teamInsert.rows[0].id);
            await saveTeamSubRecords(client, teamId, body);
            await client.query('COMMIT');
            return res.status(201).json({ id: teamInsert.rows[0].id });
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ─── PUT /:id — update team ───────────────────────────────────────────────────
router.put('/:id', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const idParam = Number(req.params.id);
    if (!Number.isFinite(idParam))
        return res.status(400).json({ error: 'Invalid team id.' });
    const body = req.body;
    const name = toText(body.name);
    if (!name)
        return res.status(400).json({ error: 'Team name is required.' });
    const sourceMarketCenterId = toText(body.source_market_center_id);
    const permissions = req.permissions;
    if (!permissions)
        return res.status(403).json({ error: 'Permission denied.' });
    const userEmail = req.user?.email;
    if (!userEmail)
        return res.status(401).json({ error: 'Unauthorised' });
    try {
        await runEnsureTeamSchema();
        const existingTeamResult = await pool.query(`SELECT source_market_center_id, source_team_id FROM migration.core_teams WHERE id = $1 LIMIT 1`, [idParam]);
        const existingTeam = existingTeamResult.rows[0];
        if (!existingTeam)
            return res.status(404).json({ error: 'Team not found.' });
        const editorContext = await getTeamEditorContext(userEmail);
        const targetSourceMcId = sourceMarketCenterId ?? existingTeam.source_market_center_id;
        if (!canEditTeamDetails(permissions, editorContext, targetSourceMcId, existingTeam.source_team_id)) {
            return res.status(403).json({ error: 'Permission denied: you cannot edit this team.' });
        }
        const allowCapEdit = canEditTeamCap(permissions);
        if (!allowCapEdit) {
            delete body.team_cap_amount;
            delete body.commission_split_to_team;
            delete body.manual_cap;
            delete body.cap_year;
        }
        const allowDateEdit = canEditTeamDates(permissions);
        if (!allowDateEdit) {
            delete body.open_date;
            delete body.close_date;
            delete body.cap_date;
            delete body.anniversary_date;
            delete body.anniversary_comment;
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let marketCenterId = null;
            if (sourceMarketCenterId) {
                const mcResult = await client.query(`SELECT id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId]);
                marketCenterId = mcResult.rows[0] ? Number(mcResult.rows[0].id) : null;
            }
            await client.query(`UPDATE migration.core_teams SET
           name = $1,
           status_name = $2,
           market_center_id = $3,
           source_market_center_id = $4,
           registered_name = $5,
           contact_number = $6,
           contact_email = $7,
           logo_url = $8,
           address_line1 = $9,
           address_suburb = $10,
           address_city = $11,
           address_province = $12,
           address_postal_code = $13,
           updated_at = NOW()
         WHERE id = $14`, [
                name,
                toText(body.status_name) ?? 'Active',
                marketCenterId,
                sourceMarketCenterId,
                toText(body.registered_name),
                toText(body.contact_number),
                toText(body.contact_email),
                toText(body.logo_url),
                toText(body.address_line1),
                toText(body.address_suburb),
                toText(body.address_city),
                toText(body.address_province),
                toText(body.address_postal_code),
                idParam,
            ]);
            await saveTeamSubRecords(client, idParam, body);
            await client.query('COMMIT');
            return res.json({ success: true });
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
async function saveTeamSubRecords(client, teamId, body) {
    // Cap
    const capAmount = toNumber(body.team_cap_amount);
    const splitToTeam = toNumber(body.commission_split_to_team);
    const capYear = toNumber(body.cap_year) ?? new Date().getFullYear();
    if (capAmount !== null || splitToTeam !== null) {
        await client.query(`INSERT INTO migration.team_caps
         (team_id, commission_split_to_team, team_cap_amount, manual_cap, cap_year, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (team_id, cap_year)
       DO UPDATE SET
         commission_split_to_team = EXCLUDED.commission_split_to_team,
         team_cap_amount = EXCLUDED.team_cap_amount,
         manual_cap = EXCLUDED.manual_cap,
         updated_at = NOW()`, [teamId, splitToTeam, capAmount, toBool(body.manual_cap), capYear]);
    }
    // Associate commissions
    const defaultCap = toNumber(body.associate_default_cap);
    const defaultSplit = toNumber(body.associate_default_split);
    const productivityCoach = toText(body.productivity_coach);
    if (defaultCap !== null || defaultSplit !== null || productivityCoach !== null) {
        await client.query(`INSERT INTO migration.team_associate_commissions
         (team_id, has_individual_cap, associate_default_cap, associate_default_split, productivity_coach, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (team_id)
       DO UPDATE SET
         has_individual_cap = EXCLUDED.has_individual_cap,
         associate_default_cap = EXCLUDED.associate_default_cap,
         associate_default_split = EXCLUDED.associate_default_split,
         productivity_coach = EXCLUDED.productivity_coach,
         updated_at = NOW()`, [teamId, toBool(body.has_individual_cap), defaultCap, defaultSplit, productivityCoach]);
    }
    // Dates
    const openDate = toDate(body.open_date);
    const closeDate = toDate(body.close_date);
    const capDate = toDate(body.cap_date);
    const anniversaryDate = toDate(body.anniversary_date);
    if (openDate || closeDate || capDate || anniversaryDate) {
        await client.query(`INSERT INTO migration.team_dates
         (team_id, open_date, close_date, cap_date, anniversary_date, anniversary_comment, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (team_id)
       DO UPDATE SET
         open_date = EXCLUDED.open_date,
         close_date = EXCLUDED.close_date,
         cap_date = EXCLUDED.cap_date,
         anniversary_date = EXCLUDED.anniversary_date,
         anniversary_comment = EXCLUDED.anniversary_comment,
         updated_at = NOW()`, [teamId, openDate, closeDate, capDate, anniversaryDate, toText(body.anniversary_comment)]);
    }
    // Portal settings
    await client.query(`INSERT INTO migration.team_portal_settings
       (team_id, use_mc_account_p24, p24_agency_id, feed_to_p24, p24_auction_approved,
        use_mc_account_entegral, entegral_url, feed_to_entegral, entegral_portals, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (team_id)
     DO UPDATE SET
       use_mc_account_p24 = EXCLUDED.use_mc_account_p24,
       p24_agency_id = EXCLUDED.p24_agency_id,
       feed_to_p24 = EXCLUDED.feed_to_p24,
       p24_auction_approved = EXCLUDED.p24_auction_approved,
       use_mc_account_entegral = EXCLUDED.use_mc_account_entegral,
       entegral_url = EXCLUDED.entegral_url,
       feed_to_entegral = EXCLUDED.feed_to_entegral,
       entegral_portals = EXCLUDED.entegral_portals,
       updated_at = NOW()`, [
        teamId,
        body.use_mc_account_p24 !== undefined ? toBool(body.use_mc_account_p24) : true,
        toText(body.p24_agency_id),
        body.feed_to_p24 !== undefined ? toBool(body.feed_to_p24) : true,
        toBool(body.p24_auction_approved),
        body.use_mc_account_entegral !== undefined ? toBool(body.use_mc_account_entegral) : true,
        toText(body.entegral_url),
        body.feed_to_entegral !== undefined ? toBool(body.feed_to_entegral) : true,
        toStringArray(body.entegral_portals),
    ]);
    // Notes (full replace)
    const notes = toStringArray(body.notes);
    if (notes.length > 0 || body.notes !== undefined) {
        await client.query(`DELETE FROM migration.team_notes WHERE team_id = $1`, [teamId]);
        for (const note of notes) {
            await client.query(`INSERT INTO migration.team_notes (team_id, note_text, note_type, created_by)
         VALUES ($1, $2, $3, $4)`, [teamId, note, 'general', 'console-user']);
        }
    }
}
export default router;
//# sourceMappingURL=teams.js.map