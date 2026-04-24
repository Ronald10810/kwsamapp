import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';

const router = Router();
const pool = getOptionalPgPool();

type MarketCenterPerformanceRow = {
  market_center: string;
  total_transactions: string;
  total_gci: string;
  total_sales_price: string;
};

type AssociatePerformanceRow = {
  associate_name: string;
  market_center: string;
  total_transactions: string;
  total_gci: string;
};

type ReportingWindowRow = {
  start_date: string;
  end_date: string;
  basis: 'registered' | 'allStatuses';
};

router.get('/summary', async (_req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'DATABASE_URL is not configured for ops summary.'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        CASE WHEN to_regclass('staging.market_centers_raw') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM staging.market_centers_raw) END AS staging_market_centers,
        CASE WHEN to_regclass('staging.teams_raw') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM staging.teams_raw) END AS staging_teams,
        CASE WHEN to_regclass('staging.associates_raw') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM staging.associates_raw) END AS staging_associates,
        CASE WHEN to_regclass('staging.listings_raw') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM staging.listings_raw) END AS staging_listings,

        CASE WHEN to_regclass('migration.market_centers_prepared') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.market_centers_prepared) END AS prepared_market_centers,
        CASE WHEN to_regclass('migration.teams_prepared') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.teams_prepared) END AS prepared_teams,
        CASE WHEN to_regclass('migration.associates_prepared') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.associates_prepared) END AS prepared_associates,
        CASE WHEN to_regclass('migration.listings_prepared') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.listings_prepared) END AS prepared_listings,

        CASE WHEN to_regclass('migration.core_market_centers') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.core_market_centers) END AS core_market_centers,
        CASE WHEN to_regclass('migration.core_teams') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.core_teams) END AS core_teams,
        CASE WHEN to_regclass('migration.core_associates') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.core_associates) END AS core_associates,
        CASE WHEN to_regclass('migration.core_listings') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.core_listings) END AS core_listings,
        CASE WHEN to_regclass('migration.core_associates') IS NULL THEN 0 ELSE (
          SELECT COUNT(*)
          FROM migration.core_associates
          WHERE LOWER(TRIM(COALESCE(status_name, ''))) = 'active'
        ) END AS active_associates,
        CASE WHEN to_regclass('migration.core_listings') IS NULL THEN 0 ELSE (
          SELECT COUNT(*)
          FROM migration.core_listings
          WHERE LOWER(TRIM(COALESCE(status_name, ''))) = 'active'
        ) END AS active_listings,

        CASE WHEN to_regclass('migration.load_rejections') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.load_rejections) END AS load_rejections
    `);

    const row = result.rows[0];

    let legacyCounts = {
      marketCenters: 0,
      associates: 0,
      listings: 0,
    };

    try {
      const legacyResult = await pool.query(`
        SELECT
          CASE WHEN to_regclass('public."MarketCentre"') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM "MarketCentre") END AS legacy_market_centers,
          CASE WHEN to_regclass('public."Associate"') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM "Associate") END AS legacy_associates,
          CASE WHEN to_regclass('public."Listing"') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM "Listing") END AS legacy_listings
      `);

      legacyCounts = {
        marketCenters: Number(legacyResult.rows[0]?.legacy_market_centers ?? 0),
        associates: Number(legacyResult.rows[0]?.legacy_associates ?? 0),
        listings: Number(legacyResult.rows[0]?.legacy_listings ?? 0),
      };
    } catch {
      legacyCounts = {
        marketCenters: 0,
        associates: 0,
        listings: 0,
      };
    }

    const transactionCalculationsExists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.transaction_agent_calculations') AS exists`
    );

    let marketCenterPerformance: { rows: MarketCenterPerformanceRow[] } = { rows: [] };
    let associatePerformance: { rows: AssociatePerformanceRow[] } = { rows: [] };
    let reportingWindow: ReportingWindowRow = {
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      basis: 'registered',
    };

    if (transactionCalculationsExists.rows[0]?.exists) {
      try {
        const reportingWindowResult = await pool.query<ReportingWindowRow>(
          `
          WITH limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT tac.effective_reporting_date::date AS effective_reporting_date
                 , tac.is_registered
            FROM migration.transaction_agent_calculations tac
            LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
            LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
            WHERE (ca.id IS NULL OR LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1'))
              AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
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
            basis
          FROM reporting_window
          `
        );

        reportingWindow = reportingWindowResult.rows[0] ?? reportingWindow;

        marketCenterPerformance = await pool.query<MarketCenterPerformanceRow>(
          `
          WITH limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT
              COALESCE(tac.office_name, mc.name, 'Unassigned / Unknown') AS market_center,
              tac.transaction_id,
              tac.transaction_gci_before_fees,
              tac.sales_value_component,
              tac.effective_reporting_date::date AS effective_reporting_date,
              tac.is_registered
            FROM migration.transaction_agent_calculations tac
            LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
            LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
            WHERE (ca.id IS NULL OR LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1'))
              AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
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
          ),
          mtd AS (
            SELECT er.market_center, er.transaction_id, er.transaction_gci_before_fees, er.sales_value_component
            FROM eligible er
            CROSS JOIN reporting_window rw
            WHERE er.effective_reporting_date >= rw.start_date
              AND er.effective_reporting_date < (rw.start_date + INTERVAL '1 month')
              AND (rw.basis = 'allStatuses' OR er.is_registered = true)
          ),
          sales_by_market_center AS (
            SELECT
              market_center,
              COUNT(DISTINCT transaction_id)::text AS total_transactions,
              COALESCE(SUM(transaction_gci_before_fees), 0)::text AS total_gci,
              COALESCE(SUM(sales_value_component), 0)::text AS total_sales_price
            FROM mtd
            GROUP BY market_center
          )
          SELECT
            smbmc.market_center,
            smbmc.total_transactions,
            smbmc.total_gci,
            COALESCE(smbmc.total_sales_price, '0') AS total_sales_price
          FROM sales_by_market_center smbmc
          ORDER BY smbmc.total_gci::numeric DESC, smbmc.total_transactions::int DESC
          LIMIT 13
          `
        );

        associatePerformance = await pool.query<AssociatePerformanceRow>(
          `
          WITH limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT
              COALESCE(tac.agent_name, ca.full_name, ca.first_name || ' ' || ca.last_name, ca.source_associate_id, 'Unknown Associate') AS associate_name,
              COALESCE(tac.office_name, mc.name, 'Unassigned / Unknown') AS market_center,
              tac.transaction_id,
              tac.transaction_gci_before_fees,
              tac.effective_reporting_date::date AS effective_reporting_date,
              tac.is_registered
            FROM migration.transaction_agent_calculations tac
            LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
            LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
            WHERE tac.is_outside_agent = false
              AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
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
            er.associate_name,
            er.market_center,
            COUNT(DISTINCT er.transaction_id)::text AS total_transactions,
            COALESCE(SUM(er.transaction_gci_before_fees), 0)::text AS total_gci
          FROM eligible er
          CROSS JOIN reporting_window rw
          WHERE er.effective_reporting_date >= rw.start_date
            AND er.effective_reporting_date < (rw.start_date + INTERVAL '1 month')
            AND (rw.basis = 'allStatuses' OR er.is_registered = true)
          GROUP BY
            er.associate_name,
            er.market_center
          ORDER BY COALESCE(SUM(er.transaction_gci_before_fees), 0) DESC, COUNT(*) DESC
          LIMIT 15
          `
        );
      } catch {
        marketCenterPerformance = { rows: [] };
        associatePerformance = { rows: [] };
      }
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      staging: {
        marketCenters: Number(row.staging_market_centers),
        teams: Number(row.staging_teams),
        associates: Number(row.staging_associates),
        listings: Number(row.staging_listings)
      },
      prepared: {
        marketCenters: Number(row.prepared_market_centers),
        teams: Number(row.prepared_teams),
        associates: Number(row.prepared_associates),
        listings: Number(row.prepared_listings)
      },
      core: {
        marketCenters: Number(row.core_market_centers),
        teams: Number(row.core_teams),
        associates: Number(row.core_associates),
        listings: Number(row.core_listings)
      },
      active: {
        associates: Number(row.active_associates),
        listings: Number(row.active_listings)
      },
      legacy: legacyCounts,
      rejections: Number(row.load_rejections),
      reportingWindow,
      performanceBasis: reportingWindow.basis,
      marketCenterPerformance: marketCenterPerformance.rows.map((item) => ({
        marketCenter: item.market_center,
        totalTransactions: Number(item.total_transactions),
        totalGci: Number(item.total_gci),
        totalSalesPrice: Number(item.total_sales_price),
      })),
      associatePerformance: associatePerformance.rows.map((item) => ({
        associateName: item.associate_name,
        marketCenter: item.market_center,
        totalTransactions: Number(item.total_transactions),
        totalGci: Number(item.total_gci),
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
