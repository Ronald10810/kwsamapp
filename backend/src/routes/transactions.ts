import { Router } from 'express';
import { type Pool } from 'pg';
import { recomputeAllTransactionAgentCalculations } from '../services/transactionCalculations.js';
import { getOptionalPgPool } from '../config/db.js';

const router = Router();
const pool = getOptionalPgPool();

const ALLOWED_STATUSES = [
  'Start',
  'Working',
  'Submitted',
  'Registered',
  'Accepted',
  'Rejected',
  'Withdrawn',
  'Pending',
] as const;

type ReportingWindowRow = {
  start_date: string;
  end_date: string;
  end_exclusive: string;
  basis: 'registered' | 'allStatuses';
};

function reportingDateSql(alias: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${alias}.transaction_status, ''))) = 'registered'
      THEN COALESCE(${alias}.status_change_date, ${alias}.transaction_date, ${alias}.created_at)
    ELSE COALESCE(${alias}.transaction_date, ${alias}.status_change_date, ${alias}.created_at)
  END`;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDateValue(value: unknown): string | null {
  const t = toText(value);
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildManualTransactionId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `MAN-TX-${ts}-${rand}`;
}

function validateAgentSplits(agents: Array<Record<string, unknown>>): string | null {
  if (agents.length === 0) {
    return null;
  }

  let splitSum = 0;
  for (const agent of agents) {
    const splitValue = toNumber(agent?.split_percentage);
    if (splitValue === null || splitValue < 0 || splitValue > 100) {
      return 'Each agent split_percentage must be between 0 and 100.';
    }
    splitSum += splitValue;
  }

  if (Math.abs(splitSum - 100) > 0.01) {
    return `Total split percentage must equal 100. Current total: ${splitSum.toFixed(2)}.`;
  }

  return null;
}

async function getNextTransactionNumber(db: Pool): Promise<string> {
  const result = await db.query<{ max_number: string | null }>(
    `
    SELECT MAX(CAST(SUBSTRING(transaction_number FROM 4) AS INTEGER))::text AS max_number
    FROM migration.core_transactions
    WHERE transaction_number ~ '^TRH[0-9]+$'
    `
  );
  const currentMax = Number(result.rows[0]?.max_number ?? 8999);
  const nextValue = Number.isFinite(currentMax) ? currentMax + 1 : 9000;
  return `TRH${nextValue}`;
}

router.get('/next-number', async (_req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }
  try {
    const nextTransactionNumber = await getNextTransactionNumber(pool);
    return res.json({ next_transaction_number: nextTransactionNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/summary', async (_req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  try {
    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_transactions') AS exists`
    );
    if (!exists.rows[0]?.exists) {
      return res.json({
        totals: {
          total_transactions: 0,
          total_sales_value: 0,
          total_net_commission: 0,
          average_split_percentage: 0,
        },
        mtd_registered_active: {
          total_transactions: 0,
          total_sales_value: 0,
          total_net_commission: 0,
          average_split_percentage: 0,
        },
        by_status: [],
        by_type: [],
        market_center_performance: [],
        associate_performance: [],
        expected_closings_90_days: [],
        reporting_window: null,
        performance_basis: 'registered',
      });
    }

    const reportingWindowResult = await pool.query<ReportingWindowRow>(
      `
      WITH limits AS (
        SELECT
          date_trunc('month', CURRENT_DATE)::date AS month_start,
          (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
      ),
      eligible AS (
        SELECT tac.effective_reporting_date::date AS effective_reporting_date,
               tac.is_registered
        FROM migration.transaction_agent_calculations tac
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
        WHERE (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
          AND (ca.id IS NULL OR LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1'))
      ),
      reporting_window AS (
        SELECT
          CASE
            WHEN EXISTS (
              SELECT 1 FROM eligible, limits
              WHERE is_registered = true
                AND effective_reporting_date >= limits.month_start
                AND effective_reporting_date < limits.month_end
            ) THEN 'registered'
            WHEN EXISTS (
              SELECT 1 FROM eligible, limits
              WHERE effective_reporting_date >= limits.month_start
                AND effective_reporting_date < limits.month_end
            ) THEN 'allStatuses'
            WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN 'registered'
            ELSE 'allStatuses'
          END AS basis,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM eligible, limits
              WHERE effective_reporting_date >= limits.month_start
                AND effective_reporting_date < limits.month_end
            ) THEN (SELECT month_start FROM limits)
            WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN (
              SELECT date_trunc('month', MAX(effective_reporting_date))::date
              FROM eligible
              WHERE is_registered = true
            )
            ELSE COALESCE((SELECT date_trunc('month', MAX(effective_reporting_date))::date FROM eligible), (SELECT month_start FROM limits))
          END AS start_date
      )
      SELECT
        start_date::text,
        (start_date + INTERVAL '1 month' - INTERVAL '1 day')::date::text AS end_date,
        (start_date + INTERVAL '1 month')::date::text AS end_exclusive,
        basis
      FROM reporting_window
      `
    );

    const reportingWindow = reportingWindowResult.rows[0] ?? {
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      end_exclusive: new Date().toISOString().slice(0, 10),
      basis: 'registered',
    };

    const reportingWindowParams = [reportingWindow.start_date, reportingWindow.end_exclusive, reportingWindow.basis];

    const [totalsResult, mtdResult, statusResult, typeResult, marketCenterResult, associateResult, closingsResult] = await Promise.all([
      pool.query<{
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        average_split_percentage: string;
      }>(
        `
        SELECT
          COUNT(DISTINCT ct.id)::text AS total_transactions,
          COALESCE(SUM(ct.sales_price), 0)::text AS total_sales_value,
          COALESCE(SUM(tac.gci_after_fees_excl_vat), 0)::text AS total_net_commission,
          COALESCE(AVG(COALESCE(tac.split_percentage, 0)), 0)::text AS average_split_percentage
        FROM migration.core_transactions ct
        LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_id = ct.id
        `
      ),
      pool.query<{
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        average_split_percentage: string;
      }>(
        `
        WITH filtered_tac AS (
          SELECT tac.transaction_id, tac.gci_after_fees_excl_vat, tac.split_percentage
          FROM migration.transaction_agent_calculations tac
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
          WHERE ($3::text = 'allStatuses' OR tac.is_registered = true)
            AND tac.effective_reporting_date >= $1::date
            AND tac.effective_reporting_date < $2::date
            AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
            AND (ca.id IS NULL OR LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1'))
        ),
        grouped_tx AS (
          SELECT
            ft.transaction_id,
            MAX(ct.sales_price) AS sales_price
          FROM filtered_tac ft
          LEFT JOIN migration.core_transactions ct ON ct.id = ft.transaction_id
          GROUP BY ft.transaction_id
        )
        SELECT
          COALESCE((SELECT COUNT(*) FROM grouped_tx), 0)::text AS total_transactions,
          COALESCE((SELECT SUM(sales_price) FROM grouped_tx), 0)::text AS total_sales_value,
          COALESCE((SELECT SUM(gci_after_fees_excl_vat) FROM filtered_tac), 0)::text AS total_net_commission,
          COALESCE((SELECT AVG(COALESCE(split_percentage, 0)) FROM filtered_tac), 0)::text AS average_split_percentage
        `,
        reportingWindowParams
      ),
      pool.query<{ label: string; count: string }>(
        `
        SELECT
          COALESCE(transaction_status, 'Unknown') AS label,
          COUNT(*)::text AS count
        FROM migration.core_transactions
        GROUP BY COALESCE(transaction_status, 'Unknown')
        ORDER BY COUNT(*) DESC
        `
      ),
      pool.query<{ label: string; count: string }>(
        `
        SELECT
          COALESCE(transaction_type, 'Unknown') AS label,
          COUNT(*)::text AS count
        FROM migration.core_transactions
        GROUP BY COALESCE(transaction_type, 'Unknown')
        ORDER BY COUNT(*) DESC
        `
      ),
      pool.query<{ market_center: string; total_transactions: string; total_sales_value: string; total_net_commission: string; total_gci: string }>(
        `
        WITH mtd AS (
          SELECT
            COALESCE(tac.office_name, mc.name, 'Unassigned / Unknown') AS market_center,
            tac.transaction_id,
            tac.gci_after_fees_excl_vat,
            tac.transaction_gci_before_fees,
            ct.sales_price
          FROM migration.transaction_agent_calculations tac
          LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
          WHERE ($3::text = 'allStatuses' OR tac.is_registered = true)
            AND tac.effective_reporting_date >= $1::date
            AND tac.effective_reporting_date < $2::date
            AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
            AND (ca.id IS NULL OR LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1'))
        ),
        per_transaction AS (
          SELECT
            market_center,
            transaction_id,
            MAX(sales_price) AS sales_price,
            COALESCE(SUM(transaction_gci_before_fees), 0) AS total_gci,
            COALESCE(SUM(gci_after_fees_excl_vat), 0) AS total_net_commission
          FROM mtd
          GROUP BY market_center, transaction_id
        ),
        grouped AS (
          SELECT
            market_center,
            COUNT(*)::text AS total_transactions,
            COALESCE(SUM(total_gci), 0)::text AS total_gci,
            COALESCE(SUM(total_net_commission), 0)::text AS total_net_commission,
            COALESCE(SUM(sales_price), 0)::text AS total_sales_value
          FROM per_transaction
          GROUP BY market_center
        )
        SELECT
          grouped.market_center,
          grouped.total_transactions,
          grouped.total_sales_value,
          grouped.total_net_commission,
          grouped.total_gci
        FROM grouped
        ORDER BY grouped.total_gci::numeric DESC, grouped.total_transactions::int DESC
        LIMIT 8
        `,
        reportingWindowParams
      ),
      pool.query<{ associate_name: string; market_center: string; total_transactions: string; total_sales_value: string; total_gci: string }>(
        `
        WITH mtd AS (
          SELECT
            COALESCE(tac.agent_name, ca.full_name, ca.source_associate_id, 'Unknown Associate') AS associate_name,
            COALESCE(tac.office_name, mc.name, 'Unassigned / Unknown') AS market_center,
            tac.transaction_id,
            tac.transaction_gci_before_fees,
            ct.sales_price
          FROM migration.transaction_agent_calculations tac
          LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
          WHERE ($3::text = 'allStatuses' OR tac.is_registered = true)
            AND tac.is_outside_agent = false
            AND tac.effective_reporting_date >= $1::date
            AND tac.effective_reporting_date < $2::date
            AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
            AND (ca.id IS NULL OR LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1'))
        ),
        per_transaction AS (
          SELECT
            associate_name,
            market_center,
            transaction_id,
            MAX(sales_price) AS sales_price,
            COALESCE(SUM(transaction_gci_before_fees), 0) AS total_gci
          FROM mtd
          GROUP BY associate_name, market_center, transaction_id
        )
        SELECT
          associate_name,
          market_center,
          COUNT(*)::text AS total_transactions,
          COALESCE(SUM(sales_price), 0)::text AS total_sales_value,
          COALESCE(SUM(total_gci), 0)::text AS total_gci
        FROM per_transaction
        GROUP BY associate_name, market_center
        ORDER BY COALESCE(SUM(total_gci), 0) DESC, COUNT(*) DESC
        LIMIT 10
        `,
        reportingWindowParams
      ),
      pool.query<{ bucket: string; count: string; total_gci: string }>(
        `
        WITH windowed AS (
          SELECT
            CASE
              WHEN expected_date >= NOW() AND expected_date < (NOW() + INTERVAL '30 days') THEN 'Days 1-30'
              WHEN expected_date >= (NOW() + INTERVAL '30 days') AND expected_date < (NOW() + INTERVAL '60 days') THEN 'Days 31-60'
              WHEN expected_date >= (NOW() + INTERVAL '60 days') AND expected_date < (NOW() + INTERVAL '90 days') THEN 'Days 61-90'
              WHEN expected_date >= (NOW() + INTERVAL '90 days') AND expected_date < (NOW() + INTERVAL '120 days') THEN 'Days 91-120'
              ELSE NULL
            END AS bucket,
            total_gci
          FROM migration.core_transactions
          WHERE expected_date IS NOT NULL
            AND expected_date >= NOW()
            AND expected_date < (NOW() + INTERVAL '120 days')
        )
        SELECT
          bucket,
          COUNT(*)::text AS count,
          COALESCE(SUM(total_gci), 0)::text AS total_gci
        FROM windowed
        WHERE bucket IS NOT NULL
        GROUP BY bucket
        ORDER BY CASE bucket
          WHEN 'Days 1-30' THEN 1
          WHEN 'Days 31-60' THEN 2
          WHEN 'Days 61-90' THEN 3
          WHEN 'Days 91-120' THEN 4
          ELSE 5
        END
        `
      ),
    ]);

    const totals = totalsResult.rows[0] ?? {
      total_transactions: '0',
      total_sales_value: '0',
      total_net_commission: '0',
      average_split_percentage: '0',
    };

    const mtdTotals = mtdResult.rows[0] ?? {
      total_transactions: '0',
      total_sales_value: '0',
      total_net_commission: '0',
      average_split_percentage: '0',
    };

    return res.json({
      totals: {
        total_transactions: Number(totals.total_transactions ?? '0'),
        total_sales_value: Number(totals.total_sales_value ?? '0'),
        total_net_commission: Number(totals.total_net_commission ?? '0'),
        average_split_percentage: Number(totals.average_split_percentage ?? '0'),
      },
      mtd_registered_active: {
        total_transactions: Number(mtdTotals.total_transactions ?? '0'),
        total_sales_value: Number(mtdTotals.total_sales_value ?? '0'),
        total_net_commission: Number(mtdTotals.total_net_commission ?? '0'),
        average_split_percentage: Number(mtdTotals.average_split_percentage ?? '0'),
      },
      by_status: statusResult.rows.map((row) => ({ label: row.label, count: Number(row.count) })),
      by_type: typeResult.rows.map((row) => ({ label: row.label, count: Number(row.count) })),
      market_center_performance: marketCenterResult.rows.map((row) => ({
        market_center: row.market_center,
        total_transactions: Number(row.total_transactions),
        total_sales_value: Number(row.total_sales_value),
        total_net_commission: Number(row.total_net_commission),
        total_gci: Number(row.total_gci),
      })),
      associate_performance: associateResult.rows.map((row) => ({
        associate_name: row.associate_name,
        market_center: row.market_center,
        total_transactions: Number(row.total_transactions),
        total_sales_value: Number(row.total_sales_value),
        total_gci: Number(row.total_gci),
      })),
      expected_closings_90_days: closingsResult.rows.map((row) => ({
        bucket: row.bucket,
        count: Number(row.count),
        total_gci: Number(row.total_gci),
      })),
      reporting_window: {
        start_date: reportingWindow.start_date,
        end_date: reportingWindow.end_date,
        basis: reportingWindow.basis,
      },
      performance_basis: reportingWindow.basis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const limitInput = Number(req.query.limit ?? 25);
  const offsetInput = Number(req.query.offset ?? 0);
  const searchInput = String(req.query.search ?? '').trim();
  const statusFilter = String(req.query.status ?? '').trim();
  const typeFilter = String(req.query.type ?? '').trim();

  const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 200) : 25;
  const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;

  try {
    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_transactions') AS exists`
    );
    if (!exists.rows[0]?.exists) {
      return res.json({ total: 0, limit, offset, items: [] });
    }

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (searchInput.length > 0) {
      const tokens = searchInput
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean);

      for (const token of tokens) {
        params.push(`%${token}%`);
        const p = `$${params.length}`;
        whereClauses.push(
          `(
            ct.transaction_number ILIKE ${p}
            OR ct.source_transaction_id ILIKE ${p}
            OR ct.address ILIKE ${p}
            OR ct.suburb ILIKE ${p}
            OR ct.city ILIKE ${p}
            OR ct.transaction_type ILIKE ${p}
            OR ct.transaction_status ILIKE ${p}
            OR ct.listing_number ILIKE ${p}
            OR ct.source_listing_id ILIKE ${p}
            OR ca.full_name ILIKE ${p}
            OR ca.source_associate_id ILIKE ${p}
            OR mc.name ILIKE ${p}
            OR mc.source_market_center_id ILIKE ${p}
            OR tac.agent_name ILIKE ${p}
            OR tac.office_name ILIKE ${p}
            OR tac.transaction_side ILIKE ${p}
          )`
        );
      }
    }
    if (statusFilter.length > 0) {
      params.push(statusFilter);
      whereClauses.push(`LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM($${params.length}))`);
    }
    if (typeFilter.length > 0) {
      params.push(typeFilter);
      whereClauses.push(`LOWER(TRIM(COALESCE(ct.transaction_type, ''))) = LOWER(TRIM($${params.length}))`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countParams = [...params];
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const [totalResult, dataResult] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(DISTINCT ct.id)::text AS total
         FROM migration.core_transactions ct
         LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
         LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
         LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
         LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
         ${whereSql}`,
        countParams
      ),
      pool.query(
        `WITH filtered AS (
           SELECT DISTINCT ct.id
           FROM migration.core_transactions ct
           LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
           LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
           LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
           LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
           ${whereSql}
         ),
         page_tx AS (
           SELECT ct.*
           FROM migration.core_transactions ct
           JOIN filtered f ON f.id = ct.id
           ORDER BY ${reportingDateSql('ct')} DESC NULLS LAST, ct.id DESC
           LIMIT ${limitParam} OFFSET ${offsetParam}
         )
         SELECT
           t.id, t.source_transaction_id, t.transaction_number,
           t.transaction_status, t.transaction_type,
           t.listing_number, t.source_listing_id,
           t.address, t.suburb, t.city,
           t.sales_price, t.list_price, t.gci_excl_vat,
           t.net_comm, t.total_gci,
           t.sale_type, t.buyer, t.seller,
           t.list_date::text, t.transaction_date::text,
           t.status_change_date::text, t.expected_date::text,
           t.created_at::text AS created_at,
           COALESCE(mc_primary.name, mc.name) AS market_center_name,
           COALESCE(mc_primary.source_market_center_id, mc.source_market_center_id) AS source_market_center_id,
           ta.id AS agent_id,
           ta.associate_id,
           COALESCE(ca.full_name, tac.agent_name) AS associate_name,
           ca.image_url AS associate_image_url,
           ta.source_associate_id,
           COALESCE(ta.agent_role, tac.transaction_side, t.transaction_type) AS agent_role,
           ta.split_percentage,
           ta.sort_order,
           tac.office_name,
           tac.transaction_side,
           tac.split_percentage::text AS calculated_split_percentage,
           tac.variance_sale_list_pct::text,
           tac.transaction_gci_before_fees::text,
           tac.average_commission_pct::text,
           tac.production_royalties::text,
           tac.growth_share::text,
           tac.total_pr_and_gs::text,
           tac.gci_after_fees_excl_vat::text,
           tac.associate_dollar::text,
           tac.cap_amount::text,
           tac.cap_remaining::text,
           tac.team_dollar::text,
           tac.market_center_dollar::text,
           tac.is_outside_agent,
           t.updated_at::text
         FROM page_tx t
         LEFT JOIN migration.core_market_centers mc_primary ON mc_primary.id = t.primary_market_center_id
         LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = t.id
         LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
         LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
         LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
         ORDER BY ${reportingDateSql('t')} DESC NULLS LAST, t.id DESC, ta.sort_order ASC`,
        params
      ),
    ]);

    // Group agents by transaction
    const txMap = new Map<string, any>();
    for (const row of dataResult.rows) {
      if (!txMap.has(row.id)) {
        txMap.set(row.id, {
          id: row.id,
          source_transaction_id: row.source_transaction_id,
          transaction_number: row.transaction_number,
          transaction_status: row.transaction_status,
          transaction_type: row.transaction_type,
          listing_number: row.listing_number,
          source_listing_id: row.source_listing_id,
          address: row.address,
          suburb: row.suburb,
          city: row.city,
          sales_price: row.sales_price,
          list_price: row.list_price,
          gci_excl_vat: row.gci_excl_vat,
          net_comm: row.net_comm,
          total_gci: row.total_gci,
          sale_type: row.sale_type,
          buyer: row.buyer,
          seller: row.seller,
          list_date: row.list_date,
          transaction_date: row.transaction_date,
          status_change_date: row.status_change_date,
          expected_date: row.expected_date,
          created_at: row.created_at,
          market_center_name: row.market_center_name,
          source_market_center_id: row.source_market_center_id,
          updated_at: row.updated_at,
          agents: [],
        });
      }

      if (row.agent_id) {
        txMap.get(row.id)!.agents.push({
          associate_id: row.associate_id,
          associate_name: row.associate_name,
          image_url: row.associate_image_url,
          source_associate_id: row.source_associate_id,
          agent_role: row.agent_role,
          split_percentage: row.split_percentage,
          summary: {
            office_name: row.office_name,
            transaction_type: row.transaction_side,
            split_percentage: row.calculated_split_percentage,
            variance_sale_list_pct: row.variance_sale_list_pct,
            transaction_gci_before_fees: row.transaction_gci_before_fees,
            average_commission_pct: row.average_commission_pct,
            production_royalties: row.production_royalties,
            growth_share: row.growth_share,
            total_pr_and_gs: row.total_pr_and_gs,
            gci_after_fees_excl_vat: row.gci_after_fees_excl_vat,
            associate_dollar: row.associate_dollar,
            cap_amount: row.cap_amount,
            cap_remaining: row.cap_remaining,
            team_dollar: row.team_dollar,
            market_center_dollar: row.market_center_dollar,
            is_outside_agent: row.is_outside_agent,
          },
        });
      }
    }

    return res.json({
      total: parseInt(totalResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
      items: Array.from(txMap.values()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const sourceTransactionId = toText(req.body?.source_transaction_id) ?? buildManualTransactionId();
  const transactionNumber = await getNextTransactionNumber(pool);
  const transactionStatus = toText(req.body?.transaction_status);
  const transactionType = toText(req.body?.transaction_type);
  const sourceListingId = toText(req.body?.source_listing_id);
  const listingNumber = toText(req.body?.listing_number);
  const address = toText(req.body?.address);
  const suburb = toText(req.body?.suburb);
  const city = toText(req.body?.city);
  const salesPrice = toNumber(req.body?.sales_price);
  const listPrice = toNumber(req.body?.list_price);
  const gci = toNumber(req.body?.gci_excl_vat);
  const netComm = toNumber(req.body?.net_comm);
  const totalGci = toNumber(req.body?.total_gci);
  const saleType = toText(req.body?.sale_type);
  const buyer = toText(req.body?.buyer);
  const seller = toText(req.body?.seller);
  const listDate = toDateValue(req.body?.list_date);
  const txDate = new Date().toISOString();
  const statusChangeDate = txDate;
  const expectedDate = toDateValue(req.body?.expected_date);
  const agents = Array.isArray(req.body?.agents) ? req.body.agents : [];

  const splitError = validateAgentSplits(agents);
  if (splitError) {
    return res.status(400).json({ error: splitError });
  }

  if (!transactionStatus || !ALLOWED_STATUSES.includes(transactionStatus as (typeof ALLOWED_STATUSES)[number])) {
    return res.status(400).json({ error: `transaction_status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    // Get primary market center ID from first agent (if available)
    let marketCenterId: number | null = null;
    if (agents.length > 0 && agents[0].source_associate_id) {
      const assocLookup = await pool.query<{ source_market_center_id: string | null }>(
        `SELECT source_market_center_id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
        [agents[0].source_associate_id]
      );
      if (assocLookup.rows[0]?.source_market_center_id) {
        const mcLookup = await pool.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [assocLookup.rows[0].source_market_center_id]
        );
        marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
      }
    }

    const insert = await pool.query<{ id: string }>(
      `
      INSERT INTO migration.core_transactions (
        source_transaction_id,
        primary_market_center_id,
        transaction_number,
        transaction_status,
        transaction_type,
        source_listing_id,
        listing_number,
        address,
        suburb,
        city,
        sales_price,
        list_price,
        gci_excl_vat,
        net_comm,
        total_gci,
        sale_type,
        buyer,
        seller,
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19::timestamptz,$20::timestamptz,$21::timestamptz,$22::timestamptz,
        NOW()
      )
      RETURNING id::text
      `,
      [
        sourceTransactionId,
        marketCenterId,
        transactionNumber,
        transactionStatus,
        transactionType,
        sourceListingId,
        listingNumber,
        address,
        suburb,
        city,
        salesPrice,
        listPrice,
        gci,
        netComm,
        totalGci,
        saleType,
        buyer,
        seller,
        listDate,
        txDate,
        statusChangeDate,
        expectedDate,
      ]
    );

    const transactionId = Number(insert.rows[0].id);

    // Insert agents if provided
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const sourceAssociateId = toText(agent?.source_associate_id);
      const agentRole = toText(agent?.agent_role);
      const splitPct = toNumber(agent?.split_percentage) ?? (agents.length === 1 ? 100 : null);

      if (sourceAssociateId) {
        const assocLookup = await pool.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
          [sourceAssociateId]
        );
        const associateId = assocLookup.rows[0]?.id ? Number(assocLookup.rows[0].id) : null;

        const agentInsert = await pool.query<{ id: string }>(
          `INSERT INTO migration.transaction_agents (transaction_id, associate_id, source_associate_id, agent_role, split_percentage, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id::text`,
          [transactionId, associateId, sourceAssociateId, agentRole, splitPct, i]
        );

        // Save outside agency contact if provided
        if (agentRole === 'Outside Agency Referral' && agent.outside_agency) {
          const oa = agent.outside_agency;
          await pool.query(
            `INSERT INTO migration.outside_agency_contacts (transaction_agent_id, transaction_id, first_name, last_name, email, phone, agency_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              Number(agentInsert.rows[0].id),
              transactionId,
              toText(oa.first_name),
              toText(oa.last_name),
              toText(oa.email),
              toText(oa.phone),
              toText(oa.agency_name),
            ]
          );
        }
      }
    }

    await recomputeAllTransactionAgentCalculations(pool);

    return res.status(201).json({ id: insert.rows[0].id, source_transaction_id: sourceTransactionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.put('/:id', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  const transactionNumber = toText(req.body?.transaction_number);
  const transactionStatus = toText(req.body?.transaction_status);
  const transactionType = toText(req.body?.transaction_type);
  const sourceListingId = toText(req.body?.source_listing_id);
  const listingNumber = toText(req.body?.listing_number);
  const address = toText(req.body?.address);
  const suburb = toText(req.body?.suburb);
  const city = toText(req.body?.city);
  const salesPrice = toNumber(req.body?.sales_price);
  const listPrice = toNumber(req.body?.list_price);
  const gci = toNumber(req.body?.gci_excl_vat);
  const netComm = toNumber(req.body?.net_comm);
  const totalGci = toNumber(req.body?.total_gci);
  const saleType = toText(req.body?.sale_type);
  const buyer = toText(req.body?.buyer);
  const seller = toText(req.body?.seller);
  const listDate = toDateValue(req.body?.list_date);
  const expectedDate = toDateValue(req.body?.expected_date);
  const agents = Array.isArray(req.body?.agents) ? req.body.agents : [];

  const splitError = validateAgentSplits(agents);
  if (splitError) {
    return res.status(400).json({ error: splitError });
  }

  if (!transactionStatus || !ALLOWED_STATUSES.includes(transactionStatus as (typeof ALLOWED_STATUSES)[number])) {
    return res.status(400).json({ error: `transaction_status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    // First, update the transaction itself (without agent fields)
    const statusChangeUpdateSql = transactionStatus
      ? `CASE WHEN transaction_status IS DISTINCT FROM $18 THEN NOW() ELSE status_change_date END`
      : `status_change_date`;

    const update = await pool.query<{ id: string }>(
      `
      UPDATE migration.core_transactions
      SET
        transaction_number = $1,
        transaction_status = $2,
        transaction_type = $3,
        source_listing_id = $4,
        listing_number = $5,
        address = $6,
        suburb = $7,
        city = $8,
        sales_price = $9,
        list_price = $10,
        gci_excl_vat = $11,
        net_comm = $12,
        total_gci = $13,
        sale_type = $14,
        buyer = $15,
        seller = $16,
        list_date = $17::timestamptz,
        status_change_date = ${statusChangeUpdateSql},
        expected_date = $19::timestamptz,
        updated_at = NOW()
      WHERE id = $20
      RETURNING id::text
      `,
      [
        transactionNumber,
        transactionStatus,
        transactionType,
        sourceListingId,
        listingNumber,
        address,
        suburb,
        city,
        salesPrice,
        listPrice,
        gci,
        netComm,
        totalGci,
        saleType,
        buyer,
        seller,
        listDate,
        transactionStatus,
        expectedDate,
        id,
      ]
    );

    if (update.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    // Delete existing agents and insert new ones
    if (agents.length >= 0) {
      await pool.query(`DELETE FROM migration.transaction_agents WHERE transaction_id = $1`, [id]);

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const sourceAssociateId = toText(agent?.source_associate_id);
        const agentRole = toText(agent?.agent_role);
        const splitPct = toNumber(agent?.split_percentage) ?? (agents.length === 1 ? 100 : null);

        if (sourceAssociateId) {
          const assocLookup = await pool.query<{ id: string }>(
            `SELECT id::text AS id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
            [sourceAssociateId]
          );
          const associateId = assocLookup.rows[0]?.id ? Number(assocLookup.rows[0].id) : null;

          const agentInsert = await pool.query<{ id: string }>(
            `INSERT INTO migration.transaction_agents (transaction_id, associate_id, source_associate_id, agent_role, split_percentage, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id::text`,
            [id, associateId, sourceAssociateId, agentRole, splitPct, i]
          );

          if (agentRole === 'Outside Agency Referral' && agent.outside_agency) {
            const oa = agent.outside_agency;
            await pool.query(
              `INSERT INTO migration.outside_agency_contacts (transaction_agent_id, transaction_id, first_name, last_name, email, phone, agency_name)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                Number(agentInsert.rows[0].id),
                id,
                toText(oa.first_name),
                toText(oa.last_name),
                toText(oa.email),
                toText(oa.phone),
                toText(oa.agency_name),
              ]
            );
          }
        }
      }
    }

    await recomputeAllTransactionAgentCalculations(pool);

    return res.json({ id: update.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/:id/calculated-summary', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        tac.id::text,
        tac.transaction_id::text,
        tac.transaction_agent_id::text,
        tac.associate_id::text,
        tac.source_associate_id,
        tac.is_outside_agent,
        tac.agent_name,
        tac.office_name,
        tac.transaction_side,
        tac.split_percentage::text,
        tac.variance_sale_list_pct::text,
        COALESCE(ct.sales_price, 0)::text AS sales_value_component,
        tac.transaction_gci_before_fees::text,
        tac.average_commission_pct::text,
        tac.production_royalties::text,
        tac.growth_share::text,
        tac.total_pr_and_gs::text,
        tac.gci_after_fees_excl_vat::text,
        tac.associate_split_pct::text,
        tac.market_center_split_pct::text,
        tac.associate_dollar::text,
        tac.cap_amount::text,
        tac.cap_contribution::text,
        tac.cap_remaining::text,
        tac.team_dollar::text,
        tac.market_center_dollar::text,
        tac.cap_cycle_start_date::text,
        tac.cap_cycle_end_date::text,
        tac.effective_reporting_date::text,
        tac.is_registered
      FROM migration.transaction_agent_calculations tac
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      WHERE tac.transaction_id = $1
      ORDER BY tac.id ASC
      `,
      [id]
    );

    return res.json({ items: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
