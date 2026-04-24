import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

type RawAgentRow = {
  transaction_agent_id: string;
  transaction_id: string;
  associate_id: string | null;
  source_associate_id: string | null;
  associate_name: string | null;
  office_name: string | null;
  agent_role: string | null;
  split_percentage: string | null;
  transaction_status: string | null;
  transaction_type: string | null;
  sales_price: string | null;
  list_price: string | null;
  total_gci: string | null;
  transaction_date: string | null;
  status_change_date: string | null;
  created_at: string;
  agent_split: string | null;
  cap: string | null;
  manual_cap: string | null;
  cap_date: string | null;
};

type CalculatedRow = {
  transaction_agent_id: number;
  transaction_id: number;
  associate_id: number | null;
  source_associate_id: string | null;
  is_outside_agent: boolean;
  agent_name: string | null;
  office_name: string | null;
  transaction_side: string | null;
  split_percentage: number;
  variance_sale_list_pct: number;
  sales_value_component: number;
  transaction_gci_before_fees: number;
  average_commission_pct: number;
  production_royalties: number;
  growth_share: number;
  total_pr_and_gs: number;
  gci_after_fees_excl_vat: number;
  associate_split_pct: number;
  market_center_split_pct: number;
  associate_dollar: number;
  cap_amount: number;
  cap_contribution: number;
  cap_remaining: number;
  team_dollar: number;
  market_center_dollar: number;
  cap_cycle_start_date: string;
  cap_cycle_end_date: string;
  effective_reporting_date: string;
  is_registered: boolean;
};

type TransactionGroup = {
  id: number;
  agents: RawAgentRow[];
};

function toNumber(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 999999) return 999999;
  if (value < -999999) return -999999;
  return value;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeAssociateSplit(rawSplit: number): number {
  if (rawSplit <= 0) return 70;
  if (rawSplit <= 1) return rawSplit * 100;
  return Math.max(Math.min(rawSplit, 100), 0);
}

function resolveCapAmount(cap: number, manualCap: number): number {
  if (manualCap > 0) return manualCap;
  if (cap > 0) return cap;
  return 0;
}

function isRegisteredStatus(status: string | null): boolean {
  return (status ?? '').trim().toLowerCase() === 'registered';
}

