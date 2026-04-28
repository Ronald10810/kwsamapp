'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function requireWorkspacePackage(packageName) {
  try {
    return require(packageName);
  } catch {
    const backendRequire = createRequire(path.join(__dirname, '..', 'backend', 'package.json'));
    return backendRequire(packageName);
  }
}

const { Client } = requireWorkspacePackage('pg');
const { parse } = requireWorkspacePackage('csv-parse');

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  return args[idx + 1] ?? fallback;
};

const DB_URL = process.env.DATABASE_URL;
const csvPathArg = getArg('--csv');

if (!DB_URL) {
  console.error('[merge] ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

if (!csvPathArg) {
  console.error('[merge] Usage: node scripts/merge-associate-details-updated.cjs --csv "C:\\path\\Associate Details Updated.csv"');
  process.exit(1);
}

const csvPath = path.resolve(csvPathArg);
if (!fs.existsSync(csvPath)) {
  console.error(`[merge] ERROR: CSV not found at ${csvPath}`);
  process.exit(1);
}

function toTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toBoolOrNull(value) {
  const s = toTextOrNull(value);
  if (!s) return null;
  const v = s.toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return null;
}

function toNumericOrNull(value) {
  const s = toTextOrNull(value);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(value) {
  const s = toTextOrNull(value);
  if (!s) return null;
  // Accept formats like 2025/07/01 00:00 or ISO.
  const normalized = s.replace(/\//g, '-');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function splitMulti(value) {
  const s = toTextOrNull(value);
  if (!s) return [];
  return s
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function readCsvRows(filePath) {
  return await new Promise((resolve, reject) => {
    const rows = [];
    const parser = parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
    parser.on('readable', () => {
      let rec;
      while ((rec = parser.read()) !== null) {
        rows.push(rec);
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));
    fs.createReadStream(filePath).pipe(parser);
  });
}

async function batchInsert(client, tableName, columns, rows, batchSize = 500) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const params = [];
    const valuesSql = chunk
      .map((row) => {
        const start = params.length + 1;
        columns.forEach((col) => params.push(row[col] ?? null));
        return `(${columns.map((_, idx) => `$${start + idx}`).join(',')})`;
      })
      .join(',');

    await client.query(
      `INSERT INTO ${tableName} (${columns.join(',')}) VALUES ${valuesSql}`,
      params
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function main() {
  const rawRows = await readCsvRows(csvPath);
  if (rawRows.length === 0) {
    console.log('[merge] No rows found in CSV. Nothing to do.');
    return;
  }

  const associateRows = [];
  const roleRows = [];
  const jobTitleRows = [];
  const communityRows = [];
  const adminTeamRows = [];
  const adminMcRows = [];

  for (const row of rawRows) {
    const sourceAssociateId = toTextOrNull(row.AssociateId);
    if (!sourceAssociateId) continue;

    associateRows.push({
      source_associate_id: sourceAssociateId,
      associate_status: toTextOrNull(row.AssociateStatus),
      national_id: toTextOrNull(row.NationalID),
      first_name: toTextOrNull(row.FirstName),
      last_name: toTextOrNull(row.LastName),
      full_name: toTextOrNull(row['Full name']) || toTextOrNull(row.Fullname),
      ffc_number: toTextOrNull(row.FFCNumber),
      kwsa_email: toTextOrNull(row.KWSAEmail),
      private_email: toTextOrNull(row.PrivateEmail),
      mobile_number: toTextOrNull(row.MobileNumber),
      office_number: toTextOrNull(row.OfficeNumber),
      image_url: toTextOrNull(row.AssociateImageUrl),
      gs_sponsor: toTextOrNull(row.GSSponsor),
      kwuid: toTextOrNull(row.KWUID),
      start_date: toDateOrNull(row.StartDate),
      end_date: toDateOrNull(row.EndDate),
      anniversary_date: toDateOrNull(row.AnniversaryDate),
      cap_date: toDateOrNull(row.CapDate),
      associate_start_date: toDateOrNull(row.AssociateStartDate),
      market_center_name: toTextOrNull(row.MarketCentre),
      team_name: toTextOrNull(row.TeamName),
      total_cap_amount: toNumericOrNull(row.TotalCapAmount),
      projected_cap_amount: toNumericOrNull(row.ProjectedCapAmount),
      p24_opt_in: toBoolOrNull(row.P24OptIn),
      p24_agent_id: toTextOrNull(row.P24AgentId),
      p24_status: toTextOrNull(row.P24Status),
      entegral_opt_in: toBoolOrNull(row.EntegralOptIn),
      entegral_agent_id: toTextOrNull(row.EntegralAgentId),
      entegral_status: toTextOrNull(row.EntegralStatus),
      private_property_opt_in: toBoolOrNull(row.PrivatePropertyOptIn),
      private_property_status: toTextOrNull(row.PrivatePropertyStatus),
      agent_split: toNumericOrNull(row.AgentSplit),
    });

    for (const roleName of splitMulti(row.Roles)) {
      roleRows.push({ source_associate_id: sourceAssociateId, role_name: roleName });
    }
    for (const jobTitle of splitMulti(row.JobTitles)) {
      jobTitleRows.push({ source_associate_id: sourceAssociateId, job_title: jobTitle });
    }
    for (const communityName of splitMulti(row.ServiceCommunities)) {
      communityRows.push({ source_associate_id: sourceAssociateId, community_name: communityName });
    }
    for (const teamName of splitMulti(row.AdminTeams)) {
      adminTeamRows.push({ source_associate_id: sourceAssociateId, admin_team_name: teamName });
    }
    for (const mcName of splitMulti(row.AdminMCs)) {
      adminMcRows.push({ source_associate_id: sourceAssociateId, admin_mc_name: mcName });
    }
  }

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TEMP TABLE tmp_associate_details_updated (
        source_associate_id TEXT,
        associate_status TEXT,
        national_id TEXT,
        first_name TEXT,
        last_name TEXT,
        full_name TEXT,
        ffc_number TEXT,
        kwsa_email TEXT,
        private_email TEXT,
        mobile_number TEXT,
        office_number TEXT,
        image_url TEXT,
        gs_sponsor TEXT,
        kwuid TEXT,
        start_date DATE,
        end_date DATE,
        anniversary_date DATE,
        cap_date DATE,
        associate_start_date DATE,
        market_center_name TEXT,
        team_name TEXT,
        total_cap_amount NUMERIC(18,2),
        projected_cap_amount NUMERIC(18,2),
        p24_opt_in BOOLEAN,
        p24_agent_id TEXT,
        p24_status TEXT,
        entegral_opt_in BOOLEAN,
        entegral_agent_id TEXT,
        entegral_status TEXT,
        private_property_opt_in BOOLEAN,
        private_property_status TEXT,
        agent_split NUMERIC(18,2)
      ) ON COMMIT DROP;

      CREATE TEMP TABLE tmp_associate_roles_updated (
        source_associate_id TEXT,
        role_name TEXT
      ) ON COMMIT DROP;

      CREATE TEMP TABLE tmp_associate_job_titles_updated (
        source_associate_id TEXT,
        job_title TEXT
      ) ON COMMIT DROP;

      CREATE TEMP TABLE tmp_associate_service_communities_updated (
        source_associate_id TEXT,
        community_name TEXT
      ) ON COMMIT DROP;

      CREATE TEMP TABLE tmp_associate_admin_teams_updated (
        source_associate_id TEXT,
        admin_team_name TEXT
      ) ON COMMIT DROP;

      CREATE TEMP TABLE tmp_associate_admin_mcs_updated (
        source_associate_id TEXT,
        admin_mc_name TEXT
      ) ON COMMIT DROP;
    `);

    await batchInsert(client, 'tmp_associate_details_updated', [
      'source_associate_id', 'associate_status', 'national_id', 'first_name', 'last_name', 'full_name', 'ffc_number',
      'kwsa_email', 'private_email', 'mobile_number', 'office_number', 'image_url', 'gs_sponsor', 'kwuid',
      'start_date', 'end_date', 'anniversary_date', 'cap_date', 'associate_start_date', 'market_center_name', 'team_name',
      'total_cap_amount', 'projected_cap_amount', 'p24_opt_in', 'p24_agent_id', 'p24_status',
      'entegral_opt_in', 'entegral_agent_id', 'entegral_status', 'private_property_opt_in', 'private_property_status', 'agent_split'
    ], associateRows);

    if (roleRows.length > 0) {
      await batchInsert(client, 'tmp_associate_roles_updated', ['source_associate_id', 'role_name'], roleRows);
    }
    if (jobTitleRows.length > 0) {
      await batchInsert(client, 'tmp_associate_job_titles_updated', ['source_associate_id', 'job_title'], jobTitleRows);
    }
    if (communityRows.length > 0) {
      await batchInsert(client, 'tmp_associate_service_communities_updated', ['source_associate_id', 'community_name'], communityRows);
    }
    if (adminTeamRows.length > 0) {
      await batchInsert(client, 'tmp_associate_admin_teams_updated', ['source_associate_id', 'admin_team_name'], adminTeamRows);
    }
    if (adminMcRows.length > 0) {
      await batchInsert(client, 'tmp_associate_admin_mcs_updated', ['source_associate_id', 'admin_mc_name'], adminMcRows);
    }

    const updateResult = await client.query(`
      UPDATE migration.core_associates ca
      SET
        status_name = COALESCE(NULLIF(ca.status_name, ''), NULLIF(t.associate_status, '')),
        first_name = COALESCE(NULLIF(ca.first_name, ''), NULLIF(t.first_name, '')),
        last_name = COALESCE(NULLIF(ca.last_name, ''), NULLIF(t.last_name, '')),
        full_name = COALESCE(NULLIF(ca.full_name, ''), NULLIF(t.full_name, ''), TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, '')))),
        national_id = COALESCE(NULLIF(ca.national_id, ''), NULLIF(t.national_id, '')),
        ffc_number = COALESCE(NULLIF(ca.ffc_number, ''), NULLIF(t.ffc_number, '')),
        kwsa_email = COALESCE(NULLIF(ca.kwsa_email, ''), NULLIF(t.kwsa_email, '')),
        private_email = COALESCE(NULLIF(ca.private_email, ''), NULLIF(t.private_email, '')),
        email = COALESCE(NULLIF(ca.email, ''), NULLIF(t.kwsa_email, ''), NULLIF(t.private_email, '')),
        mobile_number = COALESCE(NULLIF(ca.mobile_number, ''), NULLIF(t.mobile_number, '')),
        office_number = COALESCE(NULLIF(ca.office_number, ''), NULLIF(t.office_number, '')),
        image_url = COALESCE(NULLIF(ca.image_url, ''), NULLIF(t.image_url, '')),
        kwuid = COALESCE(NULLIF(ca.kwuid, ''), NULLIF(t.kwuid, '')),
        proposed_growth_share_sponsor = COALESCE(NULLIF(ca.proposed_growth_share_sponsor, ''), NULLIF(t.gs_sponsor, '')),
        start_date = COALESCE(ca.start_date, t.start_date, t.associate_start_date),
        end_date = COALESCE(ca.end_date, t.end_date),
        anniversary_date = COALESCE(ca.anniversary_date, t.anniversary_date),
        cap_date = COALESCE(ca.cap_date, t.cap_date),
        cap = COALESCE(ca.cap, t.total_cap_amount),
        projected_cap = COALESCE(ca.projected_cap, t.projected_cap_amount),
        agent_split = COALESCE(ca.agent_split, t.agent_split),
        property24_opt_in = COALESCE(ca.property24_opt_in, false) OR COALESCE(t.p24_opt_in, false),
        agent_property24_id = COALESCE(NULLIF(ca.agent_property24_id, ''), NULLIF(t.p24_agent_id, '')),
        property24_status = COALESCE(NULLIF(ca.property24_status, ''), NULLIF(t.p24_status, '')),
        entegral_opt_in = COALESCE(ca.entegral_opt_in, false) OR COALESCE(t.entegral_opt_in, false),
        agent_entegral_id = COALESCE(NULLIF(ca.agent_entegral_id, ''), NULLIF(t.entegral_agent_id, '')),
        entegral_status = COALESCE(NULLIF(ca.entegral_status, ''), NULLIF(t.entegral_status, '')),
        private_property_opt_in = COALESCE(ca.private_property_opt_in, false) OR COALESCE(t.private_property_opt_in, false),
        private_property_status = COALESCE(NULLIF(ca.private_property_status, ''), NULLIF(t.private_property_status, '')),
        source_market_center_id = COALESCE(NULLIF(ca.source_market_center_id, ''), mc.source_market_center_id),
        source_team_id = COALESCE(NULLIF(ca.source_team_id, ''), tm.source_team_id),
        market_center_id = COALESCE(ca.market_center_id, mc.id),
        team_id = COALESCE(ca.team_id, tm.id),
        updated_at = now()
      FROM tmp_associate_details_updated t
      LEFT JOIN migration.core_market_centers mc
        ON LOWER(TRIM(mc.name)) = LOWER(TRIM(t.market_center_name))
      LEFT JOIN migration.core_teams tm
        ON LOWER(TRIM(tm.name)) = LOWER(TRIM(t.team_name))
      WHERE ca.source_associate_id = t.source_associate_id
    `);

    const roleInsertResult = await client.query(`
      INSERT INTO migration.associate_roles (associate_id, role_name)
      SELECT DISTINCT ca.id, TRIM(r.role_name)
      FROM tmp_associate_roles_updated r
      JOIN migration.core_associates ca ON ca.source_associate_id = r.source_associate_id
      WHERE NULLIF(TRIM(r.role_name), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM migration.associate_roles ar
          WHERE ar.associate_id = ca.id
            AND LOWER(TRIM(ar.role_name)) = LOWER(TRIM(r.role_name))
        )
    `);

    const jobInsertResult = await client.query(`
      INSERT INTO migration.associate_job_titles (associate_id, job_title)
      SELECT DISTINCT ca.id, TRIM(j.job_title)
      FROM tmp_associate_job_titles_updated j
      JOIN migration.core_associates ca ON ca.source_associate_id = j.source_associate_id
      WHERE NULLIF(TRIM(j.job_title), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM migration.associate_job_titles aj
          WHERE aj.associate_id = ca.id
            AND LOWER(TRIM(aj.job_title)) = LOWER(TRIM(j.job_title))
        )
    `);

    const communityInsertResult = await client.query(`
      INSERT INTO migration.associate_service_communities (associate_id, community_name)
      SELECT DISTINCT ca.id, TRIM(s.community_name)
      FROM tmp_associate_service_communities_updated s
      JOIN migration.core_associates ca ON ca.source_associate_id = s.source_associate_id
      WHERE NULLIF(TRIM(s.community_name), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM migration.associate_service_communities asc2
          WHERE asc2.associate_id = ca.id
            AND LOWER(TRIM(asc2.community_name)) = LOWER(TRIM(s.community_name))
        )
    `);

    const adminMcInsertResult = await client.query(`
      INSERT INTO migration.associate_admin_market_centers (associate_id, source_market_center_id)
      SELECT DISTINCT
        ca.id,
        mc.source_market_center_id
      FROM tmp_associate_admin_mcs_updated am
      JOIN migration.core_associates ca ON ca.source_associate_id = am.source_associate_id
      JOIN migration.core_market_centers mc ON LOWER(TRIM(mc.name)) = LOWER(TRIM(am.admin_mc_name))
      WHERE NULLIF(TRIM(am.admin_mc_name), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM migration.associate_admin_market_centers a2
          WHERE a2.associate_id = ca.id
            AND a2.source_market_center_id = mc.source_market_center_id
        )
    `);

    const adminTeamInsertResult = await client.query(`
      INSERT INTO migration.associate_admin_teams (associate_id, source_team_id)
      SELECT DISTINCT
        ca.id,
        tm.source_team_id
      FROM tmp_associate_admin_teams_updated at
      JOIN migration.core_associates ca ON ca.source_associate_id = at.source_associate_id
      JOIN migration.core_teams tm ON LOWER(TRIM(tm.name)) = LOWER(TRIM(at.admin_team_name))
      WHERE NULLIF(TRIM(at.admin_team_name), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM migration.associate_admin_teams a2
          WHERE a2.associate_id = ca.id
            AND a2.source_team_id = tm.source_team_id
        )
    `);

    await client.query('COMMIT');

    console.log(`[merge] CSV rows parsed: ${rawRows.length}`);
    console.log(`[merge] Associates staged: ${associateRows.length}`);
    console.log(`[merge] Associates merged: ${updateResult.rowCount}`);
    console.log(`[merge] Roles inserted: ${roleInsertResult.rowCount}`);
    console.log(`[merge] Job titles inserted: ${jobInsertResult.rowCount}`);
    console.log(`[merge] Service communities inserted: ${communityInsertResult.rowCount}`);
    console.log(`[merge] Admin market centers inserted: ${adminMcInsertResult.rowCount}`);
    console.log(`[merge] Admin teams inserted: ${adminTeamInsertResult.rowCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[merge] FATAL:', error.message);
  process.exit(1);
});
