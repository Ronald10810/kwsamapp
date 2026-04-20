import { Router } from 'express';
import { Pool } from 'pg';
const router = Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
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

        CASE WHEN to_regclass('migration.load_rejections') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM migration.load_rejections) END AS load_rejections,

        CASE WHEN to_regclass('public."MarketCentre"') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM "MarketCentre") END AS legacy_market_centers,
        CASE WHEN to_regclass('public."Associate"') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM "Associate") END AS legacy_associates,
        CASE WHEN to_regclass('public."Listing"') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM "Listing") END AS legacy_listings
    `);
        const row = result.rows[0];
        const transactionsExists = await pool.query(`SELECT to_regclass('migration.core_transactions') AS exists`);
        const marketCenterPerformance = transactionsExists.rows[0]?.exists
            ? await pool.query(`
          SELECT
            COALESCE(mc.name, 'Unassigned / Unknown') AS market_center,
            COUNT(*)::text AS total_transactions,
            COALESCE(SUM(ct.total_gci), 0)::text AS total_gci,
            COALESCE(SUM(ct.sales_price), 0)::text AS total_sales_price
          FROM migration.core_transactions ct
          INNER JOIN migration.core_market_centers mc ON mc.id = ct.market_center_id
          INNER JOIN migration.core_associates ca ON ca.id = ct.associate_id
          WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
            AND ct.status_change_date::date >= date_trunc('month', CURRENT_DATE)::date
            AND ct.status_change_date::date <= CURRENT_DATE
            AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
            AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
          GROUP BY COALESCE(mc.name, 'Unassigned / Unknown')
          ORDER BY COALESCE(SUM(ct.total_gci), 0) DESC, COUNT(*) DESC
          LIMIT 13
          `)
            : { rows: [] };
        const associatePerformance = transactionsExists.rows[0]?.exists
            ? await pool.query(`
          SELECT
            COALESCE(ca.full_name, ca.first_name || ' ' || ca.last_name, ca.source_associate_id, 'Unknown Associate') AS associate_name,
            COALESCE(mc.name, 'Unassigned / Unknown') AS market_center,
            COUNT(*)::text AS total_transactions,
            COALESCE(SUM(ct.total_gci), 0)::text AS total_gci
          FROM migration.core_transactions ct
          INNER JOIN migration.core_market_centers mc ON mc.id = ct.market_center_id
          INNER JOIN migration.core_associates ca ON ca.id = ct.associate_id
          WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
            AND ct.status_change_date::date >= date_trunc('month', CURRENT_DATE)::date
            AND ct.status_change_date::date <= CURRENT_DATE
            AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
            AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
          GROUP BY
            COALESCE(ca.full_name, ca.first_name || ' ' || ca.last_name, ca.source_associate_id, 'Unknown Associate'),
            COALESCE(mc.name, 'Unassigned / Unknown')
          ORDER BY COALESCE(SUM(ct.total_gci), 0) DESC, COUNT(*) DESC
          LIMIT 15
          `)
            : { rows: [] };
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
            legacy: {
                marketCenters: Number(row.legacy_market_centers),
                associates: Number(row.legacy_associates),
                listings: Number(row.legacy_listings)
            },
            rejections: Number(row.load_rejections),
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
export default router;
//# sourceMappingURL=ops.js.map