function getEffectiveReportingDate(row: RawAgentRow): Date {
  const statusChangeDate = toDate(row.status_change_date);
  const transactionDate = toDate(row.transaction_date);
  const createdAt = toDate(row.created_at) ?? new Date();

  if (isRegisteredStatus(row.transaction_status)) {
    return statusChangeDate ?? transactionDate ?? createdAt;
  }

  return transactionDate ?? statusChangeDate ?? createdAt;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildCapCycle(effectiveDate: Date, capStartDateRaw: string | null): { start: Date; end: Date } {
  const effective = startOfDay(effectiveDate);

  if (!capStartDateRaw) {
    const start = new Date(Date.UTC(effective.getUTCFullYear(), 0, 1));
    const end = addDays(addYears(start, 1), -1);
    return { start, end };
  }

  const anchor = toDate(capStartDateRaw);
  if (!anchor) {
    const start = new Date(Date.UTC(effective.getUTCFullYear(), 0, 1));
    const end = addDays(addYears(start, 1), -1);
    return { start, end };
  }

  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();

  let cycleStart = new Date(Date.UTC(effective.getUTCFullYear(), month, day));
  if (effective < cycleStart) {
    cycleStart = new Date(Date.UTC(effective.getUTCFullYear() - 1, month, day));
  }

  const cycleEnd = addDays(addYears(cycleStart, 1), -1);
  return { start: cycleStart, end: cycleEnd };
}

function isOutsideAgent(row: RawAgentRow): boolean {
  const role = (row.agent_role ?? '').trim().toLowerCase();
  return role.includes('outside');
}

async function fetchRawRows(db: Queryable): Promise<RawAgentRow[]> {
  const result = await db.query<RawAgentRow>(`
    SELECT
      ta.id::text AS transaction_agent_id,
      ta.transaction_id::text AS transaction_id,
      ta.associate_id::text AS associate_id,
      ta.source_associate_id,
      COALESCE(ca.full_name, ca.first_name || ' ' || ca.last_name, ta.source_associate_id) AS associate_name,
      COALESCE(mc.name, 'Unassigned / Unknown') AS office_name,
      ta.agent_role,
      ta.split_percentage::text,
      ct.transaction_status,
      ct.transaction_type,
      ct.sales_price::text,
      ct.list_price::text,
      ct.total_gci::text,
      ct.transaction_date::text,
      ct.status_change_date::text,
      ct.created_at::text,
      ca.agent_split::text,
      ca.cap::text,
      ca.manual_cap::text,
      ca.cap_date::text
    FROM migration.transaction_agents ta
    JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
    LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
    LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
    ORDER BY ta.transaction_id ASC, ta.sort_order ASC, ta.id ASC
  `);

  return result.rows;
}

function groupByTransaction(rows: RawAgentRow[]): TransactionGroup[] {
  const map = new Map<number, TransactionGroup>();

  for (const row of rows) {
    const transactionId = Number(row.transaction_id);
    const existing = map.get(transactionId);
    if (existing) {
      existing.agents.push(row);
      continue;
    }

    map.set(transactionId, {
      id: transactionId,
      agents: [row],
    });
  }

  return Array.from(map.values());
}

function getNormalizedSplit(raw: number, splitSum: number, count: number): number {
  if (count <= 0) return 100;
  if (splitSum <= 0) return 100 / count;
  return (raw / splitSum) * 100;
}

function buildCalculatedRows(groups: TransactionGroup[]): CalculatedRow[] {
  const rows: CalculatedRow[] = [];
  const capProgressByCycle = new Map<string, number>();

  type RowMeta = {
    row: CalculatedRow;
    associate_key: string;
  };

  const metaRows: RowMeta[] = [];

  for (const group of groups) {
    const splitSum = group.agents.reduce((acc, item) => acc + Math.max(toNumber(item.split_percentage), 0), 0);

    for (const row of group.agents) {
      const effectiveDate = getEffectiveReportingDate(row);
      const totalGci = Math.max(toNumber(row.total_gci), 0);
      const salesPrice = Math.max(toNumber(row.sales_price), 0);
      const listPrice = Math.max(toNumber(row.list_price), 0);
      const rawSplit = Math.max(toNumber(row.split_percentage), 0);
      const splitPercentage = getNormalizedSplit(rawSplit, splitSum, group.agents.length);
      const splitRatio = splitPercentage / 100;

      const agentGci = roundMoney(totalGci * splitRatio);
      const salesValueComponent = roundMoney(salesPrice * splitRatio);
      const listValueComponent = listPrice * splitRatio;

      const variancePct = listValueComponent > 0 ? clampPct(((salesValueComponent - listValueComponent) / listValueComponent) * 100) : 0;
      const avgCommissionPct = salesValueComponent > 0 ? clampPct((agentGci / salesValueComponent) * 100) : 0;

      const productionRoyalties = roundMoney(agentGci * 0.06);
      const growthShare = roundMoney(agentGci * 0.02);
      const totalPrAndGs = roundMoney(productionRoyalties + growthShare);
      const gciAfterFees = roundMoney(agentGci - totalPrAndGs);

      const outside = isOutsideAgent(row);
      const agentSplitPct = outside ? 100 : normalizeAssociateSplit(toNumber(row.agent_split));
      const marketCenterSplitPct = outside ? 0 : Math.max(100 - agentSplitPct, 0);

      const associateDollarPreCap = roundMoney(gciAfterFees * (agentSplitPct / 100));
      const marketCenterDollarPreCap = roundMoney(gciAfterFees * (marketCenterSplitPct / 100));
      const capAmount = outside ? 0 : roundMoney(resolveCapAmount(toNumber(row.cap), toNumber(row.manual_cap)));
      const cycle = buildCapCycle(effectiveDate, row.cap_date);
      const capCycleStartDate = toIsoDate(cycle.start);
      const capCycleEndDate = toIsoDate(cycle.end);

      const normalizedRow: CalculatedRow = {
        transaction_agent_id: Number(row.transaction_agent_id),
        transaction_id: Number(row.transaction_id),
        associate_id: row.associate_id ? Number(row.associate_id) : null,
        source_associate_id: row.source_associate_id,
        is_outside_agent: outside,
        agent_name: row.associate_name,
        office_name: row.office_name,
        transaction_side: row.transaction_type,
        split_percentage: roundPct(splitPercentage),
        variance_sale_list_pct: roundPct(variancePct),
        sales_value_component: roundMoney(salesValueComponent),
        transaction_gci_before_fees: roundMoney(agentGci),
        average_commission_pct: roundPct(avgCommissionPct),
        production_royalties: roundMoney(productionRoyalties),
        growth_share: roundMoney(growthShare),
        total_pr_and_gs: roundMoney(totalPrAndGs),
        gci_after_fees_excl_vat: roundMoney(gciAfterFees),
        associate_split_pct: roundPct(agentSplitPct),
        market_center_split_pct: roundPct(marketCenterSplitPct),
        associate_dollar: outside ? roundMoney(gciAfterFees) : associateDollarPreCap,
        cap_amount: roundMoney(capAmount),
        cap_contribution: 0,
        cap_remaining: 0,
        team_dollar: 0,
        market_center_dollar: outside ? 0 : marketCenterDollarPreCap,
        cap_cycle_start_date: capCycleStartDate,
        cap_cycle_end_date: capCycleEndDate,
        effective_reporting_date: toIsoDate(effectiveDate),
        is_registered: isRegisteredStatus(row.transaction_status),
      };

      metaRows.push({
        row: normalizedRow,
        associate_key: row.associate_id ?? row.source_associate_id ?? `outside-${row.transaction_agent_id}`,
      });
    }
  }

  metaRows.sort((a, b) => {
    if (a.row.is_outside_agent !== b.row.is_outside_agent) {
      return a.row.is_outside_agent ? 1 : -1;
    }
    if (a.associate_key !== b.associate_key) {
      return a.associate_key.localeCompare(b.associate_key);
    }
    if (a.row.effective_reporting_date !== b.row.effective_reporting_date) {
      return a.row.effective_reporting_date.localeCompare(b.row.effective_reporting_date);
    }
    if (a.row.transaction_id !== b.row.transaction_id) {
      return a.row.transaction_id - b.row.transaction_id;
    }
    return a.row.transaction_agent_id - b.row.transaction_agent_id;
  });

  for (const entry of metaRows) {
    const row = entry.row;

    if (row.is_outside_agent) {
      row.cap_remaining = 0;
      row.cap_contribution = 0;
      rows.push(row);
      continue;
    }

    const cycleKey = `${entry.associate_key}|${row.cap_cycle_start_date}`;
    const capUsedBefore = capProgressByCycle.get(cycleKey) ?? 0;
    const capAmount = row.cap_amount;
    const capLeft = Math.max(capAmount - capUsedBefore, 0);

    if (capAmount > 0) {
      if (!row.is_registered) {
        row.cap_contribution = 0;
        row.cap_remaining = roundMoney(capLeft);
        rows.push(row);
        continue;
      }

      const contribution = roundMoney(Math.min(row.market_center_dollar, capLeft));
      const overflow = roundMoney(row.market_center_dollar - contribution);
      row.cap_contribution = contribution;
      row.market_center_dollar = contribution;
      row.associate_dollar = roundMoney(row.associate_dollar + overflow);
      row.cap_remaining = roundMoney(Math.max(capAmount - (capUsedBefore + contribution), 0));

      capProgressByCycle.set(cycleKey, roundMoney(capUsedBefore + contribution));
    } else {
      row.cap_contribution = 0;
      row.cap_remaining = 0;
    }

    rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.associate_id !== b.associate_id) {
      return (a.associate_id ?? Number.MAX_SAFE_INTEGER) - (b.associate_id ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.effective_reporting_date !== b.effective_reporting_date) {
      return a.effective_reporting_date.localeCompare(b.effective_reporting_date);
    }
    if (a.transaction_id !== b.transaction_id) {
      return a.transaction_id - b.transaction_id;
    }
    return a.transaction_agent_id - b.transaction_agent_id;
  });

  return rows;
}

