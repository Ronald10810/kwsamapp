import { Router } from 'express';
import { env } from '../config/env.js';
import { getOptionalPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { getReportAccessSnapshot, REPORT_KEYS, requireReportAccess } from '../services/reportAccess.js';
import { queryLiveReportingShadowSummary } from '../services/liveReportingEvents.js';
import { salesOnlyTransactionExclusionSql, transactionAgentCalculationDedupCte } from './reportingSql.js';
import { getAppTimeZone, getFirstOfMonthInAppTimeZone, getTodayInAppTimeZone } from '../utils/timeZone.js';

const router = Router();
const pool = getOptionalPgPool();

type MCRow = {
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  total_gci: number;
  growth_share: number;
  royalties: number;
  company_dollar: number;
  cos_to_gci_pct: number;
  associate_dollar: number;
  team_dollar: number;
};

type MonthEndExtendedFilterOptions = {
  statuses: string[];
  sale_types: string[];
  market_centers: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  associates: Array<{ id: string; name: string; team_id: string; market_center_id: string; market_center_name: string }>;
};

type MonthEndSummaryRow = {
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  sales_price: number;
  mc_sales_volume: number;
  list_price: number;
  contract_gci: number;
  gci: number;
  royalties: number;
  growth_share: number;
  associate_dollar: number;
  company_dollar: number;
  team_dollar: number;
};

type MonthEndDetailRow = {
  market_center_name: string;
  mc_source_id: string;
  associate_name: string;
  source_associate_id: string;
  team_name: string;
  source_team_id: string;
  transaction_number: string;
  transaction_date: string | null;
  list_date: string | null;
  status_change_date: string | null;
  kwl_number: string;
  transaction_type: string;
  sale_type: string;
  transaction_status: string;
  suburb: string;
  city: string;
  buyer: string;
  seller: string;
  list_price: number;
  sales_price: number;
  th_split_pct: number;
  agent_sales_volume: number;
  comm_pct: number;
  contract_gci: number;
  total_gci: number;
  royalties: number;
  growth_share: number;
  associate_dollar: number;
  company_dollar: number;
  team_dollar: number;
  cap_remaining: number;
  listing_office: string;
  bond_originator: string;
  bond_attorney: string;
  bond_attorney_email: string;
  bond_attorney_phone: string;
  transfer_attorney: string;
  transfer_attorney_email: string;
  transfer_attorney_phone: string;
};

type CapCycleSnapshot = {
  associate_name: string;
  source_associate_id: string;
  cap_date: string | null;
  cap_amount: number;
  company_dollar: number;
  cap_remaining: number;
  manual_cap: boolean;
};

type CappersView = 'associate' | 'team';

type CappersTeamContribution = {
  associate_name: string;
  source_associate_id: string;
  company_dollar: number;
};

type CappersRegisteredDeal = {
  source_transaction_id: string;
  transaction_number: string;
  transaction_status: string;
  kwl_number: string;
  reporting_date: string | null;
  company_dollar: number;
};

type CappersRow = {
  view: CappersView;
  entity_name: string;
  source_entity_id: string;
  market_center_name: string;
  mc_source_id: string;
  team_name: string;
  cap_date: string | null;
  cap_amount: number;
  cap_achieved: number;
  cap_remaining: number;
  cap_percent_remaining: number;
  months_to_cap_date: number | null;
  manual_cap: boolean;
  team_contributions?: CappersTeamContribution[];
  registered_deals?: CappersRegisteredDeal[];
};

type CappersFilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  associates: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
};

type AssociateReportFilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  statuses: string[];
  roles: string[];
};

type AssociateReportRow = {
  market_center_name: string;
  mc_source_id: string;
  team_name: string;
  team_source_id: string;
  associate_name: string;
  source_associate_id: string;
  status_name: string;
  kw_start_date: string | null;
  end_date: string | null;
  anniversary_date: string | null;
  birthday: string | null;
  birthday_source: 'id_number' | 'unknown';
  mobile_number: string | null;
  associate_email: string | null;
  roles: string;
};

type McDashboardTopAgent = {
  associate_id: string;
  associate_name: string;
  team_name: string;
  registered_gci: number;
  units: number;
};

type McDashboardTopTeam = {
  team_id: string;
  team_name: string;
  registered_gci: number;
  units: number;
  active_agents: number;
};

type McDashboardPerson = {
  associate_id: string;
  associate_name: string;
  team_name: string;
  mobile_number: string | null;
  date: string;
};

type McDashboardData = {
  market_center: {
    source_market_center_id: string;
    name: string;
    logo_image_url: string | null;
    white_logo_image_url: string | null;
  };
  period: {
    date_from: string;
    date_to: string;
    description: string;
  };
  metrics: {
    birthdays_today: number;
    anniversaries_this_month: number;
    new_agents_this_month: number;
    active_agents: number;
    active_listings: number;
    registered_gci: number;
    registered_co_dollars: number;
    registered_units: number;
    registered_contracts: number;
    avg_gci_per_unit: number;
  };
  top_performers: {
    agents: McDashboardTopAgent[];
    teams: McDashboardTopTeam[];
  };
  people: {
    birthdays_today: McDashboardPerson[];
    anniversaries_this_month: McDashboardPerson[];
  };
  _v?: number;
};

const MC_DASHBOARD_SNAPSHOT_VERSION = 9;
const MC_DASHBOARD_ALL_MARKET_CENTERS_ID = '__all__';
const MC_DASHBOARD_ALL_MARKET_CENTERS_LABEL = 'Keller Williams South Africa';

type TopDownAgentFilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  associates: Array<{ id: string; name: string; market_center_id: string; market_center_name: string; team_id: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  transaction_statuses: string[];
  sale_types: string[];
  listing_statuses: string[];
  sale_or_rent_options: string[];
  mandate_types: string[];
};

type TopDownAgentProductionRow = {
  source_associate_id: string;
  associate_name: string;
  team_name: string;
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  total_gci: number;
  growth_share: number;
  royalties: number;
  company_dollar: number;
  associate_dollar: number;
  team_dollar: number;
};

type TopDownAgentListingRow = {
  source_associate_id: string;
  associate_name: string;
  team_name: string;
  market_center_name: string;
  mc_source_id: string;
  total_listings: number;
  active_listings: number;
  for_sale_listings: number;
  for_rent_listings: number;
  total_listing_value: number;
  avg_days_on_market: number;
  avg_listing_price: number;
};

type TopDownAgentTotals = {
  production_contracts: number;
  production_units: number;
  production_gci: number;
  production_royalties: number;
  production_growth_share: number;
  production_company_dollar: number;
  production_associate_dollar: number;
  production_team_dollar: number;
  listings_total: number;
  listings_active: number;
  listings_total_value: number;
};

type ReportingScope = 'GLOBAL' | 'MARKET_CENTRE' | 'TEAM' | 'ASSOCIATE';

type EffectiveReportScope = {
  reportingScope: ReportingScope;
  forcedMarketCentreId: string | null;
  forcedTeamId: string | null;
  forcedAssociateId: string | null;
  forcedAssociateDbId: number | null;
  permittedMarketCentreIds: string[];
  permittedTeamIds: string[];
  permittedAssociateIds: string[];
};

function normalizeView(raw: unknown): CappersView {
  return String(raw ?? '').trim().toLowerCase() === 'team' ? 'team' : 'associate';
}

function parseCsvParam(raw: unknown): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return text.split(',').map((value) => value.trim()).filter(Boolean);
}

function normalizeMonthEndDateBasis(raw: unknown): 'status_change' | 'transaction' {
  return String(raw ?? '').trim().toLowerCase() === 'transaction' ? 'transaction' : 'status_change';
}

export function buildHistoricalReportingDateSql(historicalAlias: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${historicalAlias}.transaction_status, ''))) = 'start'
      THEN COALESCE(${historicalAlias}.transaction_date::date, ${historicalAlias}.effective_reporting_date::date)
    ELSE COALESCE(${historicalAlias}.status_change_date::date, ${historicalAlias}.effective_reporting_date::date)
  END`;
}

function isLiveReportingEventShadowEnabled(): boolean {
  return Boolean(env.reporting.liveEvents.enabled && env.reporting.liveEvents.shadowCompareEnabled);
}

type MonthEndUnifiedFlags = {
  enabled: boolean;
  shadowCompareEnabled: boolean;
  transitionExceptionsEnabled: boolean;
  historicalEnabled: boolean;
  liveEnabled: boolean;
  historicalCorrectionPreviewBatchId: string | null;
};

const MONTH_END_UNIFIED_CUTOVER_DATE = '2026-07-06';
const MONTH_END_HISTORICAL_GAP_FALLBACK_START_DATE = '2026-07-01';
const MONTH_END_HISTORICAL_PROTECTED_END_DATE = '2026-07-03';
const MONTH_END_TRANSITION_EXCEPTION_START_DATE = '2026-07-04';
const MONTH_END_TRANSITION_EXCEPTION_END_DATE = '2026-07-05';

type UnifiedWindow = {
  from: string;
  to: string;
};

type UnifiedSourceWindows = {
  historicalWindow: UnifiedWindow | null;
  transitionExceptionWindow: UnifiedWindow | null;
  liveWindow: UnifiedWindow | null;
};

function windowIntersects(window: UnifiedWindow | null, start: string, end: string): boolean {
  if (!window) return false;
  return window.to >= start && window.from <= end;
}

function shouldUseHistoricalGapFallback(window: UnifiedWindow | null): boolean {
  return windowIntersects(window, MONTH_END_HISTORICAL_GAP_FALLBACK_START_DATE, MONTH_END_HISTORICAL_PROTECTED_END_DATE);
}

function resolveUnifiedSourceWindows(
  dateFrom: string,
  dateTo: string,
  flags: MonthEndUnifiedFlags,
): UnifiedSourceWindows {
  if (!flags.enabled) {
    return {
      historicalWindow: null,
      transitionExceptionWindow: null,
      liveWindow: { from: dateFrom, to: dateTo },
    };
  }

  const pickWindow = (start: string, end: string, enabled: boolean): UnifiedWindow | null => {
    if (!enabled) return null;
    const from = dateFrom > start ? dateFrom : start;
    const to = dateTo < end ? dateTo : end;
    return from <= to ? { from, to } : null;
  };

  return {
    historicalWindow: pickWindow(dateFrom, MONTH_END_HISTORICAL_PROTECTED_END_DATE, flags.historicalEnabled),
    transitionExceptionWindow: pickWindow(MONTH_END_TRANSITION_EXCEPTION_START_DATE, MONTH_END_TRANSITION_EXCEPTION_END_DATE, flags.transitionExceptionsEnabled),
    liveWindow: pickWindow(MONTH_END_UNIFIED_CUTOVER_DATE, dateTo, flags.liveEnabled),
  };
}

function isStrictHistoricalIsolationRequest(dateTo: string): boolean {
  return dateTo <= MONTH_END_HISTORICAL_PROTECTED_END_DATE;
}

function getMonthEndUnifiedFlags(): MonthEndUnifiedFlags {
  const flags = (env.reporting as any)?.monthEndUnified;
  return {
    enabled: Boolean(flags?.enabled),
    shadowCompareEnabled: Boolean(flags?.shadowCompareEnabled),
    transitionExceptionsEnabled: Boolean(flags?.transitionExceptionsEnabled),
    historicalEnabled: flags?.historicalEnabled !== false,
    liveEnabled: flags?.liveEnabled !== false,
    historicalCorrectionPreviewBatchId: typeof flags?.historicalCorrectionPreviewBatchId === 'string'
      ? flags.historicalCorrectionPreviewBatchId
      : null,
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mergeMcRows(rows: MCRow[]): MCRow[] {
  const merged = new Map<string, MCRow>();
  for (const row of rows) {
    const key = `${row.mc_source_id}::${row.market_center_name}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...row });
      continue;
    }

    current.contracts += row.contracts;
    current.units += row.units;
    current.total_gci = round2(current.total_gci + row.total_gci);
    current.growth_share = round2(current.growth_share + row.growth_share);
    current.royalties = round2(current.royalties + row.royalties);
    current.company_dollar = round2(current.company_dollar + row.company_dollar);
    current.associate_dollar = round2(current.associate_dollar + row.associate_dollar);
    current.team_dollar = round2(current.team_dollar + row.team_dollar);
    current.cos_to_gci_pct = current.total_gci > 0 ? round2((current.company_dollar / current.total_gci) * 100) : 0;
  }

  return Array.from(merged.values()).sort((a, b) => b.total_gci - a.total_gci || a.market_center_name.localeCompare(b.market_center_name));
}

function mergeSummaryRows(rows: MonthEndSummaryRow[]): MonthEndSummaryRow[] {
  const merged = new Map<string, MonthEndSummaryRow>();
  for (const row of rows) {
    const key = `${row.mc_source_id}::${row.market_center_name}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...row });
      continue;
    }

    current.contracts += row.contracts;
    current.units += row.units;
    current.sales_price = round2(current.sales_price + row.sales_price);
    current.mc_sales_volume = round2(current.mc_sales_volume + row.mc_sales_volume);
    current.list_price = round2(current.list_price + row.list_price);
    current.contract_gci = round2(current.contract_gci + row.contract_gci);
    current.gci = round2(current.gci + row.gci);
    current.royalties = round2(current.royalties + row.royalties);
    current.growth_share = round2(current.growth_share + row.growth_share);
    current.associate_dollar = round2(current.associate_dollar + row.associate_dollar);
    current.company_dollar = round2(current.company_dollar + row.company_dollar);
    current.team_dollar = round2(current.team_dollar + row.team_dollar);
  }

  return Array.from(merged.values()).sort((a, b) => b.gci - a.gci || a.market_center_name.localeCompare(b.market_center_name));
}

type UnitSideFlags = {
  hasBoth: boolean;
  hasBuyer: boolean;
  hasSeller: boolean;
  hasOther: boolean;
  hasReferral: boolean;
  hasPc: boolean;
};

function updateUnitSideFlags(flags: UnitSideFlags, rawSide: string | null | undefined): void {
  const side = normalizeIdToken(rawSide);
  if (!side) return;
  if (side.includes('both')) flags.hasBoth = true;
  if (side.includes('buyer')) flags.hasBuyer = true;
  if (side.includes('seller')) flags.hasSeller = true;
  if (side.includes('other')) flags.hasOther = true;
  if (side.includes('referral')) flags.hasReferral = true;
  if (side.includes('pc')) flags.hasPc = true;
}

function resolveUnitContribution(flags: UnitSideFlags): number {
  if (flags.hasBoth) return 2;
  if (flags.hasBuyer && flags.hasSeller) return 2;
  if (flags.hasBuyer || flags.hasSeller) return 1;
  if (flags.hasOther || flags.hasReferral || flags.hasPc) return 1;
  return 0;
}

function aggregateDetailRowsToMcRows(detailRows: MonthEndDetailRow[]): MCRow[] {
  const grouped = new Map<string, {
    market_center_name: string;
    mc_source_id: string;
    txSides: Map<string, UnitSideFlags>;
    total_gci: number;
    growth_share: number;
    royalties: number;
    company_dollar: number;
    associate_dollar: number;
    team_dollar: number;
  }>();

  for (const row of detailRows) {
    const market_center_name = (row.market_center_name || '').trim() || 'Unassigned / Unknown';
    const mc_source_id = (row.mc_source_id || '').trim();
    const key = `${mc_source_id}::${market_center_name}`;
    const txKey = (row.transaction_number || '').trim()
      || `${row.kwl_number}|${row.transaction_date ?? ''}|${row.status_change_date ?? ''}|${row.associate_name}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        market_center_name,
        mc_source_id,
        txSides: new Map<string, UnitSideFlags>(),
        total_gci: 0,
        growth_share: 0,
        royalties: 0,
        company_dollar: 0,
        associate_dollar: 0,
        team_dollar: 0,
      });
    }

    const bucket = grouped.get(key)!;
    const sideFlags = bucket.txSides.get(txKey) ?? {
      hasBoth: false,
      hasBuyer: false,
      hasSeller: false,
      hasOther: false,
      hasReferral: false,
      hasPc: false,
    };
    updateUnitSideFlags(sideFlags, row.transaction_type);
    bucket.txSides.set(txKey, sideFlags);

    bucket.total_gci = round2(bucket.total_gci + Number(row.total_gci || 0));
    bucket.growth_share = round2(bucket.growth_share + Number(row.growth_share || 0));
    bucket.royalties = round2(bucket.royalties + Number(row.royalties || 0));
    bucket.company_dollar = round2(bucket.company_dollar + Number(row.company_dollar || 0));
    bucket.associate_dollar = round2(bucket.associate_dollar + Number(row.associate_dollar || 0));
    bucket.team_dollar = round2(bucket.team_dollar + Number(row.team_dollar || 0));
  }

  const rows: MCRow[] = [];
  for (const bucket of grouped.values()) {
    let units = 0;
    for (const flags of bucket.txSides.values()) {
      units += resolveUnitContribution(flags);
    }

    rows.push({
      market_center_name: bucket.market_center_name,
      mc_source_id: bucket.mc_source_id,
      contracts: bucket.txSides.size,
      units,
      total_gci: round2(bucket.total_gci),
      growth_share: round2(bucket.growth_share),
      royalties: round2(bucket.royalties),
      company_dollar: round2(bucket.company_dollar),
      cos_to_gci_pct: bucket.total_gci > 0 ? round2((bucket.company_dollar / bucket.total_gci) * 100) : 0,
      associate_dollar: round2(bucket.associate_dollar),
      team_dollar: round2(bucket.team_dollar),
    });
  }

  return rows.sort((a, b) => b.total_gci - a.total_gci || a.market_center_name.localeCompare(b.market_center_name));
}

function aggregateDetailRowsToSummaryRows(detailRows: MonthEndDetailRow[]): MonthEndSummaryRow[] {
  const grouped = new Map<string, {
    market_center_name: string;
    mc_source_id: string;
    txSides: Map<string, UnitSideFlags>;
    txPrices: Map<string, { list_price: number; sales_price: number }>;
    contract_gci: number;
    gci: number;
    royalties: number;
    growth_share: number;
    associate_dollar: number;
    company_dollar: number;
    team_dollar: number;
  }>();

  for (const row of detailRows) {
    const market_center_name = (row.market_center_name || '').trim() || 'Unassigned / Unknown';
    const mc_source_id = (row.mc_source_id || '').trim();
    const key = `${mc_source_id}::${market_center_name}`;
    const txKey = (row.transaction_number || '').trim()
      || `${row.kwl_number}|${row.transaction_date ?? ''}|${row.status_change_date ?? ''}|${row.associate_name}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        market_center_name,
        mc_source_id,
        txSides: new Map<string, UnitSideFlags>(),
        txPrices: new Map<string, { list_price: number; sales_price: number }>(),
        contract_gci: 0,
        gci: 0,
        royalties: 0,
        growth_share: 0,
        associate_dollar: 0,
        company_dollar: 0,
        team_dollar: 0,
      });
    }

    const bucket = grouped.get(key)!;
    const sideFlags = bucket.txSides.get(txKey) ?? {
      hasBoth: false,
      hasBuyer: false,
      hasSeller: false,
      hasOther: false,
      hasReferral: false,
      hasPc: false,
    };
    updateUnitSideFlags(sideFlags, row.transaction_type);
    bucket.txSides.set(txKey, sideFlags);

    const existingPrice = bucket.txPrices.get(txKey) ?? { list_price: 0, sales_price: 0 };
    existingPrice.list_price = Math.max(existingPrice.list_price, Number(row.list_price || 0));
    existingPrice.sales_price = Math.max(existingPrice.sales_price, Number(row.sales_price || 0));
    bucket.txPrices.set(txKey, existingPrice);

    bucket.contract_gci = round2(bucket.contract_gci + Number(row.contract_gci || 0));
    bucket.gci = round2(bucket.gci + Number(row.total_gci || 0));
    bucket.royalties = round2(bucket.royalties + Number(row.royalties || 0));
    bucket.growth_share = round2(bucket.growth_share + Number(row.growth_share || 0));
    bucket.associate_dollar = round2(bucket.associate_dollar + Number(row.associate_dollar || 0));
    bucket.company_dollar = round2(bucket.company_dollar + Number(row.company_dollar || 0));
    bucket.team_dollar = round2(bucket.team_dollar + Number(row.team_dollar || 0));
  }

  const rows: MonthEndSummaryRow[] = [];
  for (const bucket of grouped.values()) {
    let units = 0;
    let sales_price = 0;
    let list_price = 0;
    for (const [txKey, flags] of bucket.txSides.entries()) {
      units += resolveUnitContribution(flags);
      const prices = bucket.txPrices.get(txKey);
      if (prices) {
        sales_price = round2(sales_price + prices.sales_price);
        list_price = round2(list_price + prices.list_price);
      }
    }

    rows.push({
      market_center_name: bucket.market_center_name,
      mc_source_id: bucket.mc_source_id,
      contracts: bucket.txSides.size,
      units,
      sales_price,
      mc_sales_volume: sales_price,
      list_price,
      contract_gci: round2(bucket.contract_gci),
      gci: round2(bucket.gci),
      royalties: round2(bucket.royalties),
      growth_share: round2(bucket.growth_share),
      associate_dollar: round2(bucket.associate_dollar),
      company_dollar: round2(bucket.company_dollar),
      team_dollar: round2(bucket.team_dollar),
    });
  }

  return rows.sort((a, b) => b.gci - a.gci || a.market_center_name.localeCompare(b.market_center_name));
}

function normalizeIdToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function filterByMarketCenterIds<T extends { mc_source_id: string }>(rows: T[], marketCenterIds: string[]): T[] {
  if (marketCenterIds.length === 0) return rows;
  const allowed = new Set(marketCenterIds.map((id) => normalizeIdToken(id)).filter(Boolean));
  return rows.filter((row) => allowed.has(normalizeIdToken(row.mc_source_id)));
}

async function fetchHistoricalMonthEndRows(
  dateFrom: string,
  dateTo: string,
  transactionStatuses: string[],
  saleTypes: string[],
  previewBatchId: string | null,
  includeContractsCount = true,
): Promise<{ rows: MCRow[]; contracts: number }> {
  if (!pool) return { rows: [], contracts: 0 };

  const previewLiteral = previewBatchId ? `'${previewBatchId.replace(/'/g, "''")}'` : 'NULL';
  const result = await pool.query<{
    market_center_name: string;
    mc_source_id: string;
    contracts: string;
    units: string;
    total_gci: string;
    growth_share: string;
    royalties: string;
    company_dollar: string;
    associate_dollar: string;
    team_dollar: string;
  }>(
    `
    WITH preview_batch AS (
      SELECT rb.id
      FROM migration.reporting_reconciliation_batch rb
      WHERE rb.batch_id = ${previewLiteral}
      ORDER BY rb.id DESC
      LIMIT 1
    ),
    preview_supersessions AS (
      SELECT
        hs.original_historical_fact_id,
        hs.replacement_historical_fact_id
      FROM migration.historical_supersession_ledger hs
      INNER JOIN preview_batch pb
        ON pb.id = hs.correction_batch_id
    ),
    historical_effective_facts AS (
      SELECT
        h.*,
        COALESCE(NULLIF(h.sale_type, ''), NULLIF(ct_hist.sale_type, ''), '') AS effective_sale_type,
        COALESCE(NULLIF(TRIM(h.market_center_label), ''), 'Unassigned / Unknown') AS canonical_market_center_name
      FROM migration.historical_reporting_fact h
      LEFT JOIN migration.core_transactions ct_hist
        ON NULLIF(TRIM(COALESCE(h.transaction_number, '')), '') = NULLIF(TRIM(COALESCE(ct_hist.transaction_number, '')), '')
      LEFT JOIN preview_supersessions ps_original
        ON ps_original.original_historical_fact_id = h.id
      LEFT JOIN preview_supersessions ps_replacement
        ON ps_replacement.replacement_historical_fact_id = h.id
      WHERE COALESCE(LOWER(TRIM(h.reconciliation_status)), 'exact') <> 'invalid'
        AND (ps_original.original_historical_fact_id IS NULL)
        AND (
          ${previewLiteral} IS NULL
          OR h.reconciliation_batch_id IS DISTINCT FROM (SELECT id FROM preview_batch)
          OR ps_replacement.replacement_historical_fact_id IS NOT NULL
        )
    )
    SELECT
      h.canonical_market_center_name AS market_center_name,
      COALESCE(
        MIN(NULLIF(TRIM(COALESCE(h.source_market_center_id, '')), '')),
        ''
      ) AS mc_source_id,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(h.transaction_number, '')), ''))::text AS contracts,
      ROUND(COALESCE(SUM(COALESCE(h.unit_contribution, 0)), 0)::numeric, 0)::text AS units,
      ROUND(COALESCE(SUM(COALESCE(h.total_gci, 0)), 0)::numeric, 2)::text AS total_gci,
      ROUND(COALESCE(SUM(COALESCE(h.growth_share, 0)), 0)::numeric, 2)::text AS growth_share,
      ROUND(COALESCE(SUM(COALESCE(h.royalty, 0)), 0)::numeric, 2)::text AS royalties,
      ROUND(COALESCE(SUM(COALESCE(h.company_dollar, 0)), 0)::numeric, 2)::text AS company_dollar,
      ROUND(COALESCE(SUM(COALESCE(h.associate_dollar, 0)), 0)::numeric, 2)::text AS associate_dollar,
      ROUND(COALESCE(SUM(COALESCE(h.team_dollar, 0)), 0)::numeric, 2)::text AS team_dollar
    FROM historical_effective_facts h
    WHERE ${buildHistoricalReportingDateSql('h')} >= $1::date
      AND ${buildHistoricalReportingDateSql('h')} <= $2::date
      AND (
        CARDINALITY($3::text[]) = 0
        OR EXISTS (
          SELECT 1 FROM UNNEST($3::text[]) AS selected_status
          WHERE LOWER(TRIM(COALESCE(h.transaction_status, ''))) = LOWER(TRIM(selected_status))
        )
      )
      AND (
        CARDINALITY($4::text[]) = 0
        OR EXISTS (
          SELECT 1 FROM UNNEST($4::text[]) AS selected_sale_type
          WHERE LOWER(TRIM(COALESCE(h.effective_sale_type, ''))) = LOWER(TRIM(selected_sale_type))
        )
      )
    GROUP BY h.canonical_market_center_name
    ORDER BY ROUND(COALESCE(SUM(COALESCE(h.total_gci, 0)), 0)::numeric, 2) DESC, market_center_name ASC
    `,
    [dateFrom, dateTo, transactionStatuses, saleTypes],
  );

  const contractsResult = includeContractsCount
    ? await pool.query<{ contracts: string }>(
      `
      WITH preview_batch AS (
        SELECT rb.id
        FROM migration.reporting_reconciliation_batch rb
        WHERE rb.batch_id = ${previewLiteral}
        ORDER BY rb.id DESC
        LIMIT 1
      ),
      preview_supersessions AS (
        SELECT
          hs.original_historical_fact_id,
          hs.replacement_historical_fact_id
        FROM migration.historical_supersession_ledger hs
        INNER JOIN preview_batch pb
          ON pb.id = hs.correction_batch_id
      ),
      historical_effective_facts AS (
        SELECT
          h.*,
          COALESCE(
            NULLIF(h.sale_type, ''),
            NULLIF(ct_hist.sale_type, ''),
            ''
          ) AS effective_sale_type
        FROM migration.historical_reporting_fact h
        LEFT JOIN migration.core_transactions ct_hist
          ON NULLIF(TRIM(COALESCE(h.transaction_number, '')), '') = NULLIF(TRIM(COALESCE(ct_hist.transaction_number, '')), '')
        LEFT JOIN preview_supersessions ps_original
          ON ps_original.original_historical_fact_id = h.id
        LEFT JOIN preview_supersessions ps_replacement
          ON ps_replacement.replacement_historical_fact_id = h.id
        WHERE COALESCE(LOWER(TRIM(h.reconciliation_status)), 'exact') <> 'invalid'
          AND (ps_original.original_historical_fact_id IS NULL)
          AND (
            ${previewLiteral} IS NULL
            OR h.reconciliation_batch_id IS DISTINCT FROM (SELECT id FROM preview_batch)
            OR ps_replacement.replacement_historical_fact_id IS NOT NULL
          )
      )
      SELECT COUNT(DISTINCT COALESCE(
        NULLIF(TRIM(COALESCE(h.source_transaction_id, '')), ''),
        NULLIF(TRIM(COALESCE(h.transaction_number, '')), '')
      ))::text AS contracts
      FROM historical_effective_facts h
      WHERE ${buildHistoricalReportingDateSql('h')} >= $1::date
        AND ${buildHistoricalReportingDateSql('h')} <= $2::date
        AND (
          CARDINALITY($3::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM UNNEST($3::text[]) AS selected_status
            WHERE LOWER(TRIM(COALESCE(h.transaction_status, ''))) = LOWER(TRIM(selected_status))
          )
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM UNNEST($4::text[]) AS selected_sale_type
            WHERE LOWER(TRIM(COALESCE(h.effective_sale_type, ''))) = LOWER(TRIM(selected_sale_type))
          )
        )
      `,
      [dateFrom, dateTo, transactionStatuses, saleTypes],
    )
    : { rows: [{ contracts: '0' }] };

  const rows: MCRow[] = result.rows.map((row) => {
    const anyRow = row as Record<string, unknown>;
    const marketCenterName = String(anyRow.market_center_name ?? 'Unassigned / Unknown');
    const mcSourceId = String(anyRow.mc_source_id ?? '');
    const totalGci = Number(anyRow.total_gci ?? anyRow.gci ?? 0);
    const companyDollar = Number(anyRow.company_dollar ?? 0);

    return {
      market_center_name: marketCenterName,
      mc_source_id: mcSourceId,
      contracts: Number(anyRow.contracts ?? 0),
      units: Number(anyRow.units ?? 0),
      total_gci: totalGci,
      growth_share: Number(anyRow.growth_share ?? 0),
      royalties: Number(anyRow.royalties ?? 0),
      company_dollar: companyDollar,
      cos_to_gci_pct: totalGci > 0 ? round2((companyDollar / totalGci) * 100) : 0,
      associate_dollar: Number(anyRow.associate_dollar ?? 0),
      team_dollar: Number(anyRow.team_dollar ?? 0),
    };
  });

  return {
    rows,
    contracts: Number(contractsResult.rows[0]?.contracts ?? 0),
  };
}

