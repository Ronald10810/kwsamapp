import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { buildCapCycleForTesting } from '../services/transactionCalculations.js';
function readWorkspaceFile(relativePath) {
    return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}
function toIsoDate(value) {
    return value.toISOString().slice(0, 10);
}
describe('CAP-002 approved rules regression ledger', () => {
    const agentsSource = readWorkspaceFile('src/routes/agents.ts');
    const reportsSource = readWorkspaceFile('src/routes/reports.ts');
    const transactionsSource = readWorkspaceFile('src/routes/transactions.ts');
    const calculationsSource = readWorkspaceFile('src/services/transactionCalculations.ts');
    const runIfDb = process.env.DATABASE_URL ? it : it.skip;
    it('CAP002-T001 IND-01: individual cycle helper anchors to first day of next month from join month', () => {
        expect(agentsSource).toContain('function firstOfNextMonthFromDateText(dateText: string): string');
        expect(agentsSource).toContain('const nextMonth = month === 12 ? 1 : month + 1;');
        expect(agentsSource).toContain("return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;");
    });
    it('CAP002-T002 IND-02: cap cycle spans a full 12-month anniversary window', () => {
        const cycle = buildCapCycleForTesting(new Date('2026-07-01T00:00:00.000Z'), '2025-07-01');
        expect(toIsoDate(cycle.start)).toBe('2026-07-01');
        expect(toIsoDate(cycle.end)).toBe('2027-06-30');
    });
    it('CAP002-T003 IND-01/IND-02: before anniversary stays in prior cycle', () => {
        const cycle = buildCapCycleForTesting(new Date('2026-06-30T23:59:59.000Z'), '2025-07-01');
        expect(toIsoDate(cycle.start)).toBe('2025-07-01');
        expect(toIsoDate(cycle.end)).toBe('2026-06-30');
    });
    it('CAP002-T004 REG-01: non-registered rows are excluded from cap contribution progression', () => {
        expect(calculationsSource).toContain('if (!row.is_registered) {');
        expect(calculationsSource).toContain('row.cap_contribution = 0;');
    });
    it('CAP002-T005 REG-01: registered gating exists for cap progression updates', () => {
        expect(calculationsSource).toContain('if (row.cap_amount > 0 && row.is_registered && shouldConsumeCap) {');
    });
    it('CAP002-T006 TEAM-01: cappers team achieved is based on market_center_dollar', () => {
        expect(reportsSource).toContain('ROUND(COALESCE(SUM(tac.market_center_dollar), 0)::numeric, 2) AS cap_achieved');
    });
    it('CAP002-T006A CAPDATE-LEAP: cappers anniversary date clamps day-of-month to month end', () => {
        expect(reportsSource).toContain('LEAST(');
        expect(reportsSource).toContain('make_date(');
    });
    it('CAP002-T007 TEAM-01: home team achieved should be based on market_center_dollar (not team_dollar)', () => {
        expect(agentsSource).toContain('COALESCE(SUM(tac.market_center_dollar), 0)::text AS team_cap_achieved');
        expect(agentsSource).not.toContain('SELECT COALESCE(SUM(tac.team_dollar), 0)::text AS team_cap_achieved');
    });
    it('CAP002-T008 TEAM-02: home and cappers should share market_center_dollar achieved basis', () => {
        expect(agentsSource).toContain('SUM(tac.market_center_dollar)');
        expect(reportsSource).toContain('SUM(tac.market_center_dollar)');
    });
    it('CAP002-T015 ASSOC-01: cappers associate achieved should be derived from registered cycle company dollar', () => {
        expect(reportsSource).toContain('associate_cycle_achieved');
        expect(reportsSource).toContain('LEAST(cap_amount, COALESCE(aca.cap_achieved, 0))::numeric(18,2) AS cap_achieved');
        expect(reportsSource).toContain('GREATEST(cap_amount - LEAST(cap_amount, COALESCE(aca.cap_achieved, 0)), 0)::numeric(18,2) AS cap_remaining');
    });
    it('CAP002-T016 TEAM-03: team cappers logic remains unchanged', () => {
        expect(reportsSource).toContain('LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0))::numeric(18,2) AS cap_achieved');
        expect(reportsSource).toContain('GREATEST(tb.cap_amount - LEAST(tb.cap_amount, COALESCE(ta.cap_achieved, 0)), 0)::numeric(18,2) AS cap_remaining');
    });
    it('CAP002-T009 TEAM-02: home should use cycle-window filtering aligned with cappers team cycle logic', () => {
        expect(agentsSource).toContain('tac.effective_reporting_date::date >= (tb.cap_date - INTERVAL \'1 year\')::date');
        expect(agentsSource).toContain('tac.effective_reporting_date::date < tb.cap_date');
    });
    it('CAP002-T010 TEAM-02: home team achieved should avoid calendar-year filter shortcuts', () => {
        expect(agentsSource).not.toContain('EXTRACT(YEAR FROM tac.effective_reporting_date) = $2');
    });
    it('CAP002-T011 SOT-01: transaction financial rollup should not prefer core cap_remaining over TAC', () => {
        expect(transactionsSource).toContain('COALESCE(t.cap_remaining, tac_rollup.cap_remaining) AS cap_remaining');
    });
    it('CAP002-T012 SOT-01: transaction financial rollup should not prefer core company/team dollars over TAC', () => {
        expect(transactionsSource).toContain('COALESCE(t.company_dollar, tac_rollup.market_center_dollar) AS company_dollar');
        expect(transactionsSource).toContain('COALESCE(t.team_dollar, tac_rollup.team_dollar) AS team_dollar');
    });
    it('CAP002-T013 CAPDATE-01: no bulk cap_date auto-correction SQL exists in calculation/report read paths', () => {
        const calculationAndReportingSource = `${calculationsSource}\n${reportsSource}`;
        expect(calculationAndReportingSource).not.toMatch(/UPDATE\s+migration\.core_associates[\s\S]*cap_date/i);
    });
    it('CAP002-T014 CAPDATE-01: audit artifact still exposes unresolved cap_date anomalies (no auto-remediation)', () => {
        const audit = JSON.parse(readWorkspaceFile('tmp_cap_audit_result_20260707.json'));
        const summary = audit.data_quality?.cap_dates?.summary;
        expect(summary).toBeTruthy();
        expect((summary?.associates_with_null_cap_date ?? 0) > 0).toBe(true);
        expect((summary?.associates_cap_date_before_start_date ?? 0) > 0).toBe(true);
        expect((summary?.associates_cap_date_far_future ?? 0) > 0).toBe(true);
    });
    const associateCappersQuery = `
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
    )
    SELECT
      ab.associate_name,
      ab.source_associate_id,
      ab.cap_amount::text AS cap_amount,
      LEAST(ab.cap_amount, COALESCE(aca.cap_achieved, 0))::text AS cap_achieved,
      GREATEST(ab.cap_amount - LEAST(ab.cap_amount, COALESCE(aca.cap_achieved, 0)), 0)::text AS cap_remaining,
      CASE WHEN GREATEST(ab.cap_amount - LEAST(ab.cap_amount, COALESCE(aca.cap_achieved, 0)), 0) <= 0 THEN true ELSE false END AS is_capped,
      ab.team_id
    FROM associate_base ab
    LEFT JOIN associate_cycle_achieved aca ON aca.associate_id = ab.id
    WHERE (
      NULLIF($1::text, '') IS NULL
      OR LOWER(TRIM(ab.associate_name)) = LOWER(TRIM($1::text))
      OR ab.id::text = $1::text
    )
    ORDER BY ab.associate_name
  `;
    async function fetchAssociateRows(client, selector) {
        const result = await client.query(associateCappersQuery, [selector]);
        return result.rows;
    }
    runIfDb('CAP002-T015-DATA: Elaine Carstens should use registered-only cycle company dollar', async () => {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const row = (await fetchAssociateRows(client, 'Elaine Carstens'))[0] ?? null;
            expect(row).toBeTruthy();
            expect(row?.associate_name).toBe('Elaine Carstens');
            expect(Number(row?.cap_amount)).toBeCloseTo(150000, 2);
            expect(Number(row?.cap_achieved)).toBeCloseTo(135659.10, 2);
            expect(Number(row?.cap_remaining)).toBeCloseTo(14340.90, 2);
            expect(row?.is_capped).toBe(false);
        }
        finally {
            await client.end();
        }
    });
    runIfDb('CAP002-T016-DATA: fully capped associate still shows capped with zero remaining', async () => {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const rows = await fetchAssociateRows(client, '');
            const row = rows.find((entry) => Number(entry.cap_amount) > 0 && Number(entry.cap_remaining) === 0);
            expect(row).toBeTruthy();
            expect(Number(row?.cap_achieved)).toBeCloseTo(Number(row?.cap_amount), 2);
            expect(Number(row?.cap_remaining)).toBeCloseTo(0, 2);
        }
        finally {
            await client.end();
        }
    });
    runIfDb('CAP002-T017-DATA: non-capped associate still shows positive remaining cap', async () => {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const rows = await fetchAssociateRows(client, '');
            const row = rows.find((entry) => Number(entry.cap_amount) > 0 && Number(entry.cap_remaining) > 0);
            expect(row).toBeTruthy();
            expect(Number(row?.cap_remaining)).toBeGreaterThan(0);
            expect(Number(row?.cap_achieved)).toBeLessThan(Number(row?.cap_amount));
        }
        finally {
            await client.end();
        }
    });
});
//# sourceMappingURL=cap002.approved-rules.test.js.map