export const DEFAULT_CAP004_STRICT_TRANSACTION_NUMBERS = [
    'TH44357',
    'TH44427',
    'TH44650',
    'TH45218',
    'TH45483',
    'TH45519',
];
function toNumber(value) {
    if (value === null || value === undefined)
        return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function roundPct(value) {
    return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
function clampPct(value) {
    if (!Number.isFinite(value))
        return 0;
    if (value > 999999)
        return 999999;
    if (value < -999999)
        return -999999;
    return value;
}
function toDate(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
function normalizeAssociateSplit(rawSplit) {
    if (rawSplit <= 0)
        return 70;
    if (rawSplit <= 1)
        return rawSplit * 100;
    return Math.max(Math.min(rawSplit, 100), 0);
}
function normalizeTeamSplit(rawSplit) {
    if (rawSplit <= 0)
        return 0;
    if (rawSplit <= 1)
        return Math.max(Math.min(rawSplit * 100, 100), 0);
    return Math.max(Math.min(rawSplit, 100), 0);
}
function resolveSplitPcts(input) {
    if (input.outside) {
        return {
            associateSplitPct: 100,
            marketCenterSplitPct: 0,
        };
    }
    // Team-member precedence: when we are not using authoritative payment rows,
    // split must come from team configuration, not associate profile.
    if (input.teamTransaction && !input.authoritativePaymentDetails && input.configuredTeamSplitPct > 0) {
        return {
            associateSplitPct: input.configuredTeamSplitPct,
            marketCenterSplitPct: Math.max(100 - input.configuredTeamSplitPct, 0),
        };
    }
    const associateSplitPct = normalizeAssociateSplit(input.associateSplitPct);
    if (input.authoritativePaymentDetails && input.gciAfterFees > 0) {
        return {
            associateSplitPct: roundPct((roundMoney(input.paymentAssociateDollar) / input.gciAfterFees) * 100),
            marketCenterSplitPct: roundPct((roundMoney(input.paymentMarketCenterDollar) / input.gciAfterFees) * 100),
        };
    }
    return {
        associateSplitPct,
        marketCenterSplitPct: Math.max(100 - associateSplitPct, 0),
    };
}
export function resolveSplitPctsForTesting(input) {
    return resolveSplitPcts(input);
}
function isRegisteredStatus(status) {
    return (status ?? '').trim().toLowerCase() === 'registered';
}
function getEffectiveReportingDate(row) {
    const statusChangeDate = toDate(row.status_change_date);
    const transactionDate = toDate(row.transaction_date);
    const createdAt = toDate(row.created_at) ?? new Date();
    if (isRegisteredStatus(row.transaction_status)) {
        return statusChangeDate ?? transactionDate ?? createdAt;
    }
    return transactionDate ?? statusChangeDate ?? createdAt;
}
function startOfDay(date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}
function addYears(date, years) {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + years);
    return d;
}
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
}
function buildCapCycle(effectiveDate, capStartDateRaw) {
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
// Narrow test export to verify cap-cycle boundary behavior.
export function buildCapCycleForTesting(effectiveDate, capStartDateRaw) {
    return buildCapCycle(effectiveDate, capStartDateRaw);
}
function isOutsideAgent(row) {
    const role = (row.agent_role ?? '').trim().toLowerCase();
    return role.includes('outside');
}
function isRentalTransaction(row) {
    const category = (row.transaction_category ?? '').trim().toLowerCase();
    const sourceType = (row.source_type ?? '').trim().toLowerCase();
    return (category === 'rentals' ||
        sourceType === 'rental_payment' ||
        row.source_rental_id !== null ||
        row.source_rental_payment_schedule_id !== null);
}
function isTeamTransaction(row) {
    return [
        row.associate_source_team_id,
        row.transaction_source_team_id,
        row.transaction_current_source_team_id,
    ].some((value) => (value ?? '').trim().length > 0);
}
export async function fetchRawRows(db) {
    const result = await db.query(`
    SELECT
      ta.id::text AS transaction_agent_id,
      ta.transaction_id::text AS transaction_id,
      ct.transaction_number,
      ta.associate_id::text AS associate_id,
      ta.source_associate_id,
      COALESCE(ca.full_name, ca.first_name || ' ' || ca.last_name, ta.source_associate_id) AS associate_name,
      COALESCE(mc.name, 'Unassigned / Unknown') AS office_name,
      ta.agent_role,
      ta.split_percentage::text,
      ct.transaction_status,
      ct.transaction_type,
      COALESCE(NULLIF(TRIM(ct.transaction_type), ''), NULLIF(TRIM(ta.agent_role), ''), 'Unspecified') AS transaction_side,
      ct.sales_price::text,
      ct.list_price::text,
      ct.gci_excl_vat::text,
      ct.net_comm::text,
      ct.total_gci::text,
      ct.growth_share::text AS transaction_growth_share,
      ct.production_royalties::text AS transaction_production_royalties,
      ct.transaction_date::text,
      ct.status_change_date::text,
      ct.created_at::text,
      ca.agent_split::text,
      ca.cap::text,
      ca.manual_cap,
      ca.cap_date::text,
      pay.split_percentage::text AS payment_split_percentage,
      pay.gci_before_fees::text AS payment_gci_before_fees,
      pay.production_royalties::text AS payment_production_royalties,
      pay.growth_share::text AS payment_growth_share,
      pay.gci_after_fees_excl_vat::text AS payment_gci_after_fees_excl_vat,
      pay.cap_remaining::text AS payment_cap_remaining,
      pay.associate_dollar::text AS payment_associate_dollar,
      pay.team_dollar::text AS payment_team_dollar,
      pay.mc_dollar::text AS payment_mc_dollar,
      ct.transaction_category,
      ct.source_type,
      ct.source_rental_id::text,
      ct.source_rental_payment_schedule_id::text,
      ca.team_id::text AS associate_team_id,
      team_cap.team_cap_amount::text AS team_cap_amount,
      team_cap.commission_split_to_team::text AS team_commission_split_to_team,
      ct.source_team_id AS transaction_source_team_id,
      ct.current_source_team_id AS transaction_current_source_team_id,
      ca.source_team_id AS associate_source_team_id,
      ct.counts_toward_cap,
      ct.manual_financial_override
    FROM migration.transaction_agents ta
    JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
    LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
    LEFT JOIN LATERAL (
      SELECT
        GREATEST(COALESCE(tc.team_cap_amount, 0), 0)::numeric(18,2) AS team_cap_amount,
        GREATEST(COALESCE(tc.commission_split_to_team, 0), 0)::numeric(10,4) AS commission_split_to_team
      FROM migration.team_caps tc
      WHERE tc.team_id = ca.team_id
      ORDER BY tc.cap_year DESC NULLS LAST, tc.id DESC
      LIMIT 1
    ) team_cap ON true
    LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
    LEFT JOIN LATERAL (
      SELECT
        tapd.split_percentage,
        tapd.gci_before_fees,
        tapd.production_royalties,
        tapd.growth_share,
        tapd.gci_after_fees_excl_vat,
        tapd.cap_remaining,
        tapd.associate_dollar,
        tapd.team_dollar,
        tapd.mc_dollar
      FROM staging.transaction_associate_payment_details tapd
      WHERE tapd.source_transaction_id = ct.source_transaction_id
        AND COALESCE(tapd.source_associate_id, '') = COALESCE(ta.source_associate_id, '')
      ORDER BY tapd.source_transaction_associate_id DESC NULLS LAST, tapd.source_associate_id DESC NULLS LAST
      LIMIT 1
    ) pay ON true
    ORDER BY ta.transaction_id ASC, ta.sort_order ASC, ta.id ASC
  `);
    return result.rows;
}
export function groupByTransaction(rows) {
    const map = new Map();
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
function getNormalizedSplit(raw, splitSum, count) {
    if (count <= 0)
        return 100;
    if (splitSum <= 0)
        return 100 / count;
    return (raw / splitSum) * 100;
}
function resolveTransactionGci(row) {
    const totalGci = toNumber(row.total_gci);
    if (totalGci > 0)
        return totalGci;
    const netComm = toNumber(row.net_comm);
    if (netComm > 0)
        return netComm;
    const gciExclVat = toNumber(row.gci_excl_vat);
    if (gciExclVat > 0)
        return gciExclVat;
    return 0;
}
function hasAuthoritativePaymentDetails(row) {
    return [
        row.payment_split_percentage,
        row.payment_gci_before_fees,
        row.payment_production_royalties,
        row.payment_growth_share,
        row.payment_gci_after_fees_excl_vat,
        row.payment_cap_remaining,
        row.payment_associate_dollar,
        row.payment_team_dollar,
        row.payment_mc_dollar,
    ].some((value) => value !== null && value !== undefined && String(value).trim() !== '');
}
function hasUsableManualFinancialValues(row) {
    return resolveTransactionGci(row) > 0;
}
function buildCalculatedRows(groups) {
    return buildCalculatedRowsWithMeta(groups).map((entry) => entry.row);
}
export function buildPreCapCalculatedRowsWithMeta(groups) {
    const metaRows = [];
    for (const group of groups) {
        const splitSum = group.agents.reduce((acc, item) => acc + Math.max(toNumber(item.split_percentage), 0), 0);
        for (const row of group.agents) {
            const effectiveDate = getEffectiveReportingDate(row);
            const totalGci = resolveTransactionGci(row);
            const salesPrice = Math.max(toNumber(row.sales_price), 0);
            const listPrice = Math.max(toNumber(row.list_price), 0);
            const outside = isOutsideAgent(row);
            const rentalTransaction = isRentalTransaction(row);
            const teamTransaction = isTeamTransaction(row);
            const manualOverrideActive = row.manual_financial_override === true;
            const allowPaymentDetails = !manualOverrideActive || !hasUsableManualFinancialValues(row);
            const authoritativePaymentDetails = !rentalTransaction
                && allowPaymentDetails
                && hasAuthoritativePaymentDetails(row);
            const paymentSplit = Math.max(toNumber(row.payment_split_percentage), 0);
            const rawSplit = Math.max(toNumber(row.split_percentage), 0);
            const splitPercentage = authoritativePaymentDetails && paymentSplit > 0
                ? paymentSplit
                : getNormalizedSplit(rawSplit, splitSum, group.agents.length);
            const splitRatio = splitPercentage / 100;
            const agentGci = authoritativePaymentDetails
                ? roundMoney(toNumber(row.payment_gci_before_fees))
                : roundMoney(totalGci * splitRatio);
            const salesValueComponent = roundMoney(salesPrice * splitRatio);
            const listValueComponent = listPrice * splitRatio;
            const variancePct = listValueComponent > 0 ? clampPct(((salesValueComponent - listValueComponent) / listValueComponent) * 100) : 0;
            const avgCommissionPct = rentalTransaction
                ? roundPct(splitPercentage)
                : salesValueComponent > 0
                    ? clampPct((agentGci / salesValueComponent) * 100)
                    : 0;
            const transactionProductionRoyalties = Math.max(toNumber(row.transaction_production_royalties), 0);
            const transactionGrowthShare = Math.max(toNumber(row.transaction_growth_share), 0);
            const transactionNetComm = Math.max(toNumber(row.net_comm), 0);
            const productionRoyalties = authoritativePaymentDetails
                ? roundMoney(toNumber(row.payment_production_royalties))
                : rentalTransaction && transactionProductionRoyalties > 0
                    ? roundMoney(transactionProductionRoyalties * splitRatio)
                    : roundMoney(agentGci * 0.06);
            const growthShare = authoritativePaymentDetails
                ? roundMoney(toNumber(row.payment_growth_share))
                : rentalTransaction && transactionGrowthShare > 0
                    ? roundMoney(transactionGrowthShare * splitRatio)
                    : roundMoney(agentGci * 0.02);
            const totalPrAndGs = roundMoney(productionRoyalties + growthShare);
            const gciAfterFees = authoritativePaymentDetails
                ? roundMoney(toNumber(row.payment_gci_after_fees_excl_vat))
                : rentalTransaction && transactionNetComm > 0
                    ? roundMoney(transactionNetComm * splitRatio)
                    : roundMoney(agentGci - totalPrAndGs);
            const countsTowardCap = rentalTransaction ? row.counts_toward_cap !== false : true;
            const configuredTeamSplitPct = normalizeTeamSplit(toNumber(row.team_commission_split_to_team));
            const resolvedSplit = resolveSplitPcts({
                outside,
                teamTransaction,
                authoritativePaymentDetails,
                configuredTeamSplitPct,
                associateSplitPct: toNumber(row.agent_split),
                gciAfterFees,
                paymentAssociateDollar: toNumber(row.payment_associate_dollar),
                paymentMarketCenterDollar: toNumber(row.payment_mc_dollar),
            });
            const agentSplitPct = resolvedSplit.associateSplitPct;
            const marketCenterSplitPct = resolvedSplit.marketCenterSplitPct;
            const associateDollarPreCap = roundMoney(gciAfterFees * (agentSplitPct / 100));
            const marketCenterDollarPreCap = roundMoney(gciAfterFees * (marketCenterSplitPct / 100));
            const associateCapAmount = outside ? 0 : roundMoney(toNumber(row.cap));
            const teamCapAmount = outside ? 0 : roundMoney(toNumber(row.team_cap_amount));
            const capAmount = teamTransaction && teamCapAmount > 0 ? teamCapAmount : associateCapAmount;
            const cycle = buildCapCycle(effectiveDate, row.cap_date);
            const capCycleStartDate = toIsoDate(cycle.start);
            const capCycleEndDate = toIsoDate(cycle.end);
            const paymentMarketCenterDollar = roundMoney(toNumber(row.payment_mc_dollar));
            const requiresCapProgression = !outside
                && row.manual_cap !== true
                && authoritativePaymentDetails
                && paymentMarketCenterDollar <= 0
                && gciAfterFees > 0;
            let associateDollar = authoritativePaymentDetails
                ? roundMoney(toNumber(row.payment_associate_dollar))
                : outside ? roundMoney(gciAfterFees) : associateDollarPreCap;
            let teamDollar = authoritativePaymentDetails ? roundMoney(toNumber(row.payment_team_dollar)) : 0;
            if (!outside && teamTransaction) {
                teamDollar = roundMoney(teamDollar + associateDollar);
                associateDollar = 0;
            }
            const normalizedRow = {
                transaction_agent_id: Number(row.transaction_agent_id),
                transaction_id: Number(row.transaction_id),
                transaction_number: row.transaction_number,
                transaction_status: row.transaction_status,
                associate_id: row.associate_id ? Number(row.associate_id) : null,
                source_associate_id: row.source_associate_id,
                is_outside_agent: outside,
                agent_name: row.associate_name,
                office_name: row.office_name,
                transaction_side: row.transaction_side,
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
                associate_dollar: associateDollar,
                cap_amount: roundMoney(capAmount),
                cap_contribution: 0,
                cap_remaining: authoritativePaymentDetails && !requiresCapProgression ? roundMoney(toNumber(row.payment_cap_remaining)) : 0,
                team_dollar: teamDollar,
                market_center_dollar: authoritativePaymentDetails
                    ? (requiresCapProgression ? marketCenterDollarPreCap : paymentMarketCenterDollar)
                    : outside ? 0 : marketCenterDollarPreCap,
                cap_cycle_start_date: capCycleStartDate,
                cap_cycle_end_date: capCycleEndDate,
                effective_reporting_date: toIsoDate(effectiveDate),
                is_registered: isRegisteredStatus(row.transaction_status),
                has_authoritative_payment_details: authoritativePaymentDetails,
                requires_cap_progression: requiresCapProgression,
                is_rental_transaction: rentalTransaction,
                is_team_transaction: teamTransaction,
                counts_toward_cap: countsTowardCap,
            };
            const associateKey = row.associate_id ?? row.source_associate_id ?? `outside-${row.transaction_agent_id}`;
            const capProgressKey = teamTransaction && row.associate_team_id
                ? `team-${row.associate_team_id}`
                : associateKey;
            metaRows.push({
                row: normalizedRow,
                cap_progress_key: capProgressKey,
            });
        }
    }
    return metaRows;
}
export function applyCapProgressionToCalculatedRowsWithMeta(baseMetaRows) {
    const rows = [];
    const capProgressByCycle = new Map();
    const metaRows = baseMetaRows.map((entry) => ({
        row: { ...entry.row },
        cap_progress_key: entry.cap_progress_key,
    }));
    metaRows.sort((a, b) => {
        if (a.row.is_outside_agent !== b.row.is_outside_agent) {
            return a.row.is_outside_agent ? 1 : -1;
        }
        if (a.cap_progress_key !== b.cap_progress_key) {
            return a.cap_progress_key.localeCompare(b.cap_progress_key);
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
        const cycleKey = `${entry.cap_progress_key}|${row.cap_cycle_start_date}`;
        const shouldConsumeCap = !row.is_rental_transaction || row.counts_toward_cap;
        if (row.is_outside_agent) {
            row.cap_remaining = 0;
            row.cap_contribution = 0;
            rows.push(row);
            continue;
        }
        if (row.has_authoritative_payment_details && !row.requires_cap_progression && !row.is_team_transaction) {
            if (row.cap_amount > 0 && row.is_registered && shouldConsumeCap) {
                const capUsedAfter = roundMoney(Math.max(row.cap_amount - row.cap_remaining, 0));
                const capUsedBefore = capProgressByCycle.get(cycleKey) ?? 0;
                capProgressByCycle.set(cycleKey, roundMoney(Math.max(capUsedBefore, capUsedAfter)));
            }
            rows.push(row);
            continue;
        }
        const capUsedBefore = capProgressByCycle.get(cycleKey) ?? 0;
        const capAmount = row.cap_amount;
        const capLeft = Math.max(capAmount - capUsedBefore, 0);
        if (!shouldConsumeCap) {
            row.cap_contribution = 0;
            row.cap_remaining = roundMoney(capLeft);
            rows.push(row);
            continue;
        }
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
            if (row.is_team_transaction) {
                row.team_dollar = roundMoney(row.team_dollar + overflow);
            }
            else {
                row.associate_dollar = roundMoney(row.associate_dollar + overflow);
            }
            row.cap_remaining = roundMoney(Math.max(capAmount - (capUsedBefore + contribution), 0));
            capProgressByCycle.set(cycleKey, roundMoney(capUsedBefore + contribution));
        }
        else {
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
    const rowByAgentId = new Map();
    for (const row of rows) {
        rowByAgentId.set(row.transaction_agent_id, row);
    }
    const withMeta = [];
    for (const entry of metaRows) {
        const finalRow = rowByAgentId.get(entry.row.transaction_agent_id);
        if (!finalRow)
            continue;
        withMeta.push({
            row: finalRow,
            cap_progress_key: entry.cap_progress_key,
        });
    }
    return withMeta;
}
export function buildCalculatedRowsWithMeta(groups) {
    return applyCapProgressionToCalculatedRowsWithMeta(buildPreCapCalculatedRowsWithMeta(groups));
}
function differs(a, b) {
    if (a === null)
        return true;
    return Math.abs(a - b) > 0.000001;
}
function normalizeTransactionAgentId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : -1;
}
export function normalizeTransactionAgentIdForTesting(value) {
    return normalizeTransactionAgentId(value);
}
export function selectScopedEnvelopeForTesting(calculatedRowsWithMeta, strictTransactionNumbers) {
    const strictSet = new Set(strictTransactionNumbers.map((value) => value.trim().toUpperCase()));
    const envelopeKeys = new Set();
    for (const row of calculatedRowsWithMeta) {
        const txNumber = (row.transaction_number ?? '').trim().toUpperCase();
        if (!strictSet.has(txNumber))
            continue;
        envelopeKeys.add(`${row.cap_progress_key}|${row.cap_cycle_start_date}`);
    }
    return calculatedRowsWithMeta.filter((row) => envelopeKeys.has(`${row.cap_progress_key}|${row.cap_cycle_start_date}`));
}
async function fetchCurrentTacRowsByAgentIds(db, transactionAgentIds) {
    if (transactionAgentIds.length === 0) {
        return new Map();
    }
    const result = await db.query(`
    SELECT
      transaction_agent_id,
      market_center_dollar::text AS market_center_dollar,
      team_dollar::text AS team_dollar,
      associate_split_pct::text AS associate_split_pct,
      market_center_split_pct::text AS market_center_split_pct,
      cap_contribution::text AS cap_contribution,
      cap_remaining::text AS cap_remaining,
      is_registered
    FROM migration.transaction_agent_calculations
    WHERE transaction_agent_id = ANY($1::int[])
    `, [transactionAgentIds]);
    const map = new Map();
    for (const row of result.rows) {
        map.set(normalizeTransactionAgentId(row.transaction_agent_id), row);
    }
    return map;
}
async function fetchTeamNagelCapImpactSummary(db, proposedByAgentId) {
    const cycleResult = await db.query(`
    WITH team_base AS (
      SELECT t.id AS team_id, MIN(ca.cap_date)::date AS cap_date
      FROM migration.core_teams t
      JOIN migration.core_associates ca ON ca.team_id = t.id
      WHERE LOWER(TRIM(COALESCE(t.name,''))) = 'team nagel'
        AND LOWER(TRIM(COALESCE(ca.status_name,''))) IN ('active','1')
      GROUP BY t.id
      LIMIT 1
    ),
    cycle_windows AS (
      SELECT team_id,
        CASE
          WHEN cap_date IS NULL THEN NULL::date
          ELSE make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM cap_date)::int, EXTRACT(DAY FROM cap_date)::int)
        END AS anniversary_this_year
      FROM team_base
    ),
    windowed AS (
      SELECT team_id,
        CASE
          WHEN anniversary_this_year IS NULL THEN NULL::date
          WHEN anniversary_this_year >= CURRENT_DATE THEN anniversary_this_year
          ELSE (anniversary_this_year + INTERVAL '1 year')::date
        END AS next_cap_date
      FROM cycle_windows
    ),
    latest_team_cap AS (
      SELECT GREATEST(COALESCE(tc.team_cap_amount,0),0)::numeric(18,2) AS cap_amount
      FROM migration.team_caps tc
      JOIN windowed w ON w.team_id = tc.team_id
      ORDER BY tc.cap_year DESC NULLS LAST, tc.id DESC
      LIMIT 1
    )
    SELECT w.team_id, ltc.cap_amount::text AS cap_amount, w.next_cap_date::text AS next_cap_date
    FROM windowed w
    CROSS JOIN latest_team_cap ltc
    `);
    if (cycleResult.rows.length === 0) {
        return null;
    }
    const cycleRow = cycleResult.rows[0];
    const nextCapDate = cycleRow.next_cap_date ? new Date(cycleRow.next_cap_date) : null;
    const capAmount = roundMoney(toNumber(cycleRow.cap_amount));
    const currentRows = await db.query(`
    SELECT
      tac.transaction_agent_id,
      tac.associate_id,
      tac.effective_reporting_date::text AS effective_reporting_date,
      tac.is_registered,
      tac.market_center_dollar::text AS market_center_dollar
    FROM migration.transaction_agent_calculations tac
    JOIN migration.core_associates ca ON ca.id = tac.associate_id
    WHERE ca.team_id = $1
    `, [cycleRow.team_id]);
    const inWindow = (effectiveReportingDate) => {
        if (!nextCapDate)
            return true;
        const effectiveDate = new Date(effectiveReportingDate);
        const from = new Date(nextCapDate);
        from.setUTCFullYear(from.getUTCFullYear() - 1);
        return effectiveDate >= from && effectiveDate < nextCapDate;
    };
    let currentCapAchieved = 0;
    let proposedCapAchieved = 0;
    for (const current of currentRows.rows) {
        if (!current.is_registered)
            continue;
        if (!inWindow(current.effective_reporting_date))
            continue;
        const currentCompany = roundMoney(toNumber(current.market_center_dollar));
        currentCapAchieved = roundMoney(currentCapAchieved + currentCompany);
        const proposed = proposedByAgentId.get(normalizeTransactionAgentId(current.transaction_agent_id));
        if (!proposed) {
            proposedCapAchieved = roundMoney(proposedCapAchieved + currentCompany);
            continue;
        }
        if (!proposed.is_registered)
            continue;
        if (!inWindow(proposed.effective_reporting_date))
            continue;
        proposedCapAchieved = roundMoney(proposedCapAchieved + roundMoney(proposed.market_center_dollar));
    }
    return {
        cap_amount: capAmount,
        current_cap_achieved: roundMoney(currentCapAchieved),
        proposed_cap_achieved: roundMoney(proposedCapAchieved),
        current_cap_remaining: roundMoney(Math.max(capAmount - Math.min(capAmount, currentCapAchieved), 0)),
        proposed_cap_remaining: roundMoney(Math.max(capAmount - Math.min(capAmount, proposedCapAchieved), 0)),
    };
}
export async function previewScopedTransactionAgentCalculations(db, strictTransactionNumbers = DEFAULT_CAP004_STRICT_TRANSACTION_NUMBERS) {
    const normalizedStrictTransactionNumbers = strictTransactionNumbers
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 0);
    const rawRows = await fetchRawRows(db);
    const groups = groupByTransaction(rawRows);
    const calculatedWithMeta = buildCalculatedRowsWithMeta(groups);
    const envelopeWithMeta = selectScopedEnvelopeForTesting(calculatedWithMeta.map((entry) => ({
        transaction_number: entry.row.transaction_number,
        cap_progress_key: entry.cap_progress_key,
        cap_cycle_start_date: entry.row.cap_cycle_start_date,
    })), normalizedStrictTransactionNumbers);
    const envelopeKeySet = new Set(envelopeWithMeta.map((entry) => `${entry.cap_progress_key}|${entry.cap_cycle_start_date}`));
    const envelopeEntries = calculatedWithMeta.filter((entry) => {
        const key = `${entry.cap_progress_key}|${entry.row.cap_cycle_start_date}`;
        return envelopeKeySet.has(key);
    });
    const envelopeTransactionAgentIds = envelopeEntries.map((entry) => entry.row.transaction_agent_id);
    const currentByAgentId = await fetchCurrentTacRowsByAgentIds(db, envelopeTransactionAgentIds);
    const changedRows = [];
    for (const entry of envelopeEntries) {
        const proposed = entry.row;
        const current = currentByAgentId.get(normalizeTransactionAgentId(proposed.transaction_agent_id)) ?? null;
        const currentCompany = current ? roundMoney(toNumber(current.market_center_dollar)) : null;
        const currentTeam = current ? roundMoney(toNumber(current.team_dollar)) : null;
        const currentAssociateSplit = current ? roundPct(toNumber(current.associate_split_pct)) : null;
        const currentCompanySplit = current ? roundPct(toNumber(current.market_center_split_pct)) : null;
        const currentContribution = current ? roundMoney(toNumber(current.cap_contribution)) : null;
        const currentRemaining = current ? roundMoney(toNumber(current.cap_remaining)) : null;
        const changed = differs(currentCompany, proposed.market_center_dollar)
            || differs(currentTeam, proposed.team_dollar)
            || differs(currentAssociateSplit, proposed.associate_split_pct)
            || differs(currentCompanySplit, proposed.market_center_split_pct)
            || differs(currentContribution, proposed.cap_contribution)
            || differs(currentRemaining, proposed.cap_remaining)
            || (current?.is_registered ?? null) !== proposed.is_registered;
        if (!changed)
            continue;
        changedRows.push({
            transaction_agent_id: proposed.transaction_agent_id,
            transaction_id: proposed.transaction_id,
            transaction_number: proposed.transaction_number,
            cap_progress_key: entry.cap_progress_key,
            cap_cycle_start_date: proposed.cap_cycle_start_date,
            cap_cycle_end_date: proposed.cap_cycle_end_date,
            associate_id: proposed.associate_id,
            current_market_center_dollar: currentCompany,
            proposed_market_center_dollar: proposed.market_center_dollar,
            current_team_dollar: currentTeam,
            proposed_team_dollar: proposed.team_dollar,
            current_associate_split_pct: currentAssociateSplit,
            proposed_associate_split_pct: proposed.associate_split_pct,
            current_market_center_split_pct: currentCompanySplit,
            proposed_market_center_split_pct: proposed.market_center_split_pct,
            current_cap_contribution: currentContribution,
            proposed_cap_contribution: proposed.cap_contribution,
            current_cap_remaining: currentRemaining,
            proposed_cap_remaining: proposed.cap_remaining,
            current_is_registered: current?.is_registered ?? null,
            proposed_is_registered: proposed.is_registered,
        });
    }
    const strictTransactionSummaries = [];
    for (const transactionNumber of normalizedStrictTransactionNumbers) {
        let currentCompany = 0;
        let proposedCompany = 0;
        let currentTeam = 0;
        let proposedTeam = 0;
        for (const entry of envelopeEntries) {
            const txNumber = (entry.row.transaction_number ?? '').trim().toUpperCase();
            if (txNumber !== transactionNumber)
                continue;
            const current = currentByAgentId.get(normalizeTransactionAgentId(entry.row.transaction_agent_id));
            currentCompany = roundMoney(currentCompany + roundMoney(toNumber(current?.market_center_dollar ?? null)));
            currentTeam = roundMoney(currentTeam + roundMoney(toNumber(current?.team_dollar ?? null)));
            proposedCompany = roundMoney(proposedCompany + roundMoney(entry.row.market_center_dollar));
            proposedTeam = roundMoney(proposedTeam + roundMoney(entry.row.team_dollar));
        }
        strictTransactionSummaries.push({
            transaction_number: transactionNumber,
            current_company_dollar: currentCompany,
            proposed_company_dollar: proposedCompany,
            current_team_dollar: currentTeam,
            proposed_team_dollar: proposedTeam,
        });
    }
    const th44357 = strictTransactionSummaries.find((row) => row.transaction_number === 'TH44357');
    const teamNagelCapImpact = await fetchTeamNagelCapImpactSummary(db, new Map(envelopeEntries.map((entry) => [entry.row.transaction_agent_id, entry.row])));
    return {
        strict_transaction_numbers: normalizedStrictTransactionNumbers,
        envelope_transaction_agent_ids: envelopeTransactionAgentIds,
        envelope_rows_count: envelopeEntries.length,
        changed_rows_count: changedRows.length,
        changed_rows: changedRows,
        strict_transaction_summaries: strictTransactionSummaries,
        th44357_expected_check: {
            expected_company_dollar: 78936,
            expected_team_dollar: 184184,
            proposed_company_dollar: th44357?.proposed_company_dollar ?? 0,
            proposed_team_dollar: th44357?.proposed_team_dollar ?? 0,
            matches_expected: !!th44357
                && Math.abs(th44357.proposed_company_dollar - 78936) < 0.000001
                && Math.abs(th44357.proposed_team_dollar - 184184) < 0.000001,
        },
        team_nagel_cap_impact: teamNagelCapImpact,
    };
}
async function insertCalculatedRows(db, rows) {
    // Replace the full snapshot each run.
    await db.query(`TRUNCATE TABLE migration.transaction_agent_calculations`);
    if (rows.length === 0) {
        return;
    }
    const chunkSize = 500;
    for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize);
        const values = [];
        const placeholders = [];
        for (let i = 0; i < chunk.length; i += 1) {
            const row = chunk[i];
            const base = i * 31;
            placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20},$${base + 21},$${base + 22},$${base + 23},$${base + 24},$${base + 25},$${base + 26},$${base + 27},$${base + 28},$${base + 29},$${base + 30},$${base + 31})`);
            values.push(row.transaction_agent_id, row.transaction_id, row.associate_id, row.source_associate_id, row.is_outside_agent, row.agent_name, row.office_name, row.transaction_side, row.split_percentage, row.variance_sale_list_pct, row.sales_value_component, row.transaction_gci_before_fees, row.average_commission_pct, row.production_royalties, row.growth_share, row.total_pr_and_gs, row.gci_after_fees_excl_vat, row.associate_split_pct, row.market_center_split_pct, row.associate_dollar, row.cap_amount, row.cap_contribution, row.cap_remaining, row.team_dollar, row.market_center_dollar, row.cap_cycle_start_date, row.cap_cycle_end_date, row.effective_reporting_date, row.is_registered, new Date().toISOString(), new Date().toISOString());
        }
        await db.query(`
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
        is_registered,
        created_at,
        updated_at
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (transaction_agent_id) DO UPDATE
      SET
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
        updated_at = EXCLUDED.updated_at
      `, values);
    }
}
async function ensureCalculationUniqueness(db) {
    // Keep latest row per transaction_agent_id before enforcing uniqueness.
    await db.query(`
    DELETE FROM migration.transaction_agent_calculations a
    USING migration.transaction_agent_calculations b
    WHERE a.transaction_agent_id = b.transaction_agent_id
      AND a.id < b.id
  `);
    await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_calc_transaction_agent_id
      ON migration.transaction_agent_calculations(transaction_agent_id)
  `);
}
async function ensureCalculationColumns(db) {
    await db.query(`
    ALTER TABLE migration.core_transactions
      ADD COLUMN IF NOT EXISTS manual_financial_override BOOLEAN DEFAULT FALSE
  `);
    await db.query(`
    ALTER TABLE migration.transaction_agent_calculations
      ADD COLUMN IF NOT EXISTS source_associate_id TEXT,
      ADD COLUMN IF NOT EXISTS sales_value_component NUMERIC(18,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS associate_split_pct NUMERIC(10,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS market_center_split_pct NUMERIC(10,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cap_contribution NUMERIC(18,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cap_cycle_start_date DATE,
      ADD COLUMN IF NOT EXISTS cap_cycle_end_date DATE
  `);
}
export async function recomputeAllTransactionAgentCalculations(db) {
    // Serialize recompute across all app instances sharing the same database.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('kwsa:transaction-agent-calculations:recompute'))`);
    await ensureCalculationColumns(db);
    await ensureCalculationUniqueness(db);
    const rawRows = await fetchRawRows(db);
    const groups = groupByTransaction(rawRows);
    const calculated = buildCalculatedRows(groups);
    await insertCalculatedRows(db, calculated);
}
//# sourceMappingURL=transactionCalculations.js.map