async function fetchTransitionExceptionMonthEndRows(
  dateFrom: string,
  dateTo: string,
  transactionStatuses: string[],
  saleTypes: string[],
): Promise<{ rows: MCRow[]; contracts: number }> {
  if (!pool) return { rows: [], contracts: 0 };

  const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
    NULLIF(ct.sale_type, ''),
    CASE
      WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
      ELSE NULLIF(ct.transaction_type, '')
    END,
    ''
  )))`;

  const result = await pool.query<{
    market_center_name: string;
    mc_source_id: string;
    contracts: string;
    units: string;
    total_gci: string;
    growth_share: string;
    royalties: string;
    company_dollar: string;
    associate_dollar: string;
    team_dollar: string;
  }>(
    `
    WITH ${transactionAgentCalculationDedupCte},
    base AS (
      SELECT
        tac.transaction_id,
        COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
        COALESCE(tac.growth_share, 0)::numeric(18,2) AS growth_share,
        COALESCE(tac.production_royalties, 0)::numeric(18,2) AS royalties,
        COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
        COALESCE(tac.associate_dollar, 0)::numeric(18,2) AS associate_dollar,
        COALESCE(tac.team_dollar, 0)::numeric(18,2) AS team_dollar,
        COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side
      FROM tac_dedup tac
      JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
      LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
      LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
      WHERE ct.transaction_date::date >= $1::date
        AND ct.transaction_date::date <= $2::date
        AND ca.id IS NOT NULL
        AND ${salesOnlyTransactionExclusionSql}
        AND (
          CARDINALITY($3::text[]) = 0
          OR ${buildRegisteredOnlyOrSelectedStatusSql('ct', '$3::text[]')}
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($4::text[]) AS selected_sale_type
            WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
          )
        )
    ),
    per_tx AS (
      SELECT
        transaction_id,
        COALESCE(market_center_name, 'Unassigned / Unknown') AS market_center_name,
        COALESCE(mc_source_id, '') AS mc_source_id,
        CASE
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') THEN 1
          ELSE 0
        END::int AS units,
        SUM(total_gci)::numeric(18,2) AS total_gci,
        SUM(growth_share)::numeric(18,2) AS growth_share,
        SUM(royalties)::numeric(18,2) AS royalties,
        SUM(company_dollar)::numeric(18,2) AS company_dollar,
        SUM(associate_dollar)::numeric(18,2) AS associate_dollar,
        SUM(team_dollar)::numeric(18,2) AS team_dollar
      FROM base
      GROUP BY transaction_id, COALESCE(market_center_name, 'Unassigned / Unknown'), COALESCE(mc_source_id, '')
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
      FROM per_tx
      GROUP BY market_center_name, mc_source_id
    )
    SELECT
      market_center_name,
      mc_source_id,
      contracts::text,
      units::text,
      total_gci::text,
      growth_share::text,
      royalties::text,
      company_dollar::text,
      associate_dollar::text,
      team_dollar::text
    FROM by_mc
    ORDER BY total_gci DESC, market_center_name ASC
    `,
    [dateFrom, dateTo, transactionStatuses, saleTypes],
  );

  const rows: MCRow[] = result.rows.map((row) => {
    const totalGci = Number(row.total_gci);
    const companyDollar = Number(row.company_dollar);
    return {
      market_center_name: row.market_center_name,
      mc_source_id: row.mc_source_id,
      contracts: Number(row.contracts),
      units: Number(row.units),
      total_gci: totalGci,
      growth_share: Number(row.growth_share),
      royalties: Number(row.royalties),
      company_dollar: companyDollar,
      cos_to_gci_pct: totalGci > 0 ? round2((companyDollar / totalGci) * 100) : 0,
      associate_dollar: Number(row.associate_dollar),
      team_dollar: Number(row.team_dollar),
    };
  });

  return {
    rows,
    contracts: rows.reduce((sum, row) => sum + row.contracts, 0),
  };
}

async function fetchHistoricalGapFallbackMonthEndRows(
  dateFrom: string,
  dateTo: string,
  transactionStatuses: string[],
  saleTypes: string[],
): Promise<{ rows: MCRow[]; contracts: number }> {
  if (!pool) return { rows: [], contracts: 0 };

  const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
    NULLIF(ct.sale_type, ''),
    CASE
      WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
      ELSE NULLIF(ct.transaction_type, '')
    END,
    ''
  )))`;

  const result = await pool.query<{
    market_center_name: string;
    mc_source_id: string;
    contracts: string;
    units: string;
    total_gci: string;
    growth_share: string;
    royalties: string;
    company_dollar: string;
    associate_dollar: string;
    team_dollar: string;
  }>(
    `
    WITH historical_keys AS (
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(h.source_transaction_id), ''), NULLIF(TRIM(h.transaction_number), ''), NULLIF(TRIM(h.raw_transaction_number), '')) AS tx_key
      FROM migration.historical_reporting_fact h
      WHERE ${buildHistoricalReportingDateSql('h')} >= $1::date
        AND ${buildHistoricalReportingDateSql('h')} <= $2::date
        AND (
          CARDINALITY($3::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM UNNEST($3::text[]) AS selected_status
            WHERE LOWER(TRIM(COALESCE(h.transaction_status, ''))) = LOWER(TRIM(selected_status))
          )
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM UNNEST($4::text[]) AS selected_sale_type
            WHERE LOWER(TRIM(COALESCE(h.sale_type, ''))) = LOWER(TRIM(selected_sale_type))
          )
        )
    ),
    ${transactionAgentCalculationDedupCte},
    base AS (
      SELECT
        tac.transaction_id,
        COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
        COALESCE(tac.growth_share, 0)::numeric(18,2) AS growth_share,
        COALESCE(tac.production_royalties, 0)::numeric(18,2) AS royalties,
        COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
        COALESCE(tac.associate_dollar, 0)::numeric(18,2) AS associate_dollar,
        COALESCE(tac.team_dollar, 0)::numeric(18,2) AS team_dollar,
        COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side
      FROM tac_dedup tac
      JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
      LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
      LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
      WHERE ct.transaction_date::date >= $1::date
        AND ct.transaction_date::date <= $2::date
        AND ca.id IS NOT NULL
        AND ${salesOnlyTransactionExclusionSql}
        AND (
          CARDINALITY($3::text[]) = 0
          OR ${buildRegisteredOnlyOrSelectedStatusSql('ct', '$3::text[]')}
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($4::text[]) AS selected_sale_type
            WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM historical_keys hk
          WHERE hk.tx_key = COALESCE(NULLIF(TRIM(ct.source_transaction_id), ''), NULLIF(TRIM(ct.transaction_number), ''), ct.id::text)
        )
    ),
    per_tx AS (
      SELECT
        transaction_id,
        COALESCE(market_center_name, 'Unassigned / Unknown') AS market_center_name,
        COALESCE(mc_source_id, '') AS mc_source_id,
        CASE
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') THEN 1
          ELSE 0
        END::int AS units,
        SUM(total_gci)::numeric(18,2) AS total_gci,
        SUM(growth_share)::numeric(18,2) AS growth_share,
        SUM(royalties)::numeric(18,2) AS royalties,
        SUM(company_dollar)::numeric(18,2) AS company_dollar,
        SUM(associate_dollar)::numeric(18,2) AS associate_dollar,
        SUM(team_dollar)::numeric(18,2) AS team_dollar
      FROM base
      GROUP BY transaction_id, COALESCE(market_center_name, 'Unassigned / Unknown'), COALESCE(mc_source_id, '')
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
      FROM per_tx
      GROUP BY market_center_name, mc_source_id
    )
    SELECT
      market_center_name,
      mc_source_id,
      contracts::text,
      units::text,
      total_gci::text,
      growth_share::text,
      royalties::text,
      company_dollar::text,
      associate_dollar::text,
      team_dollar::text
    FROM by_mc
    ORDER BY total_gci DESC, market_center_name ASC
    `,
    [dateFrom, dateTo, transactionStatuses, saleTypes],
  );

  const rows: MCRow[] = result.rows.map((row) => {
    const totalGci = Number(row.total_gci);
    const companyDollar = Number(row.company_dollar);
    return {
      market_center_name: row.market_center_name,
      mc_source_id: row.mc_source_id,
      contracts: Number(row.contracts),
      units: Number(row.units),
      total_gci: totalGci,
      growth_share: Number(row.growth_share),
      royalties: Number(row.royalties),
      company_dollar: companyDollar,
      cos_to_gci_pct: totalGci > 0 ? round2((companyDollar / totalGci) * 100) : 0,
      associate_dollar: Number(row.associate_dollar),
      team_dollar: Number(row.team_dollar),
    };
  });

  return {
    rows,
    contracts: rows.reduce((sum, row) => sum + row.contracts, 0),
  };
}

type HistoricalDetailUnitRow = {
  transaction_id: string;
  transaction_number: string;
  mc_source_id: string;
  unit_side: string;
  unit_contribution: number;
  list_price: number;
  sales_price: number;
};

async function fetchHistoricalMonthEndDetailRows(
  dateFrom: string,
  dateTo: string,
  transactionStatuses: string[],
  saleTypes: string[],
  previewBatchId: string | null,
): Promise<{ rows: MonthEndDetailRow[]; unitRows: HistoricalDetailUnitRow[] }> {
  if (!pool) return { rows: [], unitRows: [] };

  const previewLiteral = previewBatchId ? `'${previewBatchId.replace(/'/g, "''")}'` : 'NULL';
  const result = await pool.query<{
    transaction_id: string;
    market_center_name: string;
    mc_source_id: string;
    associate_name: string;
    source_associate_id: string;
    team_name: string;
    source_team_id: string;
    transaction_number: string;
    raw_transaction_number: string;
    transaction_date: string | null;
    status_change_date: string | null;
    transaction_type: string;
    sale_type: string;
    transaction_status: string;
    list_price: string;
    sales_price: string;
    th_split_pct: string;
    agent_sales_volume: string;
    contract_gci: string;
    total_gci: string;
    royalties: string;
    growth_share: string;
    associate_dollar: string;
    company_dollar: string;
    team_dollar: string;
    unit_side: string;
    unit_contribution: string;
  }>(
    `
    WITH preview_batch AS (
      SELECT rb.id
      FROM migration.reporting_reconciliation_batch rb
      WHERE rb.batch_id = ${previewLiteral}
      ORDER BY rb.id DESC
      LIMIT 1
    ),
    preview_supersessions AS (
      SELECT
        hs.original_historical_fact_id,
        hs.replacement_historical_fact_id
      FROM migration.historical_supersession_ledger hs
      INNER JOIN preview_batch pb
        ON pb.id = hs.correction_batch_id
    ),
    historical_effective_facts AS (
      SELECT
        h.*,
        COALESCE(NULLIF(h.sale_type, ''), NULLIF(ct_hist.sale_type, ''), '') AS effective_sale_type,
        COALESCE(NULLIF(TRIM(h.market_center_label), ''), 'Unassigned / Unknown') AS canonical_market_center_name
      FROM migration.historical_reporting_fact h
      LEFT JOIN migration.core_transactions ct_hist
        ON NULLIF(TRIM(COALESCE(h.transaction_number, '')), '') = NULLIF(TRIM(COALESCE(ct_hist.transaction_number, '')), '')
      LEFT JOIN preview_supersessions ps_original
        ON ps_original.original_historical_fact_id = h.id
      LEFT JOIN preview_supersessions ps_replacement
        ON ps_replacement.replacement_historical_fact_id = h.id
      WHERE COALESCE(LOWER(TRIM(h.reconciliation_status)), 'exact') <> 'invalid'
        AND (ps_original.original_historical_fact_id IS NULL)
        AND (
          ${previewLiteral} IS NULL
          OR h.reconciliation_batch_id IS DISTINCT FROM (SELECT id FROM preview_batch)
          OR ps_replacement.replacement_historical_fact_id IS NOT NULL
        )
    )
    SELECT
      COALESCE(
        NULLIF(TRIM(COALESCE(h.transaction_number, '')), ''),
        NULLIF(TRIM(COALESCE(h.raw_transaction_number, '')), ''),
        NULLIF(TRIM(COALESCE(h.source_transaction_id, '')), ''),
        'historical-unknown'
      ) AS transaction_id,
      h.canonical_market_center_name AS market_center_name,
      COALESCE(NULLIF(TRIM(COALESCE(h.source_market_center_id, '')), ''), '') AS mc_source_id,
      COALESCE(NULLIF(TRIM(COALESCE(h.associate_label, '')), ''), 'Unknown Associate') AS associate_name,
      COALESCE(NULLIF(TRIM(COALESCE(h.source_associate_id, '')), ''), '') AS source_associate_id,
      COALESCE(NULLIF(TRIM(COALESCE(h.team_label, '')), ''), 'No Team') AS team_name,
      COALESCE(NULLIF(TRIM(COALESCE(h.source_team_id, '')), ''), '') AS source_team_id,
      COALESCE(NULLIF(TRIM(COALESCE(h.transaction_number, '')), ''), '') AS transaction_number,
      COALESCE(NULLIF(TRIM(COALESCE(h.raw_transaction_number, '')), ''), '') AS raw_transaction_number,
      h.transaction_date::date::text AS transaction_date,
      h.status_change_date::date::text AS status_change_date,
      COALESCE(NULLIF(TRIM(COALESCE(h.transaction_side, '')), ''), 'Unspecified') AS transaction_type,
      COALESCE(NULLIF(TRIM(COALESCE(h.effective_sale_type, '')), ''), '') AS sale_type,
      COALESCE(NULLIF(TRIM(COALESCE(h.transaction_status, '')), ''), '') AS transaction_status,
      COALESCE(h.list_price, 0)::numeric(18,2)::text AS list_price,
      COALESCE(h.sales_price, 0)::numeric(18,2)::text AS sales_price,
      COALESCE(h.split_percentage, 0)::numeric(18,4)::text AS th_split_pct,
      COALESCE(h.agent_sales_volume, COALESCE(h.volume_contribution, 0), 0)::numeric(18,2)::text AS agent_sales_volume,
      COALESCE(h.contract_gci, h.total_gci, 0)::numeric(18,2)::text AS contract_gci,
      COALESCE(h.total_gci, 0)::numeric(18,2)::text AS total_gci,
      COALESCE(h.royalty, 0)::numeric(18,2)::text AS royalties,
      COALESCE(h.growth_share, 0)::numeric(18,2)::text AS growth_share,
      COALESCE(h.associate_dollar, 0)::numeric(18,2)::text AS associate_dollar,
      COALESCE(h.company_dollar, 0)::numeric(18,2)::text AS company_dollar,
      COALESCE(h.team_dollar, 0)::numeric(18,2)::text AS team_dollar,
      COALESCE(NULLIF(TRIM(COALESCE(h.transaction_side, '')), ''), 'Unspecified') AS unit_side
      ,COALESCE(h.unit_contribution, 0)::numeric(18,4)::text AS unit_contribution
    FROM historical_effective_facts h
    WHERE ${buildHistoricalReportingDateSql('h')} >= $1::date
      AND ${buildHistoricalReportingDateSql('h')} <= $2::date
      AND (
        CARDINALITY($3::text[]) = 0
        OR EXISTS (
          SELECT 1 FROM UNNEST($3::text[]) AS selected_status
          WHERE LOWER(TRIM(COALESCE(h.transaction_status, ''))) = LOWER(TRIM(selected_status))
        )
      )
      AND (
        CARDINALITY($4::text[]) = 0
        OR EXISTS (
          SELECT 1 FROM UNNEST($4::text[]) AS selected_sale_type
          WHERE LOWER(TRIM(COALESCE(h.effective_sale_type, ''))) = LOWER(TRIM(selected_sale_type))
        )
      )
    ORDER BY h.canonical_market_center_name ASC, COALESCE(h.transaction_number, '') ASC, COALESCE(h.associate_label, '') ASC, h.id ASC
    `,
    [dateFrom, dateTo, transactionStatuses, saleTypes],
  );

  const rows: MonthEndDetailRow[] = result.rows.map((row) => {
    const salesPrice = Number(row.sales_price);
    const agentSalesVolume = Number(row.agent_sales_volume);
    const totalGci = Number(row.total_gci);
    const commPct = agentSalesVolume > 0 ? round2((totalGci / agentSalesVolume) * 100) : 0;

    return {
      market_center_name: row.market_center_name,
      mc_source_id: row.mc_source_id,
      associate_name: row.associate_name,
      source_associate_id: row.source_associate_id,
      team_name: row.team_name,
      source_team_id: row.source_team_id,
      transaction_number: row.transaction_number,
      transaction_date: row.transaction_date,
      list_date: null,
      status_change_date: row.status_change_date,
      kwl_number: '',
      transaction_type: row.transaction_type,
      sale_type: row.sale_type,
      transaction_status: row.transaction_status,
      suburb: '',
      city: '',
      buyer: '',
      seller: '',
      list_price: Number(row.list_price),
      sales_price: salesPrice,
      th_split_pct: Number(row.th_split_pct),
      agent_sales_volume: agentSalesVolume,
      comm_pct: commPct,
      contract_gci: Number(row.contract_gci),
      total_gci: totalGci,
      royalties: Number(row.royalties),
      growth_share: Number(row.growth_share),
      associate_dollar: Number(row.associate_dollar),
      company_dollar: Number(row.company_dollar),
      team_dollar: Number(row.team_dollar),
      cap_remaining: 0,
      listing_office: row.market_center_name,
      bond_originator: '',
      bond_attorney: '',
      bond_attorney_email: '',
      bond_attorney_phone: '',
      transfer_attorney: '',
      transfer_attorney_email: '',
      transfer_attorney_phone: '',
    };
  });

  const unitRows: HistoricalDetailUnitRow[] = result.rows.map((row) => ({
    transaction_id: row.transaction_id,
    transaction_number: row.transaction_number || row.raw_transaction_number,
    mc_source_id: row.mc_source_id,
    unit_side: row.unit_side,
    unit_contribution: Number(row.unit_contribution),
    list_price: Number(row.list_price),
    sales_price: Number(row.sales_price),
  }));

  return { rows, unitRows };
}

