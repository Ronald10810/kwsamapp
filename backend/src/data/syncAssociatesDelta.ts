import 'dotenv/config';
import sql from 'mssql';
import { Client } from 'pg';
import { optionalArg } from './args.js';

const AZURE = {
  server: 'kwsa.database.windows.net',
  port: 1433,
  database: 'dbMappProd',
  user: 'kwsaReadOnly',
  password: 'W4Km3jUnYyt+x8=',
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 30000,
  connectionTimeout: 30000,
};

const PG = {
  host: '127.0.0.1',
  port: 9470,
  database: 'kwsa_uat',
  user: 'kwsa_uat',
  password: '123456789',
  ssl: false,
};

const SYNC_NAME = 'associates-daily-incremental';

type DeltaAssociateRow = {
  AssociateId: number;
  FirstName: string | null;
  LastName: string | null;
  NationalId: string | null;
  FFCNumber: string | null;
  AssociateStatusId: number | null;
  WhenUpdated: Date;
};

type ExistingAssociateRow = {
  source_associate_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  national_id: string | null;
  ffc_number: string | null;
  status_name: string | null;
};

type AssociateBusinessRow = {
  AssociateId: number;
  KWUID: string | null;
  MarketCenterId: number | null;
  TeamId: number | null;
  ProposedGrowthShareSponsor: string | null;
  GrowthShareSponsorName: string | null;
  TemporaryGrowthShareSponsor: boolean | null;
  ListingApprovalRequired: boolean | null;
  ExcludeFromIndividualReports: boolean | null;
  Vested: boolean | null;
  VestingStartPeriod: Date | null;
};

type AssociateCommissionRow = {
  AssociateId: number;
  CommissionSplitPercentageToAgent: number | null;
  TotalCapAmount: number | null;
  ManualCap: boolean | null;
  ProjectedCapAmount: number | null;
};

type AssociateDateRow = {
  AssociateId: number;
  StartDate: Date | null;
  EndDate: Date | null;
  AnniversaryDate: Date | null;
  CapDate: Date | null;
};

type AssociateThirdPartyRow = {
  AssociateId: number;
  FeedToP24: boolean | null;
  P24AgentId: number | null;
  FeedToEntegral: boolean | null;
  EntegralAgentId: string | null;
  EntegralSyncMessage: string | null;
  EntegralStatus: string | null;
  FeedToPrivateProperty: boolean | null;
  PrivatePropertySyncMessage: string | null;
  PrivatePropertyStatus: string | null;
  P24SyncMessage: string | null;
  P24Status: string | null;
};

type AssociateEnrichment = {
  business: Map<number, AssociateBusinessRow>;
  commissions: Map<number, AssociateCommissionRow>;
  dates: Map<number, AssociateDateRow>;
  thirdParty: Map<number, AssociateThirdPartyRow>;
  roles: Map<number, string[]>;
  jobTitles: Map<number, string[]>;
  serviceCommunities: Map<number, string[]>;
  adminMarketCenters: Map<number, string[]>;
  adminTeams: Map<number, string[]>;
};