async function insertCalculatedRows(db: Queryable, rows: CalculatedRow[]): Promise<void> {
  await db.query(`DELETE FROM migration.transaction_agent_calculations`);

  if (rows.length === 0) {
    return;
  }

  const chunkSize = 500;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: Array<string | number | boolean | null> = [];
    const placeholders: string[] = [];

    for (let i = 0; i < chunk.length; i += 1) {
      const row = chunk[i];
      const base = i * 29;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20},$${base + 21},$${base + 22},$${base + 23},$${base + 24},$${base + 25},$${base + 26},$${base + 27},$${base + 28},$${base + 29})`
      );
      values.push(
        row.transaction_agent_id,
        row.transaction_id,
        row.associate_id,
        row.source_associate_id,
        row.is_outside_agent,
        row.agent_name,
        row.office_name,
        row.transaction_side,
        row.split_percentage,
        row.variance_sale_list_pct,
        row.sales_value_component,
        row.transaction_gci_before_fees,
        row.average_commission_pct,
        row.production_royalties,
        row.growth_share,
        row.total_pr_and_gs,
        row.gci_after_fees_excl_vat,
        row.associate_split_pct,
        row.market_center_split_pct,
        row.associate_dollar,
        row.cap_amount,
        row.cap_contribution,
        row.cap_remaining,
        row.team_dollar,
        row.market_center_dollar,
        row.cap_cycle_start_date,
        row.cap_cycle_end_date,
        row.effective_reporting_date,
        row.is_registered
      );
    }

    await db.query(
      `
      INSERT INTO migration.transaction_agent_calculations (
        transaction_agent_id,
        transaction_id,
        associate_id,
        source_associate_id,
        is_outside_agent,
        agent_name,
        office_name,
        transaction_side,
        split_percentage,
        variance_sale_list_pct,
        sales_value_component,
        transaction_gci_before_fees,
        average_commission_pct,
        production_royalties,
        growth_share,
        total_pr_and_gs,
        gci_after_fees_excl_vat,
        associate_split_pct,
        market_center_split_pct,
        associate_dollar,
        cap_amount,
        cap_contribution,
        cap_remaining,
        team_dollar,
        market_center_dollar,
        cap_cycle_start_date,
        cap_cycle_end_date,
        effective_reporting_date,
        is_registered
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (transaction_agent_id)
      DO UPDATE SET
        transaction_id = EXCLUDED.transaction_id,
        associate_id = EXCLUDED.associate_id,
        source_associate_id = EXCLUDED.source_associate_id,
        is_outside_agent = EXCLUDED.is_outside_agent,
        agent_name = EXCLUDED.agent_name,
        office_name = EXCLUDED.office_name,
        transaction_side = EXCLUDED.transaction_side,
        split_percentage = EXCLUDED.split_percentage,
        variance_sale_list_pct = EXCLUDED.variance_sale_list_pct,
        sales_value_component = EXCLUDED.sales_value_component,
        transaction_gci_before_fees = EXCLUDED.transaction_gci_before_fees,
        average_commission_pct = EXCLUDED.average_commission_pct,
        production_royalties = EXCLUDED.production_royalties,
        growth_share = EXCLUDED.growth_share,
        total_pr_and_gs = EXCLUDED.total_pr_and_gs,
        gci_after_fees_excl_vat = EXCLUDED.gci_after_fees_excl_vat,
        associate_split_pct = EXCLUDED.associate_split_pct,
        market_center_split_pct = EXCLUDED.market_center_split_pct,
        associate_dollar = EXCLUDED.associate_dollar,
        cap_amount = EXCLUDED.cap_amount,
        cap_contribution = EXCLUDED.cap_contribution,
        cap_remaining = EXCLUDED.cap_remaining,
        team_dollar = EXCLUDED.team_dollar,
        market_center_dollar = EXCLUDED.market_center_dollar,
        cap_cycle_start_date = EXCLUDED.cap_cycle_start_date,
        cap_cycle_end_date = EXCLUDED.cap_cycle_end_date,
        effective_reporting_date = EXCLUDED.effective_reporting_date,
        is_registered = EXCLUDED.is_registered,
        updated_at = NOW()
      `,
      values
    );
  }
}

export async function recomputeAllTransactionAgentCalculations(db: Queryable): Promise<void> {
  const rawRows = await fetchRawRows(db);
  const groups = groupByTransaction(rawRows);
  const calculated = buildCalculatedRows(groups);
  await insertCalculatedRows(db, calculated);
}