async function fetchTransitionExceptionMonthEndDetailRows(
  dateFrom: string,
  dateTo: string,
  transactionStatuses: string[],
  saleTypes: string[],
): Promise<{ rows: MonthEndDetailRow[]; unitRows: HistoricalDetailUnitRow[] }> {
  if (!pool) return { rows: [], unitRows: [] };

  const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
    NULLIF(ct.sale_type, ''),
    CASE
      WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
      ELSE NULLIF(ct.transaction_type, '')
    END,
    ''
  )))`;

  const result = await pool.query<MonthEndDetailRow & { transaction_id: string; unit_side: string }>(
    `
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
      COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
      COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS mc_source_id,
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
      COALESCE(tac.split_percentage, 0)::numeric(18,4) AS th_split_pct,
      ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * (COALESCE(tac.split_percentage, 0)::numeric(18,4) / 100), 2)::numeric(18,2) AS agent_sales_volume,
      CASE
        WHEN COALESCE(ct.sales_price, 0)::numeric(18,2) > 0
          THEN ROUND((COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
            / NULLIF(ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * (COALESCE(tac.split_percentage, 0)::numeric(18,4) / 100), 2)::numeric, 0)) * 100, 4)
        ELSE COALESCE(tac.average_commission_pct, 0)::numeric(18,4)
      END AS comm_pct,
      CASE
        WHEN COALESCE(tac.split_percentage, 0) > 0
          THEN ROUND((COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric * 100) / COALESCE(tac.split_percentage, 0)::numeric, 2)
        ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
      END::numeric(18,2) AS contract_gci,
      COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
      COALESCE(tac.production_royalties, 0)::numeric(18,2) AS royalties,
      COALESCE(tac.growth_share, 0)::numeric(18,2) AS growth_share,
      COALESCE(tac.associate_dollar, 0)::numeric(18,2) AS associate_dollar,
      COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
      COALESCE(tac.team_dollar, 0)::numeric(18,2) AS team_dollar,
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
    WHERE ct.transaction_date::date >= $1::date
      AND ct.transaction_date::date <= $2::date
      AND ca.id IS NOT NULL
      AND ${salesOnlyTransactionExclusionSql}
      AND (
        CARDINALITY($3::text[]) = 0
        OR ${buildRegisteredOnlyOrSelectedStatusSql('ct', '$3::text[]')}
      )
      AND (
        CARDINALITY($4::text[]) = 0
        OR EXISTS (
          SELECT 1
          FROM UNNEST($4::text[]) AS selected_sale_type
          WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
        )
      )
    `,
    [dateFrom, dateTo, transactionStatuses, saleTypes],
  );

  const rows: MonthEndDetailRow[] = result.rows.map((row) => ({
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

  const unitRows: HistoricalDetailUnitRow[] = result.rows.map((row) => ({
    transaction_id: row.transaction_id,
    transaction_number: row.transaction_number,
    mc_source_id: row.mc_source_id,
    unit_side: row.unit_side,
    unit_contribution: 1,
    list_price: Number(row.list_price),
    sales_price: Number(row.sales_price),
  }));

  return { rows, unitRows };
}

function matchesNormalizedToken(candidate: string, target: string): boolean {
  return normalizeForMatch(candidate) === normalizeForMatch(target);
}

function detailRowMatchesTeam(row: MonthEndDetailRow, teamId: string): boolean {
  if (!teamId) return true;
  return matchesNormalizedToken(row.source_team_id, teamId) || matchesNormalizedToken(row.team_name, teamId);
}

function detailRowMatchesAssociate(row: MonthEndDetailRow, associateId: string): boolean {
  if (!associateId) return true;
  return matchesNormalizedToken(row.source_associate_id, associateId);
}

function deriveUnitsFromSides(sides: string[]): number {
  const normalized = sides.map((side) => side.trim().toLowerCase());
  const hasBoth = normalized.some((side) => side.includes('both'));
  const hasBuyer = normalized.some((side) => side.includes('buyer'));
  const hasSeller = normalized.some((side) => side.includes('seller'));
  const hasOther = normalized.some((side) => side.includes('other'));
  const hasReferralOrPc = normalized.some((side) => side.includes('referral') || side.includes('pc'));

  if (hasBoth) return 2;
  if (hasBuyer && hasSeller) return 2;
  if (hasBuyer || hasSeller) return 1;
  if (hasOther || hasReferralOrPc) return 1;
  return 0;
}

function aggregateScopedMonthEndRowsFromDetailRows(rows: MonthEndDetailRow[], useAssociateGrouping: boolean): MCRow[] {
  const groupMap = new Map<string, {
    market_center_name: string;
    mc_source_id: string;
    txMap: Map<string, {
      sides: string[];
      total_gci: number;
      growth_share: number;
      royalties: number;
      company_dollar: number;
      associate_dollar: number;
      team_dollar: number;
    }>;
  }>();

  for (const row of rows) {
    const groupName = useAssociateGrouping
      ? (row.associate_name || 'Unknown Associate')
      : (row.market_center_name || 'Unassigned / Unknown');
    const groupId = useAssociateGrouping
      ? (row.source_associate_id || 'unassigned')
      : (row.mc_source_id || '');
    const groupKey = `${groupId}::${groupName}`;

    const existingGroup = groupMap.get(groupKey) ?? {
      market_center_name: groupName,
      mc_source_id: groupId,
      txMap: new Map(),
    };

    const txKey = [
      row.transaction_number || '',
      row.transaction_date || '',
      row.associate_name || '',
      String(row.sales_price ?? 0),
    ].join('|');

    const existingTx = existingGroup.txMap.get(txKey) ?? {
      sides: [],
      total_gci: 0,
      growth_share: 0,
      royalties: 0,
      company_dollar: 0,
      associate_dollar: 0,
      team_dollar: 0,
    };

    existingTx.sides.push(row.transaction_type || '');
    existingTx.total_gci += Number(row.total_gci ?? 0);
    existingTx.growth_share += Number(row.growth_share ?? 0);
    existingTx.royalties += Number(row.royalties ?? 0);
    existingTx.company_dollar += Number(row.company_dollar ?? 0);
    existingTx.associate_dollar += Number(row.associate_dollar ?? 0);
    existingTx.team_dollar += Number(row.team_dollar ?? 0);

    existingGroup.txMap.set(txKey, existingTx);
    groupMap.set(groupKey, existingGroup);
  }

  const aggregated: MCRow[] = [];
  for (const group of groupMap.values()) {
    let contracts = 0;
    let units = 0;
    let total_gci = 0;
    let growth_share = 0;
    let royalties = 0;
    let company_dollar = 0;
    let associate_dollar = 0;
    let team_dollar = 0;

    for (const tx of group.txMap.values()) {
      contracts += 1;
      units += deriveUnitsFromSides(tx.sides);
      total_gci += tx.total_gci;
      growth_share += tx.growth_share;
      royalties += tx.royalties;
      company_dollar += tx.company_dollar;
      associate_dollar += tx.associate_dollar;
      team_dollar += tx.team_dollar;
    }

    aggregated.push({
      market_center_name: group.market_center_name,
      mc_source_id: group.mc_source_id,
      contracts,
      units,
      total_gci: round2(total_gci),
      growth_share: round2(growth_share),
      royalties: round2(royalties),
      company_dollar: round2(company_dollar),
      cos_to_gci_pct: total_gci > 0 ? round2((company_dollar / total_gci) * 100) : 0,
      associate_dollar: round2(associate_dollar),
      team_dollar: round2(team_dollar),
    });
  }

  return aggregated;
}

async function fetchHistoricalGapFallbackMonthEndDetailRows(
  dateFrom: string,
  dateTo: string,
  transactionStatuses: string[],
  saleTypes: string[],
): Promise<{ rows: MonthEndDetailRow[]; unitRows: HistoricalDetailUnitRow[] }> {
  if (!pool) return { rows: [], unitRows: [] };

  const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
    NULLIF(ct.sale_type, ''),
    CASE
      WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
      ELSE NULLIF(ct.transaction_type, '')
    END,
    ''
  )))`;

  const result = await pool.query<MonthEndDetailRow & { transaction_id: string; unit_side: string }>(
    `
    WITH historical_keys AS (
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(h.source_transaction_id), ''), NULLIF(TRIM(h.transaction_number), ''), NULLIF(TRIM(h.raw_transaction_number), '')) AS tx_key
      FROM migration.historical_reporting_fact h
      WHERE ${buildHistoricalReportingDateSql('h')} >= $1::date
        AND ${buildHistoricalReportingDateSql('h')} <= $2::date
        AND (
          CARDINALITY($3::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM UNNEST($3::text[]) AS selected_status
            WHERE LOWER(TRIM(COALESCE(h.transaction_status, ''))) = LOWER(TRIM(selected_status))
          )
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM UNNEST($4::text[]) AS selected_sale_type
            WHERE LOWER(TRIM(COALESCE(h.sale_type, ''))) = LOWER(TRIM(selected_sale_type))
          )
        )
    ),
    ${transactionAgentCalculationDedupCte},
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
      COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
      COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS mc_source_id,
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
      COALESCE(tac.split_percentage, 0)::numeric(18,4) AS th_split_pct,
      ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * (COALESCE(tac.split_percentage, 0)::numeric(18,4) / 100), 2)::numeric(18,2) AS agent_sales_volume,
      CASE
        WHEN COALESCE(ct.sales_price, 0)::numeric(18,2) > 0
          THEN ROUND((COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
            / NULLIF(ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * (COALESCE(tac.split_percentage, 0)::numeric(18,4) / 100), 2)::numeric, 0)) * 100, 4)
        ELSE COALESCE(tac.average_commission_pct, 0)::numeric(18,4)
      END AS comm_pct,
      CASE
        WHEN COALESCE(tac.split_percentage, 0) > 0
          THEN ROUND((COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric * 100) / COALESCE(tac.split_percentage, 0)::numeric, 2)
        ELSE COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric
      END::numeric(18,2) AS contract_gci,
      COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
      COALESCE(tac.production_royalties, 0)::numeric(18,2) AS royalties,
      COALESCE(tac.growth_share, 0)::numeric(18,2) AS growth_share,
      COALESCE(tac.associate_dollar, 0)::numeric(18,2) AS associate_dollar,
      COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
      COALESCE(tac.team_dollar, 0)::numeric(18,2) AS team_dollar,
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
    WHERE ct.transaction_date::date >= $1::date
      AND ct.transaction_date::date <= $2::date
      AND ca.id IS NOT NULL
      AND ${salesOnlyTransactionExclusionSql}
      AND (
        CARDINALITY($3::text[]) = 0
        OR ${buildRegisteredOnlyOrSelectedStatusSql('ct', '$3::text[]')}
      )
      AND (
        CARDINALITY($4::text[]) = 0
        OR EXISTS (
          SELECT 1
          FROM UNNEST($4::text[]) AS selected_sale_type
          WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM historical_keys hk
        WHERE hk.tx_key = COALESCE(NULLIF(TRIM(ct.source_transaction_id), ''), NULLIF(TRIM(ct.transaction_number), ''), ct.id::text)
      )
    `,
    [dateFrom, dateTo, transactionStatuses, saleTypes],
  );

  const rows: MonthEndDetailRow[] = result.rows.map((row) => ({
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

  const unitRows: HistoricalDetailUnitRow[] = result.rows.map((row) => ({
    transaction_id: row.transaction_id,
    transaction_number: row.transaction_number,
    mc_source_id: row.mc_source_id,
    unit_side: row.unit_side,
    unit_contribution: 1,
    list_price: Number(row.list_price),
    sales_price: Number(row.sales_price),
  }));

  return { rows, unitRows };
}

function buildHybridReportingDateSql(txAlias: string, tacAlias: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${txAlias}.transaction_status, ''))) = 'start'
      THEN COALESCE(${txAlias}.transaction_date::date, ${tacAlias}.effective_reporting_date::date)
    ELSE COALESCE(${txAlias}.status_change_date::date, ${tacAlias}.effective_reporting_date::date)
  END`;
}

function buildRegisteredStatusSql(txAlias: string): string {
  return `LOWER(TRIM(COALESCE(${txAlias}.transaction_status, ''))) = 'registered'`;
}

function buildRegisteredOnlyOrSelectedStatusSql(txAlias: string, selectedStatusesParam: string): string {
  return `(
    EXISTS (
      SELECT 1
      FROM UNNEST(${selectedStatusesParam}) AS status_value
      WHERE LOWER(TRIM(status_value)) = 'registered'
    )
    AND ${buildRegisteredStatusSql(txAlias)}
  )
  OR (
    NOT EXISTS (
      SELECT 1
      FROM UNNEST(${selectedStatusesParam}) AS status_value
      WHERE LOWER(TRIM(status_value)) = 'registered'
    )
    AND EXISTS (
      SELECT 1
      FROM UNNEST(${selectedStatusesParam}) AS selected_status
      WHERE LOWER(TRIM(COALESCE(${txAlias}.transaction_status, ''))) = LOWER(TRIM(selected_status))
    )
  )`;
}

async function fetchAssociateCapCycleSnapshot(associateId: number): Promise<CapCycleSnapshot | null> {
  if (!pool || !Number.isFinite(associateId) || !associateId) return null;

  const result = await pool.query<{
    associate_name: string;
    source_associate_id: string;
    cap_date: string | null;
    cap_amount: string;
    cap_achieved: string;
    cap_remaining: string;
    manual_cap: boolean;
  }>(
    `
    WITH cap_base AS (
      SELECT
        ca.id AS associate_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
        COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
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
      WHERE ca.id = $1::bigint
    ),
    cycle_window AS (
      SELECT
        cb.*,
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
        COALESCE(tac.cap_amount, 0)::numeric(18,2) AS cap_amount,
        COALESCE(tac.cap_remaining, 0)::numeric(18,2) AS cap_remaining,
        tac.cap_cycle_end_date,
        ROW_NUMBER() OVER (
          PARTITION BY tac.associate_id
          ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
        ) AS rn
      FROM migration.transaction_agent_calculations tac
      WHERE tac.associate_id = $1::bigint
    ),
    latest_cycle_caps AS (
      SELECT
        tac.associate_id,
        COALESCE(tac.cap_amount, 0)::numeric(18,2) AS cap_amount,
        COALESCE(tac.cap_remaining, 0)::numeric(18,2) AS cap_remaining,
        ROW_NUMBER() OVER (
          PARTITION BY tac.associate_id
          ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
        ) AS rn
      FROM migration.transaction_agent_calculations tac
      INNER JOIN cycle_window cw ON cw.associate_id = tac.associate_id
      WHERE cw.next_cap_date IS NOT NULL
        AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
        AND tac.effective_reporting_date::date < cw.next_cap_date
    )
    SELECT
      cw.associate_name,
      cw.source_associate_id,
      COALESCE(cw.next_cap_date, cw.cap_date, lc.cap_cycle_end_date)::date::text AS cap_date,
      GREATEST(COALESCE(lcc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2)::text AS cap_amount,
      CASE
        WHEN cw.manual_cap = true THEN GREATEST(COALESCE(lcc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2)
        ELSE LEAST(
          GREATEST(COALESCE(lcc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2),
          GREATEST(
            GREATEST(COALESCE(lcc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2)
              - GREATEST(COALESCE(lcc.cap_remaining, lc.cap_remaining, COALESCE(lcc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0)), 0)::numeric(18,2),
            0::numeric
          )
        )
      END::text AS cap_achieved,
      CASE
        WHEN cw.manual_cap = true THEN 0::numeric(18,2)
        ELSE GREATEST(COALESCE(lcc.cap_remaining, lc.cap_remaining, COALESCE(lcc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0)), 0)::numeric(18,2)
      END::text AS cap_remaining,
      cw.manual_cap
    FROM cycle_window cw
    LEFT JOIN latest_caps lc ON lc.associate_id = cw.associate_id AND lc.rn = 1
    LEFT JOIN latest_cycle_caps lcc ON lcc.associate_id = cw.associate_id AND lcc.rn = 1
    `,
    [associateId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    associate_name: row.associate_name,
    source_associate_id: row.source_associate_id,
    cap_date: row.cap_date,
    cap_amount: Number(row.cap_amount),
    company_dollar: Number(row.cap_achieved),
    cap_remaining: Number(row.cap_remaining),
    manual_cap: Boolean(row.manual_cap),
  };
}
function parseTeamContextToken(activeContextId: string): string | null {
  const normalized = activeContextId.trim().toLowerCase();
  const match = /^(lead_agent|team_admin|team_agent)(?:_(.+))?$/.exec(normalized);
  if (!match) return null;
  const token = (match[2] ?? '').trim();
  return token.length > 0 ? token : null;
}

async function resolveAssociateDbId(rawAssociateId: string | null | undefined): Promise<number | null> {
  if (!pool) return null;

  const candidate = String(rawAssociateId ?? '').trim();
  if (!candidate) return null;

  const result = await pool.query<{ id: string }>(
    `
    SELECT ca.id::text AS id
    FROM migration.core_associates ca
    WHERE ca.id::text = $1::text
       OR COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) = $1::text
    ORDER BY CASE WHEN ca.id::text = $1::text THEN 0 ELSE 1 END, ca.id ASC
    LIMIT 1
    `,
    [candidate]
  );

  const resolved = Number(result.rows[0]?.id ?? 0);
  return Number.isFinite(resolved) && resolved > 0 ? resolved : null;
}

async function resolveScopedTeamSourceId(req: { headers: Record<string, unknown>; permissions?: { scope: string; associateDbId: string | null } }): Promise<string | null> {
  if (!pool) return null;
  const perms = req.permissions;
  if (!perms || perms.scope !== 'OWN' || !perms.associateDbId) return null;

  const activeContextId = String(req.headers['x-active-context'] ?? '');
  const isTeamContext = /^(lead_agent|team_admin|team_agent)(?:_.+)?$/i.test(activeContextId.trim());
  if (!isTeamContext) return null;
  const contextRoleMatch = /^(lead_agent|team_admin|team_agent)(?:_.+)?$/i.exec(activeContextId.trim());
  const contextRole = (contextRoleMatch?.[1] ?? '').toLowerCase();
  if (contextRole === 'team_agent') {
    // Team Agent contexts must remain own-data scoped.
    return null;
  }
  const teamToken = parseTeamContextToken(activeContextId);

  const allowedTeamsResult = await pool.query<{ source_team_id: string | null; team_db_id: string | null }>(
    `WITH allowed_teams AS (
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
        OR NULLIF(TRIM(COALESCE(team_db_id, '')), '') IS NOT NULL`,
    [perms.associateDbId]
  );

  const firstAllowedTeam =
    allowedTeamsResult.rows.find((row) => (row.source_team_id ?? '').trim().length > 0)?.source_team_id
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
  const matched = allowedTeamsResult.rows.find((row) =>
    normalizeForMatch(row.source_team_id) === normalizedToken || normalizeForMatch(row.team_db_id) === normalizedToken
  );

  return matched?.source_team_id || matched?.team_db_id || firstAllowedTeam || teamToken;
}

async function resolveScopedTeamSourceIds(req: { headers: Record<string, unknown>; permissions?: { scope: string; associateDbId: string | null } }): Promise<string[]> {
  if (!pool) return [];
  const perms = req.permissions;
  if (!perms || perms.scope !== 'OWN' || !perms.associateDbId) return [];

  const activeContextId = String(req.headers['x-active-context'] ?? '');
  const isTeamContext = /^(lead_agent|team_admin|team_agent)(?:_.+)?$/i.test(activeContextId.trim());
  if (!isTeamContext) return [];
  const contextRoleMatch = /^(lead_agent|team_admin|team_agent)(?:_.+)?$/i.exec(activeContextId.trim());
  const contextRole = (contextRoleMatch?.[1] ?? '').toLowerCase();
  if (contextRole === 'team_agent') {
    return [];
  }

  const teamToken = parseTeamContextToken(activeContextId);
  const allowedTeamsResult = await pool.query<{ source_team_id: string | null; team_db_id: string | null }>(
    `WITH allowed_teams AS (
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
        OR NULLIF(TRIM(COALESCE(team_db_id, '')), '') IS NOT NULL`,
    [perms.associateDbId]
  );

  const candidates = new Set<string>();
  if (teamToken) {
    candidates.add(teamToken);
  }

  for (const row of allowedTeamsResult.rows) {
    const sourceTeamId = (row.source_team_id ?? '').trim();
    const teamDbId = (row.team_db_id ?? '').trim();
    if (sourceTeamId) candidates.add(sourceTeamId);
    if (teamDbId) candidates.add(teamDbId);
  }

  return Array.from(candidates);
}

function parseActiveContextRole(activeContextId: string): 'regional_admin' | 'office_admin' | 'lead_agent' | 'team_admin' | 'team_agent' | 'agent' | 'other' {
  const normalized = String(activeContextId ?? '').trim().toLowerCase();
  if (normalized === 'regional_admin') return 'regional_admin';
  if (normalized.startsWith('office_admin_') || normalized.startsWith('admin_')) return 'office_admin';
  if (normalized.startsWith('lead_agent')) return 'lead_agent';
  if (normalized.startsWith('team_admin')) return 'team_admin';
  if (normalized.startsWith('team_agent')) return 'team_agent';
  if (normalized === 'agent' || normalized.startsWith('agent_')) return 'agent';
  return 'other';
}

function uniqTokens(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function isAllowedToken(candidate: string, allowedValues: string[]): boolean {
  const normalizedCandidate = normalizeForMatch(candidate);
  return allowedValues.some((allowed) => normalizeForMatch(allowed) === normalizedCandidate);
}

function resolveRequestedScopedValue(requestedValue: string, allowedValues: string[], forcedValue = ''): string {
  const candidate = String(requestedValue ?? '').trim();
  if (!candidate) return String(forcedValue ?? '').trim();
  if (allowedValues.length === 0) return String(forcedValue ?? '').trim();
  return isAllowedToken(candidate, allowedValues) ? candidate : String(forcedValue ?? '').trim();
}

async function fetchAssociateScopeFacts(associateDbId: number | null): Promise<{
  sourceAssociateId: string | null;
  teamTokens: string[];
  marketCenterTokens: string[];
}> {
  if (!pool || !Number.isFinite(associateDbId) || !associateDbId) {
    return {
      sourceAssociateId: null,
      teamTokens: [],
      marketCenterTokens: [],
    };
  }

  const result = await pool.query<{
    source_associate_id: string | null;
    team_source_id: string | null;
    team_db_id: string | null;
    team_name: string | null;
    source_market_center_id: string | null;
  }>(
    `
    SELECT
      COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
      NULLIF(TRIM(t.source_team_id), '') AS team_source_id,
      t.id::text AS team_db_id,
      NULLIF(TRIM(t.name), '') AS team_name,
      COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), NULLIF(TRIM(ca.source_market_center_id), '')) AS source_market_center_id
    FROM migration.core_associates ca
    LEFT JOIN migration.core_teams t ON t.id = ca.team_id
    LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
    WHERE ca.id = $1::bigint
    LIMIT 1
    `,
    [associateDbId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      sourceAssociateId: null,
      teamTokens: [],
      marketCenterTokens: [],
    };
  }

  return {
    sourceAssociateId: row.source_associate_id,
    teamTokens: uniqTokens([row.team_source_id, row.team_db_id, row.team_name]),
    marketCenterTokens: uniqTokens([row.source_market_center_id]),
  };
}

async function fetchTeamScopeFacts(teamTokens: string[]): Promise<{
  teamTokens: string[];
  associateTokens: string[];
  marketCenterTokens: string[];
}> {
  if (!pool || teamTokens.length === 0) {
    return {
      teamTokens: [],
      associateTokens: [],
      marketCenterTokens: [],
    };
  }

  const normalizedTeamTokens = uniqTokens(teamTokens).map(normalizeForMatch).filter(Boolean);
  if (normalizedTeamTokens.length === 0) {
    return {
      teamTokens: [],
      associateTokens: [],
      marketCenterTokens: [],
    };
  }

  const result = await pool.query<{
    source_associate_id: string | null;
    associate_db_id: string;
    team_source_id: string | null;
    team_db_id: string | null;
    team_name: string | null;
    source_market_center_id: string | null;
  }>(
    `
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
      ca.id::text AS associate_db_id,
      NULLIF(TRIM(t.source_team_id), '') AS team_source_id,
      t.id::text AS team_db_id,
      NULLIF(TRIM(t.name), '') AS team_name,
      COALESCE(NULLIF(TRIM(mc.source_market_center_id), ''), NULLIF(TRIM(ca.source_market_center_id), '')) AS source_market_center_id
    FROM migration.core_associates ca
    LEFT JOIN migration.core_teams t ON t.id = ca.team_id
    LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
    WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
      AND (
        REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = ANY($1::text[])
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = ANY($1::text[])
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = ANY($1::text[])
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = ANY($1::text[])
      )
    `,
    [normalizedTeamTokens]
  );

  const permittedTeamTokens = new Set<string>();
  const permittedAssociateTokens = new Set<string>();
  const permittedMcTokens = new Set<string>();

  for (const row of result.rows) {
    uniqTokens([row.team_source_id, row.team_db_id, row.team_name]).forEach((token) => permittedTeamTokens.add(token));
    uniqTokens([row.source_associate_id, row.associate_db_id]).forEach((token) => permittedAssociateTokens.add(token));
    uniqTokens([row.source_market_center_id]).forEach((token) => permittedMcTokens.add(token));
  }

  return {
    teamTokens: Array.from(permittedTeamTokens),
    associateTokens: Array.from(permittedAssociateTokens),
    marketCenterTokens: Array.from(permittedMcTokens),
  };
}

async function fetchMarketCenterScopeFacts(marketCenterId: string | null): Promise<{
  teamTokens: string[];
  associateTokens: string[];
}> {
  if (!pool || !marketCenterId) {
    return {
      teamTokens: [],
      associateTokens: [],
    };
  }

  const normalizedMcId = normalizeForMatch(marketCenterId);
  const result = await pool.query<{
    source_associate_id: string | null;
    associate_db_id: string;
    team_source_id: string | null;
    team_db_id: string | null;
    team_name: string | null;
  }>(
    `
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
      ca.id::text AS associate_db_id,
      NULLIF(TRIM(t.source_team_id), '') AS team_source_id,
      t.id::text AS team_db_id,
      NULLIF(TRIM(t.name), '') AS team_name
    FROM migration.core_associates ca
    LEFT JOIN migration.core_teams t ON t.id = ca.team_id
    LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
    WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
      AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ca.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
    `,
    [normalizedMcId]
  );

  const teamTokens = new Set<string>();
  const associateTokens = new Set<string>();

  for (const row of result.rows) {
    uniqTokens([row.team_source_id, row.team_db_id, row.team_name]).forEach((token) => teamTokens.add(token));
    uniqTokens([row.source_associate_id, row.associate_db_id]).forEach((token) => associateTokens.add(token));
  }

  return {
    teamTokens: Array.from(teamTokens),
    associateTokens: Array.from(associateTokens),
  };
}

async function resolveEffectiveReportScope(req: { headers: Record<string, unknown>; permissions?: { scope: string; marketCenterId?: string | null; homeMcId?: string | null; associateDbId: string | null } }): Promise<EffectiveReportScope> {
  const perms = req.permissions;
  const activeContextId = String(req.headers['x-active-context'] ?? '').trim();
  const contextRole = parseActiveContextRole(activeContextId);

  const defaultScope: EffectiveReportScope = {
    reportingScope: 'ASSOCIATE',
    forcedMarketCentreId: null,
    forcedTeamId: null,
    forcedAssociateId: null,
    forcedAssociateDbId: Number.isFinite(Number(perms?.associateDbId ?? 0)) && Number(perms?.associateDbId ?? 0) > 0
      ? Number(perms?.associateDbId ?? 0)
      : null,
    permittedMarketCentreIds: [],
    permittedTeamIds: [],
    permittedAssociateIds: [],
  };

  if (!perms) return defaultScope;

  const forcedMarketCentreId = (perms.marketCenterId ?? perms.homeMcId ?? null) || null;
  const associateDbId = Number(perms.associateDbId ?? 0);
  const forcedAssociateDbId = Number.isFinite(associateDbId) && associateDbId > 0 ? associateDbId : null;
  const associateFacts = await fetchAssociateScopeFacts(forcedAssociateDbId);

  if (contextRole === 'regional_admin' || perms.scope === 'GLOBAL') {
    return {
      reportingScope: 'GLOBAL',
      forcedMarketCentreId: null,
      forcedTeamId: null,
      forcedAssociateId: null,
      forcedAssociateDbId: null,
      permittedMarketCentreIds: [],
      permittedTeamIds: [],
      permittedAssociateIds: [],
    };
  }

  if (contextRole === 'office_admin' || perms.scope === 'MARKET_CENTRE') {
    const mcFacts = await fetchMarketCenterScopeFacts(forcedMarketCentreId);
    return {
      reportingScope: 'MARKET_CENTRE',
      forcedMarketCentreId,
      forcedTeamId: null,
      forcedAssociateId: null,
      forcedAssociateDbId: null,
      permittedMarketCentreIds: uniqTokens([forcedMarketCentreId]),
      permittedTeamIds: mcFacts.teamTokens,
      permittedAssociateIds: mcFacts.associateTokens,
    };
  }

  if (contextRole === 'lead_agent' || contextRole === 'team_admin') {
    const preferredTeamId = await resolveScopedTeamSourceId(req);
    const teamCandidates = uniqTokens([preferredTeamId, ...await resolveScopedTeamSourceIds(req)]);
    const teamFacts = await fetchTeamScopeFacts(teamCandidates);
    return {
      reportingScope: 'TEAM',
      forcedMarketCentreId: null,
      forcedTeamId: preferredTeamId || teamCandidates[0] || null,
      forcedAssociateId: null,
      forcedAssociateDbId: null,
      permittedMarketCentreIds: teamFacts.marketCenterTokens,
      permittedTeamIds: teamFacts.teamTokens.length > 0 ? teamFacts.teamTokens : teamCandidates,
      permittedAssociateIds: teamFacts.associateTokens,
    };
  }

  return {
    reportingScope: 'ASSOCIATE',
    forcedMarketCentreId: associateFacts.marketCenterTokens[0] ?? null,
    forcedTeamId: associateFacts.teamTokens[0] ?? null,
    forcedAssociateId: associateFacts.sourceAssociateId,
    forcedAssociateDbId,
    permittedMarketCentreIds: associateFacts.marketCenterTokens,
    permittedTeamIds: associateFacts.teamTokens,
    permittedAssociateIds: uniqTokens([associateFacts.sourceAssociateId, forcedAssociateDbId ? String(forcedAssociateDbId) : null]),
  };
}

type ReportRouteScopeFilters = {
  reportingScope: ReportingScope;
  scopeMcId: string | null;
  scopedTeamSourceId: string | null;
  resolvedScopeAssociateId: number | null;
  effectiveTeamId: string;
  effectiveAssociateId: string;
  effectiveMarketCenterIds: string[];
};

function filterRequestedValues(requestedValues: string[], allowedValues: string[]): string[] {
  if (requestedValues.length === 0) return [];
  if (allowedValues.length === 0) return [];
  return requestedValues.filter((value) => isAllowedToken(value, allowedValues));
}

async function resolveReportRouteScopeFilters(
  req: { headers: Record<string, unknown>; permissions?: { scope: string; marketCenterId?: string | null; homeMcId?: string | null; associateDbId: string | null } },
  options?: {
    requestedTeamId?: string;
    requestedAssociateId?: string;
    requestedMarketCenterIds?: string[];
  }
): Promise<ReportRouteScopeFilters> {
  const effectiveScope = await resolveEffectiveReportScope(req);
  const requestedTeamId = String(options?.requestedTeamId ?? '').trim();
  const requestedAssociateId = String(options?.requestedAssociateId ?? '').trim();
  const requestedMarketCenterIds = uniqTokens(options?.requestedMarketCenterIds ?? []);

  if (effectiveScope.reportingScope === 'GLOBAL') {
    return {
      reportingScope: effectiveScope.reportingScope,
      scopeMcId: null,
      scopedTeamSourceId: null,
      resolvedScopeAssociateId: null,
      effectiveTeamId: requestedTeamId,
      effectiveAssociateId: requestedAssociateId,
      effectiveMarketCenterIds: requestedMarketCenterIds,
    };
  }

  const permittedMarketCenterIds = effectiveScope.permittedMarketCentreIds;
  const requestedScopedMarketCenterIds = requestedMarketCenterIds.length > 0
    ? filterRequestedValues(requestedMarketCenterIds, permittedMarketCenterIds)
    : [];

  if (effectiveScope.reportingScope === 'MARKET_CENTRE') {
    return {
      reportingScope: effectiveScope.reportingScope,
      scopeMcId: effectiveScope.forcedMarketCentreId,
      scopedTeamSourceId: null,
      resolvedScopeAssociateId: null,
      effectiveTeamId: resolveRequestedScopedValue(requestedTeamId, effectiveScope.permittedTeamIds, ''),
      effectiveAssociateId: resolveRequestedScopedValue(requestedAssociateId, effectiveScope.permittedAssociateIds, ''),
      effectiveMarketCenterIds: requestedMarketCenterIds.length > 0
        ? requestedScopedMarketCenterIds
        : permittedMarketCenterIds,
    };
  }

  if (effectiveScope.reportingScope === 'TEAM') {
    const forcedTeamId = effectiveScope.forcedTeamId ?? '';
    return {
      reportingScope: effectiveScope.reportingScope,
      scopeMcId: null,
      scopedTeamSourceId: forcedTeamId || null,
      resolvedScopeAssociateId: null,
      effectiveTeamId: resolveRequestedScopedValue(requestedTeamId, effectiveScope.permittedTeamIds, forcedTeamId),
      effectiveAssociateId: resolveRequestedScopedValue(requestedAssociateId, effectiveScope.permittedAssociateIds, ''),
      effectiveMarketCenterIds: requestedScopedMarketCenterIds,
    };
  }

  const forcedAssociateId = effectiveScope.forcedAssociateId ?? (effectiveScope.forcedAssociateDbId ? String(effectiveScope.forcedAssociateDbId) : '');
  return {
    reportingScope: effectiveScope.reportingScope,
    scopeMcId: effectiveScope.forcedMarketCentreId,
    scopedTeamSourceId: null,
    resolvedScopeAssociateId: effectiveScope.forcedAssociateDbId,
    effectiveTeamId: '',
    effectiveAssociateId: resolveRequestedScopedValue(requestedAssociateId, effectiveScope.permittedAssociateIds, forcedAssociateId),
    effectiveMarketCenterIds: requestedScopedMarketCenterIds,
  };
}

function parseBirthdayFromSouthAfricanId(nationalId: string | null): string | null {
  if (!nationalId) return null;

  const digits = nationalId.replace(/\D/g, '');
  if (digits.length < 6) return null;

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;

  const now = new Date();
  const currentTwoDigitYear = now.getUTCFullYear() % 100;
  const fullYear = yy <= currentTwoDigitYear ? 2000 + yy : 1900 + yy;

  const date = new Date(Date.UTC(fullYear, mm - 1, dd));
  if (
    date.getUTCFullYear() !== fullYear
    || date.getUTCMonth() + 1 !== mm
    || date.getUTCDate() !== dd
  ) {
    return null;
  }

  return `${fullYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function getAppTimeInTimeZone(date: Date = new Date()): string {
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

function normalizeForMatch(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function ensureMcDashboardSnapshotTable(): Promise<void> {
  if (!pool) return;

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

async function computeMcDashboardData(
  mcSourceId: string,
  dateFrom: string,
  dateTo: string,
  options?: { allMarketCenters?: boolean }
): Promise<McDashboardData> {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured.');
  }

  const isAllMarketCenters = options?.allMarketCenters === true;
  const normalizedMcId = normalizeForMatch(mcSourceId);

  const summaryResult = await pool.query<{
    market_center_name: string;
    market_center_logo_url: string | null;
    market_center_white_logo_url: string | null;
    birthdays_today: string;
    anniversaries_this_month: string;
    new_agents_this_month: string;
    active_agents: string;
    active_listings: string;
    registered_gci: string;
    registered_co_dollars: string;
    registered_units: string;
    registered_contracts: string;
  }>(
    `
    WITH ${transactionAgentCalculationDedupCte},
    selected_mc AS (
      SELECT id, source_market_center_id, name, logo_image_url, white_logo_image_url
      FROM (
        SELECT
          mc.id,
          mc.source_market_center_id,
          COALESCE(NULLIF(TRIM(mc.name), ''), 'Unknown Market Centre') AS name,
          mc.logo_image_url,
          mc.white_logo_image_url,
          ROW_NUMBER() OVER (
            PARTITION BY REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
            ORDER BY
              CASE WHEN NULLIF(TRIM(COALESCE(mc.white_logo_image_url, '')), '') IS NULL THEN 0 ELSE 1 END DESC,
              CASE WHEN NULLIF(TRIM(COALESCE(mc.logo_image_url, '')), '') IS NULL THEN 0 ELSE 1 END DESC,
              mc.updated_at DESC NULLS LAST,
              mc.id DESC
          ) AS rn
        FROM migration.core_market_centers mc
        WHERE NULLIF(TRIM(mc.source_market_center_id), '') IS NOT NULL
          AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
          AND (
            $4::boolean
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
          )
      ) ranked_mc
      WHERE rn = 1
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
        AND (
          $4::boolean
          OR REGEXP_REPLACE(
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
        )
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
          WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') THEN 1
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
      COALESCE(
        (
          SELECT CASE WHEN $4::boolean THEN $5::text ELSE MAX(name) END
          FROM selected_mc
        ),
        CASE WHEN $4::boolean THEN $5::text ELSE 'Unknown Market Centre' END
      ) AS market_center_name,
      CASE WHEN $4::boolean THEN NULL ELSE (SELECT logo_image_url FROM selected_mc LIMIT 1) END AS market_center_logo_url,
      CASE WHEN $4::boolean THEN NULL ELSE (SELECT white_logo_image_url FROM selected_mc LIMIT 1) END AS market_center_white_logo_url,
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
    `,
    [normalizedMcId, dateFrom, dateTo, isAllMarketCenters, MC_DASHBOARD_ALL_MARKET_CENTERS_LABEL]
  );

  const summary = summaryResult.rows[0];

  const topAgentsResult = await pool.query<{
    associate_id: string;
    associate_name: string;
    team_name: string;
    market_center_name: string;
    registered_gci: string;
    units: string;
  }>(
    `
    WITH ${transactionAgentCalculationDedupCte},
    tx_agent AS (
      SELECT
        ca.id::text AS associate_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
        COALESCE(NULLIF(TRIM(t.name), ''), '-') AS team_name,
        COALESCE(NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(ca.source_market_center_id), ''), '-') AS market_center_name,
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
        AND (
          t.id IS NULL
          OR NULLIF(TRIM(t.name), '') IS NULL
          OR LOWER(TRIM(COALESCE(t.name, ''))) IN ('-', 'no team', 'unassigned / unknown team')
        )
        AND ${salesOnlyTransactionExclusionSql}
        AND tac.effective_reporting_date::date >= $2::date
        AND tac.effective_reporting_date::date <= $3::date
        AND (
          $4::boolean
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
        )
    )
    SELECT
      associate_id,
      associate_name,
      team_name,
      market_center_name,
      ROUND(SUM(gci)::numeric, 2)::text AS registered_gci,
      COALESCE(SUM(units), 0)::int::text AS units
    FROM tx_agent
    GROUP BY associate_id, associate_name, team_name, market_center_name
    ORDER BY SUM(gci) DESC, SUM(units) DESC, associate_name ASC
    LIMIT 8
    `,
    [normalizedMcId, dateFrom, dateTo, isAllMarketCenters]
  );

  const topTeamsResult = await pool.query<{
    team_id: string;
    team_name: string;
    registered_gci: string;
    units: string;
    active_agents: string;
  }>(
    `
    WITH ${transactionAgentCalculationDedupCte},
    active_agent_counts AS (
      SELECT
        t.id::text AS team_id,
        COALESCE(NULLIF(TRIM(t.name), ''), '-') AS team_name,
        COUNT(*)::int AS active_agents
      FROM migration.core_associates ca
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
      WHERE LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        AND t.id IS NOT NULL
        AND NULLIF(TRIM(t.name), '') IS NOT NULL
        AND LOWER(TRIM(COALESCE(t.name, ''))) NOT IN ('-', 'no team', 'unassigned / unknown team')
        AND (
          $4::boolean
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
        )
      GROUP BY t.id::text, COALESCE(NULLIF(TRIM(t.name), ''), '-')
    ),
    team_tx AS (
      SELECT
        t.id::text AS team_id,
        COALESCE(NULLIF(TRIM(t.name), ''), '-') AS team_name,
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
        AND t.id IS NOT NULL
        AND NULLIF(TRIM(t.name), '') IS NOT NULL
        AND LOWER(TRIM(COALESCE(t.name, ''))) NOT IN ('-', 'no team', 'unassigned / unknown team')
        AND ${salesOnlyTransactionExclusionSql}
        AND tac.effective_reporting_date::date >= $2::date
        AND tac.effective_reporting_date::date <= $3::date
        AND (
          $4::boolean
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
        )
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
    `,
    [normalizedMcId, dateFrom, dateTo, isAllMarketCenters]
  );

  const birthdayPeopleResult = await pool.query<{
    associate_id: string;
    associate_name: string;
    team_name: string;
    mobile_number: string | null;
    birthday: string;
  }>(
    `
    SELECT
      ca.id::text AS associate_id,
      COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
      COALESCE(NULLIF(TRIM(t.name), ''), '-') AS team_name,
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
      AND (
        $3::boolean
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      )
      AND substring(ca.national_id, 3, 2) = to_char($2::date, 'MM')
      AND substring(ca.national_id, 5, 2) = to_char($2::date, 'DD')
      AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
    ORDER BY associate_name ASC
    `,
    [normalizedMcId, dateTo, isAllMarketCenters]
  );

  const anniversaryPeopleResult = await pool.query<{
    associate_id: string;
    associate_name: string;
    team_name: string;
    mobile_number: string | null;
    anniversary_date: string;
    anniversary_years: string | null;
  }>(
    `
    SELECT
      ca.id::text AS associate_id,
      COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
      COALESCE(NULLIF(TRIM(t.name), ''), '-') AS team_name,
      NULLIF(TRIM(ca.mobile_number), '') AS mobile_number,
      ca.anniversary_date::date::text AS anniversary_date,
      CASE
        WHEN ca.start_date IS NULL THEN NULL
        ELSE GREATEST(0, EXTRACT(YEAR FROM $2::date)::int - EXTRACT(YEAR FROM ca.start_date)::int)::text
      END AS anniversary_years
    FROM migration.core_associates ca
    LEFT JOIN migration.core_teams t ON t.id = ca.team_id
    LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.id = ca.market_center_id
    WHERE ca.anniversary_date IS NOT NULL
      AND (
        $3::boolean
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $1
      )
      AND EXTRACT(MONTH FROM ca.anniversary_date) = EXTRACT(MONTH FROM $2::date)
      AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
    ORDER BY EXTRACT(DAY FROM ca.anniversary_date) ASC, associate_name ASC
    LIMIT 150
    `,
    [normalizedMcId, dateTo, isAllMarketCenters]
  );

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
        market_center_name: row.market_center_name,
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
        years: row.anniversary_years === null ? undefined : Number(row.anniversary_years),
      })),
    },
    _v: MC_DASHBOARD_SNAPSHOT_VERSION,
  };
}

router.get('/access', resolvePermissions, async (req, res) => {
  try {
    const perms = req.permissions!;
    const reports = getReportAccessSnapshot(perms);
    const effectiveScope = await resolveEffectiveReportScope(req);

    Object.values(reports).forEach((report) => {
      report.reportingScope = effectiveScope.reportingScope;
      if (effectiveScope.reportingScope !== 'GLOBAL') {
        report.authorisedMarketCentreIds = effectiveScope.permittedMarketCentreIds;
        report.defaultMarketCentreId = effectiveScope.forcedMarketCentreId;
        report.marketCentreSelectorVisible = report.authorisedMarketCentreIds.length > 1;
        report.marketCentreSelectorEditable = report.authorisedMarketCentreIds.length > 1;
        report.teamFilterAvailable = effectiveScope.reportingScope === 'MARKET_CENTRE' || effectiveScope.reportingScope === 'TEAM';
        report.associateFilterAvailable = effectiveScope.permittedAssociateIds.length > 0;
      }
    });

    return res.json({ reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// GET /api/reports/month-end/filter-options
// Returns available filter values for the report slicers
router.get('/month-end/filter-options', resolvePermissions, requireReportAccess(REPORT_KEYS.MONTH_END), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    const debugMode = String(req.query.debug || '').trim() === '1';
    const scopeFilters = await resolveReportRouteScopeFilters(req);
    const scopeMcId = scopeFilters.scopeMcId;
    const scopedTeamSourceId = scopeFilters.scopedTeamSourceId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;
    const scopedTeamSourceIds = [scopedTeamSourceId].filter((value): value is string => Boolean(value)).map(normalizeForMatch);

    const result = await pool.query<{
      transaction_status: string | null;
      sale_type: string | null;
      source_market_center_id: string;
      market_center_name: string;
    }>(
      `
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
          AND ($3::bigint IS NULL OR tac.associate_id = $3::bigint)
        )
        SELECT
        transaction_status,
        sale_type,
        source_market_center_id,
        market_center_name
      FROM scoped_tx
      ORDER BY market_center_name
      `,
      [scopeMcId, scopedTeamSourceIds, resolvedScopeAssociateId]
    );

    const statuses = Array.from(
      new Set(
        result.rows
          .map((r) => (r.transaction_status ?? '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const saleTypes = Array.from(
      new Set(
        result.rows
          .map((r) => (r.sale_type ?? '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const marketCentersMap = new Map<string, string>();
    for (const row of result.rows) {
      const id = (row.source_market_center_id ?? '').trim();
      if (!id) continue;
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
            reporting_scope: scopeFilters.reportingScope,
            scope_mc_id: scopeMcId,
            scoped_team_source_id: scopedTeamSourceId,
          }
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// GET /api/reports/month-end
// Returns Market Centre Totals aggregated from transaction_agent_calculations
router.get('/month-end', resolvePermissions, requireReportAccess(REPORT_KEYS.MONTH_END), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;

    const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
    const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
    const monthEndUnified = getMonthEndUnifiedFlags();
    const useUnified = monthEndUnified.enabled;
    const requestedPreviewBatchId = String(req.query.preview_batch_id || '').trim();
    const selectedHistoricalPreviewBatchId = requestedPreviewBatchId || null;
    const historicalIsolationOnly = useUnified && isStrictHistoricalIsolationRequest(dateTo);
    const transactionStatuses = parseCsvParam(req.query.transaction_status).map((value) => value.trim()).filter(Boolean);
    const saleTypes = parseCsvParam(req.query.sale_type).map((value) => value.trim()).filter(Boolean);
    const teamId = String(req.query.team_id || '').trim();
    const associateId = String(req.query.associate_id || '').trim();
    const marketCenterIdsParam = String(req.query.market_center_ids || '');
    const debugMode = String(req.query.debug || '').trim() === '1';
    const marketCenterIds = marketCenterIdsParam
      ? marketCenterIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const scopeFilters = await resolveReportRouteScopeFilters(req, {
      requestedTeamId: teamId,
      requestedAssociateId: associateId,
      requestedMarketCenterIds: marketCenterIds,
    });
    const hasStartStatusFilter = transactionStatuses.some((status) => normalizeForMatch(status) === 'start');
    const useAssociateGrouping = !!(scopeFilters.effectiveTeamId || scopeFilters.effectiveAssociateId);
    const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;

    const windows = resolveUnifiedSourceWindows(dateFrom, dateTo, monthEndUnified);
    const useFullLiveWindowForStart = useUnified && hasStartStatusFilter;
    const liveDateFrom = useUnified
      ? (useFullLiveWindowForStart
        ? dateFrom
        : (useAssociateGrouping
        ? dateFrom
        : (historicalIsolationOnly ? '9999-12-31' : (windows.liveWindow?.from ?? '9999-12-31'))))
      : dateFrom;
    const liveDateTo = useUnified
      ? (useFullLiveWindowForStart
        ? dateTo
        : (useAssociateGrouping
        ? dateTo
        : (historicalIsolationOnly ? '9999-12-31' : (windows.liveWindow?.to ?? '9999-12-31'))))
      : dateTo;

    const params: Array<string | string[] | boolean | number | null> = [liveDateFrom, liveDateTo, transactionStatuses, saleTypes];

    const scopeMcId = scopeFilters.scopeMcId;
    const scopedTeamSourceId = scopeFilters.scopedTeamSourceId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;
    const effectiveTeamId = scopeFilters.effectiveTeamId;
    const effectiveAssociateId = scopeFilters.effectiveAssociateId;
    const effectiveMarketCenterIds = scopeFilters.effectiveMarketCenterIds;
    const allowHistoricalAggregateMerge = !useAssociateGrouping;
    const collapseScopedOfficeAdminRows = perms.scope === 'MARKET_CENTRE' && !useAssociateGrouping && Boolean(scopeMcId);
    let scopedOfficeAdminMarketCenterName: string | null = null;

    if (collapseScopedOfficeAdminRows && scopeMcId) {
      const scopedMarketCenterResult = await pool.query<{ name: string | null }>(
        `
        SELECT name
        FROM migration.core_market_centers
        WHERE source_market_center_id = $1
          AND LOWER(TRIM(COALESCE(status_name, ''))) IN ('active', '1')
        ORDER BY id ASC
        LIMIT 1
        `,
        [scopeMcId]
      );
      scopedOfficeAdminMarketCenterName = scopedMarketCenterResult.rows[0]?.name?.trim() || scopeMcId;
    }

    if (scopeMcId) {
      params.push(scopeMcId);
    }

    const scopeMcParam = scopeMcId ? `$${params.length}` : 'NULL';

    if (scopedTeamSourceId) {
      params.push(scopedTeamSourceId);
    }
    const scopeTeamParam = scopedTeamSourceId ? `$${params.length}` : 'NULL';

    params.push(resolvedScopeAssociateId);
    const scopeAssociateParam = `$${params.length}`;

    params.push(effectiveTeamId);
    const teamFilterParam = `$${params.length}`;
    params.push(effectiveAssociateId);
    const associateFilterParam = `$${params.length}`;
    params.push(useAssociateGrouping ? 'true' : 'false');
    const useAssociateGroupingParam = `$${params.length}`;
    params.push(collapseScopedOfficeAdminRows ? 'true' : 'false');
    const collapseScopedOfficeAdminRowsParam = `$${params.length}`;
    params.push(scopedOfficeAdminMarketCenterName ?? '');
    const scopedOfficeAdminMarketCenterNameParam = `$${params.length}`;
    params.push(scopeMcId ?? '');
    const scopedOfficeAdminMarketCenterIdParam = `$${params.length}`;

    let mcFilterClause = '';
    if (effectiveMarketCenterIds.length > 0) {
      params.push(effectiveMarketCenterIds);
      mcFilterClause = `AND mc_source_id = ANY($${params.length}::text[])`;
    }

    let historicalForUnified: { rows: MCRow[]; contracts: number } = { rows: [], contracts: 0 };
    if (useUnified && allowHistoricalAggregateMerge && !useFullLiveWindowForStart && windows.historicalWindow) {
      historicalForUnified = await fetchHistoricalMonthEndRows(
        windows.historicalWindow.from,
        windows.historicalWindow.to,
        transactionStatuses,
        saleTypes,
        selectedHistoricalPreviewBatchId,
      );
    }

    let historicalGapFallbackForUnified: { rows: MCRow[]; contracts: number } = { rows: [], contracts: 0 };
    if (useUnified && allowHistoricalAggregateMerge && !useFullLiveWindowForStart && shouldUseHistoricalGapFallback(windows.historicalWindow)) {
      const historicalWindow = windows.historicalWindow as UnifiedWindow;
      historicalGapFallbackForUnified = await fetchHistoricalGapFallbackMonthEndRows(
        historicalWindow.from,
        historicalWindow.to,
        transactionStatuses,
        saleTypes,
      );
    }

    let transitionForUnified: { rows: MCRow[]; contracts: number } = { rows: [], contracts: 0 };
    if (useUnified && allowHistoricalAggregateMerge && !useFullLiveWindowForStart && !historicalIsolationOnly && windows.transitionExceptionWindow) {
      transitionForUnified = await fetchTransitionExceptionMonthEndRows(
        windows.transitionExceptionWindow.from,
        windows.transitionExceptionWindow.to,
        transactionStatuses,
        saleTypes,
      );
    }

    const scopedMcFilter = effectiveMarketCenterIds;
    if (allowHistoricalAggregateMerge && scopedMcFilter.length > 0) {
      historicalForUnified = {
        ...historicalForUnified,
        rows: filterByMarketCenterIds(historicalForUnified.rows, scopedMcFilter),
      };
      historicalGapFallbackForUnified = {
        ...historicalGapFallbackForUnified,
        rows: filterByMarketCenterIds(historicalGapFallbackForUnified.rows, scopedMcFilter),
      };
      transitionForUnified = {
        ...transitionForUnified,
        rows: filterByMarketCenterIds(transitionForUnified.rows, scopedMcFilter),
      };
    }

    let scopedHistoricalRowsFromDetail: MCRow[] = [];
    if (useUnified && !allowHistoricalAggregateMerge && !useFullLiveWindowForStart) {
      let historicalDetailRows: MonthEndDetailRow[] = [];
      if (windows.historicalWindow) {
        const historicalDetail = await fetchHistoricalMonthEndDetailRows(
          windows.historicalWindow.from,
          windows.historicalWindow.to,
          transactionStatuses,
          saleTypes,
          selectedHistoricalPreviewBatchId,
        );
        historicalDetailRows = historicalDetailRows.concat(historicalDetail.rows);
      }

      if (shouldUseHistoricalGapFallback(windows.historicalWindow)) {
        const historicalWindow = windows.historicalWindow as UnifiedWindow;
        const historicalGapDetail = await fetchHistoricalGapFallbackMonthEndDetailRows(
          historicalWindow.from,
          historicalWindow.to,
          transactionStatuses,
          saleTypes,
        );
        historicalDetailRows = historicalDetailRows.concat(historicalGapDetail.rows);
      }

      if (!historicalIsolationOnly && windows.transitionExceptionWindow) {
        const transitionDetail = await fetchTransitionExceptionMonthEndDetailRows(
          windows.transitionExceptionWindow.from,
          windows.transitionExceptionWindow.to,
          transactionStatuses,
          saleTypes,
        );
        historicalDetailRows = historicalDetailRows.concat(transitionDetail.rows);
      }

      if (scopedMcFilter.length > 0) {
        historicalDetailRows = filterByMarketCenterIds(historicalDetailRows, scopedMcFilter);
      }

      const scopedDetailRows = historicalDetailRows.filter((row) =>
        detailRowMatchesTeam(row, effectiveTeamId)
        && detailRowMatchesAssociate(row, effectiveAssociateId)
      );

      scopedHistoricalRowsFromDetail = aggregateScopedMonthEndRowsFromDetailRows(scopedDetailRows, useAssociateGrouping);
    }

    const reportingDateExpr = buildHybridReportingDateSql('ct', 'tac');

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
        WHERE ${reportingDateExpr} >= $1::date
          AND ${reportingDateExpr} <= $2::date
          AND ca.id IS NOT NULL
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            CARDINALITY($3::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($3::text[]) AS selected_status
              WHERE (
                LOWER(TRIM(selected_status)) = 'registered'
                AND ${buildRegisteredStatusSql('ct')}
              )
              OR (
                LOWER(TRIM(selected_status)) <> 'registered'
                AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM(selected_status))
              )
            )
          )
          AND (
            CARDINALITY($4::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($4::text[]) AS selected_sale_type
              WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
            )
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
          AND (${scopeAssociateParam}::bigint IS NULL OR tac.associate_id = ${scopeAssociateParam}::bigint)
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
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') AS has_referral,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') AS has_pc
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
               AND c.has_pc = false
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
               AND c.has_pc = false
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
          CASE
            WHEN ${collapseScopedOfficeAdminRowsParam}::boolean THEN COALESCE(NULLIF(${scopedOfficeAdminMarketCenterNameParam}::text, ''), COALESCE(r.market_center_name, 'Unassigned / Unknown'))
            WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.associate_name, 'Unknown Associate')
            ELSE COALESCE(r.market_center_name, 'Unassigned / Unknown')
          END AS market_center_name,
          CASE
            WHEN ${collapseScopedOfficeAdminRowsParam}::boolean THEN COALESCE(NULLIF(${scopedOfficeAdminMarketCenterIdParam}::text, ''), COALESCE(r.mc_source_id, ''))
            WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.source_associate_id, 'unassigned')
            ELSE COALESCE(r.mc_source_id, '')
          END AS mc_source_id,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') THEN 1
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
          CASE
            WHEN ${collapseScopedOfficeAdminRowsParam}::boolean THEN COALESCE(NULLIF(${scopedOfficeAdminMarketCenterNameParam}::text, ''), COALESCE(r.market_center_name, 'Unassigned / Unknown'))
            WHEN ${useAssociateGroupingParam}::boolean
            THEN COALESCE(r.associate_name, 'Unknown Associate')
            ELSE COALESCE(r.market_center_name, 'Unassigned / Unknown')
          END,
          CASE
            WHEN ${collapseScopedOfficeAdminRowsParam}::boolean THEN COALESCE(NULLIF(${scopedOfficeAdminMarketCenterIdParam}::text, ''), COALESCE(r.mc_source_id, ''))
            WHEN ${useAssociateGroupingParam}::boolean
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

    const result = await pool.query<{
      market_center_name: string;
      mc_source_id: string;
      contracts: string;
      units: string;
      total_gci: string;
      growth_share: string;
      royalties: string;
      company_dollar: string;
      cos_to_gci_pct: string;
      associate_dollar: string;
      team_dollar: string;
      overall_contracts: string;
      overall_units: string;
      overall_total_gci: string;
      overall_growth_share: string;
      overall_royalties: string;
      overall_company_dollar: string;
      overall_associate_dollar: string;
      overall_team_dollar: string;
    }>(sql, params);

    let liveRows: MCRow[] = result.rows.map((row) => {
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
    let totalContracts = first ? Number(first.overall_contracts) : 0;
    let totalUnits = first ? Number(first.overall_units) : 0;
    let totalGciRounded = first ? Number(first.overall_total_gci) : 0;
    let totalGrowthShare = first ? Number(first.overall_growth_share) : 0;
    let totalRoyalties = first ? Number(first.overall_royalties) : 0;
    let totalCompanyDollar = first ? Number(first.overall_company_dollar) : 0;
    let totalAssociateDollar = first ? Number(first.overall_associate_dollar) : 0;
    let totalTeamDollar = first ? Number(first.overall_team_dollar) : 0;
    const historicalRowCount = historicalForUnified.rows.length;
    const transitionRowCount = transitionForUnified.rows.length;
    const historicalGapFallbackRowCount = historicalGapFallbackForUnified.rows.length;

    if (useUnified) {
      const unifiedHistoricalRows = allowHistoricalAggregateMerge
        ? [...historicalForUnified.rows, ...historicalGapFallbackForUnified.rows, ...transitionForUnified.rows]
        : scopedHistoricalRowsFromDetail;
      const composed = [...unifiedHistoricalRows, ...liveRows];
      if (composed.length > 0) {
        const mergedRows = mergeMcRows(composed);
      liveRows = mergedRows;
      totalContracts = mergedRows.reduce((acc, row) => acc + row.contracts, 0);
      totalUnits = mergedRows.reduce((acc, row) => acc + row.units, 0);
      totalGciRounded = round2(mergedRows.reduce((acc, row) => acc + row.total_gci, 0));
      totalGrowthShare = round2(mergedRows.reduce((acc, row) => acc + row.growth_share, 0));
      totalRoyalties = round2(mergedRows.reduce((acc, row) => acc + row.royalties, 0));
      totalCompanyDollar = round2(mergedRows.reduce((acc, row) => acc + row.company_dollar, 0));
      totalAssociateDollar = round2(mergedRows.reduce((acc, row) => acc + row.associate_dollar, 0));
      totalTeamDollar = round2(mergedRows.reduce((acc, row) => acc + row.team_dollar, 0));

      // Historical-only windows must preserve the canonical historical distinct contract count.
      if (allowHistoricalAggregateMerge && result.rows.length === 0 && historicalGapFallbackForUnified.rows.length === 0 && transitionForUnified.rows.length === 0) {
        totalContracts = historicalForUnified.contracts;
      }
      }
    }

    if (hasStartStatusFilter) {
      const monthEndTransactionsLayer = router.stack.find((layer: any) =>
        layer.route
        && layer.route.path === '/month-end/transactions'
      );
      const monthEndTransactionsHandler = monthEndTransactionsLayer?.route?.stack?.[monthEndTransactionsLayer.route.stack.length - 1]?.handle as
        | ((req: Request, res: Response) => Promise<void>)
        | undefined;

      if (monthEndTransactionsHandler) {
        const monthEndTransactionsReq = {
          ...req,
          headers: req.headers,
          permissions: req.permissions,
          query: {
            date_from: dateFrom,
            date_to: dateTo,
            date_basis: 'transaction',
            transaction_status: transactionStatuses.join(','),
            sale_type: saleTypes.join(','),
            market_center_ids: effectiveMarketCenterIds.join(','),
            team_id: effectiveTeamId,
            associate_id: effectiveAssociateId,
            preview_batch_id: selectedHistoricalPreviewBatchId ?? '',
          },
        } as unknown as Request;

        const monthEndTransactionsResState: { statusCode: number; payload: unknown } = { statusCode: 200, payload: null };
        const monthEndTransactionsRes = {
          status(code: number) {
            monthEndTransactionsResState.statusCode = code;
            return this;
          },
          json(payload: unknown) {
            monthEndTransactionsResState.payload = payload;
            return this;
          },
          setHeader() {
            return this;
          },
        } as unknown as Response;

        await monthEndTransactionsHandler(monthEndTransactionsReq, monthEndTransactionsRes);
        if (monthEndTransactionsResState.statusCode < 400 && monthEndTransactionsResState.payload && typeof monthEndTransactionsResState.payload === 'object') {
          const detailPayload = monthEndTransactionsResState.payload as { rows?: MonthEndDetailRow[] };
          const detailRows = detailPayload.rows ?? [];
          const aggregatedRows = aggregateDetailRowsToMcRows(detailRows);
          liveRows = aggregatedRows;
          totalContracts = aggregatedRows.reduce((sum, row) => sum + row.contracts, 0);
          totalUnits = aggregatedRows.reduce((sum, row) => sum + row.units, 0);
          totalGciRounded = round2(aggregatedRows.reduce((sum, row) => sum + row.total_gci, 0));
          totalGrowthShare = round2(aggregatedRows.reduce((sum, row) => sum + row.growth_share, 0));
          totalRoyalties = round2(aggregatedRows.reduce((sum, row) => sum + row.royalties, 0));
          totalCompanyDollar = round2(aggregatedRows.reduce((sum, row) => sum + row.company_dollar, 0));
          totalAssociateDollar = round2(aggregatedRows.reduce((sum, row) => sum + row.associate_dollar, 0));
          totalTeamDollar = round2(aggregatedRows.reduce((sum, row) => sum + row.team_dollar, 0));
        }
      }
    }

    const payload: Record<string, unknown> = {
      rows: liveRows,
      totals: {
        contracts: totalContracts,
        units: totalUnits,
        total_gci: totalGciRounded,
        growth_share: Math.round(totalGrowthShare * 100) / 100,
        royalties: Math.round(totalRoyalties * 100) / 100,
        company_dollar: Math.round(totalCompanyDollar * 100) / 100,
        cos_to_gci_pct:
          totalGciRounded > 0
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
        returned_rows: liveRows.length,
      };
    }

    if (useUnified) {
      res.setHeader('x-local-month-end-debug', JSON.stringify({
        sourceMode: 'unified',
        allowHistoricalAggregateMerge,
        historicalRowCount,
        historicalGapFallbackRowCount,
        transitionExceptionRowCount: transitionRowCount,
        liveRowCount: result.rows.length,
        windows,
        featureFlags: {
          monthEndUnifiedEnabled: monthEndUnified.enabled,
          monthEndUnifiedShadowCompareEnabled: monthEndUnified.shadowCompareEnabled,
          monthEndTransitionExceptionsEnabled: monthEndUnified.transitionExceptionsEnabled,
          monthEndHistoricalEnabled: monthEndUnified.historicalEnabled,
          monthEndLiveEnabled: monthEndUnified.liveEnabled,
          monthEndHistoricalCorrectionPreviewBatchIdConfigured: monthEndUnified.historicalCorrectionPreviewBatchId,
          monthEndHistoricalCorrectionPreviewBatchIdSelected: selectedHistoricalPreviewBatchId,
          historicalIsolationOnly,
        },
      }));
    }

    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/month-end/extended-filter-options', resolvePermissions, requireReportAccess(REPORT_KEYS.MONTH_END), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    const scopeFilters = await resolveReportRouteScopeFilters(req);
    const scopeMcId = scopeFilters.scopeMcId;
    const scopedTeamSourceId = scopeFilters.scopedTeamSourceId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;

    const optionsResult = await pool.query<{
      transaction_status: string | null;
      sale_type: string | null;
      source_market_center_id: string;
      market_center_name: string;
      source_team_id: string;
      team_name: string;
      source_associate_id: string;
      associate_name: string;
    }>(
      `
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
      `,
      [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const statuses = Array.from(
      new Set(optionsResult.rows.map((row) => (row.transaction_status ?? '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const saleTypes = Array.from(
      new Set(optionsResult.rows.map((row) => (row.sale_type ?? '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const marketCentersMap = new Map<string, string>();
    const teamsMap = new Map<string, MonthEndExtendedFilterOptions['teams'][number]>();
    const associatesMap = new Map<string, MonthEndExtendedFilterOptions['associates'][number]>();

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
    const payload: Record<string, unknown> = {
      statuses,
      sale_types: saleTypes,
      market_centers: Array.from(marketCentersMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      teams: Array.from(teamsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      associates: Array.from(associatesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    } satisfies MonthEndExtendedFilterOptions;

    if (debugMode) {
      payload.debug = {
        active_context: String(req.headers['x-active-context'] ?? ''),
        scope: perms.scope,
        reporting_scope: scopeFilters.reportingScope,
        scope_mc_id: scopeMcId,
        scoped_team_source_id: scopedTeamSourceId,
        resolved_scope_associate_id: resolvedScopeAssociateId,
        market_centers_count: payload.market_centers instanceof Array ? payload.market_centers.length : 0,
        teams_count: payload.teams instanceof Array ? payload.teams.length : 0,
        associates_count: payload.associates instanceof Array ? payload.associates.length : 0,
      };
    }

    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/month-end/transaction-summary', resolvePermissions, requireReportAccess(REPORT_KEYS.MONTH_END), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
    const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
    const monthEndUnified = getMonthEndUnifiedFlags();
    const useUnified = monthEndUnified.enabled;
    const requestedPreviewBatchId = String(req.query.preview_batch_id || '').trim();
    const selectedHistoricalPreviewBatchId = requestedPreviewBatchId || null;
    const historicalIsolationOnly = useUnified && isStrictHistoricalIsolationRequest(dateTo);
    const transactionStatuses = parseCsvParam(req.query.transaction_status).map((value) => value.trim()).filter(Boolean);
    const saleTypes = parseCsvParam(req.query.sale_type).map((value) => value.trim()).filter(Boolean);
    const teamId = String(req.query.team_id || '').trim();
    const associateId = String(req.query.associate_id || '').trim();
    const dateBasis = normalizeMonthEndDateBasis(req.query.date_basis);
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const scopeFilters = await resolveReportRouteScopeFilters(req, {
      requestedTeamId: teamId,
      requestedAssociateId: associateId,
      requestedMarketCenterIds: marketCenterIds,
    });
    const hasStartStatusFilter = transactionStatuses.some((status) => normalizeForMatch(status) === 'start');
    const effectiveMarketCenterIds = scopeFilters.effectiveMarketCenterIds;

    const scopeMcId = scopeFilters.scopeMcId;
    const effectiveTeamId = scopeFilters.effectiveTeamId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;
    const effectiveAssociateId = scopeFilters.effectiveAssociateId;
    const useAssociateGrouping = !!(effectiveTeamId || effectiveAssociateId);
    const allowHistoricalAggregateMerge = !useAssociateGrouping;
    const dateFilterExpr = buildHybridReportingDateSql('ct', 'tac');
    const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;

    const windows = resolveUnifiedSourceWindows(dateFrom, dateTo, monthEndUnified);
    const useFullLiveWindowForStart = useUnified && hasStartStatusFilter;
    const liveDateFrom = useUnified
      ? (useFullLiveWindowForStart
        ? dateFrom
        : (useAssociateGrouping
        ? dateFrom
        : (historicalIsolationOnly ? '9999-12-31' : (windows.liveWindow?.from ?? '9999-12-31'))))
      : dateFrom;
    const liveDateTo = useUnified
      ? (useFullLiveWindowForStart
        ? dateTo
        : (useAssociateGrouping
        ? dateTo
        : (historicalIsolationOnly ? '9999-12-31' : (windows.liveWindow?.to ?? '9999-12-31'))))
      : dateTo;

    let historicalForUnified: { rows: MCRow[]; contracts: number } = { rows: [], contracts: 0 };
    if (useUnified && allowHistoricalAggregateMerge && !useFullLiveWindowForStart) {
      if (windows.historicalWindow) {
        historicalForUnified = await fetchHistoricalMonthEndRows(
          windows.historicalWindow.from,
          windows.historicalWindow.to,
          transactionStatuses,
          saleTypes,
          selectedHistoricalPreviewBatchId,
        );
      } else {
        historicalForUnified = await fetchHistoricalMonthEndRows(
          dateFrom,
          dateFrom,
          ['__unified_live_only_probe__'],
          saleTypes,
          selectedHistoricalPreviewBatchId,
          false,
        );
      }
    }

    let historicalGapFallbackForUnified: { rows: MCRow[]; contracts: number } = { rows: [], contracts: 0 };
    if (useUnified && allowHistoricalAggregateMerge && !useFullLiveWindowForStart && shouldUseHistoricalGapFallback(windows.historicalWindow)) {
      const historicalWindow = windows.historicalWindow as UnifiedWindow;
      historicalGapFallbackForUnified = await fetchHistoricalGapFallbackMonthEndRows(
        historicalWindow.from,
        historicalWindow.to,
        transactionStatuses,
        saleTypes,
      );
    }

    let transitionForUnified: { rows: MCRow[]; contracts: number } = { rows: [], contracts: 0 };
    if (useUnified && allowHistoricalAggregateMerge && !useFullLiveWindowForStart && !historicalIsolationOnly && windows.transitionExceptionWindow) {
      transitionForUnified = await fetchTransitionExceptionMonthEndRows(
        windows.transitionExceptionWindow.from,
        windows.transitionExceptionWindow.to,
        transactionStatuses,
        saleTypes,
      );
    }

    if (allowHistoricalAggregateMerge && effectiveMarketCenterIds.length > 0) {
      historicalForUnified = {
        ...historicalForUnified,
        rows: filterByMarketCenterIds(historicalForUnified.rows, effectiveMarketCenterIds),
      };
      historicalGapFallbackForUnified = {
        ...historicalGapFallbackForUnified,
        rows: filterByMarketCenterIds(historicalGapFallbackForUnified.rows, effectiveMarketCenterIds),
      };
      transitionForUnified = {
        ...transitionForUnified,
        rows: filterByMarketCenterIds(transitionForUnified.rows, effectiveMarketCenterIds),
      };
    }

    const result = await pool.query<{
      market_center_name: string;
      mc_source_id: string;
      contracts: string;
      units: string;
      sales_price: string;
      mc_sales_volume: string;
      list_price: string;
      contract_gci: string;
      gci: string;
      royalties: string;
      growth_share: string;
      associate_dollar: string;
      company_dollar: string;
      team_dollar: string;
    }>(
      `
      WITH ${transactionAgentCalculationDedupCte},
      base AS (
        SELECT
          tac.transaction_id,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS tx_mc_name,
          COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS tx_mc_source_id,
          COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), '')) AS office_mc_name,
          COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS office_mc_source_id,
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
        WHERE ${dateFilterExpr} >= $1::date
          AND ${dateFilterExpr} <= $2::date
          AND ca.id IS NOT NULL
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            CARDINALITY($3::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($3::text[]) AS selected_status
              WHERE (
                LOWER(TRIM(selected_status)) = 'registered'
                AND ${buildRegisteredStatusSql('ct')}
              )
              OR (
                LOWER(TRIM(selected_status)) <> 'registered'
                AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM(selected_status))
              )
            )
          )
          AND (
            CARDINALITY($4::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($4::text[]) AS selected_sale_type
              WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
            )
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
      normalized AS (
        SELECT
          transaction_id,
          CASE
            WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_name
            ELSE office_mc_name
          END AS office_mc_name,
          CASE
            WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_source_id
            ELSE office_mc_source_id
          END AS office_mc_source_id,
          tx_mc_name,
          tx_mc_source_id,
          source_team_id,
          source_associate_id,
          associate_name,
          sales_price,
          list_price,
          contract_gci,
          gci,
          royalties,
          growth_share,
          associate_dollar,
          company_dollar,
          team_dollar,
          split_percentage,
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
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') AS has_referral,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') AS has_pc
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
               AND c.has_pc = false
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
               AND c.has_pc = false
               AND c.has_both = false
             )
            THEN COALESCE(n.office_mc_source_id, c.tx_mc_source_id, '')
            ELSE COALESCE(c.tx_mc_source_id, n.office_mc_source_id, '')
          END AS mc_source_id,
          n.source_team_id,
          n.source_associate_id,
          n.associate_name,
          n.sales_price,
          n.list_price,
          n.contract_gci,
          n.gci,
          n.royalties,
          n.growth_share,
          n.associate_dollar,
          n.company_dollar,
          n.team_dollar,
          n.split_percentage,
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
      per_tx AS (
        SELECT
          r.transaction_id,
          CASE WHEN $10::boolean
            THEN COALESCE(r.associate_name, 'Unknown Associate')
            ELSE COALESCE(r.market_center_name, 'Unassigned / Unknown')
          END AS market_center_name,
          CASE WHEN $10::boolean
            THEN COALESCE(r.source_associate_id, 'unassigned')
            ELSE COALESCE(r.mc_source_id, '')
          END AS mc_source_id,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%both%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%seller%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%buyer%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%seller%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%other%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(r.transaction_side)) LIKE '%pc%') THEN 1
            ELSE 0
          END::int AS units,
          MAX(r.sales_price)::numeric(18,2) AS sales_price,
          MAX(r.sales_price)::numeric(18,2) AS mc_sales_volume,
          MAX(r.list_price)::numeric(18,2) AS list_price,
          SUM(r.contract_gci)::numeric(18,2) AS contract_gci,
          SUM(r.gci)::numeric(18,2) AS gci,
          SUM(r.royalties)::numeric(18,2) AS royalties,
          SUM(r.growth_share)::numeric(18,2) AS growth_share,
          SUM(r.associate_dollar)::numeric(18,2) AS associate_dollar,
          SUM(r.company_dollar)::numeric(18,2) AS company_dollar,
          SUM(r.team_dollar)::numeric(18,2) AS team_dollar
        FROM resolved r
        JOIN tx_flags f ON f.transaction_id = r.transaction_id
        GROUP BY
          r.transaction_id,
          CASE WHEN $10::boolean
            THEN COALESCE(r.associate_name, 'Unknown Associate')
            ELSE COALESCE(r.market_center_name, 'Unassigned / Unknown')
          END,
          CASE WHEN $10::boolean
            THEN COALESCE(r.source_associate_id, 'unassigned')
            ELSE COALESCE(r.mc_source_id, '')
          END,
          f.tx_has_core
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
        WHERE COALESCE(array_length($7::text[], 1), 0) = 0 OR EXISTS (
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
      `,
      [
        liveDateFrom,
        liveDateTo,
        transactionStatuses,
        saleTypes,
        scopeMcId,
        resolvedScopeAssociateId,
        effectiveMarketCenterIds,
        effectiveTeamId,
        effectiveAssociateId,
        useAssociateGrouping,
      ]
    );

    let rows: MonthEndSummaryRow[] = result.rows.map((row) => ({
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

    if (useUnified && allowHistoricalAggregateMerge && (historicalForUnified.rows.length > 0 || historicalGapFallbackForUnified.rows.length > 0 || transitionForUnified.rows.length > 0)) {
      const historicalSummaryRows: MonthEndSummaryRow[] = [...historicalForUnified.rows, ...historicalGapFallbackForUnified.rows, ...transitionForUnified.rows].map((row) => ({
        market_center_name: row.market_center_name,
        mc_source_id: row.mc_source_id,
        contracts: row.contracts,
        units: row.units,
        sales_price: 0,
        mc_sales_volume: 0,
        list_price: 0,
        contract_gci: row.total_gci,
        gci: row.total_gci,
        royalties: row.royalties,
        growth_share: row.growth_share,
        associate_dollar: row.associate_dollar,
        company_dollar: row.company_dollar,
        team_dollar: row.team_dollar,
      }));
      rows = mergeSummaryRows([...historicalSummaryRows, ...rows]);

      res.setHeader('x-local-month-end-debug', JSON.stringify({
        sourceMode: 'unified',
        historicalRowCount: historicalForUnified.rows.length,
        historicalGapFallbackRowCount: historicalGapFallbackForUnified.rows.length,
        transitionExceptionRowCount: transitionForUnified.rows.length,
        liveRowCount: result.rows.length,
        windows,
        featureFlags: {
          monthEndUnifiedEnabled: monthEndUnified.enabled,
          monthEndUnifiedShadowCompareEnabled: monthEndUnified.shadowCompareEnabled,
          monthEndTransitionExceptionsEnabled: monthEndUnified.transitionExceptionsEnabled,
          monthEndHistoricalEnabled: monthEndUnified.historicalEnabled,
          monthEndLiveEnabled: monthEndUnified.liveEnabled,
          monthEndHistoricalCorrectionPreviewBatchIdConfigured: monthEndUnified.historicalCorrectionPreviewBatchId,
          monthEndHistoricalCorrectionPreviewBatchIdSelected: selectedHistoricalPreviewBatchId,
          historicalIsolationOnly,
        },
      }));
    } else if (useUnified) {
      res.setHeader('x-local-month-end-debug', JSON.stringify({
        sourceMode: 'unified',
        historicalRowCount: 0,
        historicalGapFallbackRowCount: 0,
        transitionExceptionRowCount: 0,
        liveRowCount: result.rows.length,
        windows,
        featureFlags: {
          monthEndUnifiedEnabled: monthEndUnified.enabled,
          monthEndUnifiedShadowCompareEnabled: monthEndUnified.shadowCompareEnabled,
          monthEndTransitionExceptionsEnabled: monthEndUnified.transitionExceptionsEnabled,
          monthEndHistoricalEnabled: monthEndUnified.historicalEnabled,
          monthEndLiveEnabled: monthEndUnified.liveEnabled,
          monthEndHistoricalCorrectionPreviewBatchIdConfigured: monthEndUnified.historicalCorrectionPreviewBatchId,
          monthEndHistoricalCorrectionPreviewBatchIdSelected: selectedHistoricalPreviewBatchId,
          historicalIsolationOnly,
        },
      }));
    }

    if (hasStartStatusFilter) {
      const monthEndTransactionsLayer = router.stack.find((layer: any) =>
        layer.route
        && layer.route.path === '/month-end/transactions'
      );
      const monthEndTransactionsHandler = monthEndTransactionsLayer?.route?.stack?.[monthEndTransactionsLayer.route.stack.length - 1]?.handle as
        | ((req: Request, res: Response) => Promise<void>)
        | undefined;

      if (monthEndTransactionsHandler) {
        const monthEndTransactionsReq = {
          ...req,
          headers: req.headers,
          permissions: req.permissions,
          query: {
            date_from: dateFrom,
            date_to: dateTo,
            date_basis: 'transaction',
            transaction_status: transactionStatuses.join(','),
            sale_type: saleTypes.join(','),
            market_center_ids: effectiveMarketCenterIds.join(','),
            team_id: effectiveTeamId,
            associate_id: effectiveAssociateId,
            preview_batch_id: selectedHistoricalPreviewBatchId ?? '',
          },
        } as unknown as Request;

        const monthEndTransactionsResState: { statusCode: number; payload: unknown } = { statusCode: 200, payload: null };
        const monthEndTransactionsRes = {
          status(code: number) {
            monthEndTransactionsResState.statusCode = code;
            return this;
          },
          json(payload: unknown) {
            monthEndTransactionsResState.payload = payload;
            return this;
          },
          setHeader() {
            return this;
          },
        } as unknown as Response;

        await monthEndTransactionsHandler(monthEndTransactionsReq, monthEndTransactionsRes);
        if (monthEndTransactionsResState.statusCode < 400 && monthEndTransactionsResState.payload && typeof monthEndTransactionsResState.payload === 'object') {
          const detailPayload = monthEndTransactionsResState.payload as { rows?: MonthEndDetailRow[] };
          rows = aggregateDetailRowsToSummaryRows(detailPayload.rows ?? []);
        }
      }
    }

    const totals = rows.reduce<MonthEndSummaryRow>((acc, row) => ({
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

    if (useUnified && historicalForUnified.rows.length > 0 && result.rows.length === 0) {
      totals.contracts = historicalForUnified.contracts;
    }

    const resolvedAssociateDbId = await resolveAssociateDbId(effectiveAssociateId || null);
    const capSnapshot = resolvedAssociateDbId
      ? await fetchAssociateCapCycleSnapshot(resolvedAssociateDbId)
      : null;

    if (capSnapshot) {
      totals.company_dollar = Math.round(capSnapshot.company_dollar * 100) / 100;
      if (useAssociateGrouping && rows.length === 1) {
        rows[0].company_dollar = totals.company_dollar;
      }
    }

    return res.json({
      rows,
      totals,
      date_basis: dateBasis,
      cap_snapshot: capSnapshot,
      transition_exception_count: useUnified ? 0 : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/month-end/transactions', resolvePermissions, requireReportAccess(REPORT_KEYS.MONTH_END), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
    const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
    const monthEndUnified = getMonthEndUnifiedFlags();
    const transactionStatuses = parseCsvParam(req.query.transaction_status).map((value) => value.trim()).filter(Boolean);
    const saleTypes = parseCsvParam(req.query.sale_type).map((value) => value.trim()).filter(Boolean);
    const teamId = String(req.query.team_id || '').trim();
    const associateId = String(req.query.associate_id || '').trim();
    const dateBasis = normalizeMonthEndDateBasis(req.query.date_basis);
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const scopeFilters = await resolveReportRouteScopeFilters(req, {
      requestedTeamId: teamId,
      requestedAssociateId: associateId,
      requestedMarketCenterIds: marketCenterIds,
    });
    const effectiveMarketCenterIds = scopeFilters.effectiveMarketCenterIds;

    const scopeMcId = scopeFilters.scopeMcId;
    const effectiveTeamId = scopeFilters.effectiveTeamId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;
    const effectiveAssociateId = scopeFilters.effectiveAssociateId;
    const useAssociateGrouping = !!(effectiveTeamId || effectiveAssociateId);
    const allowHistoricalDetailMerge = !(effectiveTeamId || effectiveAssociateId);
    const dateFilterExpr = buildHybridReportingDateSql('ct', 'tac');
    const hasStartStatusFilter = transactionStatuses.some((status) => normalizeForMatch(status) === 'start');
    const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;

    const useUnified = monthEndUnified.enabled;
    const requestedPreviewBatchId = String(req.query.preview_batch_id || '').trim();
    const selectedHistoricalPreviewBatchId = requestedPreviewBatchId || null;
    const historicalIsolationOnly = useUnified && isStrictHistoricalIsolationRequest(dateTo);
    const windows = resolveUnifiedSourceWindows(dateFrom, dateTo, monthEndUnified);
    const useFullLiveWindowForStart = useUnified && hasStartStatusFilter;
    const liveDateFrom = useUnified
      ? (useFullLiveWindowForStart
        ? dateFrom
        : (useAssociateGrouping
        ? dateFrom
        : (historicalIsolationOnly ? '9999-12-31' : (windows.liveWindow?.from ?? '9999-12-31'))))
      : dateFrom;
    const liveDateTo = useUnified
      ? (useFullLiveWindowForStart
        ? dateTo
        : (useAssociateGrouping
        ? dateTo
        : (historicalIsolationOnly ? '9999-12-31' : (windows.liveWindow?.to ?? '9999-12-31'))))
      : dateTo;

    let historicalForUnified: { rows: MonthEndDetailRow[]; unitRows: HistoricalDetailUnitRow[] } = { rows: [], unitRows: [] };
    if (useUnified && allowHistoricalDetailMerge && !useFullLiveWindowForStart && windows.historicalWindow) {
      historicalForUnified = await fetchHistoricalMonthEndDetailRows(
        windows.historicalWindow.from,
        windows.historicalWindow.to,
        transactionStatuses,
        saleTypes,
        selectedHistoricalPreviewBatchId,
      );
    }

    let historicalGapFallbackForUnified: { rows: MonthEndDetailRow[]; unitRows: HistoricalDetailUnitRow[] } = { rows: [], unitRows: [] };
    if (useUnified && allowHistoricalDetailMerge && !useFullLiveWindowForStart && shouldUseHistoricalGapFallback(windows.historicalWindow)) {
      const historicalWindow = windows.historicalWindow as UnifiedWindow;
      historicalGapFallbackForUnified = await fetchHistoricalGapFallbackMonthEndDetailRows(
        historicalWindow.from,
        historicalWindow.to,
        transactionStatuses,
        saleTypes,
      );
    }

    let transitionForUnified: { rows: MonthEndDetailRow[]; unitRows: HistoricalDetailUnitRow[] } = { rows: [], unitRows: [] };
    if (useUnified && allowHistoricalDetailMerge && !useFullLiveWindowForStart && !historicalIsolationOnly && windows.transitionExceptionWindow) {
      transitionForUnified = await fetchTransitionExceptionMonthEndDetailRows(
        windows.transitionExceptionWindow.from,
        windows.transitionExceptionWindow.to,
        transactionStatuses,
        saleTypes,
      );
    }

    if (allowHistoricalDetailMerge && effectiveMarketCenterIds.length > 0) {
      historicalForUnified = {
        rows: filterByMarketCenterIds(historicalForUnified.rows, effectiveMarketCenterIds),
        unitRows: filterByMarketCenterIds(historicalForUnified.unitRows, effectiveMarketCenterIds),
      };
      historicalGapFallbackForUnified = {
        rows: filterByMarketCenterIds(historicalGapFallbackForUnified.rows, effectiveMarketCenterIds),
        unitRows: filterByMarketCenterIds(historicalGapFallbackForUnified.unitRows, effectiveMarketCenterIds),
      };
      transitionForUnified = {
        rows: filterByMarketCenterIds(transitionForUnified.rows, effectiveMarketCenterIds),
        unitRows: filterByMarketCenterIds(transitionForUnified.unitRows, effectiveMarketCenterIds),
      };
    }

    const result = await pool.query<MonthEndDetailRow & {
      transaction_id: string;
      tx_mc_name: string;
      tx_mc_source_id: string;
      office_mc_name: string;
      office_mc_source_id: string;
      unit_side: string;
      resolution_side: string;
    }>(
      `
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
        COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS tx_mc_name,
        COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS tx_mc_source_id,
        COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), '')) AS office_mc_name,
        COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS office_mc_source_id,
        COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS market_center_name,
        COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS mc_source_id,
        COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
        COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
        COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
        COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(ca.source_team_id), ''), t.id::text, ca.team_id::text, NULLIF(TRIM(t.name), ''), 'No Team') AS source_team_id,
        COALESCE(NULLIF(TRIM(ct.transaction_number), ''), '') AS transaction_number,
        COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS unit_side,
        COALESCE(NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS resolution_side,
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
      WHERE ${dateFilterExpr} >= $1::date
        AND ${dateFilterExpr} <= $2::date
        AND ca.id IS NOT NULL
        AND ${salesOnlyTransactionExclusionSql}
        AND (
          CARDINALITY($3::text[]) = 0
          OR ${buildRegisteredOnlyOrSelectedStatusSql('ct', '$3::text[]')}
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($4::text[]) AS selected_sale_type
            WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
          )
        )
        AND (
          $5::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ct.source_market_center_id, mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
        )
        AND ($6::bigint IS NULL OR tac.associate_id = $6::bigint)
        AND (
          NULLIF($7::text, '') IS NULL
          OR (
            REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
          )
        )
        AND (
          NULLIF($8::text, '') IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
        )
      `,
      [
        liveDateFrom,
        liveDateTo,
        transactionStatuses,
        saleTypes,
        scopeMcId,
        resolvedScopeAssociateId,
        effectiveTeamId,
        effectiveAssociateId,
      ]
    );

    const includeStartFallbackRows = hasStartStatusFilter;

    let startFallbackRows: Array<MonthEndDetailRow & {
      transaction_id: string;
      tx_mc_name: string;
      tx_mc_source_id: string;
      office_mc_name: string;
      office_mc_source_id: string;
      unit_side: string;
      resolution_side: string;
    }> = [];

    if (includeStartFallbackRows) {
      const fallbackResult = await pool.query<MonthEndDetailRow & {
        transaction_id: string;
        tx_mc_name: string;
        tx_mc_source_id: string;
        office_mc_name: string;
        office_mc_source_id: string;
        unit_side: string;
        resolution_side: string;
      }>(
        `
        WITH latest_transaction_bonds AS (
          SELECT DISTINCT ON (source_transaction_id)
            source_transaction_id,
            bond_originator,
            bond_attorney,
            transfer_attorney
          FROM staging.transaction_bonds
          ORDER BY source_transaction_id, bond_due_date DESC NULLS LAST
        )
        SELECT
          ct.id::text AS transaction_id,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), 'Unassigned / Unknown') AS tx_mc_name,
          COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS tx_mc_source_id,
          COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), '') AS office_mc_name,
          COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS office_mc_source_id,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), 'Unassigned / Unknown') AS market_center_name,
          COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS mc_source_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') AS associate_name,
          COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS source_associate_id,
          COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') AS team_name,
          COALESCE(NULLIF(TRIM(t.source_team_id), ''), NULLIF(TRIM(ca.source_team_id), ''), t.id::text, ca.team_id::text, NULLIF(TRIM(t.name), ''), 'No Team') AS source_team_id,
          COALESCE(NULLIF(TRIM(ct.transaction_number), ''), ct.id::text) AS transaction_number,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS unit_side,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS resolution_side,
          ct.transaction_date::date::text AS transaction_date,
          ct.list_date::date::text AS list_date,
          ct.status_change_date::date::text AS status_change_date,
          COALESCE(NULLIF(TRIM(ct.listing_number), ''), NULLIF(TRIM(cl.listing_number), ''), '') AS kwl_number,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(ct.transaction_type), ''), '') AS transaction_type,
          COALESCE(NULLIF(TRIM(ct.sale_type), ''), NULLIF(TRIM(ct.transaction_type), ''), '') AS sale_type,
          COALESCE(NULLIF(TRIM(ct.transaction_status), ''), '') AS transaction_status,
          COALESCE(NULLIF(TRIM(ct.suburb), ''), NULLIF(TRIM(cl.suburb), ''), '') AS suburb,
          COALESCE(NULLIF(TRIM(ct.city), ''), NULLIF(TRIM(cl.city), ''), '') AS city,
          COALESCE(NULLIF(TRIM(ct.buyer), ''), '') AS buyer,
          COALESCE(NULLIF(TRIM(ct.seller), ''), '') AS seller,
          COALESCE(ct.list_price, 0)::numeric(18,2) AS list_price,
          COALESCE(ct.sales_price, 0)::numeric(18,2) AS sales_price,
          COALESCE(ta.split_percentage, 0)::numeric(18,4) AS th_split_pct,
          ROUND(COALESCE(ct.sales_price, 0)::numeric(18,2) * (COALESCE(ta.split_percentage, 0)::numeric(18,4) / 100), 2)::numeric(18,2) AS agent_sales_volume,
          0::numeric(18,4) AS comm_pct,
          CASE
            WHEN COALESCE(ta.split_percentage, 0) > 0
              THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
            ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
          END::numeric(18,2) AS contract_gci,
          CASE
            WHEN COALESCE(ta.split_percentage, 0) > 0
              THEN ROUND(COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric * (COALESCE(ta.split_percentage, 0)::numeric / 100.0), 2)
            ELSE COALESCE(ct.transaction_gci_excl_vat, ct.gci_excl_vat, ct.total_gci, 0)::numeric(18,2)
          END::numeric(18,2) AS total_gci,
          0::numeric(18,2) AS royalties,
          0::numeric(18,2) AS growth_share,
          0::numeric(18,2) AS associate_dollar,
          0::numeric(18,2) AS company_dollar,
          0::numeric(18,2) AS team_dollar,
          0::numeric(18,2) AS cap_remaining,
          COALESCE(NULLIF(TRIM(mc_office.name), ''), '') AS listing_office,
          COALESCE(NULLIF(TRIM(tb.bond_originator), ''), '') AS bond_originator,
          COALESCE(NULLIF(TRIM(tb.bond_attorney), ''), '') AS bond_attorney,
          ''::text AS bond_attorney_email,
          ''::text AS bond_attorney_phone,
          COALESCE(NULLIF(TRIM(tb.transfer_attorney), ''), '') AS transfer_attorney,
          ''::text AS transfer_attorney_email,
          ''::text AS transfer_attorney_phone
        FROM migration.core_transactions ct
        LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
        LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_listings cl ON cl.source_listing_id = ct.source_listing_id
        LEFT JOIN latest_transaction_bonds tb ON tb.source_transaction_id = ct.source_transaction_id
        LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(ct.market_center_name, '')))
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
        LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
        LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
        WHERE ct.transaction_date::date >= $1::date
          AND ct.transaction_date::date <= $2::date
          AND ca.id IS NOT NULL
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            CARDINALITY($3::text[]) = 0
            OR ${buildRegisteredOnlyOrSelectedStatusSql('ct', '$3::text[]')}
          )
          AND (
            CARDINALITY($4::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($4::text[]) AS selected_sale_type
              WHERE ${normalizedSaleTypeSql} = LOWER(TRIM(selected_sale_type))
            )
          )
          AND (
            $5::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ct.source_market_center_id, mc_tx_primary.source_market_center_id, mc_tx.source_market_center_id, mc_office.source_market_center_id, mc_assoc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($6::bigint IS NULL OR ca.id = $6::bigint)
          AND (
            NULLIF($7::text, '') IS NULL
            OR (
              REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(ca.source_team_id, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.team_id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.name, ''), ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($7::text)), '[^a-z0-9]+', '', 'g')
            )
          )
          AND (
            NULLIF($8::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($8::text)), '[^a-z0-9]+', '', 'g')
          )
          AND (
            ta.id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM migration.transaction_agent_calculations tac_existing
              WHERE tac_existing.transaction_agent_id = ta.id
            )
          )
        `,
        [
          liveDateFrom,
          liveDateTo,
          transactionStatuses,
          saleTypes,
          scopeMcId,
          resolvedScopeAssociateId,
          effectiveTeamId,
          effectiveAssociateId,
        ]
      );
      startFallbackRows = fallbackResult.rows;
    }

    const liveDetailSourceRows = [...result.rows, ...startFallbackRows];

    const normalizedSelectedMcIds = new Set(effectiveMarketCenterIds.map((value) => normalizeIdToken(value)).filter(Boolean));

    const liveRowsWithMeta = liveDetailSourceRows.map((row) => ({
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
      _transaction_id: row.transaction_id,
      _tx_mc_name: row.tx_mc_name,
      _tx_mc_source_id: row.tx_mc_source_id,
      _office_mc_name: row.office_mc_name,
      _office_mc_source_id: row.office_mc_source_id,
      _unit_side: row.unit_side,
      _resolution_side: row.resolution_side,
    }));

    const txResolution = new Map<string, {
      officeMcCount: number;
      txMcName: string;
      txMcSourceId: string;
      hasBoth: boolean;
      hasBuyer: boolean;
      hasSeller: boolean;
      hasOther: boolean;
      hasReferral: boolean;
      hasPc: boolean;
    }>();

    for (const row of liveRowsWithMeta) {
      const key = row._transaction_id;
      const existing = txResolution.get(key) ?? {
        officeMcCount: 0,
        txMcName: row._tx_mc_name,
        txMcSourceId: row._tx_mc_source_id,
        hasBoth: false,
        hasBuyer: false,
        hasSeller: false,
        hasOther: false,
        hasReferral: false,
        hasPc: false,
      };

      const side = String(row._resolution_side ?? '').toLowerCase();
      existing.hasBoth = existing.hasBoth || side.includes('both');
      existing.hasBuyer = existing.hasBuyer || side.includes('buyer');
      existing.hasSeller = existing.hasSeller || side.includes('seller');
      existing.hasOther = existing.hasOther || side.includes('other');
      existing.hasReferral = existing.hasReferral || side.includes('referral');
      existing.hasPc = existing.hasPc || side.includes('pc');

      txResolution.set(key, existing);
    }

    for (const [transactionId, existing] of txResolution.entries()) {
      const offices = new Set(
        liveRowsWithMeta
          .filter((row) => row._transaction_id === transactionId)
          .map((row) => (row._office_mc_name ?? '').trim())
          .filter((value) => value.length > 0)
      );
      existing.officeMcCount = offices.size;
      txResolution.set(transactionId, existing);
    }

    const liveRowsResolved = liveRowsWithMeta
      .map((row) => {
        const tx = txResolution.get(row._transaction_id);
        if (!tx) {
          return {
            ...row,
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
          };
        }

        const preferOfficeMc = tx.officeMcCount > 1 && !(
          tx.officeMcCount === 2
          && tx.hasSeller
          && tx.hasOther
          && !tx.hasBuyer
          && !tx.hasReferral
          && !tx.hasPc
          && !tx.hasBoth
        );

        const resolvedName = preferOfficeMc
          ? (row._office_mc_name || tx.txMcName || 'Unassigned / Unknown')
          : (tx.txMcName || row._office_mc_name || 'Unassigned / Unknown');
        const resolvedSourceId = preferOfficeMc
          ? (row._office_mc_source_id || tx.txMcSourceId || '')
          : (tx.txMcSourceId || row._office_mc_source_id || '');

        return {
          ...row,
          market_center_name: resolvedName,
          mc_source_id: resolvedSourceId,
        };
      })
      .filter((row) => {
        if (normalizedSelectedMcIds.size === 0) return true;
        return normalizedSelectedMcIds.has(normalizeIdToken(row.mc_source_id));
      });

    let rows: MonthEndDetailRow[] = liveRowsResolved.map((row) => ({
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
      list_price: row.list_price,
      sales_price: row.sales_price,
      th_split_pct: row.th_split_pct,
      agent_sales_volume: row.agent_sales_volume,
      comm_pct: row.comm_pct,
      contract_gci: row.contract_gci,
      total_gci: row.total_gci,
      royalties: row.royalties,
      growth_share: row.growth_share,
      associate_dollar: row.associate_dollar,
      company_dollar: row.company_dollar,
      team_dollar: row.team_dollar,
      cap_remaining: row.cap_remaining,
      listing_office: row.listing_office,
      bond_originator: row.bond_originator,
      bond_attorney: row.bond_attorney,
      bond_attorney_email: row.bond_attorney_email,
      bond_attorney_phone: row.bond_attorney_phone,
      transfer_attorney: row.transfer_attorney,
      transfer_attorney_email: row.transfer_attorney_email,
      transfer_attorney_phone: row.transfer_attorney_phone,
    }));

    if (useUnified && allowHistoricalDetailMerge && (historicalForUnified.rows.length > 0 || historicalGapFallbackForUnified.rows.length > 0 || transitionForUnified.rows.length > 0)) {
      rows = [...historicalForUnified.rows, ...historicalGapFallbackForUnified.rows, ...transitionForUnified.rows, ...rows];
    }

    const txMcMap = new Map<string, { hasBoth: boolean; hasBuyer: boolean; hasSeller: boolean; hasOther: boolean; hasReferral: boolean; hasPc: boolean; listPrice: number; salesPrice: number }>();
    for (const row of liveRowsResolved) {
      const key = `${row.mc_source_id}::${row._transaction_id}`;
      const existing = txMcMap.get(key) ?? { hasBoth: false, hasBuyer: false, hasSeller: false, hasOther: false, hasReferral: false, hasPc: false, listPrice: 0, salesPrice: 0 };
      const side = String(row._unit_side ?? '').toLowerCase();
      existing.hasBoth = existing.hasBoth || side.includes('both');
      existing.hasBuyer = existing.hasBuyer || side.includes('buyer');
      existing.hasSeller = existing.hasSeller || side.includes('seller');
      existing.hasOther = existing.hasOther || side.includes('other');
      existing.hasReferral = existing.hasReferral || side.includes('referral');
      existing.hasPc = existing.hasPc || side.includes('pc');
      existing.listPrice = Math.max(existing.listPrice, Number(row.list_price));
      existing.salesPrice = Math.max(existing.salesPrice, Number(row.sales_price));
      txMcMap.set(key, existing);
    }

    for (const row of allowHistoricalDetailMerge ? [...historicalForUnified.unitRows, ...historicalGapFallbackForUnified.unitRows, ...transitionForUnified.unitRows] : []) {
      const key = `${row.mc_source_id}::${row.transaction_id}`;
      const existing = txMcMap.get(key) ?? { hasBoth: false, hasBuyer: false, hasSeller: false, hasOther: false, hasReferral: false, hasPc: false, listPrice: 0, salesPrice: 0 };
      const side = String(row.unit_side ?? '').toLowerCase();
      existing.hasBoth = existing.hasBoth || side.includes('both');
      existing.hasBuyer = existing.hasBuyer || side.includes('buyer');
      existing.hasSeller = existing.hasSeller || side.includes('seller');
      existing.hasOther = existing.hasOther || side.includes('other');
      existing.hasReferral = existing.hasReferral || side.includes('referral');
      existing.hasPc = existing.hasPc || side.includes('pc');
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
      } else if (item.hasBuyer && item.hasSeller) {
        totalUnits += 2;
      } else if (item.hasBuyer || item.hasSeller) {
        totalUnits += 1;
      } else if (item.hasOther || item.hasReferral || item.hasPc) {
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

    if (allowHistoricalDetailMerge && (historicalForUnified.unitRows.length > 0 || historicalGapFallbackForUnified.unitRows.length > 0 || transitionForUnified.unitRows.length > 0)) {
      const historicalContracts = new Set(
        [...historicalForUnified.unitRows, ...historicalGapFallbackForUnified.unitRows, ...transitionForUnified.unitRows]
          .map((row) => (row.transaction_number ?? '').trim())
          .filter((value) => value.length > 0)
      );
      const historicalUnits = [...historicalForUnified.unitRows, ...historicalGapFallbackForUnified.unitRows, ...transitionForUnified.unitRows].reduce((sum, row) => sum + row.unit_contribution, 0);

      if (liveDetailSourceRows.length === 0 && historicalForUnified.unitRows.length > 0 && historicalGapFallbackForUnified.unitRows.length === 0 && transitionForUnified.unitRows.length === 0) {
        totals.contracts = historicalContracts.size;
        totals.units = Math.round(historicalUnits);
      }
    }

    const resolvedAssociateDbId = await resolveAssociateDbId(effectiveAssociateId || null);
    const capSnapshot = resolvedAssociateDbId
      ? await fetchAssociateCapCycleSnapshot(resolvedAssociateDbId)
      : null;

    const isRegisteredOnlyStatusFilter = transactionStatuses.length > 0
      && transactionStatuses.every((status) => normalizeForMatch(status) === 'registered');

    if (capSnapshot && resolvedAssociateDbId && isRegisteredOnlyStatusFilter && rows.length > 0) {
      const rowsWithOrder = rows
        .map((row, index) => {
          const dateToken = dateBasis === 'transaction'
            ? (row.transaction_date || row.status_change_date || row.list_date)
            : (row.status_change_date || row.transaction_date || row.list_date);
          const time = dateToken ? Date.parse(dateToken) : Number.NaN;
          return {
            index,
            row,
            time: Number.isFinite(time) ? time : Number.POSITIVE_INFINITY,
          };
        })
        .sort((a, b) => {
          if (a.time !== b.time) return a.time - b.time;
          return (a.row.transaction_number ?? '').localeCompare(b.row.transaction_number ?? '');
        });

      let runningCompanyDollar = 0;
      const remainingByIndex = new Map<number, number>();
      for (const item of rowsWithOrder) {
        runningCompanyDollar += Number(item.row.company_dollar ?? 0);
        const remaining = Math.max((capSnapshot.cap_amount ?? 0) - runningCompanyDollar, 0);
        remainingByIndex.set(item.index, Math.round(remaining * 100) / 100);
      }

      rows = rows.map((row, index) => ({
        ...row,
        cap_remaining: remainingByIndex.get(index) ?? row.cap_remaining,
      }));

      totals.cap_remaining = Math.round(Math.max((capSnapshot.cap_amount ?? 0) - runningCompanyDollar, 0) * 100) / 100;
    }

    if (useUnified) {
      res.setHeader('x-local-month-end-debug', JSON.stringify({
        sourceMode: 'unified',
        historicalRowCount: historicalForUnified.rows.length,
        historicalGapFallbackRowCount: historicalGapFallbackForUnified.rows.length,
        transitionExceptionRowCount: transitionForUnified.rows.length,
        liveRowCount: liveRowsResolved.length,
        windows,
        featureFlags: {
          monthEndUnifiedEnabled: monthEndUnified.enabled,
          monthEndUnifiedShadowCompareEnabled: monthEndUnified.shadowCompareEnabled,
          monthEndTransitionExceptionsEnabled: monthEndUnified.transitionExceptionsEnabled,
          monthEndHistoricalEnabled: monthEndUnified.historicalEnabled,
          monthEndLiveEnabled: monthEndUnified.liveEnabled,
          monthEndHistoricalCorrectionPreviewBatchIdConfigured: monthEndUnified.historicalCorrectionPreviewBatchId,
          monthEndHistoricalCorrectionPreviewBatchIdSelected: selectedHistoricalPreviewBatchId,
          historicalIsolationOnly,
        },
      }));
    }

    return res.json({ rows, totals, date_basis: dateBasis, cap_snapshot: capSnapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/month-end/shadow/live-events', resolvePermissions, requireReportAccess(REPORT_KEYS.MONTH_END), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  if (!isLiveReportingEventShadowEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
    const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
    const transactionStatuses = parseCsvParam(req.query.transaction_status).map((value) => value.trim()).filter(Boolean);
    const saleTypes = parseCsvParam(req.query.sale_type).map((value) => value.trim()).filter(Boolean);
    const teamId = String(req.query.team_id || '').trim();
    const associateId = String(req.query.associate_id || '').trim();
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const scopeFilters = await resolveReportRouteScopeFilters(req, {
      requestedTeamId: teamId,
      requestedAssociateId: associateId,
      requestedMarketCenterIds: marketCenterIds,
    });
    const effectiveMarketCenterIds = scopeFilters.effectiveMarketCenterIds;

    const scopeMcId = scopeFilters.scopeMcId;
    const effectiveTeamId = scopeFilters.effectiveTeamId;
    const effectiveAssociateId = scopeFilters.effectiveAssociateId;

    const summary = await queryLiveReportingShadowSummary(pool, {
      dateFrom,
      dateTo,
      statuses: transactionStatuses,
      saleTypes,
      marketCenterIds: [scopeMcId].filter((value): value is string => Boolean(value)).concat(effectiveMarketCenterIds),
      teamIds: effectiveTeamId ? [effectiveTeamId] : [],
      associateIds: effectiveAssociateId ? [effectiveAssociateId] : [],
    });

    return res.json({
      range: { date_from: dateFrom, date_to: dateTo },
      event_activity: summary.eventActivity,
      allocation_projection: summary.allocationProjection,
      production_totals: summary.productionTotals,
      // Legacy aliases retained for compatibility with earlier local scripts.
      event_count: summary.eventCount,
      distinct_transaction_count: summary.distinctTransactionCount,
      pending_allocation_count: summary.pendingAllocationCount,
      pending_calculation_count: summary.pendingCalculationCount,
      financially_ready_count: summary.financiallyReadyCount,
      stale_financial_snapshot_count: summary.staleFinancialSnapshotCount,
      calculation_failed_count: summary.calculationFailedCount,
      contracts: summary.contracts,
      units: summary.units,
      total_gci: summary.totalGci,
      royalty: summary.royalty,
      growth_share: summary.growthShare,
      company_dollar: summary.companyDollar,
      associate_dollar: summary.associateDollar,
      team_dollar: summary.teamDollar,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/top-down-agent/filter-options', resolvePermissions, requireReportAccess(REPORT_KEYS.TOP_DOWN_PERFORMANCE), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const scopeFilters = await resolveReportRouteScopeFilters(req);
    const scopeMcId = scopeFilters.scopeMcId;
    const scopedTeamSourceId = scopeFilters.scopedTeamSourceId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;

    const associatesResult = await pool.query<{
      mc_source_id: string;
      market_center_name: string;
      source_team_id: string;
      team_name: string;
      source_associate_id: string;
      associate_name: string;
    }>(
      `
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
      `,
      [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const productionOptionRows = await pool.query<{
      transaction_status: string | null;
      sale_type: string | null;
    }>(
      `
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
      `,
      [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const listingOptionRows = await pool.query<{
      listing_status: string | null;
      sale_or_rent: string | null;
      mandate_type: string | null;
    }>(
      `
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
      `,
      [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const marketCenterMap = new Map<string, string>();
    const associates: TopDownAgentFilterOptions['associates'] = [];
    const teamsMap = new Map<string, TopDownAgentFilterOptions['teams'][number]>();

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

    const transactionStatuses = Array.from(new Set(
      productionOptionRows.rows
        .map((row) => (row.transaction_status ?? '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    const saleTypes = Array.from(new Set(
      productionOptionRows.rows
        .map((row) => (row.sale_type ?? '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    const listingStatuses = Array.from(new Set(
      listingOptionRows.rows
        .map((row) => (row.listing_status ?? '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    const saleOrRentOptions = Array.from(new Set(
      listingOptionRows.rows
        .map((row) => (row.sale_or_rent ?? '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    const mandateTypes = Array.from(new Set(
      listingOptionRows.rows
        .map((row) => (row.mandate_type ?? '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

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
    } satisfies TopDownAgentFilterOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/top-down-agent', resolvePermissions, requireReportAccess(REPORT_KEYS.TOP_DOWN_PERFORMANCE), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const dateFrom = String(req.query.date_from || getFirstOfMonthInAppTimeZone());
    const dateTo = String(req.query.date_to || getTodayInAppTimeZone());
    const listDateFrom = String(req.query.list_date_from || getFirstOfMonthInAppTimeZone());
    const listDateTo = String(req.query.list_date_to || getTodayInAppTimeZone());
    const transactionStatuses = parseCsvParam(req.query.transaction_status);
    const saleTypes = parseCsvParam(req.query.sale_type);
    const listingStatuses = parseCsvParam(req.query.listing_status);
    const saleOrRents = parseCsvParam(req.query.sale_or_rent);
    const mandateTypes = parseCsvParam(req.query.mandate_type);
    const associateId = String(req.query.associate_id || '').trim();
    const teamId = String(req.query.team_id || '').trim();
    const associateQuery = String(req.query.associate_query || '').trim();
    const teamQuery = String(req.query.team_query || '').trim();
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const scopeFilters = await resolveReportRouteScopeFilters(req, {
      requestedTeamId: teamId,
      requestedAssociateId: associateId,
      requestedMarketCenterIds: marketCenterIds,
    });

    const scopeMcId = scopeFilters.scopeMcId;
    const effectiveTeamId = scopeFilters.effectiveTeamId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;
    const effectiveAssociateId = scopeFilters.effectiveAssociateId;
    const effectiveMarketCenterIds = scopeFilters.effectiveMarketCenterIds;

    const productionDateExpr = buildHybridReportingDateSql('ct', 'tac');

    const productionRowsResult = await pool.query<{
      source_associate_id: string;
      associate_name: string;
      team_name: string;
      market_center_name: string;
      mc_source_id: string;
      contracts: string;
      units: string;
      total_gci: string;
      growth_share: string;
      royalties: string;
      company_dollar: string;
      associate_dollar: string;
      team_dollar: string;
    }>(
      `
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
        WHERE ${productionDateExpr} >= $1::date
          AND ${productionDateExpr} <= $2::date
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            CARDINALITY($3::text[]) = 0
            OR (
              EXISTS (
                SELECT 1
                FROM UNNEST($3::text[]) AS selected_status
                WHERE LOWER(TRIM(selected_status)) = 'registered'
              )
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
            )
            OR (
              NOT EXISTS (
                SELECT 1
                FROM UNNEST($3::text[]) AS selected_status
                WHERE LOWER(TRIM(selected_status)) = 'registered'
              )
              AND EXISTS (
                SELECT 1
                FROM UNNEST($3::text[]) AS selected_status
                WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM(selected_status))
              )
            )
          )
          AND (
            CARDINALITY($4::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($4::text[]) AS selected_sale_type
              WHERE LOWER(TRIM(COALESCE(NULLIF(ct.sale_type, ''), NULLIF(ct.transaction_type, ''), ''))) = LOWER(TRIM(selected_sale_type))
            )
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
      `,
      [
        dateFrom,
        dateTo,
        transactionStatuses,
        saleTypes,
        scopeMcId,
        resolvedScopeAssociateId,
        effectiveMarketCenterIds,
        associateQuery,
        teamQuery,
        effectiveAssociateId,
        effectiveTeamId,
      ]
    );

    const listingRowsResult = await pool.query<{
      source_associate_id: string;
      associate_name: string;
      team_name: string;
      market_center_name: string;
      mc_source_id: string;
      total_listings: string;
      active_listings: string;
      for_sale_listings: string;
      for_rent_listings: string;
      total_listing_value: string;
      avg_days_on_market: string;
      avg_listing_price: string;
    }>(
      `
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
          AND (
            CARDINALITY($3::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($3::text[]) AS selected_listing_status
              WHERE LOWER(TRIM(COALESCE(cl.status_name, cl.listing_status_tag, ''))) = LOWER(TRIM(selected_listing_status))
            )
          )
          AND (
            CARDINALITY($4::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($4::text[]) AS selected_sale_or_rent
              WHERE LOWER(TRIM(COALESCE(cl.sale_or_rent, ''))) = LOWER(TRIM(selected_sale_or_rent))
            )
          )
          AND (
            CARDINALITY($5::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($5::text[]) AS selected_mandate_type
              WHERE LOWER(TRIM(COALESCE(cl.mandate_type, ''))) = LOWER(TRIM(selected_mandate_type))
            )
          )
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
        ROUND(COALESCE(SUM(listing_price), 0)::numeric, 2)::text AS total_listing_value,
        ROUND(COALESCE(AVG(days_on_market), 0)::numeric, 2)::text AS avg_days_on_market,
        ROUND(COALESCE(AVG(listing_price), 0)::numeric, 2)::text AS avg_listing_price
      FROM filtered_listings
      GROUP BY source_associate_id, associate_name, team_name, market_center_name, mc_source_id
      ORDER BY COUNT(*) DESC, associate_name ASC
      `,
      [
        listDateFrom,
        listDateTo,
        listingStatuses,
        saleOrRents,
        mandateTypes,
        scopeMcId,
        resolvedScopeAssociateId,
        effectiveMarketCenterIds,
        associateQuery,
        teamQuery,
        effectiveAssociateId,
        effectiveTeamId,
      ]
    );

    const productionRows: TopDownAgentProductionRow[] = productionRowsResult.rows.map((row) => ({
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

    const productionCanonicalSummaryResult = await pool.query<{
      market_center_name: string;
      mc_source_id: string;
      contracts: string;
      units: string;
      total_gci: string;
      growth_share: string;
      royalties: string;
      company_dollar: string;
      associate_dollar: string;
      team_dollar: string;
    }>(
      `
      WITH ${transactionAgentCalculationDedupCte},
      base AS (
        SELECT
          tac.transaction_id,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS tx_mc_name,
          COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS tx_mc_source_id,
          COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), '')) AS office_mc_name,
          COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS office_mc_source_id,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side,
          COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
          COALESCE(tac.growth_share, 0)::numeric(18,2) AS growth_share,
          COALESCE(tac.production_royalties, 0)::numeric(18,2) AS royalties,
          COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar,
          COALESCE(tac.associate_dollar, 0)::numeric(18,2) AS associate_dollar,
          COALESCE(tac.team_dollar, 0)::numeric(18,2) AS team_dollar
        FROM tac_dedup tac
        LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
        LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
        LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
        LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
        WHERE ${productionDateExpr} >= $1::date
          AND ${productionDateExpr} <= $2::date
          AND ${salesOnlyTransactionExclusionSql}
          AND (
            CARDINALITY($3::text[]) = 0
            OR (
              EXISTS (
                SELECT 1
                FROM UNNEST($3::text[]) AS selected_status
                WHERE LOWER(TRIM(selected_status)) = 'registered'
              )
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
            )
            OR (
              NOT EXISTS (
                SELECT 1
                FROM UNNEST($3::text[]) AS selected_status
                WHERE LOWER(TRIM(selected_status)) = 'registered'
              )
              AND EXISTS (
                SELECT 1
                FROM UNNEST($3::text[]) AS selected_status
                WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM(selected_status))
              )
            )
          )
          AND (
            CARDINALITY($4::text[]) = 0
            OR EXISTS (
              SELECT 1
              FROM UNNEST($4::text[]) AS selected_sale_type
              WHERE LOWER(TRIM(COALESCE(NULLIF(ct.sale_type, ''), NULLIF(ct.transaction_type, ''), ''))) = LOWER(TRIM(selected_sale_type))
            )
          )
          AND (
            $5::text IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_office.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
          )
          AND ($6::bigint IS NULL OR tac.associate_id = $6::bigint)
          AND (
            NULLIF($8::text, '') IS NULL
            OR COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') ILIKE '%' || $8::text || '%'
          )
          AND (
            NULLIF($9::text, '') IS NULL
            OR COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') ILIKE '%' || $9::text || '%'
          )
          AND (
            NULLIF($11::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($11::text)), '[^a-z0-9]+', '', 'g')
          )
          AND (
            NULLIF($10::text, '') IS NULL
            OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($10::text)), '[^a-z0-9]+', '', 'g')
          )
      ),
      normalized AS (
        SELECT
          transaction_id,
          CASE
            WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_name
            ELSE office_mc_name
          END AS office_mc_name,
          CASE
            WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_source_id
            ELSE office_mc_source_id
          END AS office_mc_source_id,
          tx_mc_name,
          tx_mc_source_id,
          transaction_side,
          total_gci,
          growth_share,
          royalties,
          company_dollar,
          associate_dollar,
          team_dollar
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
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') AS has_referral,
          BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') AS has_pc
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
               AND c.has_pc = false
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
               AND c.has_pc = false
               AND c.has_both = false
             )
            THEN COALESCE(n.office_mc_source_id, c.tx_mc_source_id, '')
            ELSE COALESCE(c.tx_mc_source_id, n.office_mc_source_id, '')
          END AS mc_source_id,
          n.transaction_side,
          n.total_gci,
          n.growth_share,
          n.royalties,
          n.company_dollar,
          n.associate_dollar,
          n.team_dollar
        FROM normalized n
        JOIN mc_cardinality c ON c.transaction_id = n.transaction_id
      ),
      per_tx AS (
        SELECT
          transaction_id,
          COALESCE(market_center_name, 'Unassigned / Unknown') AS market_center_name,
          COALESCE(mc_source_id, '') AS mc_source_id,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AND BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 2
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') THEN 1
            WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') THEN 1
            ELSE 0
          END::int AS units,
          SUM(total_gci)::numeric(18,2) AS total_gci,
          SUM(growth_share)::numeric(18,2) AS growth_share,
          SUM(royalties)::numeric(18,2) AS royalties,
          SUM(company_dollar)::numeric(18,2) AS company_dollar,
          SUM(associate_dollar)::numeric(18,2) AS associate_dollar,
          SUM(team_dollar)::numeric(18,2) AS team_dollar
        FROM resolved
        GROUP BY transaction_id, COALESCE(market_center_name, 'Unassigned / Unknown'), COALESCE(mc_source_id, '')
      ),
      by_mc AS (
        SELECT
          market_center_name,
          mc_source_id,
          COUNT(*)::int AS contracts,
          COALESCE(SUM(units), 0)::int AS units,
          ROUND(COALESCE(SUM(total_gci), 0)::numeric, 2)::text AS total_gci,
          ROUND(COALESCE(SUM(growth_share), 0)::numeric, 2)::text AS growth_share,
          ROUND(COALESCE(SUM(royalties), 0)::numeric, 2)::text AS royalties,
          ROUND(COALESCE(SUM(company_dollar), 0)::numeric, 2)::text AS company_dollar,
          ROUND(COALESCE(SUM(associate_dollar), 0)::numeric, 2)::text AS associate_dollar,
          ROUND(COALESCE(SUM(team_dollar), 0)::numeric, 2)::text AS team_dollar
        FROM per_tx
        WHERE COALESCE(array_length($7::text[], 1), 0) = 0 OR EXISTS (
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
        total_gci,
        growth_share,
        royalties,
        company_dollar,
        associate_dollar,
        team_dollar
      FROM by_mc
      ORDER BY total_gci::numeric DESC, market_center_name ASC
      `,
      [
        dateFrom,
        dateTo,
        transactionStatuses,
        saleTypes,
        scopeMcId,
        resolvedScopeAssociateId,
        effectiveMarketCenterIds,
        associateQuery,
        teamQuery,
        effectiveAssociateId,
        effectiveTeamId,
      ]
    );

    const productionCanonicalSummaryRows = productionCanonicalSummaryResult.rows.map((row) => ({
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

    const productionCanonicalOverallResult = effectiveMarketCenterIds.length === 0
      ? await pool.query<{
        contracts: string;
        units: string;
        total_gci: string;
        company_dollar: string;
      }>(
        `
        WITH ${transactionAgentCalculationDedupCte},
        base AS (
          SELECT
            tac.transaction_id,
            COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS tx_mc_name,
            COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS tx_mc_source_id,
            COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(mc_assoc.name), ''), NULLIF(TRIM(tac.office_name), '')) AS office_mc_name,
            COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), NULLIF(TRIM(mc_assoc.source_market_center_id), ''), '') AS office_mc_source_id,
            COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side,
            COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0)::numeric(18,2) AS total_gci,
            COALESCE(tac.market_center_dollar, 0)::numeric(18,2) AS company_dollar
          FROM tac_dedup tac
          LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_teams t ON t.id = ca.team_id
          LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
          LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
          LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
          LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
          WHERE ${productionDateExpr} >= $1::date
            AND ${productionDateExpr} <= $2::date
            AND ${salesOnlyTransactionExclusionSql}
            AND (
              CARDINALITY($3::text[]) = 0
              OR (
                EXISTS (
                  SELECT 1
                  FROM UNNEST($3::text[]) AS selected_status
                  WHERE LOWER(TRIM(selected_status)) = 'registered'
                )
                AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
              )
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM UNNEST($3::text[]) AS selected_status
                  WHERE LOWER(TRIM(selected_status)) = 'registered'
                )
                AND EXISTS (
                  SELECT 1
                  FROM UNNEST($3::text[]) AS selected_status
                  WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM(selected_status))
                )
              )
            )
            AND (
              CARDINALITY($4::text[]) = 0
              OR EXISTS (
                SELECT 1
                FROM UNNEST($4::text[]) AS selected_sale_type
                WHERE LOWER(TRIM(COALESCE(NULLIF(ct.sale_type, ''), NULLIF(ct.transaction_type, ''), ''))) = LOWER(TRIM(selected_sale_type))
              )
            )
            AND (
              $5::text IS NULL
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_office.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx_primary.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc_tx.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($5::text)), '[^a-z0-9]+', '', 'g')
            )
            AND ($6::bigint IS NULL OR tac.associate_id = $6::bigint)
            AND (
              NULLIF($7::text, '') IS NULL
              OR COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(CONCAT(COALESCE(ca.first_name, ''), ' ', COALESCE(ca.last_name, ''))), ''), 'Unknown Associate') ILIKE '%' || $7::text || '%'
            )
            AND (
              NULLIF($8::text, '') IS NULL
              OR COALESCE(NULLIF(TRIM(t.name), ''), 'No Team') ILIKE '%' || $8::text || '%'
            )
            AND (
              NULLIF($10::text, '') IS NULL
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g')
                = REGEXP_REPLACE(LOWER(TRIM($10::text)), '[^a-z0-9]+', '', 'g')
            )
            AND (
              NULLIF($9::text, '') IS NULL
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_associate_id, ca.id::text, ''))), '[^a-z0-9]+', '', 'g')
                = REGEXP_REPLACE(LOWER(TRIM($9::text)), '[^a-z0-9]+', '', 'g')
            )
        ),
        normalized AS (
          SELECT
            transaction_id,
            CASE
              WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_name
              ELSE office_mc_name
            END AS office_mc_name,
            CASE
              WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_source_id
              ELSE office_mc_source_id
            END AS office_mc_source_id,
            tx_mc_name,
            tx_mc_source_id,
            transaction_side,
            total_gci,
            company_dollar
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
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') AS has_referral,
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') AS has_pc
          FROM normalized
          GROUP BY transaction_id
        ),
        resolved AS (
          SELECT
            n.transaction_id,
            n.transaction_side,
            n.total_gci,
            n.company_dollar
          FROM normalized n
          JOIN mc_cardinality c ON c.transaction_id = n.transaction_id
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
              WHEN BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') OR BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%pc%') THEN 1
              ELSE 0
            END::int AS units,
            SUM(total_gci)::numeric(18,2) AS total_gci,
            SUM(company_dollar)::numeric(18,2) AS company_dollar
          FROM resolved
          GROUP BY transaction_id
        )
        SELECT
          COUNT(*)::text AS contracts,
          COALESCE(SUM(units), 0)::text AS units,
          ROUND(COALESCE(SUM(total_gci), 0)::numeric, 2)::text AS total_gci,
          ROUND(COALESCE(SUM(company_dollar), 0)::numeric, 2)::text AS company_dollar
        FROM per_tx_global
        `,
        [
          dateFrom,
          dateTo,
          transactionStatuses,
          saleTypes,
          scopeMcId,
          resolvedScopeAssociateId,
          associateQuery,
          teamQuery,
          effectiveAssociateId,
          effectiveTeamId,
        ]
      )
      : null;

    const listingRows: TopDownAgentListingRow[] = listingRowsResult.rows.map((row) => ({
      source_associate_id: row.source_associate_id,
      associate_name: row.associate_name,
      team_name: row.team_name,
      market_center_name: row.market_center_name,
      mc_source_id: row.mc_source_id,
      total_listings: Number(row.total_listings),
      active_listings: Number(row.active_listings),
      for_sale_listings: Number(row.for_sale_listings),
      for_rent_listings: Number(row.for_rent_listings),
      total_listing_value: Number(row.total_listing_value),
      avg_days_on_market: Number(row.avg_days_on_market),
      avg_listing_price: Number(row.avg_listing_price),
    }));

    const overallCanonical = productionCanonicalOverallResult?.rows[0];

    const totals: TopDownAgentTotals = {
      production_contracts: overallCanonical
        ? Number(overallCanonical.contracts)
        : productionCanonicalSummaryRows.reduce((sum, row) => sum + row.contracts, 0),
      production_units: overallCanonical
        ? Number(overallCanonical.units)
        : productionCanonicalSummaryRows.reduce((sum, row) => sum + row.units, 0),
      production_gci: overallCanonical
        ? Number(overallCanonical.total_gci)
        : Math.round(productionCanonicalSummaryRows.reduce((sum, row) => sum + row.total_gci, 0) * 100) / 100,
      production_royalties: Math.round(productionCanonicalSummaryRows.reduce((sum, row) => sum + row.royalties, 0) * 100) / 100,
      production_growth_share: Math.round(productionCanonicalSummaryRows.reduce((sum, row) => sum + row.growth_share, 0) * 100) / 100,
      production_company_dollar: overallCanonical
        ? Number(overallCanonical.company_dollar)
        : Math.round(productionCanonicalSummaryRows.reduce((sum, row) => sum + row.company_dollar, 0) * 100) / 100,
      production_associate_dollar: Math.round(productionCanonicalSummaryRows.reduce((sum, row) => sum + row.associate_dollar, 0) * 100) / 100,
      production_team_dollar: Math.round(productionCanonicalSummaryRows.reduce((sum, row) => sum + row.team_dollar, 0) * 100) / 100,
      listings_total: listingRows.reduce((sum, row) => sum + row.total_listings, 0),
      listings_active: listingRows.reduce((sum, row) => sum + row.active_listings, 0),
      listings_total_value: Math.round(listingRows.reduce((sum, row) => sum + row.total_listing_value, 0) * 100) / 100,
    };

    // Keep top-down production totals in lockstep with month-end canonical totals for identical filters.
    const monthEndLayer = router.stack.find((layer: any) =>
      layer.route
      && layer.route.path === '/month-end'
    );
    const monthEndHandler = monthEndLayer?.route?.stack?.[monthEndLayer.route.stack.length - 1]?.handle as
      | ((req: Request, res: Response) => Promise<void>)
      | undefined;

    if (monthEndHandler) {
      const monthEndReq = {
        ...req,
        headers: req.headers,
        permissions: req.permissions,
        query: {
          date_from: dateFrom,
          date_to: dateTo,
          date_basis: normalizeMonthEndDateBasis(req.query.date_basis),
          transaction_status: transactionStatuses.join(','),
          sale_type: saleTypes.join(','),
          market_center_ids: effectiveMarketCenterIds.join(','),
          team_id: effectiveTeamId,
          associate_id: effectiveAssociateId,
        },
      } as unknown as Request;

      const monthEndResState: { statusCode: number; payload: unknown } = { statusCode: 200, payload: null };
      const monthEndRes = {
        status(code: number) {
          monthEndResState.statusCode = code;
          return this;
        },
        json(payload: unknown) {
          monthEndResState.payload = payload;
          return this;
        },
        setHeader() {
          return this;
        },
      } as unknown as Response;

      await monthEndHandler(monthEndReq, monthEndRes);
      if (monthEndResState.statusCode < 400 && monthEndResState.payload && typeof monthEndResState.payload === 'object') {
        const payload = monthEndResState.payload as { totals?: { contracts?: number; units?: number; total_gci?: number; royalties?: number; growth_share?: number; company_dollar?: number; associate_dollar?: number; team_dollar?: number } };
        totals.production_contracts = Number(payload.totals?.contracts ?? totals.production_contracts);
        totals.production_units = Number(payload.totals?.units ?? totals.production_units);
        totals.production_gci = Number(payload.totals?.total_gci ?? totals.production_gci);
        totals.production_royalties = Number(payload.totals?.royalties ?? totals.production_royalties);
        totals.production_growth_share = Number(payload.totals?.growth_share ?? totals.production_growth_share);
        totals.production_company_dollar = Number(payload.totals?.company_dollar ?? totals.production_company_dollar);
        totals.production_associate_dollar = Number(payload.totals?.associate_dollar ?? totals.production_associate_dollar);
        totals.production_team_dollar = Number(payload.totals?.team_dollar ?? totals.production_team_dollar);
      }
    }

    return res.json({
      production: {
        rows: productionRows,
        summary_by_market_center: productionCanonicalSummaryRows
          .map((row) => ({
            market_center_name: row.market_center_name,
            mc_source_id: row.mc_source_id,
            contracts: row.contracts,
            units: row.units,
            total_gci: Math.round(row.total_gci * 100) / 100,
            royalties: Math.round(row.royalties * 100) / 100,
            growth_share: Math.round(row.growth_share * 100) / 100,
            company_dollar: Math.round(row.company_dollar * 100) / 100,
            associate_dollar: Math.round(row.associate_dollar * 100) / 100,
            team_dollar: Math.round(row.team_dollar * 100) / 100,
          }))
          .sort((a, b) => b.total_gci - a.total_gci),
      },
      listings: {
        rows: listingRows,
        summary_by_market_center: Array.from(
          listingRows.reduce((map, row) => {
            const key = row.mc_source_id || row.market_center_name;
            const existing = map.get(key) ?? {
              market_center_name: row.market_center_name,
              mc_source_id: row.mc_source_id,
              total_listings: 0,
              active_listings: 0,
              for_sale_listings: 0,
              for_rent_listings: 0,
              total_listing_value: 0,
            };
            existing.total_listings += row.total_listings;
            existing.active_listings += row.active_listings;
            existing.for_sale_listings += row.for_sale_listings;
            existing.for_rent_listings += row.for_rent_listings;
            existing.total_listing_value += row.total_listing_value;
            map.set(key, existing);
            return map;
          }, new Map<string, { market_center_name: string; mc_source_id: string; total_listings: number; active_listings: number; for_sale_listings: number; for_rent_listings: number; total_listing_value: number }>()).values()
        ).sort((a, b) => b.total_listings - a.total_listings),
      },
      totals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/associate/filter-options', resolvePermissions, requireReportAccess(REPORT_KEYS.ASSOCIATE_REPORT), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
    const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
    const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
    const resolvedScopeAssociateId = scopedTeamSourceId
      ? null
      : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);

    const result = await pool.query<{
      mc_source_id: string;
      market_center_name: string;
      team_source_id: string;
      team_name: string;
      status_name: string | null;
      role_name: string | null;
    }>(
      `
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
        AND (
          $3::text IS NULL
          OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($3::text)), '[^a-z0-9]+', '', 'g')
        )
      `,
      [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const marketCenterMap = new Map<string, string>();
    const teamMap = new Map<string, AssociateReportFilterOptions['teams'][number]>();
    const statuses = new Set<string>();
    const roles = new Set<string>();

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

      if (row.status_name) statuses.add(row.status_name);
      if (row.role_name) roles.add(row.role_name);
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
    } satisfies AssociateReportFilterOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/associate', resolvePermissions, requireReportAccess(REPORT_KEYS.ASSOCIATE_REPORT), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const teamIds = parseCsvParam(req.query.team_ids);
    const statuses = parseCsvParam(req.query.statuses).map((value) => value.toLowerCase());
    const roles = parseCsvParam(req.query.roles).map((value) => value.toLowerCase());
    const associateQuery = String(req.query.associate_query ?? '').trim();

    const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
    const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
    const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
    const resolvedScopeAssociateId = scopedTeamSourceId
      ? null
      : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);

    const params: Array<string | string[] | number | null> = [];
    const whereClauses: string[] = [];

    params.push(scopeMcId);
    whereClauses.push(`(
      $${params.length}::text IS NULL
      OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($${params.length}::text)), '[^a-z0-9]+', '', 'g')
    )`);

    params.push(resolvedScopeAssociateId);
    whereClauses.push(`($${params.length}::bigint IS NULL OR ca.id = $${params.length}::bigint)`);

    params.push(scopedTeamSourceId);
    whereClauses.push(`(
      $${params.length}::text IS NULL
      OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t.source_team_id, ''), NULLIF(ca.source_team_id, ''), t.id::text, ca.team_id::text, t.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($${params.length}::text)), '[^a-z0-9]+', '', 'g')
    )`);

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

    const result = await pool.query<{
      market_center_name: string;
      mc_source_id: string;
      team_name: string;
      team_source_id: string;
      associate_name: string;
      source_associate_id: string;
      status_name: string | null;
      kw_start_date: string | null;
      end_date: string | null;
      anniversary_date: string | null;
      mobile_number: string | null;
      associate_email: string | null;
      national_id: string | null;
      roles: string | null;
    }>(
      `
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
      `,
      params
    );

    const rows: AssociateReportRow[] = result.rows.map((row) => {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/mc-dashboard/filter-options', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
      return res.status(403).json({ error: 'Permission denied: MC Dashboard requires Office Admin or Regional Admin access.' });
    }

    if (perms.scope === 'GLOBAL') {
      const rows = await pool.query<{ id: string; name: string }>(
        `
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
        `
      );

      return res.json({
        market_centers: [
          { id: MC_DASHBOARD_ALL_MARKET_CENTERS_ID, name: MC_DASHBOARD_ALL_MARKET_CENTERS_LABEL },
          ...rows.rows.filter((mc) => normalizeForMatch(mc.name) !== normalizeForMatch(MC_DASHBOARD_ALL_MARKET_CENTERS_LABEL)),
        ],
        selected_market_center_id: MC_DASHBOARD_ALL_MARKET_CENTERS_ID,
      });
    }

    const selected = perms.marketCenterId ?? perms.homeMcId ?? null;
    if (!selected) {
      return res.json({ market_centers: [], selected_market_center_id: null });
    }

    const row = await pool.query<{ id: string; name: string }>(
      `
      SELECT source_market_center_id AS id, COALESCE(NULLIF(TRIM(name), ''), source_market_center_id) AS name
      FROM migration.core_market_centers
      WHERE source_market_center_id = $1
        AND LOWER(TRIM(COALESCE(status_name, ''))) IN ('active', '1')
      LIMIT 1
      `,
      [selected]
    );

    return res.json({
      market_centers: row.rows,
      selected_market_center_id: selected,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/mc-dashboard', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
      return res.status(403).json({ error: 'Permission denied: MC Dashboard requires Office Admin or Regional Admin access.' });
    }

    await ensureMcDashboardSnapshotTable();

    const queryMcId = String(req.query.market_center_id ?? '').trim();
    const targetMcSourceId = perms.scope === 'GLOBAL'
      ? (queryMcId || MC_DASHBOARD_ALL_MARKET_CENTERS_ID)
      : (perms.marketCenterId ?? perms.homeMcId ?? '');
    const isAllMarketCenters = perms.scope === 'GLOBAL'
      && normalizeForMatch(targetMcSourceId) === normalizeForMatch(MC_DASHBOARD_ALL_MARKET_CENTERS_ID);

    if (!targetMcSourceId) {
      return res.status(400).json({ error: 'market_center_id is required for the active context.' });
    }

    let currentBrandingPatch: Record<string, unknown>;
    if (isAllMarketCenters) {
      currentBrandingPatch = {
        source_market_center_id: MC_DASHBOARD_ALL_MARKET_CENTERS_ID,
        name: MC_DASHBOARD_ALL_MARKET_CENTERS_LABEL,
        logo_image_url: null,
        white_logo_image_url: null,
      };
    } else {
      const normalizedTargetMcId = normalizeForMatch(targetMcSourceId);
      const currentBrandingResult = await pool.query<{
        source_market_center_id: string | null;
        name: string | null;
        logo_image_url: string | null;
        white_logo_image_url: string | null;
      }>(
        `
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
        `,
        [normalizedTargetMcId]
      );

      const currentBrandingRow = currentBrandingResult.rows[0] ?? null;
      currentBrandingPatch = {
        source_market_center_id: currentBrandingRow?.source_market_center_id ?? targetMcSourceId,
        logo_image_url: currentBrandingRow?.logo_image_url ?? null,
        white_logo_image_url: currentBrandingRow?.white_logo_image_url ?? null,
      };
      if (currentBrandingRow?.name) {
        currentBrandingPatch.name = currentBrandingRow.name;
      }
    }

    const withLatestBranding = (payload: Record<string, unknown>): Record<string, unknown> => {
      const existingMarketCenter =
        payload.market_center && typeof payload.market_center === 'object'
          ? (payload.market_center as Record<string, unknown>)
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

    const existingToday = await pool.query<{ payload: McDashboardData; refreshed_at: string }>(
      `
      SELECT payload, refreshed_at::text
      FROM migration.mc_dashboard_daily_snapshots
      WHERE snapshot_date = $1::date
        AND mc_source_id = $2
      LIMIT 1
      `,
      [today, targetMcSourceId]
    );

    const emptyPeople = { birthdays_today: [], anniversaries_this_month: [] };
    if (existingToday.rows[0]) {
      const cached = existingToday.rows[0].payload as Record<string, unknown>;
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

    const latestBeforeToday = await pool.query<{ snapshot_date: string; payload: McDashboardData; refreshed_at: string }>(
      `
      SELECT snapshot_date::text, payload, refreshed_at::text
      FROM migration.mc_dashboard_daily_snapshots
      WHERE snapshot_date < $1::date
        AND mc_source_id = $2
      ORDER BY snapshot_date DESC
      LIMIT 1
      `,
      [today, targetMcSourceId]
    );

    const isPastDailyRefreshTime = appTime >= '03:00';
    if (!isPastDailyRefreshTime && latestBeforeToday.rows[0]) {
      const stale = latestBeforeToday.rows[0];
      const staleCached = stale.payload as Record<string, unknown>;
      const brandedStale = withLatestBranding(staleCached);
      return res.json({
        ...brandedStale,
        people: (brandedStale.people as typeof emptyPeople | undefined) ?? emptyPeople,
        snapshot_date: stale.snapshot_date,
        refreshed_at: stale.refreshed_at,
        cache_state: 'stale-before-03h00',
      });
    }

    const payload = await computeMcDashboardData(targetMcSourceId, dateFrom, today, {
      allMarketCenters: isAllMarketCenters,
    });

    const saved = await pool.query<{ refreshed_at: string }>(
      `
      INSERT INTO migration.mc_dashboard_daily_snapshots (snapshot_date, mc_source_id, payload, refreshed_at)
      VALUES ($1::date, $2, $3::jsonb, now())
      ON CONFLICT (snapshot_date, mc_source_id)
      DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = now()
      RETURNING refreshed_at::text
      `,
      [today, targetMcSourceId, JSON.stringify(payload)]
    );

    return res.json({
      ...payload,
      snapshot_date: today,
      refreshed_at: saved.rows[0]?.refreshed_at ?? new Date().toISOString(),
      cache_state: 'refreshed',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/cappers/filter-options', resolvePermissions, requireReportAccess(REPORT_KEYS.CAPPERS_REPORT), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    const scopeMcId = perms.scope === 'MARKET_CENTRE' ? (perms.marketCenterId ?? perms.homeMcId ?? null) : null;
    const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
    const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
    const resolvedScopeAssociateId = scopedTeamSourceId
      ? null
      : (Number.isFinite(scopeAssociateId) && scopeAssociateId ? scopeAssociateId : null);

    const result = await pool.query<{
      associate_id: string;
      source_associate_id: string;
      associate_name: string;
      market_center_name: string;
      mc_source_id: string;
      team_id: string | null;
      team_name: string;
      source_team_id: string;
      team_status_name: string | null;
    }>(
      `
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
      `,
      [scopeMcId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const includeTeamMembersInAssociateOptions = perms.scope === 'OWN';
    const marketCenterMap = new Map<string, string>();
    const associates: CappersFilterOptions['associates'] = [];
    const teamMap = new Map<string, CappersFilterOptions['teams'][number]>();

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/cappers', resolvePermissions, requireReportAccess(REPORT_KEYS.CAPPERS_REPORT), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const view = normalizeView(req.query.view);
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const associateQuery = String(req.query.associate_query ?? '').trim();
    const teamQuery = String(req.query.team_query ?? '').trim();
    const capStatus = String(req.query.cap_status ?? '').trim().toLowerCase();
    const scopeFilters = await resolveReportRouteScopeFilters(req, {
      requestedMarketCenterIds: marketCenterIds,
    });

    const scopeMcId = scopeFilters.scopeMcId;
    const scopedTeamSourceId = scopeFilters.scopedTeamSourceId;
    const resolvedScopeAssociateId = scopeFilters.resolvedScopeAssociateId;
    const effectiveMarketCenterIds = scopeFilters.effectiveMarketCenterIds;

    const includeTeamMembersInAssociateView = scopeFilters.reportingScope === 'TEAM';

    const params: Array<string | string[] | number | null | boolean> = [
      scopeMcId,
      resolvedScopeAssociateId,
      associateQuery,
      teamQuery,
      capStatus,
      effectiveMarketCenterIds,
      scopedTeamSourceId,
    ];

    const rowsResult = await pool.query<{
      entity_name: string;
      source_entity_id: string;
      market_center_name: string;
      mc_source_id: string;
      team_name: string;
      cap_date: string | null;
      cap_amount: string;
      cap_achieved: string;
      cap_remaining: string;
      cap_percent_remaining: string;
      months_to_cap_date: string | null;
      manual_cap: boolean;
    }>(
      `
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
      latest_cycle_caps AS (
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
          AND cw.next_cap_date IS NOT NULL
          AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
          AND tac.effective_reporting_date::date < cw.next_cap_date
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
        INNER JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        WHERE tac.associate_id IS NOT NULL
          AND ${buildRegisteredStatusSql('ct')}
          AND cw.next_cap_date IS NOT NULL
          AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
          AND tac.effective_reporting_date::date < cw.next_cap_date
      ),
      associate_registered_achieved AS (
        SELECT
          cw.associate_id,
          ROUND(COALESCE(SUM(tac.market_center_dollar), 0)::numeric, 2) AS cap_achieved
        FROM cycle_windows cw
        INNER JOIN migration.transaction_agent_calculations tac ON tac.associate_id = cw.associate_id
        INNER JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        WHERE cw.next_cap_date IS NOT NULL
          AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
          AND tac.effective_reporting_date::date < cw.next_cap_date
          AND ${buildRegisteredStatusSql('ct')}
        GROUP BY cw.associate_id
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
          GREATEST(COALESCE(lcc.cap_amount, lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2) AS cap_amount,
          CASE
            WHEN cw.manual_cap = true THEN 0::numeric(18,2)
            ELSE GREATEST(
              GREATEST(COALESCE(lcc.cap_amount, lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)
              - LEAST(
                GREATEST(COALESCE(lcc.cap_amount, lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0),
                COALESCE(ara.cap_achieved, 0)
              ),
              0
            )::numeric(18,2)
          END AS cap_remaining,
          cw.manual_cap AS manual_cap
        FROM migration.core_associates ca
        LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
        LEFT JOIN migration.core_teams t ON t.id = ca.team_id
        LEFT JOIN cycle_windows cw ON cw.associate_id = ca.id
        LEFT JOIN latest_caps lc ON lc.associate_id = ca.id AND lc.rn = 1
        LEFT JOIN latest_cycle_caps lcc ON lcc.associate_id = ca.id AND lcc.rn = 1
        LEFT JOIN latest_cycle_registered_caps lrc ON lrc.associate_id = ca.id AND lrc.rn = 1
        LEFT JOIN associate_registered_achieved ara ON ara.associate_id = ca.id
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
        INNER JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        WHERE (
            tb.cap_date IS NULL
            OR (
              tac.effective_reporting_date::date >= (tb.cap_date - INTERVAL '1 year')::date
              AND tac.effective_reporting_date::date < tb.cap_date
            )
          )
          AND ${buildRegisteredStatusSql('ct')}
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
          LEAST(cap_amount, GREATEST(cap_amount - cap_remaining, 0))::numeric(18,2) AS cap_achieved,
          cap_remaining::numeric(18,2) AS cap_remaining,
          CASE
            WHEN cap_amount > 0 THEN ROUND((cap_remaining / cap_amount) * 100, 2)
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
          CASE
            WHEN tb.manual_cap = true THEN tb.cap_amount
            ELSE LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0))::numeric(18,2)
          END AS cap_achieved,
          CASE
            WHEN tb.manual_cap = true THEN 0::numeric(18,2)
            ELSE GREATEST(tb.cap_amount - LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0)), 0)::numeric(18,2)
          END AS cap_remaining,
          CASE
            WHEN tb.manual_cap = true THEN 0
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
      `,
      [...params, view, includeTeamMembersInAssociateView]
    );

    const rows: CappersRow[] = rowsResult.rows.map((row) => ({
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
      const contributionResult = await pool.query<{
        source_team_id: string;
        source_associate_id: string;
        associate_name: string;
        company_dollar: string;
      }>(
        `
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
        `,
        [
          rows.map((row) => row.source_entity_id),
          rows.map((row) => (row.cap_date ? row.cap_date : null)),
        ]
      );

      const contributionsByTeam = new Map<string, CappersTeamContribution[]>();

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

    if (view === 'associate' && rows.length > 0) {
      const registeredDealsResult = await pool.query<{
        source_associate_id: string;
        source_transaction_id: string;
        transaction_number: string;
        transaction_status: string;
        kwl_number: string;
        reporting_date: string | null;
        company_dollar: string;
      }>(
        `
        WITH ${transactionAgentCalculationDedupCte},
        selected_associates AS (
          SELECT
            ca.id AS associate_id,
            input_rows.source_associate_id,
            input_rows.cap_date,
            GREATEST(COALESCE(ca.cap, 0), 0)::numeric(18,2) AS cap_amount
          FROM UNNEST($1::text[], $2::date[]) AS input_rows(source_associate_id, cap_date)
          INNER JOIN migration.core_associates ca
            ON COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) = input_rows.source_associate_id
        ),
        deal_rows AS (
          SELECT
            sa.source_associate_id,
            sa.cap_amount,
            COALESCE(NULLIF(TRIM(ct.source_transaction_id), ''), tac.transaction_id::text) AS source_transaction_id,
            COALESCE(NULLIF(TRIM(ct.transaction_number), ''), tac.transaction_id::text) AS transaction_number,
            COALESCE(NULLIF(TRIM(ct.transaction_status), ''), CASE WHEN tac.is_registered = true THEN 'Registered' ELSE '' END) AS transaction_status,
            COALESCE(NULLIF(TRIM(ct.listing_number), ''), '') AS kwl_number,
            MAX(COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date))::date AS reporting_date,
            ROUND(COALESCE(SUM(COALESCE(pay.mc_dollar, tac.market_center_dollar)), 0)::numeric, 2) AS company_dollar
          FROM selected_associates sa
          INNER JOIN tac_dedup tac ON tac.associate_id = sa.associate_id
          INNER JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN LATERAL (
            SELECT
              tapd.mc_dollar
            FROM staging.transaction_associate_payment_details tapd
            WHERE tapd.source_transaction_id = ct.source_transaction_id
              AND COALESCE(tapd.source_associate_id, '') = COALESCE(tac.source_associate_id, '')
            ORDER BY tapd.source_transaction_associate_id DESC NULLS LAST, tapd.source_associate_id DESC NULLS LAST
            LIMIT 1
          ) pay ON true
          WHERE (
              sa.cap_date IS NULL
              OR (
                tac.effective_reporting_date::date >= (sa.cap_date - INTERVAL '1 year')::date
                AND tac.effective_reporting_date::date < sa.cap_date
              )
            )
            AND ${buildRegisteredStatusSql('ct')}
          GROUP BY
            sa.source_associate_id,
            sa.cap_amount,
            COALESCE(NULLIF(TRIM(ct.source_transaction_id), ''), tac.transaction_id::text),
            COALESCE(NULLIF(TRIM(ct.transaction_number), ''), tac.transaction_id::text),
            COALESCE(NULLIF(TRIM(ct.transaction_status), ''), CASE WHEN tac.is_registered = true THEN 'Registered' ELSE '' END),
            COALESCE(NULLIF(TRIM(ct.listing_number), ''), '')
        ),
        ordered_deals AS (
          SELECT
            dr.*,
            SUM(dr.company_dollar) OVER (
              PARTITION BY dr.source_associate_id
              ORDER BY dr.reporting_date ASC, dr.transaction_number ASC, dr.source_transaction_id ASC
            ) AS running_company_dollar
          FROM deal_rows dr
        )
        SELECT
          source_associate_id,
          source_transaction_id,
          transaction_number,
          transaction_status,
          kwl_number,
          reporting_date::text,
          company_dollar::text
        FROM ordered_deals
        WHERE cap_amount <= 0
          OR (running_company_dollar - company_dollar) < cap_amount
        ORDER BY source_associate_id ASC, reporting_date DESC NULLS LAST, transaction_number ASC
        `,
        [
          rows.map((row) => row.source_entity_id),
          rows.map((row) => (row.cap_date ? row.cap_date : null)),
        ]
      );

      const dealsByAssociate = new Map<string, CappersRegisteredDeal[]>();

      for (const deal of registeredDealsResult.rows) {
        const existing = dealsByAssociate.get(deal.source_associate_id) ?? [];
        existing.push({
          source_transaction_id: deal.source_transaction_id,
          transaction_number: deal.transaction_number,
          transaction_status: deal.transaction_status,
          kwl_number: deal.kwl_number,
          reporting_date: deal.reporting_date,
          company_dollar: Number(deal.company_dollar),
        });
        dealsByAssociate.set(deal.source_associate_id, existing);
      }

      for (const row of rows) {
        row.registered_deals = dealsByAssociate.get(row.source_entity_id) ?? [];
      }
    }

    const totals = rows.reduce(
      (acc, row) => {
        acc.cap_amount += row.cap_amount;
        acc.cap_achieved += row.cap_achieved;
        acc.cap_remaining += row.cap_remaining;
        if (row.cap_remaining <= 0) acc.capped_entities += 1;
        return acc;
      },
      {
        entities: rows.length,
        capped_entities: 0,
        reporting_scope: scopeFilters.reportingScope,
        cap_amount: 0,
        cap_achieved: 0,
        cap_remaining: 0,
      }
    );

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Listings Location Report
// ---------------------------------------------------------------------------

// GET /api/reports/listings-location/filter-options
router.get('/listings-location/filter-options', resolvePermissions, requireReportAccess(REPORT_KEYS.LISTINGS_LOCATION_REPORT), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;
    const scopeMcSourceId = perms.scope === 'GLOBAL' ? null : (perms.marketCenterId ?? perms.homeMcId ?? null);
    const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
    const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
    const resolvedScopeAssociateId = scopedTeamSourceId
      ? null
      : (scopeAssociateId && scopeAssociateId > 0 ? scopeAssociateId : null);

    const result = await pool.query<{
      province: string | null;
      suburb: string | null;
      market_center_db_id: string | null;
      market_center_name: string | null;
      listing_status: string | null;
      property_type: string | null;
      sale_or_rent: string | null;
      mandate_type: string | null;
      agent_name: string | null;
    }>(
      `
      WITH scoped_mc_name_keys AS (
        SELECT DISTINCT
          REGEXP_REPLACE(LOWER(TRIM(COALESCE(mcs.name, ''))), '[^a-z0-9]+', '', 'g') AS mc_name_key
        FROM migration.core_market_centers mcs
        WHERE $1::text IS NOT NULL
          AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mcs.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1::text)), '[^a-z0-9]+', '', 'g')
          AND TRIM(COALESCE(mcs.name, '')) <> ''
      ),
      public_mc AS (
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
          COALESCE(mc_lateral.id::text, mc_assoc_lateral.id::text) AS market_center_db_id,
          COALESCE(NULLIF(TRIM(mc_lateral.name), ''), NULLIF(TRIM(mc_assoc_lateral.name), '')) AS market_center_name,
          COALESCE(NULLIF(TRIM(mc_lateral.source_market_center_id), ''), NULLIF(TRIM(mc_assoc_lateral.source_market_center_id), ''), NULLIF(TRIM(a_lateral.source_market_center_id), '')) AS source_market_center_id
        FROM migration.listing_agents la_lateral
        LEFT JOIN migration.core_associates a_lateral ON a_lateral.id = la_lateral.associate_id
        LEFT JOIN migration.core_market_centers mc_lateral ON mc_lateral.id = COALESCE(a_lateral.market_center_id, la_lateral.market_center_id)
        LEFT JOIN migration.core_market_centers mc_assoc_lateral ON mc_assoc_lateral.source_market_center_id = a_lateral.source_market_center_id
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
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc.name, mc_source.name, lamc.market_center_name, pmc.market_center_name, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) IN (SELECT mc_name_key FROM scoped_mc_name_keys)
        )
        AND ($2::bigint IS NULL OR EXISTS (
          SELECT 1 FROM migration.listing_agents la2
          WHERE la2.listing_id = cl.id AND la2.associate_id = $2::bigint
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
      `,
      [scopeMcSourceId, resolvedScopeAssociateId, scopedTeamSourceId]
    );

    const provinces = Array.from(new Set(result.rows.map((r) => r.province).filter(Boolean))).sort() as string[];
    const suburbs = Array.from(new Set(result.rows.map((r) => r.suburb).filter(Boolean))).sort() as string[];
    const listingStatuses = Array.from(new Set(result.rows.map((r) => r.listing_status).filter(Boolean))).sort() as string[];
    const propertyTypes = Array.from(new Set(result.rows.map((r) => r.property_type).filter(Boolean))).sort() as string[];
    const saleOrRentOptions = Array.from(new Set(result.rows.map((r) => r.sale_or_rent).filter(Boolean))).sort() as string[];
    const mandateTypes = Array.from(new Set(result.rows.map((r) => r.mandate_type).filter(Boolean))).sort() as string[];
    const agents = Array.from(new Set(result.rows.map((r) => r.agent_name).filter(Boolean))).sort() as string[];

    const normalizeMcNameKey = (value: string): string =>
      value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

    const mcMap = new Map<string, { id: string; name: string }>();
    for (const row of result.rows) {
      if (row.market_center_db_id && row.market_center_name) {
        const cleanedName = row.market_center_name.trim();
        if (!cleanedName) continue;

        const key = normalizeMcNameKey(cleanedName);
        if (!key) continue;

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// GET /api/reports/listings-location
router.get('/listings-location', resolvePermissions, requireReportAccess(REPORT_KEYS.LISTINGS_LOCATION_REPORT), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    const perms = req.permissions!;

    const listDateFrom = String(req.query.list_date_from || getFirstOfMonthInAppTimeZone());
    const listDateTo = String(req.query.list_date_to || getTodayInAppTimeZone());
    const appTimeZone = getAppTimeZone();
    const appToday = getTodayInAppTimeZone();
    const listingStatuses = parseCsvParam(req.query.listing_status);
    const provinces = parseCsvParam(req.query.province);
    const suburb = String(req.query.suburb ?? '');
    const marketCenterIds = parseCsvParam(req.query.market_center_ids);
    const agentQuery = String(req.query.agent_query ?? '').trim();
    const propertyTypes = parseCsvParam(req.query.property_type);
    const saleOrRents = parseCsvParam(req.query.sale_or_rent);
    const mandateTypes = parseCsvParam(req.query.mandate_type);

    const scopeMcSourceId = perms.scope === 'GLOBAL' ? null : (perms.marketCenterId ?? perms.homeMcId ?? null);
    const scopedTeamSourceId = await resolveScopedTeamSourceId(req);
    const scopeAssociateId = perms.scope === 'OWN' ? Number(perms.associateDbId ?? 0) : null;
    const resolvedScopeAssociateId = scopedTeamSourceId
      ? null
      : (scopeAssociateId && scopeAssociateId > 0 ? scopeAssociateId : null);

    const parsedMcIds = marketCenterIds.map(Number).filter(Number.isFinite);
    const mcIdsFilter = parsedMcIds.length > 0 ? parsedMcIds : null;
    const mcFilterTokens = marketCenterIds;

    const result = await pool.query<{
      listing_number: string;
      list_date: string;
      days_on_market: string;
      primary_agent: string;
      agent_names: string;
      market_center_name: string;
      city: string;
      suburb: string;
      province: string;
      full_address: string;
      price: string;
      mandate_type: string;
      listing_type: string;
      listing_status_tag: string;
      status_name: string;
      sale_or_rent: string;
      bedrooms: string;
      bathrooms: string;
      garages: string;
      lounges: string;
      dining_rooms: string;
      pools: string;
      reduced_date: string | null;
      p24_ref: string | null;
      private_property_ref: string | null;
    }>(
      `
      WITH scoped_mc_name_keys AS (
        SELECT DISTINCT
          REGEXP_REPLACE(LOWER(TRIM(COALESCE(mcs.name, ''))), '[^a-z0-9]+', '', 'g') AS mc_name_key
        FROM migration.core_market_centers mcs
        WHERE $11::text IS NOT NULL
          AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(mcs.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($11::text)), '[^a-z0-9]+', '', 'g')
          AND TRIM(COALESCE(mcs.name, '')) <> ''
      ),
      selected_mc_name_keys AS (
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
        timezone($14::text, cl.on_market_since_date)::date::text AS list_date,
        GREATEST(($15::date - timezone($14::text, cl.on_market_since_date)::date), 0)::int AS days_on_market,
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
        SELECT
          COALESCE(mc_lateral.id, mc_assoc_lateral.id) AS id,
          COALESCE(mc_lateral.name, mc_assoc_lateral.name) AS name,
          COALESCE(mc_lateral.source_market_center_id, mc_assoc_lateral.source_market_center_id, a_lateral.source_market_center_id) AS source_market_center_id
        FROM migration.listing_agents la_lateral
        LEFT JOIN migration.core_associates a_lateral ON a_lateral.id = la_lateral.associate_id
        LEFT JOIN migration.core_market_centers mc_lateral ON mc_lateral.id = COALESCE(a_lateral.market_center_id, la_lateral.market_center_id)
        LEFT JOIN migration.core_market_centers mc_assoc_lateral ON mc_assoc_lateral.source_market_center_id = a_lateral.source_market_center_id
        WHERE la_lateral.listing_id = cl.id
        ORDER BY COALESCE(la_lateral.is_primary, false) DESC, la_lateral.sort_order NULLS LAST, la_lateral.id ASC
        LIMIT 1
      ) mc_agent ON TRUE
      LEFT JOIN agent_agg aa ON aa.listing_id = cl.id
      LEFT JOIN public_fallback pf ON pf.listing_number = cl.listing_number
      LEFT JOIN room_agg ra ON ra.listing_id = cl.id
      WHERE cl.listing_number LIKE 'KWL%'
        AND timezone($14::text, cl.on_market_since_date)::date >= $1::date
        AND timezone($14::text, cl.on_market_since_date)::date <= $2::date
        AND (
          CARDINALITY($3::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($3::text[]) AS selected_listing_status
            WHERE LOWER(TRIM(COALESCE(cl.status_name, cl.listing_status_tag, ''))) = LOWER(TRIM(selected_listing_status))
          )
        )
        AND (
          CARDINALITY($4::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($4::text[]) AS selected_province
            WHERE LOWER(TRIM(COALESCE(cl.province, ''))) = LOWER(TRIM(selected_province))
          )
        )
        AND (NULLIF($5, '') IS NULL OR TRIM(COALESCE(cl.suburb, '')) ILIKE '%' || TRIM($5) || '%')
        AND (
          (
            $6::bigint[] IS NULL
            AND CARDINALITY($16::text[]) = 0
          )
          OR cl.market_center_id = ANY(COALESCE($6::bigint[], ARRAY[]::bigint[]))
          OR mc_source.id = ANY(COALESCE($6::bigint[], ARRAY[]::bigint[]))
          OR mc_agent.id = ANY(COALESCE($6::bigint[], ARRAY[]::bigint[]))
          OR pf.market_center_id = ANY(COALESCE($6::bigint[], ARRAY[]::bigint[]))
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc.name, mc_source.name, mc_agent.name, pf.market_center_name, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) IN (SELECT mc_name_key FROM selected_mc_name_keys)
          OR EXISTS (
            SELECT 1
            FROM UNNEST(COALESCE($16::text[], ARRAY[]::text[])) AS selected_mc_token
            WHERE REGEXP_REPLACE(
              LOWER(TRIM(COALESCE(mc.source_market_center_id, mc_source.source_market_center_id, mc_agent.source_market_center_id, cl.source_market_center_id, ''))),
              '[^a-z0-9]+',
              '',
              'g'
            ) = REGEXP_REPLACE(LOWER(TRIM(selected_mc_token)), '[^a-z0-9]+', '', 'g')
          )
        )
        AND (NULLIF($7, '') IS NULL OR COALESCE(aa.agent_names, pf.agent_names, '') ILIKE '%' || $7 || '%')
        AND (
          CARDINALITY($8::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM UNNEST($8::text[]) AS selected_property_type
            WHERE LOWER(TRIM(COALESCE(cl.property_type, ''))) = LOWER(TRIM(selected_property_type))
          )
        )
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
          OR REGEXP_REPLACE(
            LOWER(TRIM(COALESCE(mc.name, mc_source.name, mc_agent.name, pf.market_center_name, ''))),
            '[^a-z0-9]+',
            '',
            'g'
          ) IN (SELECT mc_name_key FROM scoped_mc_name_keys)
        )
        AND ($12::bigint IS NULL OR EXISTS (
          SELECT 1 FROM migration.listing_agents la2
          WHERE la2.listing_id = cl.id AND la2.associate_id = $12::bigint
        ))
        AND (
          $13::text IS NULL
          OR EXISTS (
            SELECT 1
            FROM migration.listing_agents la_team
            INNER JOIN migration.core_associates ca_team ON ca_team.id = la_team.associate_id
            LEFT JOIN migration.core_teams t_team ON t_team.id = ca_team.team_id
            WHERE la_team.listing_id = cl.id
              AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(NULLIF(t_team.source_team_id, ''), NULLIF(ca_team.source_team_id, ''), t_team.id::text, ca_team.team_id::text, t_team.name, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($13::text)), '[^a-z0-9]+', '', 'g')
          )
        )
      ORDER BY timezone($14::text, cl.on_market_since_date)::date DESC, cl.listing_number
      `,
      [
        listDateFrom,
        listDateTo,
        listingStatuses,
        provinces,
        suburb,
        mcIdsFilter,
        agentQuery,
        propertyTypes,
        saleOrRents,
        mandateTypes,
        scopeMcSourceId,
        resolvedScopeAssociateId,
        scopedTeamSourceId,
        appTimeZone,
        appToday,
        mcFilterTokens,
      ]
    );

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;