function parseSinceArg(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --since value: ${value}`);
  }
  return date;
}

function defaultSince(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeText(value: string | null | undefined): string {
  return cleanText(value).replace(/\s+/g, ' ').toLowerCase();
}

function statusFromId(statusId: number | null): string {
  if (statusId === 1) return 'Active';
  if (statusId === 2) return 'Inactive';
  if (statusId === null) return '';
  return String(statusId);
}

function normalizeStatus(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (normalized === '1' || normalized === 'active') return 'active';
  if (normalized === '2' || normalized === 'inactive') return 'inactive';
  return normalized;
}

function buildFullName(firstName: string | null, lastName: string | null): string {
  return [cleanText(firstName), cleanText(lastName)].filter(Boolean).join(' ').trim();
}

function nullableText(value: string | null | undefined): string | null {
  const text = cleanText(value);
  return text.length > 0 ? text : null;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function boolOrNull(value: boolean | null | undefined): boolean | null {
  return value === null || value === undefined ? null : Boolean(value);
}

function groupedStringMap(rows: Array<{ associate_id: number; value: string | null }>): Map<number, string[]> {
  const output = new Map<number, string[]>();
  for (const row of rows) {
    const v = nullableText(row.value);
    if (!v) continue;
    const current = output.get(row.associate_id) ?? [];
    if (!current.some((entry) => normalizeText(entry) === normalizeText(v))) {
      current.push(v);
      output.set(row.associate_id, current);
    }
  }
  return output;
}

function emptyEnrichment(): AssociateEnrichment {
  return {
    business: new Map<number, AssociateBusinessRow>(),
    commissions: new Map<number, AssociateCommissionRow>(),
    dates: new Map<number, AssociateDateRow>(),
    thirdParty: new Map<number, AssociateThirdPartyRow>(),
    roles: new Map<number, string[]>(),
    jobTitles: new Map<number, string[]>(),
    serviceCommunities: new Map<number, string[]>(),
    adminMarketCenters: new Map<number, string[]>(),
    adminTeams: new Map<number, string[]>(),
  };
}

function idClause(ids: number[]): string {
  return ids.join(',');
}

async function fetchAssociateEnrichment(az: sql.ConnectionPool, ids: number[]): Promise<AssociateEnrichment> {
  if (ids.length === 0) return emptyEnrichment();

  const clause = idClause(ids);

  const businessResult = await az.request().query(`
    SELECT
      abd.AssociateId,
      abd.KWUID,
      abd.MarketCenterId,
      abd.TeamId,
      abd.ProposedGrowthShareSponsor,
      CONCAT(COALESCE(gs.FirstName, ''), CASE WHEN gs.FirstName IS NOT NULL AND gs.LastName IS NOT NULL THEN ' ' ELSE '' END, COALESCE(gs.LastName, '')) AS GrowthShareSponsorName,
      abd.TemporaryGrowthShareSponsor,
      abd.ListingApprovalRequired,
      abd.ExcludeFromIndividualReports,
      abd.Vested,
      abd.VestingStartPeriod
    FROM dbo.AssociateBusinessDetail abd
    LEFT JOIN dbo.Associate gs ON gs.Id = abd.GrowthShareSponsorId
    WHERE abd.AssociateId IN (${clause})
  `);

  const commissionResult = await az.request().query(`
    SELECT
      ac.AssociateId,
      ac.CommissionSplitPercentageToAgent,
      ac.TotalCapAmount,
      ac.ManualCap,
      ac.ProjectedCapAmount
    FROM dbo.AssociateCommission ac
    WHERE ac.AssociateId IN (${clause})
  `);

  const dateResult = await az.request().query(`
    SELECT
      ad.AssociateId,
      ad.StartDate,
      ad.EndDate,
      ad.AnniversaryDate,
      ad.CapDate
    FROM dbo.AssociateDate ad
    WHERE ad.AssociateId IN (${clause})
  `);

  const thirdPartyResult = await az.request().query(`
    SELECT
      atpi.AssociateId,
      atpi.FeedToP24,
      atpi.P24AgentId,
      atpi.FeedToEntegral,
      atpi.EntegralAgentId,
      atpi.EntegralSyncMessage,
      atpi.EntegralStatus,
      atpi.FeedToPrivateProperty,
      atpi.PrivatePropertySyncMessage,
      atpi.PrivatePropertyStatus,
      atpi.P24SyncMessage,
      atpi.P24Status
    FROM dbo.AssociateThirdPartyIntegration atpi
    WHERE atpi.AssociateId IN (${clause})
  `);

  const roleResult = await az.request().query(`
    SELECT
      air.AssociateId AS associate_id,
      r.Name AS value
    FROM dbo.AssociateIdentityRole air
    LEFT JOIN dbo.AspNetRoles r ON r.Id = air.AssociateRolesId
    WHERE air.AssociateId IN (${clause})
  `);

  const jobTitleResult = await az.request().query(`
    SELECT
      ajt.AssociatesId AS associate_id,
      jt.Name AS value
    FROM dbo.AssociateJobTitle ajt
    LEFT JOIN dbo.JobTitle jt ON jt.Id = ajt.JobTitlesId
    WHERE ajt.AssociatesId IN (${clause})
  `);

  const communityResult = await az.request().query(`
    SELECT
      ascx.AssociatesId AS associate_id,
      sc.Name AS value
    FROM dbo.AssociateServiceCommunity ascx
    LEFT JOIN dbo.ServiceCommunity sc ON sc.Id = ascx.ServiceCommunitiesId
    WHERE ascx.AssociatesId IN (${clause})
  `);

  const adminMcResult = await az.request().query(`
    SELECT
      aamc.AdminsId AS associate_id,
      CAST(aamc.AdminMarketCentersId AS NVARCHAR(50)) AS value
    FROM dbo.AssociateAdminMarketCenter aamc
    WHERE aamc.AdminsId IN (${clause})
  `);

  const adminTeamResult = await az.request().query(`
    SELECT
      aat.AdminsId AS associate_id,
      CAST(aat.AdminTeamsId AS NVARCHAR(50)) AS value
    FROM dbo.AssociateAdminTeam aat
    WHERE aat.AdminsId IN (${clause})
  `);

  return {
    business: new Map((businessResult.recordset as AssociateBusinessRow[]).map((row) => [row.AssociateId, row])),
    commissions: new Map((commissionResult.recordset as AssociateCommissionRow[]).map((row) => [row.AssociateId, row])),
    dates: new Map((dateResult.recordset as AssociateDateRow[]).map((row) => [row.AssociateId, row])),
    thirdParty: new Map((thirdPartyResult.recordset as AssociateThirdPartyRow[]).map((row) => [row.AssociateId, row])),
    roles: groupedStringMap(roleResult.recordset as Array<{ associate_id: number; value: string | null }>),
    jobTitles: groupedStringMap(jobTitleResult.recordset as Array<{ associate_id: number; value: string | null }>),
    serviceCommunities: groupedStringMap(communityResult.recordset as Array<{ associate_id: number; value: string | null }>),
    adminMarketCenters: groupedStringMap(adminMcResult.recordset as Array<{ associate_id: number; value: string | null }>),
    adminTeams: groupedStringMap(adminTeamResult.recordset as Array<{ associate_id: number; value: string | null }>),
  };
}

async function ensureCheckpointTable(client: Client): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS migration;
    CREATE TABLE IF NOT EXISTS migration.associate_sync_state (
      sync_name TEXT PRIMARY KEY,
      last_source_updated_at TIMESTAMPTZ NOT NULL DEFAULT '1900-01-01T00:00:00Z'::timestamptz,
      last_source_associate_id BIGINT NOT NULL DEFAULT 0,
      last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_run_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function loadCheckpoint(client: Client, syncName: string): Promise<{ last_source_updated_at: string; last_source_associate_id: string } | null> {
  const result = await client.query(
    `SELECT last_source_updated_at::text AS last_source_updated_at, last_source_associate_id::text AS last_source_associate_id
     FROM migration.associate_sync_state
     WHERE sync_name = $1
     LIMIT 1`,
    [syncName]
  );

  return result.rows[0] ?? null;
}

async function saveCheckpoint(
  client: Client,
  syncName: string,
  updatedAt: string,
  associateId: number,
  runCount: number
): Promise<void> {
  await client.query(
    `INSERT INTO migration.associate_sync_state (
       sync_name, last_source_updated_at, last_source_associate_id, last_run_at, last_run_count
     ) VALUES ($1, $2::timestamptz, $3::bigint, NOW(), $4)
     ON CONFLICT (sync_name) DO UPDATE SET
       last_source_updated_at = EXCLUDED.last_source_updated_at,
       last_source_associate_id = EXCLUDED.last_source_associate_id,
       last_run_at = EXCLUDED.last_run_at,
       last_run_count = EXCLUDED.last_run_count`,
    [syncName, updatedAt, associateId, runCount]
  );
}

async function loadExistingAssociates(pg: Client, sourceIds: string[]): Promise<Map<string, ExistingAssociateRow>> {
  if (sourceIds.length === 0) return new Map<string, ExistingAssociateRow>();

  const result = await pg.query<ExistingAssociateRow>(
    `SELECT source_associate_id, first_name, last_name, full_name, national_id, ffc_number, status_name
     FROM migration.core_associates
     WHERE source_associate_id = ANY($1::text[])`,
    [sourceIds]
  );

  return new Map(result.rows.map((row) => [row.source_associate_id, row]));
}

async function syncAssociateCollections(pg: Client, associateId: number, row: DeltaAssociateRow, enrichment: AssociateEnrichment): Promise<void> {
  const roles = enrichment.roles.get(row.AssociateId) ?? [];
  const jobTitles = enrichment.jobTitles.get(row.AssociateId) ?? [];
  const communities = enrichment.serviceCommunities.get(row.AssociateId) ?? [];
  const adminMarketCenters = enrichment.adminMarketCenters.get(row.AssociateId) ?? [];
  const adminTeams = enrichment.adminTeams.get(row.AssociateId) ?? [];

  await pg.query(`DELETE FROM migration.associate_roles WHERE associate_id = $1`, [associateId]);
  await pg.query(`DELETE FROM migration.associate_job_titles WHERE associate_id = $1`, [associateId]);
  await pg.query(`DELETE FROM migration.associate_service_communities WHERE associate_id = $1`, [associateId]);
  await pg.query(`DELETE FROM migration.associate_admin_market_centers WHERE associate_id = $1`, [associateId]);
  await pg.query(`DELETE FROM migration.associate_admin_teams WHERE associate_id = $1`, [associateId]);

  for (const role of roles) {
    await pg.query(`INSERT INTO migration.associate_roles (associate_id, role_name) VALUES ($1, $2)`, [associateId, role]);
  }

  for (const title of jobTitles) {
    await pg.query(`INSERT INTO migration.associate_job_titles (associate_id, job_title) VALUES ($1, $2)`, [associateId, title]);
  }

  for (const community of communities) {
    await pg.query(
      `INSERT INTO migration.associate_service_communities (associate_id, community_name) VALUES ($1, $2)`,
      [associateId, community]
    );
  }

  for (const sourceMarketCenterId of adminMarketCenters) {
    await pg.query(
      `INSERT INTO migration.associate_admin_market_centers (associate_id, source_market_center_id) VALUES ($1, $2)`,
      [associateId, sourceMarketCenterId]
    );
  }

  for (const sourceTeamId of adminTeams) {
    await pg.query(
      `INSERT INTO migration.associate_admin_teams (associate_id, source_team_id) VALUES ($1, $2)`,
      [associateId, sourceTeamId]
    );
  }
}

async function upsertAssociate(pg: Client, row: DeltaAssociateRow, enrichment: AssociateEnrichment): Promise<number> {
  const sourceAssociateId = String(row.AssociateId);
  const firstName = cleanText(row.FirstName) || null;
  const lastName = cleanText(row.LastName) || null;
  const fullName = buildFullName(row.FirstName, row.LastName) || null;
  const nationalId = cleanText(row.NationalId) || null;
  const ffcNumber = cleanText(row.FFCNumber) || null;
  const statusName = statusFromId(row.AssociateStatusId) || null;

  const business = enrichment.business.get(row.AssociateId);
  const commission = enrichment.commissions.get(row.AssociateId);
  const dates = enrichment.dates.get(row.AssociateId);
  const thirdParty = enrichment.thirdParty.get(row.AssociateId);

  const sourceMarketCenterId = business?.MarketCenterId ? String(business.MarketCenterId) : null;
  const sourceTeamId = business?.TeamId ? String(business.TeamId) : null;
  const kwuid = nullableText(business?.KWUID);
  const growthShareSponsor = nullableText(business?.GrowthShareSponsorName);
  const proposedGrowthShareSponsor = nullableText(business?.ProposedGrowthShareSponsor);
  const temporaryGrowthShareSponsor = boolOrNull(business?.TemporaryGrowthShareSponsor);
  const listingApprovalRequired = boolOrNull(business?.ListingApprovalRequired);
  const excludeFromIndividualReports = boolOrNull(business?.ExcludeFromIndividualReports);
  const vested = boolOrNull(business?.Vested);
  const vestingPeriodStartDate = toIsoDate(business?.VestingStartPeriod ?? null);

  const agentSplit = commission?.CommissionSplitPercentageToAgent ?? null;
  const totalCapAmount = commission?.TotalCapAmount ?? null;
  const manualCap = boolOrNull(commission?.ManualCap);
  const projectedCap = commission?.ProjectedCapAmount ?? null;

  const startDate = toIsoDate(dates?.StartDate ?? null);
  const endDate = toIsoDate(dates?.EndDate ?? null);
  const anniversaryDate = toIsoDate(dates?.AnniversaryDate ?? null);
  const capDate = toIsoDate(dates?.CapDate ?? null);

  const property24OptIn = boolOrNull(thirdParty?.FeedToP24);
  const agentProperty24Id = thirdParty?.P24AgentId ? String(thirdParty.P24AgentId) : null;
  const property24Status = nullableText(thirdParty?.P24Status) ?? nullableText(thirdParty?.P24SyncMessage);
  const entegralOptIn = boolOrNull(thirdParty?.FeedToEntegral);
  const agentEntegralId = nullableText(thirdParty?.EntegralAgentId);
  const entegralStatus = nullableText(thirdParty?.EntegralStatus) ?? nullableText(thirdParty?.EntegralSyncMessage);
  const privatePropertyOptIn = boolOrNull(thirdParty?.FeedToPrivateProperty);
  const privatePropertyStatus = nullableText(thirdParty?.PrivatePropertyStatus) ?? nullableText(thirdParty?.PrivatePropertySyncMessage);

  const upsert = await pg.query<{ id: string }>(
    `INSERT INTO migration.core_associates (
       source_market_center_id,
       source_team_id,
       market_center_id,
       team_id,
       source_associate_id,
       first_name,
       last_name,
       full_name,
       national_id,
       ffc_number,
       status_name,
       kwuid,
       growth_share_sponsor,
       proposed_growth_share_sponsor,
       temporary_growth_share_sponsor,
       listing_approval_required,
       exclude_from_individual_reports,
       vested,
       vesting_period_start_date,
       property24_opt_in,
       agent_property24_id,
       property24_status,
       entegral_opt_in,
       agent_entegral_id,
       entegral_status,
       private_property_opt_in,
       private_property_status,
       cap,
       manual_cap,
       agent_split,
       projected_cap,
       start_date,
       end_date,
       anniversary_date,
       cap_date,
       updated_at
     ) VALUES (
       $1,
       $2,
       (SELECT id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1),
       (SELECT id FROM migration.core_teams WHERE source_team_id = $2 LIMIT 1),
       $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16, $17::date,
       $18, $19, $20, $21, $22, $23, $24, $25,
       $26, $27, $28, $29, $30::date, $31::date, $32::date, $33::date,
       NOW()
     )
     ON CONFLICT (source_associate_id)
     DO UPDATE SET
       source_market_center_id = COALESCE(EXCLUDED.source_market_center_id, migration.core_associates.source_market_center_id),
       source_team_id = COALESCE(EXCLUDED.source_team_id, migration.core_associates.source_team_id),
       market_center_id = COALESCE((SELECT id FROM migration.core_market_centers WHERE source_market_center_id = EXCLUDED.source_market_center_id LIMIT 1), migration.core_associates.market_center_id),
       team_id = COALESCE((SELECT id FROM migration.core_teams WHERE source_team_id = EXCLUDED.source_team_id LIMIT 1), migration.core_associates.team_id),
       first_name = COALESCE(EXCLUDED.first_name, migration.core_associates.first_name),
       last_name = COALESCE(EXCLUDED.last_name, migration.core_associates.last_name),
       full_name = COALESCE(EXCLUDED.full_name, migration.core_associates.full_name),
       national_id = COALESCE(EXCLUDED.national_id, migration.core_associates.national_id),
       ffc_number = COALESCE(EXCLUDED.ffc_number, migration.core_associates.ffc_number),
       status_name = COALESCE(EXCLUDED.status_name, migration.core_associates.status_name),
       kwuid = COALESCE(EXCLUDED.kwuid, migration.core_associates.kwuid),
       growth_share_sponsor = COALESCE(EXCLUDED.growth_share_sponsor, migration.core_associates.growth_share_sponsor),
       proposed_growth_share_sponsor = COALESCE(EXCLUDED.proposed_growth_share_sponsor, migration.core_associates.proposed_growth_share_sponsor),
       temporary_growth_share_sponsor = COALESCE(EXCLUDED.temporary_growth_share_sponsor, migration.core_associates.temporary_growth_share_sponsor),
       listing_approval_required = COALESCE(EXCLUDED.listing_approval_required, migration.core_associates.listing_approval_required),
       exclude_from_individual_reports = COALESCE(EXCLUDED.exclude_from_individual_reports, migration.core_associates.exclude_from_individual_reports),
       vested = COALESCE(EXCLUDED.vested, migration.core_associates.vested),
       vesting_period_start_date = COALESCE(EXCLUDED.vesting_period_start_date, migration.core_associates.vesting_period_start_date),
       property24_opt_in = COALESCE(EXCLUDED.property24_opt_in, migration.core_associates.property24_opt_in),
       agent_property24_id = COALESCE(EXCLUDED.agent_property24_id, migration.core_associates.agent_property24_id),
       property24_status = COALESCE(EXCLUDED.property24_status, migration.core_associates.property24_status),
       entegral_opt_in = COALESCE(EXCLUDED.entegral_opt_in, migration.core_associates.entegral_opt_in),
       agent_entegral_id = COALESCE(EXCLUDED.agent_entegral_id, migration.core_associates.agent_entegral_id),
       entegral_status = COALESCE(EXCLUDED.entegral_status, migration.core_associates.entegral_status),
       private_property_opt_in = COALESCE(EXCLUDED.private_property_opt_in, migration.core_associates.private_property_opt_in),
       private_property_status = COALESCE(EXCLUDED.private_property_status, migration.core_associates.private_property_status),
       cap = COALESCE(EXCLUDED.cap, migration.core_associates.cap),
       manual_cap = COALESCE(EXCLUDED.manual_cap, migration.core_associates.manual_cap),
       agent_split = COALESCE(EXCLUDED.agent_split, migration.core_associates.agent_split),
       projected_cap = COALESCE(EXCLUDED.projected_cap, migration.core_associates.projected_cap),
       start_date = COALESCE(EXCLUDED.start_date, migration.core_associates.start_date),
       end_date = COALESCE(EXCLUDED.end_date, migration.core_associates.end_date),
       anniversary_date = COALESCE(EXCLUDED.anniversary_date, migration.core_associates.anniversary_date),
       cap_date = COALESCE(EXCLUDED.cap_date, migration.core_associates.cap_date),
       updated_at = NOW()
     RETURNING id::text`,
    [
      sourceMarketCenterId,
      sourceTeamId,
      sourceAssociateId,
      firstName,
      lastName,
      fullName,
      nationalId,
      ffcNumber,
      statusName,
      kwuid,
      growthShareSponsor,
      proposedGrowthShareSponsor,
      temporaryGrowthShareSponsor,
      listingApprovalRequired,
      excludeFromIndividualReports,
      vested,
      vestingPeriodStartDate,
      property24OptIn,
      agentProperty24Id,
      property24Status,
      entegralOptIn,
      agentEntegralId,
      entegralStatus,
      privatePropertyOptIn,
      privatePropertyStatus,
      totalCapAmount,
      manualCap,
      agentSplit,
      projectedCap,
      startDate,
      endDate,
      anniversaryDate,
      capDate,
    ]
  );

  const associateId = Number(upsert.rows[0].id);
  await syncAssociateCollections(pg, associateId, row, enrichment);

  await pg.query(
    `INSERT INTO migration.id_map_associates (source_associate_id, core_associate_id, mapped_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (source_associate_id)
     DO UPDATE SET core_associate_id = EXCLUDED.core_associate_id, mapped_at = NOW()`,
    [sourceAssociateId, associateId]
  );

  return associateId;
}

async function main(): Promise<void> {
  const sinceArg = parseSinceArg(optionalArg('--since', ''));
  const dryRun = (optionalArg('--dry-run', '').trim().toLowerCase() === 'true') || process.argv.includes('--dry-run');
  const limitArg = Number(optionalArg('--limit', '0'));
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.trunc(limitArg) : 0;

  const az = await sql.connect(AZURE);
  const pg = new Client(PG);
  await pg.connect();

  try {
    await ensureCheckpointTable(pg);

    const checkpoint = sinceArg
      ? { last_source_updated_at: sinceArg.toISOString(), last_source_associate_id: '0' }
      : await loadCheckpoint(pg, SYNC_NAME);

    const effectiveSince = checkpoint?.last_source_updated_at ?? defaultSince().toISOString();
    const effectiveId = Number(checkpoint?.last_source_associate_id ?? '0') || 0;

    const topClause = limit > 0 ? `TOP (${limit})` : 'TOP (2147483647)';
    const deltaQuery = `
      SELECT ${topClause}
        a.Id AS AssociateId,
        a.FirstName,
        a.LastName,
        a.NationalId,
        a.FFCNumber,
        a.AssociateStatusId,
        a.WhenUpdated
      FROM dbo.Associate a
      WHERE a.WhenUpdated > @sinceUpdated
         OR (a.WhenUpdated = @sinceUpdated AND a.Id > @sinceAssociateId)
      ORDER BY a.WhenUpdated, a.Id
    `;

    const delta = await az.request()
      .input('sinceUpdated', sql.DateTime2, new Date(effectiveSince))
      .input('sinceAssociateId', sql.Int, effectiveId)
      .query(deltaQuery);

    const rows = delta.recordset as DeltaAssociateRow[];
    const ids = rows.map((row) => row.AssociateId);
    const enrichment = await fetchAssociateEnrichment(az, ids);
    const sourceIds = rows.map((row) => String(row.AssociateId));
    const existing = await loadExistingAssociates(pg, sourceIds);

    let newAssociates = 0;
    let editedAssociates = 0;
    let statusChanges = 0;

    for (const row of rows) {
      const sourceId = String(row.AssociateId);
      const current = existing.get(sourceId);

      if (!current) {
        newAssociates += 1;
        continue;
      }

      const incomingFirstName = normalizeText(row.FirstName);
      const incomingLastName = normalizeText(row.LastName);
      const incomingFullName = normalizeText(buildFullName(row.FirstName, row.LastName));
      const incomingNationalId = normalizeText(row.NationalId);
      const incomingFfc = normalizeText(row.FFCNumber);
      const incomingStatus = normalizeStatus(statusFromId(row.AssociateStatusId));

      const profileChanged =
        incomingFirstName !== normalizeText(current.first_name) ||
        incomingLastName !== normalizeText(current.last_name) ||
        incomingFullName !== normalizeText(current.full_name) ||
        incomingNationalId !== normalizeText(current.national_id) ||
        incomingFfc !== normalizeText(current.ffc_number);

      const statusChanged = incomingStatus !== normalizeStatus(current.status_name);

      if (profileChanged) editedAssociates += 1;
      if (statusChanged) statusChanges += 1;
    }

    console.log('============================================================');
    console.log('KWSA Associate Incremental Sync');
    console.log('============================================================');
    console.log(`sync-name      : ${SYNC_NAME}`);
    console.log(`since          : ${effectiveSince}`);
    console.log(`since-id       : ${effectiveId}`);
    console.log(`dry-run        : ${dryRun}`);
    console.log(`delta rows     : ${rows.length}`);
    console.log(`new associates : ${newAssociates}`);
    console.log(`edited profiles: ${editedAssociates}`);
    console.log(`status changes : ${statusChanges}`);
    console.log('============================================================');

    if (rows.length > 0) {
      const preview = rows.slice(0, 10).map((row) => ({
        associate_id: row.AssociateId,
        full_name: buildFullName(row.FirstName, row.LastName),
        status_id: row.AssociateStatusId,
        when_updated: row.WhenUpdated,
      }));
      console.table(preview);
    }

    if (dryRun) {
      console.log('Dry run only. No associates were imported.');
      return;
    }

    let processed = 0;
    let lastUpdatedAt = effectiveSince;
    let lastAssociateId = effectiveId;

    for (const row of rows) {
      await upsertAssociate(pg, row, enrichment);
      processed += 1;
      lastUpdatedAt = new Date(row.WhenUpdated).toISOString();
      lastAssociateId = row.AssociateId;
      await saveCheckpoint(pg, SYNC_NAME, lastUpdatedAt, lastAssociateId, processed);
    }

    console.log('\nIncremental associate sync completed successfully.');
    console.log(`Processed: ${processed}`);
    console.log(`Checkpoint: ${lastUpdatedAt} / ${lastAssociateId}`);
  } finally {
    await az.close();
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Incremental associate sync failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
