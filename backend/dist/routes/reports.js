import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { salesOnlyTransactionExclusionSql, transactionAgentCalculationDedupCte } from './reportingSql.js';
import { getAppTimeZone, getFirstOfMonthInAppTimeZone, getTodayInAppTimeZone } from '../utils/timeZone.js';
const router = Router();
const pool = getOptionalPgPool();
const MC_DASHBOARD_SNAPSHOT_VERSION = 7;
function normalizeView(raw) {
    return String(raw ?? '').trim().toLowerCase() === 'team' ? 'team' : 'associate';
}
function parseCsvParam(raw) {
    const text = String(raw ?? '').trim();
    if (!text)
        return [];
    return text.split(',').map((value) => value.trim()).filter(Boolean);
}
function normalizeMonthEndDateBasis(raw) {
    return String(raw ?? '').trim().toLowerCase() === 'transaction' ? 'transaction' : 'status_change';
}
function parseTeamContextToken(activeContextId) {
    const normalized = activeContextId.trim().toLowerCase();
    const match = /^(lead_agent|team_admin|team_agent)(?:_(.+))?$/.exec(normalized);
    if (!match)
        return null;
    const token = (match[2] ?? '').trim();
    return token.length > 0 ? token : null;
}
async function resolveScopedTeamSourceId(req) {
    if (!pool)
        return null;
    const perms = req.permissions;
    if (!perms || perms.scope !== 'OWN' || !perms.associateDbId)
        return null;
    const activeContextId = String(req.headers['x-active-context'] ?? '');
    const isTeamContext = /^(lead_agent|team_admin|team_agent)(?:_.+)?$/i.test(activeContextId.trim());
    if (!isTeamContext)
        return null;
    const teamToken = parseTeamContextToken(activeContextId);
    const allowedTeamsResult = await pool.query(`WITH allowed_teams AS (
       SELECT
         COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(ca.source_team_id), '')) AS source_team_id,
         COALESCE(t.id::text, ca.team_id::text) AS team_db_id
       FROM migration.core_associates ca
       LEFT JOIN migration.core_teams t ON t.id = ca.team_id
       WHERE ca.id = $1::bigint
       UNION
       SELECT
         COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(aat.source_team_id), '')) AS source_team_id,
         t.id::text AS team_db_id
       FROM migration.associate_admin_teams aat
       LEFT JOIN migration.core_teams t ON t.source_team_id = aat.source_team_id
       WHERE aat.associate_id = $1::bigint
     )
     SELECT DISTINCT
       source_team_id,
       team_db_id
     FROM allowed_teams
     WHERE NULLIF(TRIM(COALESCE(source_team_id, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(team_db_id, '')), '') IS NOT NULL`, [perms.associateDbId]);
    const firstAllowedTeam = allowedTeamsResult.rows.find((row) => (row.source_team_id ?? '').trim().length > 0)?.source_team_id
        ?? allowedTeamsResult.rows.find((row) => (row.team_db_id ?? '').trim().length > 0)?.team_db_id
        ?? null;
    // If team permissions exist in context but are missing in current joins,
    // fall back to the context token so Team views stay scoped instead of unscoped/empty.
    if (!firstAllowedTeam && teamToken) {
        return teamToken;
    }
    if (!teamToken) {
        return firstAllowedTeam;
    }
    const normalizedToken = normalizeForMatch(teamToken);
    const matched = allowedTeamsResult.rows.find((row) => normalizeForMatch(row.source_team_id) === normalizedToken || normalizeForMatch(row.team_db_id) === normalizedToken);
    return matched?.source_team_id || matched?.team_db_id || firstAllowedTeam || teamToken;
}
async function resolveScopedTeamSourceIds(req) {
    if (!pool)
        return [];
    const perms = req.permissions;
    if (!perms || perms.scope !== 'OWN' || !perms.associateDbId)
        return [];
    const activeContextId = String(req.headers['x-active-context'] ?? '');
    const isTeamContext = /^(lead_agent|team_admin|team_agent)(?:_.+)?$/i.test(activeContextId.trim());
    if (!isTeamContext)
        return [];
    const teamToken = parseTeamContextToken(activeContextId);
    const allowedTeamsResult = await pool.query(`WITH allowed_teams AS (
       SELECT
         COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(ca.source_team_id), '')) AS source_team_id,
         COALESCE(t.id::text, ca.team_id::text) AS team_db_id
       FROM migration.core_associates ca
       LEFT JOIN migration.core_teams t ON t.id = ca.team_id
       WHERE ca.id = $1::bigint
       UNION
       SELECT
         COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(aat.source_team_id), '')) AS source_team_id,
         t.id::text AS team_db_id
       FROM migration.associate_admin_teams aat
       LEFT JOIN migration.core_teams t ON t.source_team_id = aat.source_team_id
       WHERE aat.associate_id = $1::bigint
     )
     SELECT DISTINCT
       source_team_id,
       team_db_id
     FROM allowed_teams
     WHERE NULLIF(TRIM(COALESCE(source_team_id, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(team_db_id, '')), '') IS NOT NULL`, [perms.associateDbId]);
    const candidates = new Set();
    if (teamToken) {
        candidates.add(teamToken);
    }
    for (const row of allowedTeamsResult.rows) {
        const sourceTeamId = (row.source_team_id ?? '').trim();
        const teamDbId = (row.team_db_id ?? '').trim();
        if (sourceTeamId)
            candidates.add(sourceTeamId);
        if (teamDbId)
            candidates.add(teamDbId);
    }
    return Array.from(candidates);
}
function parseBirthdayFromSouthAfricanId(nationalId) {
    if (!nationalId)
        return null;
    const digits = nationalId.replace(/\D/g, '');
    if (digits.length < 6)
        return null;
    const yy = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const dd = Number(digits.slice(4, 6));
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd))
        return null;
    const now = new Date();
    const currentTwoDigitYear = now.getUTCFullYear() % 100;
    const fullYear = yy <= currentTwoDigitYear ? 2000 + yy : 1900 + yy;
    const date = new Date(Date.UTC(fullYear, mm - 1, dd));
    if (date.getUTCFullYear() !== fullYear
        || date.getUTCMonth() + 1 !== mm
        || date.getUTCDate() !== dd) {
        return null;
    }
    return `${fullYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
function getAppTimeInTimeZone(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: getAppTimeZone(),
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
}
function normalizeForMatch(value) {
    return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
async function ensureMcDashboardSnapshotTable() {
    if (!pool)
        return;
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.mc_dashboard_daily_snapshots (
      snapshot_date DATE NOT NULL,
      mc_source_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (snapshot_date, mc_source_id)
    )
  `);
}
async function computeMcDashboardData(mcSourceId, dateFrom, dateTo) {
    if (!pool) {
        throw new Error('DATABASE_URL is not configured.');
    }
    const normalizedMcId = normalizeForMatch(mcSourceId);
    const summaryResult = await pool.query(`
    WITH ${transactionAgentCalculationDedupCte},
    selected_mc AS (
      SELECT id, source_market_center_id, COALESCE(NULLIF(TRIM(name), ''), 'Unknown Market Centre') AS name, logo_image_url, white_logo_image_url
      FROM migration.core_market_centers
      WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      ORDER BY
        CASE WHEN NULLIF(TRIM(COALESCE(white_logo_image_url, '')), '') IS NULL THEN 0 ELSE 1 END DESC,
        CASE WHEN NULLIF(TRIM(COALESCE(logo_image_url, '')), '') IS NULL THEN 0 ELSE 1 END DESC,
        updated_at DESC NULLS LAST,
        id DESC
      LIMIT 1
    ),
    associates_in_mc AS (
      SELECT
        ca.id,
        ca.status_name,
        ca.start_date,
        ca.anniversary_date,
        ca.national_id
      FROM migration.core_associates ca
      INNER JOIN selected_mc smc ON smc.id = ca.market_center_id
    ),
    listing_metrics AS (
      SELECT COUNT(*)::int AS active_listings
      FROM migration.core_listings cl
      INNER JOIN selected_mc smc ON smc.id = cl.market_center_id
      WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
    ),
    tx_base AS (
      SELECT
        tac.transaction_id,
        COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0) AS transaction_gci_before_fees,
        COALESCE(tac.market_center_dollar, 0) AS market_center_dollar,
        COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side
      FROM tac_dedup tac
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
      LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
      LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
      LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
      WHERE (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
        AND ${salesOnlyTransactionExclusionSql}
        AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) >= $2::date
        AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) <= $3::date
        AND REGEXP_REPLACE(
          LOWER(TRIM(COALESCE(
            ct.source_market_center_id,
            mc_tx_primary.source_market_center_id,
            mc_tx.source_market_center_id,
            mc_office.source_market_center_id,
            mc_assoc.source_market_center_id,
            ''
          ))),
          '[^a-z0-9]+', '', 'g'
        ) = $1
        AND ca.id IS NOT NULL
    ),
    tx_per_contract AS (
      SELECT
        transaction_id,
        SUM(transaction_gci_before_fees)::numeric(18,2) AS total_gci,
        SUM(market_center_dollar)::numeric(18,2) AS total_co_dollars,
        CASE
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') THEN 1
          ELSE 0
        END::int AS units
      FROM tx_base
      GROUP BY transaction_id
    ),
    tx_metrics AS (
      SELECT
        COALESCE(SUM(total_gci), 0)::numeric(18,2) AS registered_gci,
        COALESCE(SUM(total_co_dollars), 0)::numeric(18,2) AS registered_co_dollars,
        COALESCE(SUM(units), 0)::int AS registered_units,
        COUNT(*)::int AS registered_contracts
      FROM tx_per_contract
    )
    SELECT
      COALESCE((SELECT name FROM selected_mc), 'Unknown Market Centre') AS market_center_name,
      (SELECT logo_image_url FROM selected_mc) AS market_center_logo_url,
      (SELECT white_logo_image_url FROM selected_mc) AS market_center_white_logo_url,
      (
        SELECT COUNT(*)
        FROM associates_in_mc a
        WHERE a.national_id ~ '^[0-9]{13}$'
          AND substring(a.national_id, 3, 2) = to_char($3::date, 'MM')
          AND substring(a.national_id, 5, 2) = to_char($3::date, 'DD')
          AND LOWER(TRIM(COALESCE(a.status_name, ''))) IN ('active', '1')
      )::text AS birthdays_today,
      (
        SELECT COUNT(*)
        FROM associates_in_mc a
        WHERE a.anniversary_date IS NOT NULL
          AND EXTRACT(MONTH FROM a.anniversary_date) = EXTRACT(MONTH FROM $3::date)
          AND LOWER(TRIM(COALESCE(a.status_name, ''))) IN ('active', '1')
      )::text AS anniversaries_this_month,
      (
        SELECT COUNT(*)
        FROM associates_in_mc a
        WHERE a.start_date IS NOT NULL
          AND a.start_date::date >= $2::date
          AND a.start_date::date <= $3::date
      )::text AS new_agents_this_month,
      (
        SELECT COUNT(*)
        FROM associates_in_mc a
        WHERE LOWER(TRIM(COALESCE(a.status_name, ''))) IN ('active', '1')
      )::text AS active_agents,
      (SELECT active_listings::text FROM listing_metrics) AS active_listings,
      (SELECT registered_gci::text FROM tx_metrics) AS registered_gci,
      (SELECT registered_co_dollars::text FROM tx_metrics) AS registered_co_dollars,
      (SELECT registered_units::text FROM tx_metrics) AS registered_units,
      (SELECT registered_contracts::text FROM tx_metrics) AS registered_contracts
    `, [normalizedMcId, dateFrom, dateTo]);
    const summary = summaryResult.rows[0];
    const topAgentsResult = await pool.query(`
    WITH ${transactionAgentCalculationDedupCte},
    tx_agent AS (
      SELECT
        ca.id::text AS associate_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS gci,
        CASE
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%both%' THEN 2
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%buyer%' THEN 1
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%seller%' THEN 1
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%other%' THEN 1
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%referral%' THEN 1
          ELSE 0
        END::int AS units
      FROM tac_dedup tac
      INNER JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
      WHERE tac.is_registered = true
        AND ${salesOnlyTransactionExclusionSql}
        AND tac.effective_reporting_date::date >= $2::date
        AND tac.effective_reporting_date::date <= $3::date
        AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
    )
    SELECT
      associate_id,
      associate_name,
      team_name,
      ROUND(SUM(gci)::numeric, 2)::text AS registered_gci,
      COALESCE(SUM(units), 0)::int::text AS units
    FROM tx_agent
    GROUP BY associate_id, associate_name, team_name
    ORDER BY SUM(gci) DESC, SUM(units) DESC, associate_name ASC
    LIMIT 8
    `, [normalizedMcId, dateFrom, dateTo]);
    const topTeamsResult = await pool.query(`
    WITH ${transactionAgentCalculationDedupCte},
    active_agent_counts AS (
      SELECT
        COALESCE(t.id::text, 'no-team') AS team_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COUNT(*)::int AS active_agents
      FROM migration.core_associates ca
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
      WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      GROUP BY COALESCE(t.id::text, 'no-team'), COALESCE(NULLIF(TRIM(t.name), ''), 'No Team')
    ),
    team_tx AS (
      SELECT
        COALESCE(t.id::text, 'no-team') AS team_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS gci,
        CASE
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%both%' THEN 2
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%buyer%' THEN 1
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%seller%' THEN 1
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%other%' THEN 1
          WHEN LOWER(TRIM(COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), ''))) LIKE '%referral%' THEN 1
          ELSE 0
        END::int AS units
      FROM tac_dedup tac
      INNER JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
      WHERE tac.is_registered = true
        AND ${salesOnlyTransactionExclusionSql}
        AND tac.effective_reporting_date::date >= $2::date
        AND tac.effective_reporting_date::date <= $3::date
        AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
    )
    SELECT
      tx.team_id,
      tx.team_name,
      ROUND(SUM(tx.gci)::numeric, 2)::text AS registered_gci,
      COALESCE(SUM(tx.units), 0)::int::text AS units,
      COALESCE(ac.active_agents, 0)::int::text AS active_agents
    FROM team_tx tx
    LEFT JOIN active_agent_counts ac ON ac.team_id = tx.team_id
    GROUP BY tx.team_id, tx.team_name, ac.active_agents
    ORDER BY SUM(tx.gci) DESC, SUM(tx.units) DESC, tx.team_name ASC
    LIMIT 6
    `, [normalizedMcId, dateFrom, dateTo]);
    const birthdayPeopleResult = await pool.query(`
    SELECT
      ca.id::text AS associate_id,
      COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
      COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
      NULLIF(TRIM(ca.mobile_number), '') AS mobile_number,
      to_char(
        to_date(
          (
            CASE
              WHEN substring(ca.national_id, 1, 2)::int <= (EXTRACT(YEAR FROM CURRENT_DATE)::int % 100)
                THEN (2000 + substring(ca.national_id, 1, 2)::int)::text
              ELSE (1900 + substring(ca.national_id, 1, 2)::int)::text
            END
          ) || substring(ca.national_id, 3, 2) || substring(ca.national_id, 5, 2),
          'YYYYMMDD'
        ),
        'YYYY-MM-DD'
      ) AS birthday
    FROM migration.core_associates ca
    LEFT JOIN migration.core_teams t ON t.id = ca.team_id
    LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
    WHERE ca.national_id ~ '^[0-9]{13}$'
      AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      AND substring(ca.national_id, 3, 2) = to_char($2::date, 'MM')
      AND substring(ca.national_id, 5, 2) = to_char($2::date, 'DD')
      AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
    ORDER BY associate_name ASC
    `, [normalizedMcId, dateTo]);
    const anniversaryPeopleResult = await pool.query(`
    SELECT
      ca.id::text AS associate_id,
      COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
      COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
      NULLIF(TRIM(ca.mobile_number), '') AS mobile_number,
      ca.anniversary_date::date::text AS anniversary_date
    FROM migration.core_associates ca
    LEFT JOIN migration.core_teams t ON t.id = ca.team_id
    LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
    WHERE ca.anniversary_date IS NOT NULL
      AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      AND EXTRACT(MONTH FROM ca.anniversary_date) = EXTRACT(MONTH FROM $2::date)
      AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
    ORDER BY EXTRACT(DAY FROM ca.anniversary_date) ASC, associate_name ASC
    LIMIT 150
    `, [normalizedMcId, dateTo]);
    const registeredGci = Number(summary.registered_gci);
    const registeredUnits = Number(summary.registered_units);
    return {
        market_center: {
            source_market_center_id: mcSourceId,
            name: summary.market_center_name,
            logo_image_url: summary.market_center_logo_url ?? null,
            white_logo_image_url: summary.market_center_white_logo_url ?? null,
        },
        period: {
            date_from: dateFrom,
            date_to: dateTo,
            description: 'Month to date',
        },
        metrics: {
            birthdays_today: Number(summary.birthdays_today),
            anniversaries_this_month: Number(summary.anniversaries_this_month),
            new_agents_this_month: Number(summary.new_agents_this_month),
            active_agents: Number(summary.active_agents),
            active_listings: Number(summary.active_listings),
            registered_gci: registeredGci,
            registered_co_dollars: Number(summary.registered_co_dollars),
            registered_units: registeredUnits,
            registered_contracts: Number(summary.registered_contracts),
            avg_gci_per_unit: registeredUnits > 0 ? Math.round((registeredGci / registeredUnits) * 100) / 100 : 0,
        },
        top_performers: {
            agents: topAgentsResult.rows.map((row) => ({
                associate_id: row.associate_id,
                associate_name: row.associate_name,
                team_name: row.team_name,
                registered_gci: Number(row.registered_gci),
                units: Number(row.units),
            })),
            teams: topTeamsResult.rows.map((row) => ({
                team_id: row.team_id,
                team_name: row.team_name,
                registered_gci: Number(row.registered_gci),
                units: Number(row.units),
                active_agents: Number(row.active_agents),
            })),
        },
        people: {
            birthdays_today: birthdayPeopleResult.rows.map((row) => ({
                associate_id: row.associate_id,
                associate_name: row.associate_name,
                team_name: row.team_name,
                mobile_number: row.mobile_number,
                date: row.birthday,
            })),
            anniversaries_this_month: anniversaryPeopleResult.rows.map((row) => ({
                associate_id: row.associate_id,
                associate_name: row.associate_name,
                team_name: row.team_name,
                mobile_number: row.mobile_number,
                date: row.anniversary_date,
            })),
        },
        _v: MC_DASHBOARD_SNAPSHOT_VERSION,
    };
}
// GET /api/reports/month-end/filter-options
// Returns available filter values for the report slicers
router.get('/month-end/filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const debugMode = String(req.query.debug || '').trim() === '1';
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceIds = (await resolveScopedTeamSourceIds(req)).map(normalizeForMatch);
        const scopedTeamSourceId = scopedTeamSourceIds[0] ?? await resolveScopedTeamSourceId(req);
        const result = await pool.query(`
      WITH ${transactionAgentCalculationDedupCte},
      scoped_tx AS (
        SELECT DISTINCT
          tac.transaction_id,
          COALESCE(NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS source_market_center_id,
          COALESCE(NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
          ct.transaction_status,
          COALESCE(NULLIF(TRIM(ct.sale_type), ''), NULLIF(TRIM(ct.transaction_type), '')) AS sale_type
        FROM tac_dedup tac
        LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
        LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
        LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
        LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
        WHERE (
          $1::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
        )
          AND (
            CARDINALITY($2::text[]) = 0
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = ANY($2::text[])
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = ANY($2::text[])
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = ANY($2::text[])
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = ANY($2::text[])
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = ANY($2::text[])
          )
        )
        SELECT
        transaction_status,
        sale_type,
        source_market_center_id,
        market_center_name
      FROM scoped_tx
      ORDER BY market_center_name
      `, [scopeMcId, scopedTeamSourceIds]);
        const statuses = Array.from(new Set(result.rows
            .map((r) => (r.transaction_status ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const saleTypes = Array.from(new Set(result.rows
            .map((r) => (r.sale_type ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const marketCentersMap = new Map();
        for (const row of result.rows) {
            const id = (row.source_market_center_id ?? '').trim();
            if (!id)
                continue;
            if (!marketCentersMap.has(id)) {
                marketCentersMap.set(id, row.market_center_name);
            }
        }
        const marketCenters = Array.from(marketCentersMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return res.json({
            statuses,
            sale_types: saleTypes,
            market_centers: marketCenters,
            debug: debugMode
                ? {
                    active_context: String(req.headers['x-active-context'] ?? ''),
                    scope: perms.scope,
                    scope_mc_id: scopeMcId,
                    scoped_team_source_id: scopedTeamSourceId,
                }
                : undefined,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/reports/month-end
// Returns Market Centre Totals aggregated from transaction_agent_calculations
router.get('/month-end', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
        const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
        const transactionStatus = String(req.query.transaction_status || '');
        const saleType = String(req.query.sale_type || '');
        const teamId = String(req.query.team_id || '').trim();
        const associateId = String(req.query.associate_id || '').trim();
        const marketCenterIdsParam = String(req.query.market_center_ids || '');
        const debugMode = String(req.query.debug || '').trim() === '1';
        const marketCenterIds = marketCenterIdsParam
            ? marketCenterIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;
        const params = [dateFrom, dateTo, transactionStatus, saleType];
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const effectiveTeamId = teamId || scopedTeamSourceId || '';
        const effectiveAssociateId = associateId || (resolvedScopeAssociateId ? String(resolvedScopeAssociateId) : '');
        const useAssociateGrouping = !!(effectiveTeamId || effectiveAssociateId);
        if (scopeMcId) {
            params.push(scopeMcId);
        }
        const scopeMcParam = scopeMcId ? `$${params.length}` : 'NULL';
        if (scopedTeamSourceId) {
            params.push(scopedTeamSourceId);
        }
        const scopeTeamParam = scopedTeamSourceId ? `$${params.length}` : 'NULL';
        params.push(effectiveTeamId);
        const teamFilterParam = `$${params.length}`;
        params.push(effectiveAssociateId);
        const associateFilterParam = `$${params.length}`;
        params.push(useAssociateGrouping ? 'true' : 'false');
        const useAssociateGroupingParam = `$${params.length}`;
        let mcFilterClause = '';
        if (perms.scope === 'GLOBAL' && marketCenterIds.length > 0) {
            params.push(marketCenterIds);
            mcFilterClause = `AND mc_source_id = ANY($${params.length}::text[])`;
        }
        const sql = `
      WITH ${transactionAgentCalculationDedupCte},
      base AS (
        SELECT
          tac.transaction_id,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS tx_mc_name,
          COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), '') AS tx_mc_source_id,
          COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), '')) AS office_mc_name,
          COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS office_mc_source_id,
          CASE
            WHEN _parity.use_header_values
              THEN _parity.header_row_gci
            ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2)
          END AS transaction_gci_before_fees,
          CASE
            WHEN _parity.use_header_values
              THEN ROUND(COALESCE(tac.growth_share, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.growth_share, 0)::numeric(18,2)
          END AS growth_share,
          CASE
            WHEN _parity.use_header_values
              THEN ROUND(COALESCE(tac.production_royalties, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.production_royalties, 0)::numeric(18,2)
          END AS production_royalties,
          COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
          CASE
            WHEN _parity.use_header_values
              THEN ROUND(COALESCE(tac.associate_dollar, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.associate_dollar, 0)::numeric(18,2)
          END AS associate_dollar,
          CASE
            WHEN _parity.use_header_values
              THEN ROUND(COALESCE(tac.team_dollar, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.team_dollar, 0)::numeric(18,2)
          END AS team_dollar,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side
        FROM tac_dedup tac
        JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
        LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
        LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2) AS header_contract_gci,
            COALESCE(ta.split_percentage, 0)::numeric(18,4) AS raw_split_pct,
            CASE
              WHEN COALESCE(ta.split_percentage, 0) > 0
                THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
              ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
            END AS header_row_gci,
            CASE
              WHEN COALESCE(ta.split_percentage, 0) > 0
               AND (
                 ABS(COALESCE(tac.split_percentage, 0)::numeric - COALESCE(ta.split_percentage, 0)::numeric) > 0.0001
                 OR ABS(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric -
                   CASE
                     WHEN COALESCE(ta.split_percentage, 0) > 0
                       THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
                     ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
                   END
                 ) > 0.01
               )
                THEN true
              ELSE false
            END AS use_header_values,
            CASE
              WHEN COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric > 0
               AND COALESCE(ta.split_percentage, 0) > 0
               AND (
                 ABS(COALESCE(tac.split_percentage, 0)::numeric - COALESCE(ta.split_percentage, 0)::numeric) > 0.0001
                 OR ABS(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric -
                   ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
                 ) > 0.01
               )
                THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 8)
                  / COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
              ELSE 1.0::numeric
            END AS scale_ratio
        ) _parity
        WHERE COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) >= $1::date
          AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) <= $2::date
          AND ca.id IS NOT NULL
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            NULLIF($3, '') IS NULL
            OR (
              LOWER(TRIM($3)) = 'registered'
              AND (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
            )
            OR (
              LOWER(TRIM($3)) <> 'registered'
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM($3))
            )
          )
          AND (
            NULLIF($4, '') IS NULL
            OR ${normalizedSaleTypeSql} = LOWER(TRIM($4))
          )
          AND (
            ${scopeMcParam}::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ct.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeMcParam}::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeMcParam}::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeMcParam}::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_office.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeMcParam}::text)), '[^a-z0-9]+', '', 'g')
          )
          AND (
            ${scopeTeamParam}::text IS NULL
            OR (
              REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeTeamParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeTeamParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeTeamParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeTeamParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${scopeTeamParam}::text)), '[^a-z0-9]+', '', 'g')
            )
          )
          AND (
            NULLIF(${teamFilterParam}::text, '') IS NULL
            OR (
              REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${teamFilterParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${teamFilterParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${teamFilterParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${teamFilterParam}::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${teamFilterParam}::text)), '[^a-z0-9]+', '', 'g')
            )
          )
          AND (
            NULLIF(${associateFilterParam}::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${associateFilterParam}::text)), '[^a-z0-9]+', '', 'g')
          )
      ),
      normalized AS (
        SELECT
          transaction_id,
          tx_mc_name,
          tx_mc_source_id,
          CASE
            WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_name
            ELSE office_mc_name
          END AS office_mc_name,
          CASE
            WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_source_id
            ELSE office_mc_source_id
          END AS office_mc_source_id,
          transaction_gci_before_fees,
          growth_share,
          production_royalties,
          company_dollar,
          associate_dollar,
          team_dollar,
          source_associate_id,
          associate_name,
          transaction_side
        FROM base
      ),
      mc_cardinality AS (
        SELECT
          transaction_id,
          COUNT(DISTINCT office_mc_name) FILTER (WHERE office_mc_name IS NOT NULL AND office_mc_name <> '') AS office_mc_count,
          MAX(tx_mc_name) AS tx_mc_name,
          MAX(tx_mc_source_id) AS tx_mc_source_id,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') AS has_both,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AS has_buyer,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') AS has_seller,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') AS has_other,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') AS has_referral
        FROM normalized
        GROUP BY transaction_id
      ),
      resolved AS (
        SELECT
          n.transaction_id,
          CASE
            WHEN c.office_mc_count > 1
             AND NOT (
               c.office_mc_count = 2
               AND c.has_seller = true
               AND c.has_other = true
               AND c.has_buyer = false
               AND c.has_referral = false
               AND c.has_both = false
             )
            THEN COALESCE(n.office_mc_name, c.tx_mc_name, 'Unassigned / Unknown')
            ELSE COALESCE(c.tx_mc_name, n.office_mc_name, 'Unassigned / Unknown')
          END AS market_center_name,
          CASE
            WHEN c.office_mc_count > 1
             AND NOT (
               c.office_mc_count = 2
               AND c.has_seller = true
               AND c.has_other = true
               AND c.has_buyer = false
               AND c.has_referral = false
               AND c.has_both = false
             )
            THEN COALESCE(n.office_mc_source_id, c.tx_mc_source_id, '')
            ELSE COALESCE(c.tx_mc_source_id, n.office_mc_source_id, '')
          END AS mc_source_id,
          n.transaction_gci_before_fees,
          n.growth_share,
          n.production_royalties,
          n.company_dollar,
          n.associate_dollar,
          n.team_dollar,
          n.source_associate_id,
          n.associate_name,
          n.transaction_side
        FROM normalized n
        JOIN mc_cardinality c ON c.transaction_id = n.transaction_id
      ),
      tx_flags AS (
        SELECT
          transaction_id,
          BOOL_OR(
            LOWER(TRIM(transaction_side)) LIKE '%both%'
            OR LOWER(TRIM(transaction_side)) LIKE '%buyer%'
            OR LOWER(TRIM(transaction_side)) LIKE '%seller%'
          ) AS tx_has_core
        FROM resolved
        GROUP BY transaction_id
      ),
      per_tx_mc AS (
        SELECT
          r.transaction_id,
          CASE WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.associate_name, 'Unknown Associate')
            ELSE COALESCE(r.market_center_name, 'Unassigned / Unknown')
          END AS market_center_name,
          CASE WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.source_associate_id, 'unassigned')
            ELSE COALESCE(r.mc_source_id, '')
          END AS mc_source_id,
          CASE
            WHEN f.tx_has_core
              AND NOT BOOL_OR(
                LOWER(TRIM(transaction_side)) LIKE '%both%'
                OR LOWER(TRIM(transaction_side)) LIKE '%buyer%'
                OR LOWER(TRIM(transaction_side)) LIKE '%seller%'
              ) THEN 0
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') THEN 1
            ELSE 0
          END AS units,
          SUM(transaction_gci_before_fees) AS total_gci,
          SUM(growth_share) AS growth_share,
          SUM(production_royalties) AS royalties,
          SUM(company_dollar) AS company_dollar,
          SUM(associate_dollar) AS associate_dollar,
          SUM(team_dollar) AS team_dollar
        FROM resolved r
        JOIN tx_flags f ON f.transaction_id = r.transaction_id
        GROUP BY r.transaction_id,
          CASE WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.associate_name, 'Unknown Associate')
            ELSE COALESCE(r.market_center_name, 'Unassigned / Unknown')
          END,
          CASE WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.source_associate_id, 'unassigned')
            ELSE COALESCE(r.mc_source_id, '')
          END,
          f.tx_has_core
      ),
      per_tx_global AS (
        SELECT
          transaction_id,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') THEN 1
            ELSE 0
          END AS units,
          SUM(transaction_gci_before_fees) AS total_gci,
          SUM(growth_share) AS growth_share,
          SUM(production_royalties) AS royalties,
          SUM(company_dollar) AS company_dollar,
          SUM(associate_dollar) AS associate_dollar,
          SUM(team_dollar) AS team_dollar
        FROM base
        GROUP BY transaction_id
      ),
      by_mc AS (
        SELECT
          market_center_name,
          mc_source_id,
          COUNT(*)::int AS contracts,
          COALESCE(SUM(units), 0)::int AS units,
          ROUND(COALESCE(SUM(total_gci), 0)::numeric, 2) AS total_gci,
          ROUND(COALESCE(SUM(growth_share), 0)::numeric, 2) AS growth_share,
          ROUND(COALESCE(SUM(royalties), 0)::numeric, 2) AS royalties,
          ROUND(COALESCE(SUM(company_dollar), 0)::numeric, 2) AS company_dollar,
          ROUND(COALESCE(SUM(associate_dollar), 0)::numeric, 2) AS associate_dollar,
          ROUND(COALESCE(SUM(team_dollar), 0)::numeric, 2) AS team_dollar
        FROM per_tx_mc
        WHERE 1 = 1
          ${mcFilterClause}
        GROUP BY market_center_name, mc_source_id
      ),
      overall AS (
        SELECT
          COUNT(*)::int AS contracts,
          COALESCE(SUM(units), 0)::int AS units,
          ROUND(COALESCE(SUM(total_gci), 0)::numeric, 2) AS total_gci,
          ROUND(COALESCE(SUM(growth_share), 0)::numeric, 2) AS growth_share,
          ROUND(COALESCE(SUM(royalties), 0)::numeric, 2) AS royalties,
          ROUND(COALESCE(SUM(company_dollar), 0)::numeric, 2) AS company_dollar,
          ROUND(COALESCE(SUM(associate_dollar), 0)::numeric, 2) AS associate_dollar,
          ROUND(COALESCE(SUM(team_dollar), 0)::numeric, 2) AS team_dollar
        FROM per_tx_global
      )
      SELECT
        b.market_center_name,
        b.mc_source_id,
        b.contracts,
        b.units,
        b.total_gci,
        b.growth_share,
        b.royalties,
        b.company_dollar,
        CASE WHEN b.total_gci > 0
          THEN ROUND((b.company_dollar / b.total_gci * 100)::numeric, 2)
          ELSE 0::numeric
        END AS cos_to_gci_pct,
        b.associate_dollar,
        b.team_dollar,
        o.contracts AS overall_contracts,
        o.units AS overall_units,
        o.total_gci AS overall_total_gci,
        o.growth_share AS overall_growth_share,
        o.royalties AS overall_royalties,
        o.company_dollar AS overall_company_dollar,
        o.associate_dollar AS overall_associate_dollar,
        o.team_dollar AS overall_team_dollar
      FROM by_mc b
      CROSS JOIN overall o
      ORDER BY b.total_gci DESC
    `;
        const result = await pool.query(sql, params);
        const rows = result.rows.map((row) => {
            const contracts = Number(row.contracts);
            const units = Number(row.units);
            const total_gci = Number(row.total_gci);
            const growth_share = Number(row.growth_share);
            const royalties = Number(row.royalties);
            const company_dollar = Number(row.company_dollar);
            const associate_dollar = Number(row.associate_dollar);
            const team_dollar = Number(row.team_dollar);
            const cos_to_gci_pct = Number(row.cos_to_gci_pct);
            return {
                market_center_name: row.market_center_name,
                mc_source_id: row.mc_source_id,
                contracts,
                units,
                total_gci,
                growth_share,
                royalties,
                company_dollar,
                cos_to_gci_pct,
                associate_dollar,
                team_dollar,
            };
        });
        const first = result.rows[0];
        const totalContracts = first ? Number(first.overall_contracts) : 0;
        const totalUnits = first ? Number(first.overall_units) : 0;
        const totalGciRounded = first ? Number(first.overall_total_gci) : 0;
        const totalGrowthShare = first ? Number(first.overall_growth_share) : 0;
        const totalRoyalties = first ? Number(first.overall_royalties) : 0;
        const totalCompanyDollar = first ? Number(first.overall_company_dollar) : 0;
        const totalAssociateDollar = first ? Number(first.overall_associate_dollar) : 0;
        const totalTeamDollar = first ? Number(first.overall_team_dollar) : 0;
        const payload = {
            rows,
            totals: {
                contracts: totalContracts,
                units: totalUnits,
                total_gci: totalGciRounded,
                growth_share: Math.round(totalGrowthShare * 100) / 100,
                royalties: Math.round(totalRoyalties * 100) / 100,
                company_dollar: Math.round(totalCompanyDollar * 100) / 100,
                cos_to_gci_pct: totalGciRounded > 0
                    ? Math.round((totalCompanyDollar / totalGciRounded) * 100 * 100) / 100
                    : 0,
                associate_dollar: Math.round(totalAssociateDollar * 100) / 100,
                team_dollar: Math.round(totalTeamDollar * 100) / 100,
            },
            kpi: {
                contracts: totalContracts,
                units: totalUnits,
                total_gci: totalGciRounded,
            },
        };
        if (debugMode) {
            payload.debug = {
                active_context: String(req.headers['x-active-context'] ?? ''),
                scope: perms.scope,
                scope_mc_id: scopeMcId,
                scoped_team_source_id: scopedTeamSourceId,
                requested_team_id: teamId,
                effective_team_id: effectiveTeamId,
                resolved_scope_associate_id: resolvedScopeAssociateId,
                requested_associate_id: associateId,
                effective_associate_id: effectiveAssociateId,
                use_associate_grouping: useAssociateGrouping,
                returned_rows: rows.length,
            };
        }
        return res.json(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/month-end/extended-filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const optionsResult = await pool.query(`
      WITH ${transactionAgentCalculationDedupCte}
      SELECT DISTINCT
        NULLIF(TRIM(ct.transaction_status), '') AS transaction_status,
        COALESCE(NULLIF(TRIM(ct.sale_type), ''), NULLIF(TRIM(ct.transaction_type), '')) AS sale_type,
        COALESCE(NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS source_market_center_id,
        COALESCE(NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(ca.source_team_id), ''), t.id::text, ca.team_id::text, NULLIF(TRIM(t.name), ''), 'No Team') AS source_team_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name
      FROM tac_dedup tac
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
      LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
      LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
      WHERE ${salesOnlyTransactionExclusionSql}
        AND (
          $1::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($2::bigint IS NULL OR tac.associate_id = $2::bigint)
        AND (
          $3::text IS NULL
          OR (
            REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
          )
        )
      ORDER BY market_center_name, team_name, associate_name
      `, [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]);
        const statuses = Array.from(new Set(optionsResult.rows.map((row) => (row.transaction_status ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const saleTypes = Array.from(new Set(optionsResult.rows.map((row) => (row.sale_type ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const marketCentersMap = new Map();
        const teamsMap = new Map();
        const associatesMap = new Map();
        for (const row of optionsResult.rows) {
            const mcId = (row.source_market_center_id ?? '').trim();
            if (mcId && !marketCentersMap.has(mcId)) {
                marketCentersMap.set(mcId, row.market_center_name);
            }
            const teamId = row.source_team_id || row.team_name || 'No Team';
            if (!teamsMap.has(teamId)) {
                teamsMap.set(teamId, {
                    id: teamId,
                    name: row.team_name,
                    market_center_id: row.source_market_center_id,
                    market_center_name: row.market_center_name,
                });
            }
            const associateId = row.source_associate_id || row.associate_name;
            if (!associatesMap.has(associateId)) {
                associatesMap.set(associateId, {
                    id: associateId,
                    name: row.associate_name,
                    team_id: teamId,
                    market_center_id: row.source_market_center_id,
                    market_center_name: row.market_center_name,
                });
            }
        }
        const debugMode = String(req.query.debug || '').trim() === '1';
        const payload = {
            statuses,
            sale_types: saleTypes,
            market_centers: Array.from(marketCentersMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
            teams: Array.from(teamsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
            associates: Array.from(associatesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        };
        if (debugMode) {
            payload.debug = {
                active_context: String(req.headers['x-active-context'] ?? ''),
                scope: perms.scope,
                scope_mc_id: scopeMcId,
                scoped_team_source_id: scopedTeamSourceId,
                resolved_scope_associate_id: resolvedScopeAssociateId,
                market_centers_count: payload.market_centers instanceof Array ? payload.market_centers.length : 0,
                teams_count: payload.teams instanceof Array ? payload.teams.length : 0,
                associates_count: payload.associates instanceof Array ? payload.associates.length : 0,
            };
        }
        return res.json(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/month-end/transaction-summary', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
        const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
        const transactionStatus = String(req.query.transaction_status || '');
        const saleType = String(req.query.sale_type || '');
        const teamId = String(req.query.team_id || '').trim();
        const associateId = String(req.query.associate_id || '').trim();
        const dateBasis = normalizeMonthEndDateBasis(req.query.date_basis);
        const marketCenterIds = parseCsvParam(req.query.market_center_ids);
        const effectiveMarketCenterIds = perms.scope === 'GLOBAL' ? marketCenterIds : [];
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const effectiveTeamId = teamId || scopedTeamSourceId || '';
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const effectiveAssociateId = associateId || (resolvedScopeAssociateId ? String(resolvedScopeAssociateId) : '');
        const useAssociateGrouping = !!(effectiveTeamId || effectiveAssociateId);
        const dateFilterExpr = dateBasis === 'transaction' ? 'ct.transaction_date::date' : 'ct.status_change_date::date';
        const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;
        const result = await pool.query(`
      WITH ${transactionAgentCalculationDedupCte},
      base AS (
        SELECT
          tac.transaction_id,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS mc_source_id,
          COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(t.name), ''), 'No Team') AS source_team_id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
          COALESCE(ct.sales_price, 0)::numeric(18,2) AS sales_price,
          COALESCE(ct.list_price, 0)::numeric(18,2) AS list_price,
          CASE
            WHEN _parity.use_header_values THEN _parity.header_contract_gci
            WHEN COALESCE(tac.split_percentage, 0) > 0
              THEN ROUND((COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric * 100) / COALESCE(tac.split_percentage, 0)::numeric, 2)
            ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
          END::numeric(18,2) AS contract_gci,
          CASE
            WHEN _parity.use_header_values THEN _parity.header_row_gci
            ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2)
          END AS gci,
          CASE
            WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.production_royalties, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.production_royalties, 0)::numeric(18,2)
          END AS royalties,
          CASE
            WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.growth_share, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.growth_share, 0)::numeric(18,2)
          END AS growth_share,
          CASE
            WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.associate_dollar, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.associate_dollar, 0)::numeric(18,2)
          END AS associate_dollar,
          COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
          CASE
            WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.team_dollar, 0)::numeric * _parity.scale_ratio, 2)
            ELSE COALESCE(tac.team_dollar, 0)::numeric(18,2)
          END AS team_dollar,
          CASE
            WHEN _parity.use_header_values THEN _parity.raw_split_pct
            ELSE COALESCE(tac.split_percentage, 0)::numeric(18,4)
          END AS split_percentage,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side
        FROM tac_dedup tac
        JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
        LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
        LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2) AS header_contract_gci,
            COALESCE(ta.split_percentage, 0)::numeric(18,4) AS raw_split_pct,
            CASE
              WHEN COALESCE(ta.split_percentage, 0) > 0
                THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
              ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
            END AS header_row_gci,
            CASE
              WHEN COALESCE(ta.split_percentage, 0) > 0
               AND (
                 ABS(COALESCE(tac.split_percentage, 0)::numeric - COALESCE(ta.split_percentage, 0)::numeric) > 0.0001
                 OR ABS(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric -
                   CASE
                     WHEN COALESCE(ta.split_percentage, 0) > 0
                       THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
                     ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
                   END
                 ) > 0.01
               )
                THEN true
              ELSE false
            END AS use_header_values,
            CASE
              WHEN COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric > 0
               AND COALESCE(ta.split_percentage, 0) > 0
               AND (
                 ABS(COALESCE(tac.split_percentage, 0)::numeric - COALESCE(ta.split_percentage, 0)::numeric) > 0.0001
                 OR ABS(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric -
                   ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
                 ) > 0.01
               )
                THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 8)
                  / COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
              ELSE 1.0::numeric
            END AS scale_ratio
        ) _parity
        WHERE COALESCE(${dateFilterExpr}, tac.effective_reporting_date::date) >= $1::date
          AND COALESCE(${dateFilterExpr}, tac.effective_reporting_date::date) <= $2::date
          AND ca.id IS NOT NULL
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            NULLIF($3::text, '') IS NULL
            OR (
              LOWER(TRIM($3::text)) = 'registered'
              AND (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
            )
            OR (
              LOWER(TRIM($3::text)) <> 'registered'
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM($3::text))
            )
          )
          AND (
            NULLIF($4::text, '') IS NULL
            OR ${normalizedSaleTypeSql} = LOWER(TRIM($4::text))
          )
          AND (
            $5::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ct.source_market_center_id, mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($6::bigint IS NULL OR tac.associate_id = $6::bigint)
          AND (
            NULLIF($8::text, '') IS NULL
            OR (
              REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
            )
          )
          AND (
            NULLIF($9::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($9::text)), '[^a-z0-9]+', '', 'g')
          )
      ),
      per_tx AS (
        SELECT
          transaction_id,
          CASE WHEN $10::boolean
            THEN COALESCE(associate_name, 'Unknown Associate')
            ELSE COALESCE(market_center_name, 'Unassigned / Unknown')
          END AS market_center_name,
          CASE WHEN $10::boolean
            THEN COALESCE(source_associate_id, 'unassigned')
            ELSE COALESCE(mc_source_id, '')
          END AS mc_source_id,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') THEN 1
            ELSE 0
          END::int AS units,
          MAX(sales_price)::numeric(18,2) AS sales_price,
          MAX(sales_price)::numeric(18,2) AS mc_sales_volume,
          MAX(list_price)::numeric(18,2) AS list_price,
          SUM(contract_gci)::numeric(18,2) AS contract_gci,
          SUM(gci)::numeric(18,2) AS gci,
          SUM(royalties)::numeric(18,2) AS royalties,
          SUM(growth_share)::numeric(18,2) AS growth_share,
          SUM(associate_dollar)::numeric(18,2) AS associate_dollar,
          SUM(company_dollar)::numeric(18,2) AS company_dollar,
          SUM(team_dollar)::numeric(18,2) AS team_dollar
        FROM base
        GROUP BY
          transaction_id,
          CASE WHEN $10::boolean
            THEN COALESCE(associate_name, 'Unknown Associate')
            ELSE COALESCE(market_center_name, 'Unassigned / Unknown')
          END,
          CASE WHEN $10::boolean
            THEN COALESCE(source_associate_id, 'unassigned')
            ELSE COALESCE(mc_source_id, '')
          END
      ),
      by_mc AS (
        SELECT
          market_center_name,
          mc_source_id,
          COUNT(*)::int AS contracts,
          COALESCE(SUM(units), 0)::int AS units,
          ROUND(COALESCE(SUM(sales_price), 0)::numeric, 2) AS sales_price,
          ROUND(COALESCE(SUM(mc_sales_volume), 0)::numeric, 2) AS mc_sales_volume,
          ROUND(COALESCE(SUM(list_price), 0)::numeric, 2) AS list_price,
          ROUND(COALESCE(SUM(contract_gci), 0)::numeric, 2) AS contract_gci,
          ROUND(COALESCE(SUM(gci), 0)::numeric, 2) AS gci,
          ROUND(COALESCE(SUM(royalties), 0)::numeric, 2) AS royalties,
          ROUND(COALESCE(SUM(growth_share), 0)::numeric, 2) AS growth_share,
          ROUND(COALESCE(SUM(associate_dollar), 0)::numeric, 2) AS associate_dollar,
          ROUND(COALESCE(SUM(company_dollar), 0)::numeric, 2) AS company_dollar,
          ROUND(COALESCE(SUM(team_dollar), 0)::numeric, 2) AS team_dollar
        FROM per_tx
        WHERE CARDINALITY($7::text[]) = 0 OR EXISTS (
          SELECT 1
          FROM UNNEST($7::text[]) AS selected(mc_id)
          WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_source_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(selected.mc_id)), '[^a-z0-9]+', '', 'g')
        )
        GROUP BY market_center_name, mc_source_id
      )
      SELECT
        market_center_name,
        mc_source_id,
        contracts::text,
        units::text,
        sales_price::text,
        mc_sales_volume::text,
        list_price::text,
        contract_gci::text,
        gci::text,
        royalties::text,
        growth_share::text,
        associate_dollar::text,
        company_dollar::text,
        team_dollar::text
      FROM by_mc
      ORDER BY gci DESC, market_center_name ASC
      `, [
            dateFrom,
            dateTo,
            transactionStatus,
            saleType,
            scopeMcId,
            resolvedScopeAssociateId,
            effectiveMarketCenterIds,
            effectiveTeamId,
            effectiveAssociateId,
            useAssociateGrouping,
        ]);
        const rows = result.rows.map((row) => ({
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
            contracts: Number(row.contracts),
            units: Number(row.units),
            sales_price: Number(row.sales_price),
            mc_sales_volume: Number(row.mc_sales_volume),
            list_price: Number(row.list_price),
            contract_gci: Number(row.contract_gci),
            gci: Number(row.gci),
            royalties: Number(row.royalties),
            growth_share: Number(row.growth_share),
            associate_dollar: Number(row.associate_dollar),
            company_dollar: Number(row.company_dollar),
            team_dollar: Number(row.team_dollar),
        }));
        const totals = rows.reduce((acc, row) => ({
            ...acc,
            contracts: acc.contracts + row.contracts,
            units: acc.units + row.units,
            sales_price: Math.round((acc.sales_price + row.sales_price) * 100) / 100,
            mc_sales_volume: Math.round((acc.mc_sales_volume + row.mc_sales_volume) * 100) / 100,
            list_price: Math.round((acc.list_price + row.list_price) * 100) / 100,
            contract_gci: Math.round((acc.contract_gci + row.contract_gci) * 100) / 100,
            gci: Math.round((acc.gci + row.gci) * 100) / 100,
            royalties: Math.round((acc.royalties + row.royalties) * 100) / 100,
            growth_share: Math.round((acc.growth_share + row.growth_share) * 100) / 100,
            associate_dollar: Math.round((acc.associate_dollar + row.associate_dollar) * 100) / 100,
            company_dollar: Math.round((acc.company_dollar + row.company_dollar) * 100) / 100,
            team_dollar: Math.round((acc.team_dollar + row.team_dollar) * 100) / 100,
        }), {
            market_center_name: 'TOTAL',
            mc_source_id: '',
            contracts: 0,
            units: 0,
            sales_price: 0,
            mc_sales_volume: 0,
            list_price: 0,
            contract_gci: 0,
            gci: 0,
            royalties: 0,
            growth_share: 0,
            associate_dollar: 0,
            company_dollar: 0,
            team_dollar: 0,
        });
        return res.json({ rows, totals, date_basis: dateBasis });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/month-end/transactions', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
        const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
        const transactionStatus = String(req.query.transaction_status || '');
        const saleType = String(req.query.sale_type || '');
        const teamId = String(req.query.team_id || '').trim();
        const associateId = String(req.query.associate_id || '').trim();
        const dateBasis = normalizeMonthEndDateBasis(req.query.date_basis);
        const marketCenterIds = parseCsvParam(req.query.market_center_ids);
        const effectiveMarketCenterIds = perms.scope === 'GLOBAL' ? marketCenterIds : [];
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const effectiveTeamId = teamId || scopedTeamSourceId || '';
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const effectiveAssociateId = associateId || (resolvedScopeAssociateId ? String(resolvedScopeAssociateId) : '');
        const dateFilterExpr = dateBasis === 'transaction' ? 'ct.transaction_date::date' : 'ct.status_change_date::date';
        const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;
        const result = await pool.query(`
      WITH ${transactionAgentCalculationDedupCte},
      latest_transaction_bonds AS (
        SELECT DISTINCT ON (source_transaction_id)
          source_transaction_id,
          bond_originator,
          bond_attorney,
          transfer_attorney
        FROM staging.transaction_bonds
        ORDER BY source_transaction_id, bond_due_date DESC NULLS LAST
      )
      SELECT
        tac.transaction_id::text,
        COALESCE(NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
        COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(ca.source_team_id), ''), t.id::text, ca.team_id::text, NULLIF(TRIM(t.name), ''), 'No Team') AS source_team_id,
        COALESCE(NULLIF(TRIM(ct.transaction_number), ''), '') AS transaction_number,
        COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS unit_side,
        ct.transaction_date::date::text AS transaction_date,
        ct.list_date::date::text AS list_date,
        ct.status_change_date::date::text AS status_change_date,
        COALESCE(NULLIF(TRIM(ct.listing_number), ''), NULLIF(TRIM(cl.listing_number), ''), '') AS kwl_number,
        COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), '') AS transaction_type,
        COALESCE(NULLIF(TRIM(ct.sale_type), ''), NULLIF(TRIM(ct.transaction_type), ''), '') AS sale_type,
        COALESCE(NULLIF(TRIM(ct.transaction_status), ''), '') AS transaction_status,
        COALESCE(NULLIF(TRIM(ct.suburb), ''), NULLIF(TRIM(cl.suburb), ''), '') AS suburb,
        COALESCE(NULLIF(TRIM(ct.city), ''), NULLIF(TRIM(cl.city), ''), '') AS city,
        COALESCE(NULLIF(TRIM(ct.buyer), ''), '') AS buyer,
        COALESCE(NULLIF(TRIM(ct.seller), ''), '') AS seller,
        COALESCE(ct.list_price, 0)::numeric(18,2) AS list_price,
        COALESCE(ct.sales_price, 0)::numeric(18,2) AS sales_price,
        CASE WHEN _parity.use_header_values THEN _parity.raw_split_pct ELSE COALESCE(tac.split_percentage, 0)::numeric(18,4) END AS th_split_pct,
        ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * ((CASE WHEN _parity.use_header_values THEN _parity.raw_split_pct ELSE COALESCE(tac.split_percentage, 0)::numeric(18,4) END) / 100), 2)::numeric(18,2) AS agent_sales_volume,
        CASE
          WHEN COALESCE(ct.sales_price, 0)::numeric(18,2) > 0
            THEN ROUND(((CASE WHEN _parity.use_header_values THEN _parity.header_row_gci ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) END)
              / NULLIF(ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * ((CASE WHEN _parity.use_header_values THEN _parity.raw_split_pct ELSE COALESCE(tac.split_percentage, 0)::numeric(18,4) END) / 100), 2)::numeric, 0)) * 100, 4)
          ELSE COALESCE(tac.average_commission_pct, 0)::numeric(18,4)
        END AS comm_pct,
        CASE
          WHEN _parity.use_header_values THEN _parity.header_contract_gci
          WHEN COALESCE(tac.split_percentage, 0) > 0
            THEN ROUND((COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric * 100) / COALESCE(tac.split_percentage, 0)::numeric, 2)
          ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
        END::numeric(18,2) AS contract_gci,
        CASE WHEN _parity.use_header_values THEN _parity.header_row_gci ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) END AS total_gci,
        CASE WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.production_royalties, 0)::numeric * _parity.scale_ratio, 2) ELSE COALESCE(tac.production_royalties, 0)::numeric(18,2) END AS royalties,
        CASE WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.growth_share, 0)::numeric * _parity.scale_ratio, 2) ELSE COALESCE(tac.growth_share, 0)::numeric(18,2) END AS growth_share,
        CASE WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.associate_dollar, 0)::numeric * _parity.scale_ratio, 2) ELSE COALESCE(tac.associate_dollar, 0)::numeric(18,2) END AS associate_dollar,
        COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
        CASE WHEN _parity.use_header_values THEN ROUND(COALESCE(tac.team_dollar, 0)::numeric * _parity.scale_ratio, 2) ELSE COALESCE(tac.team_dollar, 0)::numeric(18,2) END AS team_dollar,
        COALESCE(tac.cap_remaining, 0)::numeric(18,2) AS cap_remaining,
        COALESCE(NULLIF(TRIM(tac.office_name), ''), '') AS listing_office,
        COALESCE(NULLIF(TRIM(tb.bond_originator), ''), '') AS bond_originator,
        COALESCE(NULLIF(TRIM(tb.bond_attorney), ''), '') AS bond_attorney,
        ''::text AS bond_attorney_email,
        ''::text AS bond_attorney_phone,
        COALESCE(NULLIF(TRIM(tb.transfer_attorney), ''), '') AS transfer_attorney,
        ''::text AS transfer_attorney_email,
        ''::text AS transfer_attorney_phone
      FROM tac_dedup tac
      JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.core_listings cl ON cl.source_listing_id = ct.source_listing_id
      LEFT JOIN latest_transaction_bonds tb ON tb.source_transaction_id = ct.source_transaction_id
      LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
      LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
      LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2) AS header_contract_gci,
          COALESCE(ta.split_percentage, 0)::numeric(18,4) AS raw_split_pct,
          CASE
            WHEN COALESCE(ta.split_percentage, 0) > 0
              THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
            ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
          END AS header_row_gci,
          CASE
            WHEN COALESCE(ta.split_percentage, 0) > 0
             AND (
               ABS(COALESCE(tac.split_percentage, 0)::numeric - COALESCE(ta.split_percentage, 0)::numeric) > 0.0001
               OR ABS(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric -
                 CASE
                   WHEN COALESCE(ta.split_percentage, 0) > 0
                     THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
                   ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
                 END
               ) > 0.01
             )
              THEN true
            ELSE false
          END AS use_header_values,
          CASE
            WHEN COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric > 0
             AND COALESCE(ta.split_percentage, 0) > 0
             AND (
               ABS(COALESCE(tac.split_percentage, 0)::numeric - COALESCE(ta.split_percentage, 0)::numeric) > 0.0001
               OR ABS(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric -
                 ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
               ) > 0.01
             )
              THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 8)
                / COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
            ELSE 1.0::numeric
          END AS scale_ratio
      ) _parity
      WHERE COALESCE(${dateFilterExpr}, tac.effective_reporting_date::date) >= $1::date
        AND COALESCE(${dateFilterExpr}, tac.effective_reporting_date::date) <= $2::date
        AND ca.id IS NOT NULL
        AND ${salesOnlyTransactionExclusionSql}
        AND (
          NULLIF($3::text, '') IS NULL
          OR (
            LOWER(TRIM($3::text)) = 'registered'
            AND (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
          )
          OR (
            LOWER(TRIM($3::text)) <> 'registered'
            AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM($3::text))
          )
        )
        AND (
          NULLIF($4::text, '') IS NULL
          OR ${normalizedSaleTypeSql} = LOWER(TRIM($4::text))
        )
        AND (
          $5::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($6::bigint IS NULL OR tac.associate_id = $6::bigint)
        AND (
          CARDINALITY($7::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($7::text[]) AS selected(mc_id)
            WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(ct.source_market_center_id, mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(selected.mc_id)), '[^a-z0-9]+', '', 'g')
          )
        )
        AND (
          NULLIF($8::text, '') IS NULL
          OR (
            REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
          )
        )
        AND (
          NULLIF($9::text, '') IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($9::text)), '[^a-z0-9]+', '', 'g')
        )
      ORDER BY COALESCE(${dateFilterExpr}, tac.effective_reporting_date::date) DESC NULLS LAST, market_center_name ASC, associate_name ASC
      `, [
            dateFrom,
            dateTo,
            transactionStatus,
            saleType,
            scopeMcId,
            resolvedScopeAssociateId,
            effectiveMarketCenterIds,
            effectiveTeamId,
            effectiveAssociateId,
        ]);
        const rows = result.rows.map((row) => ({
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
            associate_name: row.associate_name,
            source_associate_id: row.source_associate_id,
            team_name: row.team_name,
            source_team_id: row.source_team_id,
            transaction_number: row.transaction_number,
            transaction_date: row.transaction_date,
            list_date: row.list_date,
            status_change_date: row.status_change_date,
            kwl_number: row.kwl_number,
            transaction_type: row.transaction_type,
            sale_type: row.sale_type,
            transaction_status: row.transaction_status,
            suburb: row.suburb,
            city: row.city,
            buyer: row.buyer,
            seller: row.seller,
            list_price: Number(row.list_price),
            sales_price: Number(row.sales_price),
            th_split_pct: Number(row.th_split_pct),
            agent_sales_volume: Number(row.agent_sales_volume),
            comm_pct: Number(row.comm_pct),
            contract_gci: Number(row.contract_gci),
            total_gci: Number(row.total_gci),
            royalties: Number(row.royalties),
            growth_share: Number(row.growth_share),
            associate_dollar: Number(row.associate_dollar),
            company_dollar: Number(row.company_dollar),
            team_dollar: Number(row.team_dollar),
            cap_remaining: Number(row.cap_remaining),
            listing_office: row.listing_office,
            bond_originator: row.bond_originator,
            bond_attorney: row.bond_attorney,
            bond_attorney_email: row.bond_attorney_email,
            bond_attorney_phone: row.bond_attorney_phone,
            transfer_attorney: row.transfer_attorney,
            transfer_attorney_email: row.transfer_attorney_email,
            transfer_attorney_phone: row.transfer_attorney_phone,
        }));
        const txMcMap = new Map();
        for (const row of result.rows) {
            const key = `${row.mc_source_id}::${row.transaction_id}`;
            const existing = txMcMap.get(key) ?? { hasBoth: false, hasBuyer: false, hasSeller: false, hasOther: false, hasReferral: false, listPrice: 0, salesPrice: 0 };
            const side = String(row.unit_side ?? '').toLowerCase();
            existing.hasBoth = existing.hasBoth || side.includes('both');
            existing.hasBuyer = existing.hasBuyer || side.includes('buyer');
            existing.hasSeller = existing.hasSeller || side.includes('seller');
            existing.hasOther = existing.hasOther || side.includes('other');
            existing.hasReferral = existing.hasReferral || side.includes('referral');
            existing.listPrice = Math.max(existing.listPrice, Number(row.list_price));
            existing.salesPrice = Math.max(existing.salesPrice, Number(row.sales_price));
            txMcMap.set(key, existing);
        }
        let totalUnits = 0;
        let totalListPrice = 0;
        let totalSalesPrice = 0;
        for (const item of txMcMap.values()) {
            if (item.hasBoth) {
                totalUnits += 2;
            }
            else if (item.hasBuyer && item.hasSeller) {
                totalUnits += 2;
            }
            else if (item.hasBuyer || item.hasSeller) {
                totalUnits += 1;
            }
            else if (item.hasOther || item.hasReferral) {
                totalUnits += 1;
            }
            totalListPrice += item.listPrice;
            totalSalesPrice += item.salesPrice;
        }
        const totals = {
            contracts: txMcMap.size,
            units: totalUnits,
            list_price: Math.round(totalListPrice * 100) / 100,
            sales_price: Math.round(totalSalesPrice * 100) / 100,
            agent_sales_volume: Math.round(rows.reduce((sum, row) => sum + row.agent_sales_volume, 0) * 100) / 100,
            contract_gci: Math.round(rows.reduce((sum, row) => sum + row.contract_gci, 0) * 100) / 100,
            total_gci: Math.round(rows.reduce((sum, row) => sum + row.total_gci, 0) * 100) / 100,
            royalties: Math.round(rows.reduce((sum, row) => sum + row.royalties, 0) * 100) / 100,
            growth_share: Math.round(rows.reduce((sum, row) => sum + row.growth_share, 0) * 100) / 100,
            associate_dollar: Math.round(rows.reduce((sum, row) => sum + row.associate_dollar, 0) * 100) / 100,
            company_dollar: Math.round(rows.reduce((sum, row) => sum + row.company_dollar, 0) * 100) / 100,
            team_dollar: Math.round(rows.reduce((sum, row) => sum + row.team_dollar, 0) * 100) / 100,
            cap_remaining: Math.round(rows.reduce((sum, row) => sum + row.cap_remaining, 0) * 100) / 100,
        };
        return res.json({ rows, totals, date_basis: dateBasis });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/top-down-agent/filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const associatesResult = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(NULLIF(TRIM(mc.name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(t.source_team_id), ''), '') AS source_team_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name
      FROM migration.core_associates ca
      LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        AND (
          $1::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($2::bigint IS NULL OR ca.id = $2::bigint)
        AND (
          $3::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
        )
      ORDER BY market_center_name, associate_name
      `, [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]);
        const productionOptionRows = await pool.query(`
      WITH ${transactionAgentCalculationDedupCte}
      SELECT DISTINCT
        NULLIF(TRIM(ct.transaction_status), '') AS transaction_status,
        COALESCE(NULLIF(TRIM(ct.sale_type), ''), NULLIF(TRIM(ct.transaction_type), '')) AS sale_type
      FROM tac_dedup tac
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
      LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
      LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
      LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
      WHERE ${salesOnlyTransactionExclusionSql}
        AND (
          $1::text IS NULL
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc_office.source_market_center_id, mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, ''))),
            '[^a-z0-9]+', '', 'g'
          ) = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($2::bigint IS NULL OR tac.associate_id = $2::bigint)
        AND (
          $3::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
        )
      `, [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]);
        const listingOptionRows = await pool.query(`
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(cl.status_name), ''), NULLIF(TRIM(cl.listing_status_tag), '')) AS listing_status,
        NULLIF(TRIM(cl.sale_or_rent), '') AS sale_or_rent,
        NULLIF(TRIM(cl.mandate_type), '') AS mandate_type
      FROM migration.core_listings cl
      LEFT JOIN migration.core_market_centers mc ON mc.id = cl.market_center_id
      WHERE cl.listing_number LIKE 'KWL%'
        AND (
          $1::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($2::bigint IS NULL OR EXISTS (
          SELECT 1
          FROM migration.listing_agents la
          WHERE la.listing_id = cl.id
            AND la.associate_id = $2::bigint
        ))
        AND (
          $3::text IS NULL
          OR EXISTS (
            SELECT 1
            FROM migration.listing_agents la_team
            INNER JOIN migration.core_associates ca_team ON ca_team.id = la_team.associate_id
            LEFT JOIN migration.core_teams t_team ON t_team.id = ca_team.team_id
            WHERE la_team.listing_id = cl.id
              AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t_team.source_team_id, ''), NULLIF(ca_team.source_team_id, ''), t_team.id::text, ca_team.team_id::text, t_team.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
          )
        )
      `, [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]);
        const marketCenterMap = new Map();
        const associates = [];
        const teamsMap = new Map();
        for (const row of associatesResult.rows) {
            if (row.mc_source_id && !marketCenterMap.has(row.mc_source_id)) {
                marketCenterMap.set(row.mc_source_id, row.market_center_name);
            }
            associates.push({
                id: row.source_associate_id,
                name: row.associate_name,
                market_center_id: row.mc_source_id,
                market_center_name: row.market_center_name,
                team_id: row.source_team_id || row.team_name,
            });
            const teamId = row.source_team_id || row.team_name;
            if (!teamsMap.has(teamId)) {
                teamsMap.set(teamId, {
                    id: teamId,
                    name: row.team_name,
                    market_center_id: row.mc_source_id,
                    market_center_name: row.market_center_name,
                });
            }
        }
        const transactionStatuses = Array.from(new Set(productionOptionRows.rows
            .map((row) => (row.transaction_status ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const saleTypes = Array.from(new Set(productionOptionRows.rows
            .map((row) => (row.sale_type ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const listingStatuses = Array.from(new Set(listingOptionRows.rows
            .map((row) => (row.listing_status ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const saleOrRentOptions = Array.from(new Set(listingOptionRows.rows
            .map((row) => (row.sale_or_rent ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const mandateTypes = Array.from(new Set(listingOptionRows.rows
            .map((row) => (row.mandate_type ?? '').trim())
            .filter(Boolean))).sort((a, b) => a.localeCompare(b));
        return res.json({
            market_centers: Array.from(marketCenterMap.entries())
                .map(([id, name]) => ({ id, name }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            associates,
            teams: Array.from(teamsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
            transaction_statuses: transactionStatuses,
            sale_types: saleTypes,
            listing_statuses: listingStatuses,
            sale_or_rent_options: saleOrRentOptions,
            mandate_types: mandateTypes,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/top-down-agent', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
        const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
        const listDateFrom = String(req.query.list_date_from || getFirstOfMonthInAppTimeZone());
        const listDateTo = String(req.query.list_date_to || getTodayInAppTimeZone());
        const transactionStatus = req.query.transaction_status === undefined
            ? 'Registered'
            : String(req.query.transaction_status ?? '');
        const saleType = req.query.sale_type === undefined
            ? 'For Sale'
            : String(req.query.sale_type ?? '');
        const listingStatus = String(req.query.listing_status || '');
        const saleOrRent = String(req.query.sale_or_rent || '');
        const mandateType = String(req.query.mandate_type || '');
        const associateId = String(req.query.associate_id || '').trim();
        const teamId = String(req.query.team_id || '').trim();
        const associateQuery = String(req.query.associate_query || '').trim();
        const teamQuery = String(req.query.team_query || '').trim();
        const marketCenterIds = parseCsvParam(req.query.market_center_ids);
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const effectiveTeamId = teamId || scopedTeamSourceId || '';
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const productionRowsResult = await pool.query(`
      WITH ${transactionAgentCalculationDedupCte},
      filtered_tx AS (
        SELECT
          tac.associate_id,
          tac.transaction_id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
          COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
          COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), '') AS mc_source_id,
          COALESCE(NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side,
          COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
          COALESCE(tac.growth_share, 0)::numeric(18,2) AS growth_share,
          COALESCE(tac.production_royalties, 0)::numeric(18,2) AS royalties,
          COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
          COALESCE(tac.associate_dollar, 0)::numeric(18,2) AS associate_dollar,
          COALESCE(tac.team_dollar, 0)::numeric(18,2) AS team_dollar
        FROM tac_dedup tac
        LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
        LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
        LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
        WHERE COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) >= $1::date
          AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) <= $2::date
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            NULLIF($3::text, '') IS NULL
            OR (
              LOWER(TRIM($3::text)) = 'registered'
              AND (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
            )
            OR (
              LOWER(TRIM($3::text)) <> 'registered'
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM($3::text))
            )
          )
          AND (
            NULLIF($4::text, '') IS NULL
            OR LOWER(TRIM(COALESCE(NULLIF(ct.sale_type, ''), NULLIF(ct.transaction_type, ''), ''))) = LOWER(TRIM($4::text))
          )
          AND (
            $5::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_office.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($6::bigint IS NULL OR tac.associate_id = $6::bigint)
          AND (
            CARDINALITY($7::text[]) = 0
            OR NULLIF(TRIM(mc_office.source_market_center_id), '') = ANY($7::text[])
            OR NULLIF(TRIM(mc_tx_primary.source_market_center_id), '') = ANY($7::text[])
            OR NULLIF(TRIM(mc_tx.source_market_center_id), '') = ANY($7::text[])
          )
          AND (
            NULLIF($8::text, '') IS NULL
            OR COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') ILIKE '%' || $8::text || '%'
          )
          AND (
            NULLIF($9::text, '') IS NULL
            OR COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') ILIKE '%' || $9::text || '%'
          )
          AND (
            NULLIF($10::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($10::text)), '[^a-z0-9]+', '', 'g')
          )
          AND (
            NULLIF($11::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($11::text)), '[^a-z0-9]+', '', 'g')
          )
      ),
      grouped AS (
        SELECT
          source_associate_id,
          associate_name,
          team_name,
          market_center_name,
          mc_source_id,
          COUNT(DISTINCT transaction_id)::int AS contracts,
          COALESCE(SUM(
            CASE
              WHEN LOWER(TRIM(transaction_side)) LIKE '%both%' THEN 2
              WHEN LOWER(TRIM(transaction_side)) LIKE '%buyer%' THEN 1
              WHEN LOWER(TRIM(transaction_side)) LIKE '%seller%' THEN 1
              ELSE 0
            END
          ), 0)::int AS units,
          ROUND(COALESCE(SUM(total_gci), 0)::numeric, 2)::text AS total_gci,
          ROUND(COALESCE(SUM(growth_share), 0)::numeric, 2)::text AS growth_share,
          ROUND(COALESCE(SUM(royalties), 0)::numeric, 2)::text AS royalties,
          ROUND(COALESCE(SUM(company_dollar), 0)::numeric, 2)::text AS company_dollar,
          ROUND(COALESCE(SUM(associate_dollar), 0)::numeric, 2)::text AS associate_dollar,
          ROUND(COALESCE(SUM(team_dollar), 0)::numeric, 2)::text AS team_dollar
        FROM filtered_tx
        GROUP BY source_associate_id, associate_name, team_name, market_center_name, mc_source_id
      )
      SELECT
        source_associate_id,
        associate_name,
        team_name,
        market_center_name,
        mc_source_id,
        contracts::text,
        units::text,
        total_gci,
        growth_share,
        royalties,
        company_dollar,
        associate_dollar,
        team_dollar
      FROM grouped
      ORDER BY total_gci::numeric DESC, associate_name ASC
      `, [
            dateFrom,
            dateTo,
            transactionStatus,
            saleType,
            scopeMcId,
            resolvedScopeAssociateId,
            marketCenterIds,
            associateQuery,
            teamQuery,
            associateId,
            effectiveTeamId,
        ]);
        const listingRowsResult = await pool.query(`
      WITH primary_listing_agents AS (
        SELECT
          la.listing_id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), NULLIF(TRIM(la.agent_name), ''), 'Unknown Associate') AS associate_name,
          COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
          COALESCE(NULLIF(TRIM(t.source_team_id), ''), t.id::text, NULLIF(TRIM(t.name), ''), 'No Team') AS source_team_id,
          COALESCE(NULLIF(TRIM(mc_assoc.name), ''), 'Unassigned / Unknown') AS associate_market_center_name,
          COALESCE(NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS associate_mc_source_id,
          ROW_NUMBER() OVER (
            PARTITION BY la.listing_id
            ORDER BY COALESCE(la.is_primary, false) DESC, la.sort_order NULLS LAST, la.id
          ) AS row_number
        FROM migration.listing_agents la
        LEFT JOIN migration.core_associates ca ON ca.id = la.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
      ),
      filtered_listings AS (
        SELECT
          pla.source_associate_id,
          pla.associate_name,
          pla.team_name,
          pla.source_team_id,
          COALESCE(NULLIF(TRIM(mc_listing.name), ''), pla.associate_market_center_name, 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(mc_listing.source_market_center_id), ''), pla.associate_mc_source_id, '') AS mc_source_id,
          cl.id,
          COALESCE(cl.status_name, cl.listing_status_tag, '') AS listing_status,
          COALESCE(cl.sale_or_rent, '') AS sale_or_rent,
          COALESCE(cl.price, 0)::numeric(18,2) AS listing_price,
          GREATEST((CURRENT_DATE - cl.on_market_since_date), 0)::int AS days_on_market
        FROM migration.core_listings cl
        LEFT JOIN migration.core_market_centers mc_listing ON mc_listing.id = cl.market_center_id
        LEFT JOIN primary_listing_agents pla ON pla.listing_id = cl.id AND pla.row_number = 1
        WHERE cl.listing_number LIKE 'KWL%'
          AND cl.on_market_since_date >= $1::date
          AND cl.on_market_since_date <= $2::date
          AND (NULLIF($3::text, '') IS NULL OR LOWER(TRIM(COALESCE(cl.status_name, cl.listing_status_tag, ''))) = LOWER(TRIM($3::text)))
          AND (NULLIF($4::text, '') IS NULL OR LOWER(TRIM(COALESCE(cl.sale_or_rent, ''))) = LOWER(TRIM($4::text)))
          AND (NULLIF($5::text, '') IS NULL OR LOWER(TRIM(COALESCE(cl.mandate_type, ''))) = LOWER(TRIM($5::text)))
          AND (
            $6::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_listing.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($6::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(pla.associate_mc_source_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($6::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($7::bigint IS NULL OR EXISTS (
            SELECT 1
            FROM migration.listing_agents la_filter
            WHERE la_filter.listing_id = cl.id
              AND la_filter.associate_id = $7::bigint
          ))
          AND (
            CARDINALITY($8::text[]) = 0
            OR NULLIF(TRIM(mc_listing.source_market_center_id), '') = ANY($8::text[])
            OR NULLIF(TRIM(pla.associate_mc_source_id), '') = ANY($8::text[])
          )
          AND (NULLIF($9::text, '') IS NULL OR COALESCE(pla.associate_name, '') ILIKE '%' || $9::text || '%')
          AND (NULLIF($10::text, '') IS NULL OR COALESCE(pla.team_name, '') ILIKE '%' || $10::text || '%')
          AND (
            NULLIF($11::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(pla.source_associate_id, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($11::text)), '[^a-z0-9]+', '', 'g')
          )
          AND (
            NULLIF($12::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(pla.source_team_id, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($12::text)), '[^a-z0-9]+', '', 'g')
          )
      )
      SELECT
        COALESCE(NULLIF(TRIM(source_associate_id), ''), 'unassigned') AS source_associate_id,
        COALESCE(NULLIF(TRIM(associate_name), ''), 'Unassigned') AS associate_name,
        COALESCE(NULLIF(TRIM(team_name), ''), 'No Team') AS team_name,
        market_center_name,
        mc_source_id,
        COUNT(*)::text AS total_listings,
        COUNT(*) FILTER (WHERE LOWER(TRIM(listing_status)) = 'active')::text AS active_listings,
        COUNT(*) FILTER (WHERE LOWER(TRIM(sale_or_rent)) = 'for sale')::text AS for_sale_listings,
        COUNT(*) FILTER (WHERE LOWER(TRIM(sale_or_rent)) IN ('for rent', 'to let'))::text AS for_rent_listings,
        ROUND(COALESCE(AVG(days_on_market), 0)::numeric, 2)::text AS avg_days_on_market,
        ROUND(COALESCE(AVG(listing_price), 0)::numeric, 2)::text AS avg_listing_price
      FROM filtered_listings
      GROUP BY source_associate_id, associate_name, team_name, market_center_name, mc_source_id
      ORDER BY COUNT(*) DESC, associate_name ASC
      `, [
            listDateFrom,
            listDateTo,
            listingStatus,
            saleOrRent,
            mandateType,
            scopeMcId,
            resolvedScopeAssociateId,
            marketCenterIds,
            associateQuery,
            teamQuery,
            associateId,
            effectiveTeamId,
        ]);
        const productionRows = productionRowsResult.rows.map((row) => ({
            source_associate_id: row.source_associate_id,
            associate_name: row.associate_name,
            team_name: row.team_name,
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
            contracts: Number(row.contracts),
            units: Number(row.units),
            total_gci: Number(row.total_gci),
            growth_share: Number(row.growth_share),
            royalties: Number(row.royalties),
            company_dollar: Number(row.company_dollar),
            associate_dollar: Number(row.associate_dollar),
            team_dollar: Number(row.team_dollar),
        }));
        const listingRows = listingRowsResult.rows.map((row) => ({
            source_associate_id: row.source_associate_id,
            associate_name: row.associate_name,
            team_name: row.team_name,
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
            total_listings: Number(row.total_listings),
            active_listings: Number(row.active_listings),
            for_sale_listings: Number(row.for_sale_listings),
            for_rent_listings: Number(row.for_rent_listings),
            avg_days_on_market: Number(row.avg_days_on_market),
            avg_listing_price: Number(row.avg_listing_price),
        }));
        const totals = {
            production_contracts: productionRows.reduce((sum, row) => sum + row.contracts, 0),
            production_units: productionRows.reduce((sum, row) => sum + row.units, 0),
            production_gci: Math.round(productionRows.reduce((sum, row) => sum + row.total_gci, 0) * 100) / 100,
            production_company_dollar: Math.round(productionRows.reduce((sum, row) => sum + row.company_dollar, 0) * 100) / 100,
            listings_total: listingRows.reduce((sum, row) => sum + row.total_listings, 0),
            listings_active: listingRows.reduce((sum, row) => sum + row.active_listings, 0),
        };
        return res.json({
            production: {
                rows: productionRows,
                summary_by_market_center: Array.from(productionRows.reduce((map, row) => {
                    const key = row.mc_source_id || row.market_center_name;
                    const existing = map.get(key) ?? {
                        market_center_name: row.market_center_name,
                        mc_source_id: row.mc_source_id,
                        contracts: 0,
                        units: 0,
                        total_gci: 0,
                        company_dollar: 0,
                    };
                    existing.contracts += row.contracts;
                    existing.units += row.units;
                    existing.total_gci += row.total_gci;
                    existing.company_dollar += row.company_dollar;
                    map.set(key, existing);
                    return map;
                }, new Map()).values())
                    .map((row) => ({
                    ...row,
                    total_gci: Math.round(row.total_gci * 100) / 100,
                    company_dollar: Math.round(row.company_dollar * 100) / 100,
                }))
                    .sort((a, b) => b.total_gci - a.total_gci),
            },
            listings: {
                rows: listingRows,
                summary_by_market_center: Array.from(listingRows.reduce((map, row) => {
                    const key = row.mc_source_id || row.market_center_name;
                    const existing = map.get(key) ?? {
                        market_center_name: row.market_center_name,
                        mc_source_id: row.mc_source_id,
                        total_listings: 0,
                        active_listings: 0,
                        for_sale_listings: 0,
                        for_rent_listings: 0,
                    };
                    existing.total_listings += row.total_listings;
                    existing.active_listings += row.active_listings;
                    existing.for_sale_listings += row.for_sale_listings;
                    existing.for_rent_listings += row.for_rent_listings;
                    map.set(key, existing);
                    return map;
                }, new Map()).values()).sort((a, b) => b.total_listings - a.total_listings),
            },
            totals,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/associate/filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null;
        const result = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(NULLIF(TRIM(mc.name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(t.source_team_id), ''), '') AS team_source_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        NULLIF(TRIM(ca.status_name), '') AS status_name,
        NULLIF(TRIM(ar.role_name), '') AS role_name
      FROM migration.core_associates ca
      LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.associate_roles ar ON ar.associate_id = ca.id
      WHERE (
        $1::text IS NULL
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
      )
        AND ($2::bigint IS NULL OR ca.id = $2::bigint)
      `, [scopeMcId, resolvedScopeAssociateId]);
        const marketCenterMap = new Map();
        const teamMap = new Map();
        const statuses = new Set();
        const roles = new Set();
        for (const row of result.rows) {
            if (row.mc_source_id && !marketCenterMap.has(row.mc_source_id)) {
                marketCenterMap.set(row.mc_source_id, row.market_center_name);
            }
            const teamKey = row.team_source_id || row.team_name;
            if (teamKey && !teamMap.has(teamKey)) {
                teamMap.set(teamKey, {
                    id: teamKey,
                    name: row.team_name,
                    market_center_id: row.mc_source_id,
                    market_center_name: row.market_center_name,
                });
            }
            if (row.status_name)
                statuses.add(row.status_name);
            if (row.role_name)
                roles.add(row.role_name);
        }
        const market_centers = Array.from(marketCenterMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const teams = Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        return res.json({
            market_centers,
            teams,
            statuses: Array.from(statuses).sort((a, b) => a.localeCompare(b)),
            roles: Array.from(roles).sort((a, b) => a.localeCompare(b)),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/associate', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const marketCenterIds = parseCsvParam(req.query.market_center_ids);
        const teamIds = parseCsvParam(req.query.team_ids);
        const statuses = parseCsvParam(req.query.statuses).map((value) => value.toLowerCase());
        const roles = parseCsvParam(req.query.roles).map((value) => value.toLowerCase());
        const associateQuery = String(req.query.associate_query ?? '').trim();
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null;
        const params = [];
        const whereClauses = [];
        params.push(scopeMcId);
        whereClauses.push(`(
      $${params.length}::text IS NULL
      OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($${params.length}::text)), '[^a-z0-9]+', '', 'g')
    )`);
        params.push(resolvedScopeAssociateId);
        whereClauses.push(`($${params.length}::bigint IS NULL OR ca.id = $${params.length}::bigint)`);
        if (marketCenterIds.length > 0) {
            params.push(marketCenterIds);
            whereClauses.push(`COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') = ANY($${params.length}::text[])`);
        }
        if (teamIds.length > 0) {
            params.push(teamIds);
            whereClauses.push(`COALESCE(NULLIF(TRIM(t.source_team_id), ''), '') = ANY($${params.length}::text[])`);
        }
        if (statuses.length > 0) {
            params.push(statuses);
            whereClauses.push(`LOWER(TRIM(COALESCE(ca.status_name, ''))) = ANY($${params.length}::text[])`);
        }
        if (roles.length > 0) {
            params.push(roles);
            whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.associate_roles ar_filter
        WHERE ar_filter.associate_id = ca.id
          AND LOWER(TRIM(COALESCE(ar_filter.role_name, ''))) = ANY($${params.length}::text[])
      )`);
        }
        if (associateQuery) {
            params.push(`%${associateQuery}%`);
            const searchParam = `$${params.length}`;
            whereClauses.push(`(
        COALESCE(ca.full_name, '') ILIKE ${searchParam}
        OR COALESCE(ca.first_name, '') ILIKE ${searchParam}
        OR COALESCE(ca.last_name, '') ILIKE ${searchParam}
        OR COALESCE(ca.source_associate_id, '') ILIKE ${searchParam}
        OR COALESCE(ca.national_id, '') ILIKE ${searchParam}
      )`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const result = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(mc.name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(NULLIF(TRIM(t.source_team_id), ''), '') AS team_source_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
        COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
        NULLIF(TRIM(ca.status_name), '') AS status_name,
        ca.start_date::text AS kw_start_date,
        ca.end_date::text AS end_date,
        ca.anniversary_date::text AS anniversary_date,
        NULLIF(TRIM(ca.mobile_number), '') AS mobile_number,
        NULLIF(TRIM(COALESCE(ca.kwsa_email, ca.email, ca.private_email, '')), '') AS associate_email,
        NULLIF(TRIM(ca.national_id), '') AS national_id,
        role_list.roles AS roles
      FROM migration.core_associates ca
      LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(role_name, '; ' ORDER BY role_name) AS roles
        FROM (
          SELECT DISTINCT NULLIF(TRIM(ar.role_name), '') AS role_name
          FROM migration.associate_roles ar
          WHERE ar.associate_id = ca.id
            AND NULLIF(TRIM(ar.role_name), '') IS NOT NULL
        ) distinct_roles
      ) role_list ON true
      ${whereSql}
      ORDER BY market_center_name ASC, team_name ASC, associate_name ASC
      `, params);
        const rows = result.rows.map((row) => {
            const birthday = parseBirthdayFromSouthAfricanId(row.national_id);
            return {
                market_center_name: row.market_center_name,
                mc_source_id: row.mc_source_id,
                team_name: row.team_name,
                team_source_id: row.team_source_id,
                associate_name: row.associate_name,
                source_associate_id: row.source_associate_id,
                status_name: row.status_name ?? '',
                kw_start_date: row.kw_start_date,
                end_date: row.end_date,
                anniversary_date: row.anniversary_date,
                birthday,
                birthday_source: birthday ? 'id_number' : 'unknown',
                mobile_number: row.mobile_number,
                associate_email: row.associate_email,
                roles: row.roles ?? '',
            };
        });
        const totalAssociates = rows.length;
        const activeAssociates = rows.filter((row) => {
            const normalized = row.status_name.trim().toLowerCase();
            return normalized === 'active' || normalized === '1';
        }).length;
        const rowsWithBirthdays = rows.filter((row) => row.birthday !== null).length;
        return res.json({
            rows,
            totals: {
                total_associates: totalAssociates,
                active_associates: activeAssociates,
                birthdays_found: rowsWithBirthdays,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/mc-dashboard/filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
            return res.status(403).json({ error: 'Permission denied: MC Dashboard requires Office Admin or Regional Admin access.' });
        }
        if (perms.scope === 'GLOBAL') {
            const rows = await pool.query(`
        SELECT source_market_center_id AS id, COALESCE(NULLIF(TRIM(name), ''), source_market_center_id) AS name
        FROM migration.core_market_centers mc
        WHERE NULLIF(TRIM(mc.source_market_center_id), '') IS NOT NULL
          AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
          AND EXISTS (
            SELECT 1
            FROM migration.core_associates a
            WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
                    = REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
              AND LOWER(TRIM(COALESCE(a.status_name, ''))) IN ('active', '1')
          )
        ORDER BY name
        `);
            return res.json({
                market_centers: rows.rows,
                selected_market_center_id: null,
            });
        }
        const selected = perms.homeMcId ?? perms.marketCenterId ?? null;
        if (!selected) {
            return res.json({ market_centers: [], selected_market_center_id: null });
        }
        const row = await pool.query(`
      SELECT source_market_center_id AS id, COALESCE(NULLIF(TRIM(name), ''), source_market_center_id) AS name
      FROM migration.core_market_centers
      WHERE source_market_center_id = $1
        AND LOWER(TRIM(COALESCE(status_name, ''))) IN ('active', '1')
      LIMIT 1
      `, [selected]);
        return res.json({
            market_centers: row.rows,
            selected_market_center_id: selected,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/mc-dashboard', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
            return res.status(403).json({ error: 'Permission denied: MC Dashboard requires Office Admin or Regional Admin access.' });
        }
        await ensureMcDashboardSnapshotTable();
        const queryMcId = String(req.query.market_center_id ?? '').trim();
        const targetMcSourceId = perms.scope === 'GLOBAL'
            ? queryMcId
            : (perms.homeMcId ?? perms.marketCenterId ?? '');
        if (!targetMcSourceId) {
            return res.status(400).json({ error: 'market_center_id is required for the active context.' });
        }
        const normalizedTargetMcId = normalizeForMatch(targetMcSourceId);
        const currentBrandingResult = await pool.query(`
      SELECT
        source_market_center_id,
        name,
        logo_image_url,
        white_logo_image_url
      FROM migration.core_market_centers
      WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      ORDER BY
        CASE WHEN NULLIF(TRIM(COALESCE(white_logo_image_url, '')), '') IS NULL THEN 0 ELSE 1 END DESC,
        CASE WHEN NULLIF(TRIM(COALESCE(logo_image_url, '')), '') IS NULL THEN 0 ELSE 1 END DESC,
        updated_at DESC NULLS LAST,
        id DESC
      LIMIT 1
      `, [normalizedTargetMcId]);
        const currentBrandingRow = currentBrandingResult.rows[0] ?? null;
        const currentBrandingPatch = {
            source_market_center_id: currentBrandingRow?.source_market_center_id ?? targetMcSourceId,
            logo_image_url: currentBrandingRow?.logo_image_url ?? null,
            white_logo_image_url: currentBrandingRow?.white_logo_image_url ?? null,
        };
        if (currentBrandingRow?.name) {
            currentBrandingPatch.name = currentBrandingRow.name;
        }
        const withLatestBranding = (payload) => {
            const existingMarketCenter = payload.market_center && typeof payload.market_center === 'object'
                ? payload.market_center
                : {};
            return {
                ...payload,
                market_center: {
                    ...existingMarketCenter,
                    ...currentBrandingPatch,
                },
            };
        };
        const today = getTodayInAppTimeZone();
        const dateFrom = getFirstOfMonthInAppTimeZone();
        const appTime = getAppTimeInTimeZone();
        const existingToday = await pool.query(`
      SELECT payload, refreshed_at::text
      FROM migration.mc_dashboard_daily_snapshots
      WHERE snapshot_date = $1::date
        AND mc_source_id = $2
      LIMIT 1
      `, [today, targetMcSourceId]);
        const emptyPeople = { birthdays_today: [], anniversaries_this_month: [] };
        if (existingToday.rows[0]) {
            const cached = existingToday.rows[0].payload;
            // Serve from cache only if the people field exists AND the snapshot version is current.
            if (cached.people !== undefined && cached._v === MC_DASHBOARD_SNAPSHOT_VERSION) {
                const branded = withLatestBranding(cached);
                return res.json({
                    ...branded,
                    people: branded.people,
                    snapshot_date: today,
                    refreshed_at: existingToday.rows[0].refreshed_at,
                    cache_state: 'fresh',
                });
            }
            // Fall through to recompute (missing people or outdated version)
        }
        const latestBeforeToday = await pool.query(`
      SELECT snapshot_date::text, payload, refreshed_at::text
      FROM migration.mc_dashboard_daily_snapshots
      WHERE snapshot_date < $1::date
        AND mc_source_id = $2
      ORDER BY snapshot_date DESC
      LIMIT 1
      `, [today, targetMcSourceId]);
        const isPastDailyRefreshTime = appTime >= '03:00';
        if (!isPastDailyRefreshTime && latestBeforeToday.rows[0]) {
            const stale = latestBeforeToday.rows[0];
            const staleCached = stale.payload;
            const brandedStale = withLatestBranding(staleCached);
            return res.json({
                ...brandedStale,
                people: brandedStale.people ?? emptyPeople,
                snapshot_date: stale.snapshot_date,
                refreshed_at: stale.refreshed_at,
                cache_state: 'stale-before-03h00',
            });
        }
        const payload = await computeMcDashboardData(targetMcSourceId, dateFrom, today);
        const saved = await pool.query(`
      INSERT INTO migration.mc_dashboard_daily_snapshots (snapshot_date, mc_source_id, payload, refreshed_at)
      VALUES ($1::date, $2, $3::jsonb, now())
      ON CONFLICT (snapshot_date, mc_source_id)
      DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = now()
      RETURNING refreshed_at::text
      `, [today, targetMcSourceId, JSON.stringify(payload)]);
        return res.json({
            ...payload,
            snapshot_date: today,
            refreshed_at: saved.rows[0]?.refreshed_at ?? new Date().toISOString(),
            cache_state: 'refreshed',
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/cappers/filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const result = await pool.query(`
      WITH scoped_associates AS (
        SELECT
          ca.id::text AS associate_id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
          COALESCE(NULLIF(TRIM(mc.name), ''), 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') AS mc_source_id,
          t.id::text AS team_id,
          COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
          COALESCE(NULLIF(TRIM(t.source_team_id), ''), '') AS source_team_id,
          t.status_name AS team_status_name
        FROM migration.core_associates ca
        LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
          AND (
            $1::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($2::bigint IS NULL OR ca.id = $2::bigint)
          AND (
            $3::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
          )
      )
      SELECT
        associate_id,
        source_associate_id,
        associate_name,
        market_center_name,
        mc_source_id,
        team_id,
        team_name,
        source_team_id,
        team_status_name
      FROM scoped_associates
      ORDER BY market_center_name, associate_name
      `, [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]);
        const includeTeamMembersInAssociateOptions = perms.scope === 'OWN';
        const marketCenterMap = new Map();
        const associates = [];
        const teamMap = new Map();
        for (const row of result.rows) {
            if (row.mc_source_id && !marketCenterMap.has(row.mc_source_id)) {
                marketCenterMap.set(row.mc_source_id, row.market_center_name);
            }
            if (!row.team_id || includeTeamMembersInAssociateOptions) {
                associates.push({
                    id: row.source_associate_id,
                    name: row.associate_name,
                    market_center_id: row.mc_source_id,
                    market_center_name: row.market_center_name,
                });
            }
            const teamId = row.source_team_id || row.team_name;
            const isActiveTeam = ['active', '1'].includes((row.team_status_name ?? '').trim().toLowerCase());
            if (row.team_id && isActiveTeam && !teamMap.has(teamId)) {
                teamMap.set(teamId, {
                    id: teamId,
                    name: row.team_name,
                    market_center_id: row.mc_source_id,
                    market_center_name: row.market_center_name,
                });
            }
        }
        const market_centers = Array.from(marketCenterMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const teams = Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        return res.json({
            market_centers,
            associates,
            teams,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/cappers', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const view = normalizeView(req.query.view);
        const marketCenterIds = parseCsvParam(req.query.market_center_ids);
        const associateQuery = String(req.query.associate_query ?? '').trim();
        const teamQuery = String(req.query.team_query ?? '').trim();
        const capStatus = String(req.query.cap_status ?? '').trim().toLowerCase();
        const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
        const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const resolvedScopeAssociateId = scopedTeamSourceId
            ? null
            : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);
        const includeTeamMembersInAssociateView = perms.scope === 'OWN';
        const params = [
            scopeMcId,
            resolvedScopeAssociateId,
            associateQuery,
            teamQuery,
            capStatus,
            marketCenterIds,
            scopedTeamSourceId,
        ];
        const rowsResult = await pool.query(`
      WITH cap_base AS (
        SELECT
          ca.id AS associate_id,
          ca.cap_date,
          COALESCE(ca.manual_cap, false) AS manual_cap,
          GREATEST(COALESCE(ca.cap, 0), 0)::numeric(18,2) AS associate_cap_amount,
          CASE
            WHEN ca.cap_date IS NULL THEN NULL::date
            ELSE make_date(
              EXTRACT(YEAR FROM CURRENT_DATE)::int,
              EXTRACT(MONTH FROM ca.cap_date)::int,
              EXTRACT(DAY FROM ca.cap_date)::int
            )
          END AS anniversary_this_year
        FROM migration.core_associates ca
      ),
      cycle_windows AS (
        SELECT
          cb.associate_id,
          cb.cap_date,
          cb.manual_cap,
          cb.associate_cap_amount,
          CASE
            WHEN cb.cap_date IS NULL THEN NULL::date
            WHEN cb.anniversary_this_year >= CURRENT_DATE THEN cb.anniversary_this_year
            ELSE (cb.anniversary_this_year + INTERVAL '1 year')::date
          END AS next_cap_date
        FROM cap_base cb
      ),
      latest_caps AS (
        SELECT
          tac.associate_id,
          COALESCE(tac.cap_amount, 0) AS cap_amount,
          COALESCE(tac.cap_remaining, 0) AS cap_remaining,
          tac.cap_cycle_end_date,
          ROW_NUMBER() OVER (
            PARTITION BY tac.associate_id
            ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
          ) AS rn
        FROM migration.transaction_agent_calculations tac
        WHERE tac.associate_id IS NOT NULL
      ),
      latest_cycle_registered_caps AS (
        SELECT
          tac.associate_id,
          COALESCE(tac.cap_amount, 0) AS cap_amount,
          COALESCE(tac.cap_remaining, 0) AS cap_remaining,
          ROW_NUMBER() OVER (
            PARTITION BY tac.associate_id
            ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
          ) AS rn
        FROM migration.transaction_agent_calculations tac
        INNER JOIN cycle_windows cw ON cw.associate_id = tac.associate_id
        WHERE tac.associate_id IS NOT NULL
          AND tac.is_registered = true
          AND cw.next_cap_date IS NOT NULL
          AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
          AND tac.effective_reporting_date::date < cw.next_cap_date
      ),
      associate_base AS (
        SELECT
          ca.id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
          COALESCE(NULLIF(TRIM(mc.name), ''), 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') AS mc_source_id,
          t.id AS team_id,
          COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
          COALESCE(NULLIF(TRIM(t.source_team_id), ''), '') AS source_team_id,
          COALESCE(cw.next_cap_date, ca.cap_date, lc.cap_cycle_end_date) AS cap_date,
          GREATEST(COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2) AS cap_amount,
          GREATEST(
            COALESCE(
              lrc.cap_remaining,
              COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0)
            ),
            0
          )::numeric(18,2) AS cap_remaining,
          cw.manual_cap AS manual_cap
        FROM migration.core_associates ca
        LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN cycle_windows cw ON cw.associate_id = ca.id
        LEFT JOIN latest_caps lc ON lc.associate_id = ca.id AND lc.rn = 1
        LEFT JOIN latest_cycle_registered_caps lrc ON lrc.associate_id = ca.id AND lrc.rn = 1
        WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
          AND (
            $1::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($2::bigint IS NULL OR ca.id = $2::bigint)
          AND (NULLIF($3::text, '') IS NULL OR LOWER(TRIM(COALESCE(ca.full_name, CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, '')), ''))) LIKE '%' || LOWER(TRIM($3::text)) || '%')
          AND (NULLIF($4::text, '') IS NULL OR LOWER(TRIM(COALESCE(t.name, ''))) LIKE '%' || LOWER(TRIM($4::text)) || '%')
          AND (CARDINALITY($6::text[]) = 0 OR COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') = ANY($6::text[]))
          AND (
            $7::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
          )
      ),
      associate_cycle_achieved AS (
        SELECT
          ab.id AS associate_id,
          ROUND(COALESCE(SUM(tac.market_center_dollar), 0)::numeric, 2) AS cap_achieved
        FROM associate_base ab
        LEFT JOIN migration.transaction_agent_calculations tac ON tac.associate_id = ab.id
        WHERE tac.is_registered = true
          AND (
            ab.cap_date IS NULL
            OR (
              tac.effective_reporting_date::date >= (ab.cap_date - INTERVAL '1 year')::date
              AND tac.effective_reporting_date::date < ab.cap_date
            )
          )
        GROUP BY ab.id
      ),
      latest_team_caps AS (
        SELECT
          tc.team_id,
          COALESCE(tc.team_cap_amount, 0)::numeric(18,2) AS team_cap_amount,
          COALESCE(tc.manual_cap, false) AS manual_cap,
          tc.cap_year,
          ROW_NUMBER() OVER (
            PARTITION BY tc.team_id
            ORDER BY tc.cap_year DESC NULLS LAST, tc.id DESC
          ) AS rn
        FROM migration.team_caps tc
      ),
      team_member_counts AS (
        SELECT
          ab.team_id,
          COUNT(*) AS member_count,
          MIN(ab.cap_date) AS cap_date
        FROM associate_base ab
        WHERE ab.team_id IS NOT NULL
        GROUP BY ab.team_id
      ),
      team_base AS (
        SELECT
          t.id AS team_id,
          COALESCE(NULLIF(TRIM(t.source_team_id), ''), t.id::text) AS source_team_id,
          COALESCE(NULLIF(TRIM(t.name), ''), 'Unknown Team') AS team_name,
          COALESCE(NULLIF(TRIM(mc.name), ''), 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') AS mc_source_id,
          tmc.cap_date,
          tmc.member_count,
          GREATEST(COALESCE(ltc.team_cap_amount, 0), 0)::numeric(18,2) AS cap_amount,
          COALESCE(ltc.manual_cap, false) AS manual_cap,
          ltc.cap_year
        FROM migration.core_teams t
        INNER JOIN team_member_counts tmc ON tmc.team_id = t.id
        LEFT JOIN migration.core_market_centers mc ON mc.id = t.market_center_id
        LEFT JOIN latest_team_caps ltc ON ltc.team_id = t.id AND ltc.rn = 1
        WHERE LOWER(TRIM(COALESCE(t.status_name, ''))) IN ('active', '1')
          AND (
            $1::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
          )
          AND (NULLIF($4::text, '') IS NULL OR LOWER(TRIM(COALESCE(t.name, ''))) LIKE '%' || LOWER(TRIM($4::text)) || '%')
          AND (CARDINALITY($6::text[]) = 0 OR COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), '') = ANY($6::text[]))
          AND (
            $7::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), t.id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
          )
      ),
      team_achieved AS (
        SELECT
          tb.team_id,
          ROUND(COALESCE(SUM(tac.market_center_dollar), 0)::numeric, 2) AS cap_achieved
        FROM team_base tb
        INNER JOIN migration.core_associates ca ON ca.team_id = tb.team_id
        INNER JOIN migration.transaction_agent_calculations tac ON tac.associate_id = ca.id
        WHERE tac.is_registered = true
          AND (
            tb.cap_date IS NULL
            OR (
              tac.effective_reporting_date::date >= (tb.cap_date - INTERVAL '1 year')::date
              AND tac.effective_reporting_date::date < tb.cap_date
            )
          )
        GROUP BY tb.team_id
      ),
      associate_rows AS (
        SELECT
          'associate'::text AS view,
          associate_name AS entity_name,
          source_associate_id AS source_entity_id,
          market_center_name,
          mc_source_id,
          team_name,
          cap_date::date::text AS cap_date,
          cap_amount,
          LEAST(cap_amount, COALESCE(aca.cap_achieved, 0))::numeric(18,2) AS cap_achieved,
          GREATEST(cap_amount - LEAST(cap_amount, COALESCE(aca.cap_achieved, 0)), 0)::numeric(18,2) AS cap_remaining,
          CASE
            WHEN cap_amount > 0 THEN ROUND((GREATEST(cap_amount - LEAST(cap_amount, COALESCE(aca.cap_achieved, 0)), 0) / cap_amount) * 100, 2)
            ELSE 0
          END AS cap_percent_remaining,
          CASE
            WHEN cap_date IS NULL THEN NULL
            ELSE (
              (
                (EXTRACT(YEAR FROM cap_date::date)::int * 12 + EXTRACT(MONTH FROM cap_date::date)::int)
                - (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int)
              )
            )::int
          END AS months_to_cap_date,
          manual_cap
        FROM associate_base
        LEFT JOIN associate_cycle_achieved aca ON aca.associate_id = associate_base.id
        WHERE (team_id IS NULL OR $9::boolean = true)
      ),
      team_rows AS (
        SELECT
          'team'::text AS view,
          tb.team_name AS entity_name,
          tb.source_team_id AS source_entity_id,
          tb.market_center_name,
          tb.mc_source_id,
          tb.team_name,
          tb.cap_date::date::text AS cap_date,
          tb.cap_amount,
          LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0))::numeric(18,2) AS cap_achieved,
          GREATEST(tb.cap_amount - LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0)), 0)::numeric(18,2) AS cap_remaining,
          CASE
            WHEN tb.cap_amount > 0 THEN ROUND((GREATEST(tb.cap_amount - LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0)), 0) / tb.cap_amount) * 100, 2)
            ELSE 0
          END AS cap_percent_remaining,
          CASE
            WHEN tb.cap_date IS NULL THEN NULL
            ELSE (
              (
                (EXTRACT(YEAR FROM tb.cap_date::date)::int * 12 + EXTRACT(MONTH FROM tb.cap_date::date)::int)
                - (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int)
              )
            )::int
          END AS months_to_cap_date,
          tb.manual_cap
        FROM team_base tb
        LEFT JOIN team_achieved ta ON ta.team_id = tb.team_id
      ),
      selected_rows AS (
        SELECT * FROM associate_rows WHERE $8::text = 'associate'
        UNION ALL
        SELECT * FROM team_rows WHERE $8::text = 'team'
      )
      SELECT
        entity_name,
        source_entity_id,
        market_center_name,
        mc_source_id,
        team_name,
        cap_date,
        cap_amount::text,
        cap_achieved::text,
        cap_remaining::text,
        cap_percent_remaining::text,
        months_to_cap_date::text,
        manual_cap
      FROM selected_rows
      WHERE (
        NULLIF($5::text, '') IS NULL
        OR ($5::text = 'capped' AND cap_remaining <= 0)
        OR ($5::text = 'not_capped' AND cap_remaining > 0)
      )
      ORDER BY cap_remaining ASC, entity_name ASC
      `, [...params, view, includeTeamMembersInAssociateView]);
        const rows = rowsResult.rows.map((row) => ({
            view,
            entity_name: row.entity_name,
            source_entity_id: row.source_entity_id,
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
            team_name: row.team_name,
            cap_date: row.cap_date,
            cap_amount: Number(row.cap_amount),
            cap_achieved: Number(row.cap_achieved),
            cap_remaining: Number(row.cap_remaining),
            cap_percent_remaining: Number(row.cap_percent_remaining),
            months_to_cap_date: row.months_to_cap_date === null ? null : Number(row.months_to_cap_date),
            manual_cap: Boolean(row.manual_cap),
        }));
        if (view === 'team' && rows.length > 0) {
            const contributionResult = await pool.query(`
        WITH
        selected_teams AS (
          SELECT
            t.id AS team_id,
            input_rows.source_team_id,
            input_rows.cap_date
          FROM UNNEST($1::text[], $2::date[]) AS input_rows(source_team_id, cap_date)
          INNER JOIN migration.core_teams t
            ON COALESCE(NULLIF(TRIM(t.source_team_id), ''), t.id::text) = input_rows.source_team_id
        )
        SELECT
          st.source_team_id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(
            NULLIF(TRIM(ca.full_name), ''),
            NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''),
            'Unknown Associate'
          ) AS associate_name,
          COALESCE(SUM(tac.market_center_dollar), 0)::text AS company_dollar
        FROM selected_teams st
        INNER JOIN migration.core_associates ca ON ca.team_id = st.team_id
        LEFT JOIN migration.transaction_agent_calculations tac
          ON tac.associate_id = ca.id
         AND tac.is_registered = true
         AND (
           st.cap_date IS NULL
           OR (
             tac.effective_reporting_date::date >= (st.cap_date - INTERVAL '1 year')::date
             AND tac.effective_reporting_date::date < st.cap_date
           )
         )
        WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        GROUP BY
          st.source_team_id,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text),
          COALESCE(
            NULLIF(TRIM(ca.full_name), ''),
            NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''),
            'Unknown Associate'
          )
        ORDER BY st.source_team_id ASC, COALESCE(SUM(tac.market_center_dollar), 0) DESC, associate_name ASC
        `, [
                rows.map((row) => row.source_entity_id),
                rows.map((row) => (row.cap_date ? row.cap_date : null)),
            ]);
            const contributionsByTeam = new Map();
            for (const contribution of contributionResult.rows) {
                const existing = contributionsByTeam.get(contribution.source_team_id) ?? [];
                existing.push({
                    associate_name: contribution.associate_name,
                    source_associate_id: contribution.source_associate_id,
                    company_dollar: Number(contribution.company_dollar),
                });
                contributionsByTeam.set(contribution.source_team_id, existing);
            }
            for (const row of rows) {
                row.team_contributions = contributionsByTeam.get(row.source_entity_id) ?? [];
            }
        }
        const totals = rows.reduce((acc, row) => {
            acc.cap_amount += row.cap_amount;
            acc.cap_achieved += row.cap_achieved;
            acc.cap_remaining += row.cap_remaining;
            if (row.cap_remaining <= 0)
                acc.capped_entities += 1;
            return acc;
        }, {
            entities: rows.length,
            capped_entities: 0,
            cap_amount: 0,
            cap_achieved: 0,
            cap_remaining: 0,
        });
        return res.json({
            view,
            rows,
            totals: {
                entities: totals.entities,
                capped_entities: totals.capped_entities,
                cap_amount: Math.round(totals.cap_amount * 100) / 100,
                cap_achieved: Math.round(totals.cap_achieved * 100) / 100,
                cap_remaining: Math.round(totals.cap_remaining * 100) / 100,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// Listings Location Report
// ---------------------------------------------------------------------------
// GET /api/reports/listings-location/filter-options
router.get('/listings-location/filter-options', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const scopeMcSourceId = perms.scope === 'GLOBAL' ? null : (perms.marketCenterId ?? perms.homeMcId ?? null);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const result = await pool.query(`
      WITH public_mc AS (
        SELECT
          l."listingNumber" AS listing_number,
          l."marketCenterId"::text AS market_center_db_id,
          COALESCE(mc_pub.name, '') AS market_center_name
        FROM listings l
        LEFT JOIN market_centers mc_pub ON mc_pub.id = l."marketCenterId"
      )
      SELECT DISTINCT
        NULLIF(TRIM(cl.province), '') AS province,
        NULLIF(TRIM(cl.suburb), '') AS suburb,
        COALESCE(mc.id::text, mc_source.id::text, lamc.market_center_db_id, pmc.market_center_db_id) AS market_center_db_id,
        COALESCE(mc.name, mc_source.name, lamc.market_center_name, pmc.market_center_name, '') AS market_center_name,
        cl.status_name AS listing_status,
        cl.property_type,
        cl.sale_or_rent,
        cl.mandate_type,
        NULLIF(TRIM(la.agent_name), '') AS agent_name
      FROM migration.core_listings cl
      LEFT JOIN migration.core_market_centers mc ON mc.id = cl.market_center_id
      LEFT JOIN LATERAL (
        SELECT mcs.id, mcs.name, mcs.source_market_center_id
        FROM migration.core_market_centers mcs
        WHERE NULLIF(TRIM(COALESCE(cl.source_market_center_id, '')), '') IS NOT NULL
          AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mcs.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
            = REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
        ORDER BY mcs.id ASC
        LIMIT 1
      ) mc_source ON TRUE
      LEFT JOIN public_mc pmc ON pmc.listing_number = cl.listing_number
      LEFT JOIN LATERAL (
        SELECT
          mc_lateral.id::text AS market_center_db_id,
          NULLIF(TRIM(mc_lateral.name), '') AS market_center_name,
          NULLIF(TRIM(mc_lateral.source_market_center_id), '') AS source_market_center_id
        FROM migration.listing_agents la_lateral
        LEFT JOIN migration.core_associates a_lateral ON a_lateral.id = la_lateral.associate_id
        LEFT JOIN migration.core_market_centers mc_lateral ON mc_lateral.id = COALESCE(a_lateral.market_center_id, la_lateral.market_center_id)
        WHERE la_lateral.listing_id = cl.id
        ORDER BY COALESCE(la_lateral.is_primary, false) DESC, la_lateral.sort_order NULLS LAST, la_lateral.id ASC
        LIMIT 1
      ) lamc ON TRUE
      LEFT JOIN migration.listing_agents la ON la.listing_id = cl.id
      WHERE cl.listing_number LIKE 'KWL%'
        AND (
          $1::text IS NULL
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc.source_market_center_id, mc_source.source_market_center_id, lamc.source_market_center_id, cl.source_market_center_id, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($2::bigint IS NULL OR EXISTS (
          SELECT 1 FROM migration.listing_agents la2
          WHERE la2.listing_id = cl.id AND la2.associate_id = $2::bigint
        ))
      `, [scopeMcSourceId, scopeAssociateId && scopeAssociateId > 0 ? scopeAssociateId : null]);
        const provinces = Array.from(new Set(result.rows.map((r) => r.province).filter(Boolean))).sort();
        const suburbs = Array.from(new Set(result.rows.map((r) => r.suburb).filter(Boolean))).sort();
        const listingStatuses = Array.from(new Set(result.rows.map((r) => r.listing_status).filter(Boolean))).sort();
        const propertyTypes = Array.from(new Set(result.rows.map((r) => r.property_type).filter(Boolean))).sort();
        const saleOrRentOptions = Array.from(new Set(result.rows.map((r) => r.sale_or_rent).filter(Boolean))).sort();
        const mandateTypes = Array.from(new Set(result.rows.map((r) => r.mandate_type).filter(Boolean))).sort();
        const agents = Array.from(new Set(result.rows.map((r) => r.agent_name).filter(Boolean))).sort();
        const normalizeMcNameKey = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
        const mcMap = new Map();
        for (const row of result.rows) {
            if (row.market_center_db_id && row.market_center_name) {
                const cleanedName = row.market_center_name.trim();
                if (!cleanedName)
                    continue;
                const key = normalizeMcNameKey(cleanedName);
                if (!key)
                    continue;
                const existing = mcMap.get(key);
                if (!existing) {
                    mcMap.set(key, { id: row.market_center_db_id, name: cleanedName });
                    continue;
                }
                const currentId = Number(row.market_center_db_id);
                const existingId = Number(existing.id);
                if (Number.isFinite(currentId) && Number.isFinite(existingId) && currentId < existingId) {
                    mcMap.set(key, { id: row.market_center_db_id, name: cleanedName });
                }
            }
        }
        const marketCenters = Array.from(mcMap.values())
            .sort((a, b) => a.name.localeCompare(b.name));
        return res.json({
            provinces,
            suburbs,
            listing_statuses: listingStatuses,
            property_types: propertyTypes,
            sale_or_rent_options: saleOrRentOptions,
            mandate_types: mandateTypes,
            agents,
            market_centers: marketCenters,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/reports/listings-location
router.get('/listings-location', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const perms = req.permissions;
        const listDateFrom = String(req.query.list_date_from || getFirstOfMonthInAppTimeZone());
        const listDateTo = String(req.query.list_date_to || getTodayInAppTimeZone());
        const appTimeZone = getAppTimeZone();
        const appToday = getTodayInAppTimeZone();
        const listingStatuses = parseCsvParam(req.query.listing_status);
        const province = String(req.query.province ?? '');
        const suburb = String(req.query.suburb ?? '');
        const marketCenterIds = parseCsvParam(req.query.market_center_ids);
        const agentQuery = String(req.query.agent_query ?? '').trim();
        const propertyType = String(req.query.property_type ?? '');
        const saleOrRents = parseCsvParam(req.query.sale_or_rent);
        const mandateTypes = parseCsvParam(req.query.mandate_type);
        const scopeMcSourceId = perms.scope === 'GLOBAL' ? null : (perms.marketCenterId ?? perms.homeMcId ?? null);
        const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
        const mcIdsFilter = marketCenterIds.length > 0
            ? marketCenterIds.map(Number).filter(Number.isFinite)
            : null;
        const result = await pool.query(`
      WITH selected_mc_name_keys AS (
        SELECT DISTINCT
          REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mcm.name, mcp.name, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) AS mc_name_key
        FROM UNNEST(COALESCE($6::bigint[], ARRAY[]::bigint[])) AS chosen(mc_id)
        LEFT JOIN migration.core_market_centers mcm ON mcm.id = chosen.mc_id
        LEFT JOIN market_centers mcp ON mcp.id = chosen.mc_id
        WHERE TRIM(COALESCE(mcm.name, mcp.name, '')) <> ''
      ),
      agent_agg AS (
        SELECT
          la.listing_id,
          STRING_AGG(
            NULLIF(TRIM(la.agent_name), ''),
            ', '
            ORDER BY COALESCE(la.is_primary, false) DESC, la.sort_order NULLS LAST, la.id
          ) AS agent_names,
          COALESCE(
            MAX(CASE WHEN la.is_primary = true THEN NULLIF(TRIM(la.agent_name), '') END),
            (
              ARRAY_REMOVE(
                ARRAY_AGG(NULLIF(TRIM(la.agent_name), '') ORDER BY la.sort_order NULLS LAST, la.id),
                NULL
              )
            )[1]
          ) AS primary_agent
        FROM migration.listing_agents la
        WHERE NULLIF(TRIM(la.agent_name), '') IS NOT NULL
        GROUP BY la.listing_id
      ),
      public_fallback AS (
        SELECT
          l."listingNumber" AS listing_number,
          MAX(l."marketCenterId")::bigint AS market_center_id,
          MAX(COALESCE(mc_pub.name, '')) AS market_center_name,
          STRING_AGG(
            NULLIF(TRIM(CONCAT_WS(' ', a."firstName", a."lastName")), ''),
            ', '
            ORDER BY COALESCE(la_pub."isPrimary", false) DESC, la_pub."createdAt" NULLS LAST, la_pub.id
          ) AS agent_names,
          COALESCE(
            MAX(CASE
              WHEN la_pub."isPrimary" = true THEN NULLIF(TRIM(CONCAT_WS(' ', a."firstName", a."lastName")), '')
            END),
            (
              ARRAY_REMOVE(
                ARRAY_AGG(
                  NULLIF(TRIM(CONCAT_WS(' ', a."firstName", a."lastName")), '')
                  ORDER BY la_pub."createdAt" NULLS LAST, la_pub.id
                ),
                NULL
              )
            )[1]
          ) AS primary_agent
        FROM listings l
        LEFT JOIN market_centers mc_pub ON mc_pub.id = l."marketCenterId"
        LEFT JOIN listing_associates la_pub ON la_pub."listingId" = l.id
        LEFT JOIN associates a ON a.id = la_pub."associateId"
        GROUP BY l."listingNumber"
      ),
      room_agg AS (
        -- Each row in listing_property_areas = one unit (count is often null).
        -- Use COUNT(*) per area_type so null-count rows are still counted as 1.
        SELECT
          lpa.listing_id,
          COUNT(*) FILTER (WHERE lpa.area_type = 'Bedroom')     AS bedrooms,
          COUNT(*) FILTER (WHERE lpa.area_type = 'Bathroom')    AS bathrooms,
          COUNT(*) FILTER (WHERE lpa.area_type = 'Garage')      AS garages,
          COUNT(*) FILTER (WHERE lpa.area_type = 'Lounge')      AS lounges,
          COUNT(*) FILTER (WHERE lpa.area_type = 'Dining Room') AS dining_rooms,
          COUNT(*) FILTER (WHERE lpa.area_type = 'Pool')        AS pools
        FROM migration.listing_property_areas lpa
        GROUP BY lpa.listing_id
      )
      SELECT
        cl.listing_number,
        timezone($13::text, cl.on_market_since_date)::date::text AS list_date,
        GREATEST(($14::date - timezone($13::text, cl.on_market_since_date)::date), 0)::int AS days_on_market,
        COALESCE(aa.primary_agent, pf.primary_agent, '') AS primary_agent,
        COALESCE(aa.agent_names, pf.agent_names, '') AS agent_names,
        COALESCE(mc.name, mc_source.name, mc_agent.name, pf.market_center_name, '') AS market_center_name,
        COALESCE(cl.city, '') AS city,
        COALESCE(TRIM(cl.suburb), '') AS suburb,
        COALESCE(TRIM(cl.province), '') AS province,
        -- Build full address: prefer address_line, fall back to street_number + street_name
        TRIM(CONCAT_WS(' ',
          COALESCE(NULLIF(TRIM(cl.address_line), ''),
            NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(cl.street_number),''), NULLIF(TRIM(cl.street_name),''))), '')
          ),
          NULLIF(TRIM(cl.suburb), ''),
          NULLIF(TRIM(cl.city), '')
        )) AS full_address,
        COALESCE(cl.price, 0)::text AS price,
        COALESCE(cl.mandate_type, '') AS mandate_type,
        COALESCE(cl.property_type, '') AS listing_type,
        COALESCE(cl.listing_status_tag, cl.status_name, '') AS listing_status_tag,
        COALESCE(cl.status_name, '') AS status_name,
        COALESCE(cl.sale_or_rent, '') AS sale_or_rent,
        COALESCE(ra.bedrooms,    0)::text AS bedrooms,
        COALESCE(ra.bathrooms,   0)::text AS bathrooms,
        COALESCE(ra.garages,     0)::text AS garages,
        COALESCE(ra.lounges,     0)::text AS lounges,
        COALESCE(ra.dining_rooms,0)::text AS dining_rooms,
        COALESCE(ra.pools,       0)::text AS pools,
        cl.reduced_date::text AS reduced_date,
        cl.property24_ref1 AS p24_ref,
        cl.private_property_ref1 AS private_property_ref
      FROM migration.core_listings cl
      LEFT JOIN migration.core_market_centers mc ON mc.id = cl.market_center_id
      LEFT JOIN LATERAL (
        SELECT mcs.id, mcs.name, mcs.source_market_center_id
        FROM migration.core_market_centers mcs
        WHERE NULLIF(TRIM(COALESCE(cl.source_market_center_id, '')), '') IS NOT NULL
          AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mcs.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
            = REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
        ORDER BY mcs.id ASC
        LIMIT 1
      ) mc_source ON TRUE
      LEFT JOIN LATERAL (
        SELECT mc_lateral.id, mc_lateral.name, mc_lateral.source_market_center_id
        FROM migration.listing_agents la_lateral
        LEFT JOIN migration.core_associates a_lateral ON a_lateral.id = la_lateral.associate_id
        LEFT JOIN migration.core_market_centers mc_lateral ON mc_lateral.id = COALESCE(a_lateral.market_center_id, la_lateral.market_center_id)
        WHERE la_lateral.listing_id = cl.id
        ORDER BY COALESCE(la_lateral.is_primary, false) DESC, la_lateral.sort_order NULLS LAST, la_lateral.id ASC
        LIMIT 1
      ) mc_agent ON TRUE
      LEFT JOIN agent_agg aa ON aa.listing_id = cl.id
      LEFT JOIN public_fallback pf ON pf.listing_number = cl.listing_number
      LEFT JOIN room_agg ra ON ra.listing_id = cl.id
      WHERE cl.listing_number LIKE 'KWL%'
        AND timezone($13::text, cl.on_market_since_date)::date >= $1::date
        AND timezone($13::text, cl.on_market_since_date)::date <= $2::date
        AND (
          CARDINALITY($3::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($3::text[]) AS selected_listing_status
            WHERE LOWER(TRIM(COALESCE(cl.status_name, cl.listing_status_tag, ''))) = LOWER(TRIM(selected_listing_status))
          )
        )
        AND (NULLIF($4, '') IS NULL OR TRIM(COALESCE(cl.province, '')) = TRIM($4))
        AND (NULLIF($5, '') IS NULL OR TRIM(COALESCE(cl.suburb, '')) ILIKE '%' || TRIM($5) || '%')
        AND (
          $6::bigint[] IS NULL
          OR cl.market_center_id = ANY($6::bigint[])
          OR mc_source.id = ANY($6::bigint[])
          OR mc_agent.id = ANY($6::bigint[])
          OR pf.market_center_id = ANY($6::bigint[])
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc.name, mc_source.name, mc_agent.name, pf.market_center_name, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) IN (SELECT mc_name_key FROM selected_mc_name_keys)
        )
        AND (NULLIF($7, '') IS NULL OR COALESCE(aa.agent_names, pf.agent_names, '') ILIKE '%' || $7 || '%')
        AND (NULLIF($8, '') IS NULL OR cl.property_type = $8)
        AND (
          CARDINALITY($9::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($9::text[]) AS selected_sale_or_rent
            WHERE LOWER(TRIM(COALESCE(cl.sale_or_rent, ''))) = LOWER(TRIM(selected_sale_or_rent))
          )
        )
        AND (
          CARDINALITY($10::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($10::text[]) AS selected_mandate_type
            WHERE LOWER(TRIM(COALESCE(cl.mandate_type, ''))) = LOWER(TRIM(selected_mandate_type))
          )
        )
        AND (
          $11::text IS NULL
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc.source_market_center_id, mc_source.source_market_center_id, mc_agent.source_market_center_id, cl.source_market_center_id, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) = REGEXP_REPLACE(LOWER(TRIM($11::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($12::bigint IS NULL OR EXISTS (
          SELECT 1 FROM migration.listing_agents la2
          WHERE la2.listing_id = cl.id AND la2.associate_id = $12::bigint
        ))
      ORDER BY timezone($13::text, cl.on_market_since_date)::date DESC, cl.listing_number
      `, [
            listDateFrom,
            listDateTo,
            listingStatuses,
            province,
            suburb,
            mcIdsFilter,
            agentQuery,
            propertyType,
            saleOrRents,
            mandateTypes,
            scopeMcSourceId,
            scopeAssociateId && scopeAssociateId > 0 ? scopeAssociateId : null,
            appTimeZone,
            appToday,
        ]);
        const rows = result.rows.map((row) => ({
            listing_number: row.listing_number,
            list_date: row.list_date,
            days_on_market: Number(row.days_on_market),
            primary_agent: row.primary_agent,
            agent_names: row.agent_names,
            market_center_name: row.market_center_name,
            city: row.city,
            suburb: row.suburb,
            province: row.province,
            full_address: row.full_address,
            price: Number(row.price),
            mandate_type: row.mandate_type,
            listing_type: row.listing_type,
            listing_status_tag: row.listing_status_tag,
            status_name: row.status_name,
            sale_or_rent: row.sale_or_rent,
            bedrooms: Number(row.bedrooms),
            bathrooms: Number(row.bathrooms),
            garages: Number(row.garages),
            lounges: Number(row.lounges),
            dining_rooms: Number(row.dining_rooms),
            pools: Number(row.pools),
            reduced_date: row.reduced_date ?? null,
            p24_ref: row.p24_ref ?? null,
            private_property_ref: row.private_property_ref ?? null,
        }));
        const totalListings = rows.length;
        const activeListings = rows.filter((r) => r.status_name.toLowerCase() === 'active').length;
        const priceSum = rows.reduce((sum, r) => sum + r.price, 0);
        const avgPrice = totalListings > 0 ? Math.round((priceSum / totalListings) * 100) / 100 : 0;
        return res.json({
            rows,
            totals: {
                total: totalListings,
                active: activeListings,
                avg_price: avgPrice,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
export default router;
//# sourceMappingURL=reports.js.map