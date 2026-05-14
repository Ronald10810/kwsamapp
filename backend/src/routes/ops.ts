import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';
import { salesOnlyTransactionExclusionSql, transactionAgentCalculationDedupCte } from './reportingSql.js';
import { getTodayInAppTimeZone } from '../utils/timeZone.js';

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

type TeamPerformanceRow = {
  team_name: string;
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
    // Step 1: Check which optional tables exist (safe – no table references, only catalog lookups).
    // PostgreSQL validates table names referenced inside CASE ELSE subqueries at parse time, not
    // execution time, so we must avoid referencing non-existent tables in the SQL text at all.
    const teResult = await pool.query(`
      SELECT
        to_regclass('staging.market_centers_raw')       IS NOT NULL AS has_staging_mc,
        to_regclass('staging.teams_raw')                IS NOT NULL AS has_staging_teams,
        to_regclass('staging.associates_raw')           IS NOT NULL AS has_staging_assoc,
        to_regclass('staging.listings_raw')             IS NOT NULL AS has_staging_listings,
        to_regclass('migration.market_centers_prepared') IS NOT NULL AS has_prep_mc,
        to_regclass('migration.teams_prepared')          IS NOT NULL AS has_prep_teams,
        to_regclass('migration.associates_prepared')     IS NOT NULL AS has_prep_assoc,
        to_regclass('migration.listings_prepared')       IS NOT NULL AS has_prep_listings,
        to_regclass('migration.load_rejections')         IS NOT NULL AS has_load_rejections,
        to_regclass('app.rentals')                       IS NOT NULL AS has_rentals,
        to_regclass('app.rental_payment_schedule')       IS NOT NULL AS has_rental_schedule
    `);
    const te = teResult.rows[0];

    // Step 2: Build query that only references tables confirmed to exist.
    const result = await pool.query(`
      SELECT
        ${te.has_staging_mc       ? '(SELECT COUNT(*) FROM staging.market_centers_raw)'        : '0'} AS staging_market_centers,
        ${te.has_staging_teams    ? '(SELECT COUNT(*) FROM staging.teams_raw)'                 : '0'} AS staging_teams,
        ${te.has_staging_assoc    ? '(SELECT COUNT(*) FROM staging.associates_raw)'            : '0'} AS staging_associates,
        ${te.has_staging_listings ? '(SELECT COUNT(*) FROM staging.listings_raw)'              : '0'} AS staging_listings,

        ${te.has_prep_mc          ? '(SELECT COUNT(*) FROM migration.market_centers_prepared)' : '0'} AS prepared_market_centers,
        ${te.has_prep_teams       ? '(SELECT COUNT(*) FROM migration.teams_prepared)'          : '0'} AS prepared_teams,
        ${te.has_prep_assoc       ? '(SELECT COUNT(*) FROM migration.associates_prepared)'     : '0'} AS prepared_associates,
        ${te.has_prep_listings    ? '(SELECT COUNT(*) FROM migration.listings_prepared)'       : '0'} AS prepared_listings,

        (SELECT COUNT(*) FROM migration.core_market_centers) AS core_market_centers,
        (SELECT COUNT(*) FROM migration.core_teams)          AS core_teams,
        (SELECT COUNT(*) FROM migration.core_associates)     AS core_associates,
        (SELECT COUNT(*) FROM migration.core_listings)       AS core_listings,
        (SELECT COUNT(*) FROM migration.core_associates WHERE LOWER(TRIM(COALESCE(status_name, ''))) = 'active') AS active_associates,
        (SELECT COUNT(*) FROM migration.core_listings
          WHERE (
              LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%active%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%sale%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%rent%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%let%'
            )
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%withdraw%'
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%expired%'
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%sold%'
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%declined%'
            AND (
              LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%sale%'
              AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%sold%'
            )
        ) AS active_for_sale_listings,
        (SELECT COUNT(*) FROM migration.core_listings
          WHERE (
              LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%active%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%sale%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%rent%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%let%'
            )
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%withdraw%'
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%expired%'
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%sold%'
            AND LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(listing_status_tag, ''))) NOT LIKE '%declined%'
            AND (
              LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%rent%'
              OR LOWER(CONCAT_WS(' ', COALESCE(status_name, ''), COALESCE(sale_or_rent, ''), COALESCE(listing_status_tag, ''))) LIKE '%let%'
            )
        ) AS active_rental_listings,

    ${te.has_load_rejections  ? '(SELECT COUNT(*) FROM migration.load_rejections)'         : '0'} AS load_rejections,

    ${te.has_rentals ? "(SELECT COUNT(*) FROM app.rentals WHERE rental_status = 'ACTIVE')" : '0'} AS rentals_active,
    ${te.has_rentals ? "(SELECT COUNT(*) FROM app.rentals WHERE rental_status = 'CANCELLED')" : '0'} AS rentals_cancelled,
    ${te.has_rental_schedule ? "(SELECT COUNT(*) FROM app.rental_payment_schedule WHERE payment_status NOT IN ('PAID','CANCELLED') AND due_date = CURRENT_DATE)" : '0'} AS rentals_due_today,
    ${te.has_rental_schedule ? "(SELECT COUNT(*) FROM app.rental_payment_schedule WHERE payment_status NOT IN ('PAID','CANCELLED') AND due_date < CURRENT_DATE)" : '0'} AS rentals_overdue,
    ${te.has_rental_schedule ? "(SELECT COUNT(*) FROM app.rental_payment_schedule WHERE payment_status = 'PAID' AND paid_date::date >= date_trunc('month', CURRENT_DATE)::date)" : '0'} AS rentals_paid_this_month,
    ${te.has_rental_schedule ? "(SELECT COALESCE(SUM(gross_commission), 0) FROM app.rental_payment_schedule WHERE payment_status = 'PAID' AND paid_date::date >= date_trunc('month', CURRENT_DATE)::date)" : '0'} AS rentals_gci_this_month,
    ${te.has_rental_schedule ? "(SELECT COALESCE(SUM(company_dollar), 0) FROM app.rental_payment_schedule WHERE payment_status = 'PAID' AND paid_date::date >= date_trunc('month', CURRENT_DATE)::date)" : '0'} AS rentals_co_dollar_this_month
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
    let teamPerformance: { rows: TeamPerformanceRow[] } = { rows: [] };
    const todayInAppTimeZone = getTodayInAppTimeZone();
    let reportingWindow: ReportingWindowRow = {
      start_date: todayInAppTimeZone,
      end_date: todayInAppTimeZone,
      basis: 'registered',
    };

    if (transactionCalculationsExists.rows[0]?.exists) {
      try {
        const reportingWindowResult = await pool.query<ReportingWindowRow>(
          `
          WITH ${transactionAgentCalculationDedupCte},
          limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT
              COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) AS report_date,
              tac.is_registered
            FROM tac_dedup tac
            LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
            WHERE COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) IS NOT NULL
              AND ${salesOnlyTransactionExclusionSql}
          ),
          reporting_window AS (
            SELECT
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE is_registered = true
                    AND report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'registered'
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'allStatuses'
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN 'registered'
                ELSE 'allStatuses'
              END AS basis,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN (SELECT month_start FROM limits)
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN (
                  SELECT date_trunc('month', MAX(report_date))::date
                  FROM eligible
                  WHERE is_registered = true
                )
                ELSE COALESCE((SELECT date_trunc('month', MAX(report_date))::date FROM eligible), (SELECT month_start FROM limits))
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
          WITH ${transactionAgentCalculationDedupCte},
          limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT
              COALESCE(
                NULLIF(TRIM(mc_office.name), ''),
                NULLIF(TRIM(mc_assoc.name), ''),
                NULLIF(TRIM(mc_tx_primary.name), ''),
                NULLIF(TRIM(mc_tx.name), ''),
                NULLIF(TRIM(tac.office_name), ''),
                'Unassigned / Unknown'
              ) AS market_center,
              tac.transaction_id,
              COALESCE(tac.gci_after_fees_excl_vat, 0) AS transaction_gci,
              ct.sales_price,
              COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) AS report_date,
              tac.is_registered
            FROM tac_dedup tac
            LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
            LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
            LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
            LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
            LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
            LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
            WHERE COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) IS NOT NULL
              AND ${salesOnlyTransactionExclusionSql}
          ),
          reporting_window AS (
            SELECT
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE is_registered = true
                    AND report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'registered'
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'allStatuses'
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN 'registered'
                ELSE 'allStatuses'
              END AS basis,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN (SELECT month_start FROM limits)
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN (
                  SELECT date_trunc('month', MAX(report_date))::date
                  FROM eligible
                  WHERE is_registered = true
                )
                ELSE COALESCE((SELECT date_trunc('month', MAX(report_date))::date FROM eligible), (SELECT month_start FROM limits))
              END AS start_date
          ),
          mtd AS (
            SELECT er.market_center, er.transaction_id, er.transaction_gci, er.sales_price
            FROM eligible er
            CROSS JOIN reporting_window rw
            WHERE er.report_date >= rw.start_date
              AND er.report_date < (rw.start_date + INTERVAL '1 month')
              AND (rw.basis = 'allStatuses' OR er.is_registered = true)
          ),
          per_transaction AS (
            SELECT
              market_center,
              transaction_id,
              MAX(sales_price) AS sales_price,
              COALESCE(SUM(transaction_gci), 0) AS total_gci
            FROM mtd
            GROUP BY market_center, transaction_id
          ),
          sales_by_market_center AS (
            SELECT
              market_center,
              COUNT(*)::text AS total_transactions,
              COALESCE(SUM(total_gci), 0)::text AS total_gci,
              COALESCE(SUM(sales_price), 0)::text AS total_sales_price
            FROM per_transaction
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
          WITH ${transactionAgentCalculationDedupCte},
          limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT
              COALESCE(
                NULLIF(TRIM(tac.agent_name), ''),
                NULLIF(TRIM(ca.full_name), ''),
                NULLIF(TRIM(CONCAT_WS(' ', ca.first_name, ca.last_name)), ''),
                NULLIF(TRIM(ca.source_associate_id), ''),
                'Unknown Associate'
              ) AS associate_name,
              COALESCE(
                NULLIF(TRIM(mc_office.name), ''),
                NULLIF(TRIM(mc_assoc.name), ''),
                NULLIF(TRIM(mc_tx_primary.name), ''),
                NULLIF(TRIM(mc_tx.name), ''),
                NULLIF(TRIM(tac.office_name), ''),
                'Unassigned / Unknown'
              ) AS market_center,
              tac.transaction_id,
              COALESCE(tac.gci_after_fees_excl_vat, 0) AS transaction_gci,
              COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) AS report_date,
              tac.is_registered
            FROM tac_dedup tac
            LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
            LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
            LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
            LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
            LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
            LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
            WHERE tac.is_outside_agent = false
              AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) IS NOT NULL
              AND ${salesOnlyTransactionExclusionSql}
          ),
          reporting_window AS (
            SELECT
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE is_registered = true
                    AND report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'registered'
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'allStatuses'
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN 'registered'
                ELSE 'allStatuses'
              END AS basis,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN (SELECT month_start FROM limits)
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN (
                  SELECT date_trunc('month', MAX(report_date))::date
                  FROM eligible
                  WHERE is_registered = true
                )
                ELSE COALESCE((SELECT date_trunc('month', MAX(report_date))::date FROM eligible), (SELECT month_start FROM limits))
              END AS start_date
          )
          SELECT
            er.associate_name,
            er.market_center,
            COUNT(DISTINCT er.transaction_id)::text AS total_transactions,
            COALESCE(SUM(er.transaction_gci), 0)::text AS total_gci
          FROM eligible er
          CROSS JOIN reporting_window rw
          WHERE er.report_date >= rw.start_date
            AND er.report_date < (rw.start_date + INTERVAL '1 month')
            AND (rw.basis = 'allStatuses' OR er.is_registered = true)
          GROUP BY
            er.associate_name,
            er.market_center
          ORDER BY COALESCE(SUM(er.transaction_gci), 0) DESC, COUNT(*) DESC
          LIMIT 15
          `
        );

        teamPerformance = await pool.query<TeamPerformanceRow>(
          `
          WITH ${transactionAgentCalculationDedupCte},
          limits AS (
            SELECT
              date_trunc('month', CURRENT_DATE)::date AS month_start,
              (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
          ),
          eligible AS (
            SELECT
              COALESCE(
                NULLIF(TRIM(t.name), ''),
                NULLIF(TRIM(ca.source_team_id), ''),
                'Unassigned / Unknown Team'
              ) AS team_name,
              COALESCE(
                NULLIF(TRIM(mc_office.name), ''),
                NULLIF(TRIM(mc_assoc.name), ''),
                NULLIF(TRIM(mc_tx_primary.name), ''),
                NULLIF(TRIM(mc_tx.name), ''),
                NULLIF(TRIM(tac.office_name), ''),
                'Unassigned / Unknown'
              ) AS market_center,
              tac.transaction_id,
              COALESCE(tac.gci_after_fees_excl_vat, 0) AS transaction_gci,
              COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) AS report_date,
              tac.is_registered
            FROM tac_dedup tac
            LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
            LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
            LEFT JOIN migration.core_teams t ON t.id = ca.team_id
            LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
            LEFT JOIN migration.core_market_centers mc_assoc ON mc_assoc.source_market_center_id = ca.source_market_center_id
            LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
            LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
            WHERE tac.is_outside_agent = false
              AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) IS NOT NULL
              AND ${salesOnlyTransactionExclusionSql}
          ),
          reporting_window AS (
            SELECT
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE is_registered = true
                    AND report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'registered'
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN 'allStatuses'
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN 'registered'
                ELSE 'allStatuses'
              END AS basis,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM eligible, limits
                  WHERE report_date >= limits.month_start
                    AND report_date < limits.month_end
                ) THEN (SELECT month_start FROM limits)
                WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN (
                  SELECT date_trunc('month', MAX(report_date))::date
                  FROM eligible
                  WHERE is_registered = true
                )
                ELSE COALESCE((SELECT date_trunc('month', MAX(report_date))::date FROM eligible), (SELECT month_start FROM limits))
              END AS start_date
          )
          SELECT
            er.team_name,
            er.market_center,
            COUNT(DISTINCT er.transaction_id)::text AS total_transactions,
            COALESCE(SUM(er.transaction_gci), 0)::text AS total_gci
          FROM eligible er
          CROSS JOIN reporting_window rw
          WHERE er.report_date >= rw.start_date
            AND er.report_date < (rw.start_date + INTERVAL '1 month')
            AND (rw.basis = 'allStatuses' OR er.is_registered = true)
          GROUP BY
            er.team_name,
            er.market_center
          ORDER BY COALESCE(SUM(er.transaction_gci), 0) DESC, COUNT(*) DESC
          LIMIT 15
          `
        );
      } catch {
        marketCenterPerformance = { rows: [] };
        associatePerformance = { rows: [] };
        teamPerformance = { rows: [] };
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
        forSaleListings: Number(row.active_for_sale_listings),
        rentalListings: Number(row.active_rental_listings)
      },
      legacy: legacyCounts,
      rejections: Number(row.load_rejections),
      rentals: {
        active: Number(row.rentals_active),
        cancelled: Number(row.rentals_cancelled),
        dueToday: Number(row.rentals_due_today),
        overdue: Number(row.rentals_overdue),
        paidThisMonth: Number(row.rentals_paid_this_month),
        gciThisMonth: Number(row.rentals_gci_this_month),
        coDollarThisMonth: Number(row.rentals_co_dollar_this_month),
      },
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
      })),
      teamPerformance: teamPerformance.rows.map((item) => ({
        teamName: item.team_name,
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
