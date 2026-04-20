import { Router } from 'express';
import { Pool } from 'pg';

const router = Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

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
      });
    }

    const [totalsResult, mtdResult, statusResult, typeResult, marketCenterResult, associateResult, closingsResult] = await Promise.all([
      pool.query<{
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        average_split_percentage: string;
      }>(
        `
        SELECT
          COUNT(*)::text AS total_transactions,
          COALESCE(SUM(sales_price), 0)::text AS total_sales_value,
          COALESCE(SUM(net_comm), 0)::text AS total_net_commission,
          COALESCE(AVG(split_percentage), 0)::text AS average_split_percentage
        FROM migration.core_transactions
        `
      ),
      pool.query<{
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        average_split_percentage: string;
      }>(
        `
        SELECT
          COUNT(*)::text AS total_transactions,
          COALESCE(SUM(ct.sales_price), 0)::text AS total_sales_value,
          COALESCE(SUM(ct.net_comm), 0)::text AS total_net_commission,
          COALESCE(AVG(ct.split_percentage), 0)::text AS average_split_percentage
        FROM migration.core_transactions ct
        INNER JOIN migration.core_market_centers mc ON mc.id = ct.market_center_id
        INNER JOIN migration.core_associates ca ON ca.id = ct.associate_id
        WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
          AND ct.status_change_date::date >= date_trunc('month', CURRENT_DATE)::date
          AND ct.status_change_date::date <= CURRENT_DATE
          AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
          AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        `
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
      pool.query<{ market_center: string; total_transactions: string; total_sales_value: string; total_net_commission: string }>(
        `
        SELECT
          COALESCE(mc.name, 'Unassigned / Unknown') AS market_center,
          COUNT(*)::text AS total_transactions,
          COALESCE(SUM(ct.sales_price), 0)::text AS total_sales_value,
          COALESCE(SUM(ct.net_comm), 0)::text AS total_net_commission
        FROM migration.core_transactions ct
        INNER JOIN migration.core_market_centers mc ON mc.id = ct.market_center_id
        INNER JOIN migration.core_associates ca ON ca.id = ct.associate_id
        WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
          AND ct.status_change_date::date >= date_trunc('month', CURRENT_DATE)::date
          AND ct.status_change_date::date <= CURRENT_DATE
          AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
          AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        GROUP BY COALESCE(mc.name, 'Unassigned / Unknown')
        ORDER BY COALESCE(SUM(ct.sales_price), 0) DESC, COUNT(*) DESC
        LIMIT 8
        `
      ),
      pool.query<{ associate_name: string; market_center: string; total_transactions: string; total_sales_value: string }>(
        `
        SELECT
          COALESCE(ca.full_name, ca.first_name || ' ' || ca.last_name, ca.source_associate_id, 'Unknown Associate') AS associate_name,
          COALESCE(mc.name, 'Unassigned / Unknown') AS market_center,
          COUNT(*)::text AS total_transactions,
          COALESCE(SUM(ct.sales_price), 0)::text AS total_sales_value
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
        ORDER BY COALESCE(SUM(ct.sales_price), 0) DESC, COUNT(*) DESC
        LIMIT 10
        `
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
      })),
      associate_performance: associateResult.rows.map((row) => ({
        associate_name: row.associate_name,
        market_center: row.market_center,
        total_transactions: Number(row.total_transactions),
        total_sales_value: Number(row.total_sales_value),
      })),
      expected_closings_90_days: closingsResult.rows.map((row) => ({
        bucket: row.bucket,
        count: Number(row.count),
        total_gci: Number(row.total_gci),
      })),
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
      params.push(`%${searchInput}%`);
      const p = `$${params.length}`;
      whereClauses.push(
        `(t.transaction_number ILIKE ${p} OR t.address ILIKE ${p} OR t.city ILIKE ${p} OR a.full_name ILIKE ${p} OR mc.name ILIKE ${p} OR t.listing_number ILIKE ${p})`
      );
    }
    if (statusFilter.length > 0) {
      params.push(statusFilter);
      whereClauses.push(`LOWER(TRIM(COALESCE(t.transaction_status, ''))) = LOWER(TRIM($${params.length}))`);
    }
    if (typeFilter.length > 0) {
      params.push(typeFilter);
      whereClauses.push(`LOWER(TRIM(COALESCE(t.transaction_type, ''))) = LOWER(TRIM($${params.length}))`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countParams = [...params];
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const [totalResult, dataResult] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM migration.core_transactions t
         LEFT JOIN migration.core_associates a ON a.id = t.associate_id
         LEFT JOIN migration.core_market_centers mc ON mc.id = t.market_center_id
         ${whereSql}`,
        countParams
      ),
      pool.query(
        `SELECT
           t.id, t.source_transaction_id, t.transaction_number,
           t.source_associate_id,
           t.transaction_status, t.transaction_type,
           t.listing_number, t.source_listing_id,
           t.address, t.suburb, t.city,
           t.sales_price, t.list_price, t.gci_excl_vat,
           t.split_percentage, t.net_comm, t.total_gci,
           t.sale_type, t.agent_type,
           t.buyer, t.seller,
           t.list_date::text, t.transaction_date::text,
           t.status_change_date::text, t.expected_date::text,
           a.full_name AS associate_name, a.image_url AS associate_image_url,
           mc.name AS market_center_name,
           mc.source_market_center_id,
           t.updated_at::text
         FROM migration.core_transactions t
         LEFT JOIN migration.core_associates a ON a.id = t.associate_id
         LEFT JOIN migration.core_market_centers mc ON mc.id = t.market_center_id
         ${whereSql}
         ORDER BY t.status_change_date DESC NULLS LAST, t.transaction_date DESC NULLS LAST, t.id DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      ),
    ]);

    return res.json({
      total: parseInt(totalResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
      items: dataResult.rows,
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
  const sourceAssociateId = toText(req.body?.source_associate_id) ?? '';
  const sourceMarketCenterIdInput = toText(req.body?.source_market_center_id);
  if (!toText(req.body?.transaction_number)) {
    // transaction_number is generated on backend and read-only in UI
  }
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
  const splitPct = toNumber(req.body?.split_percentage);
  const netComm = toNumber(req.body?.net_comm);
  const totalGci = toNumber(req.body?.total_gci);
  const saleType = toText(req.body?.sale_type);
  const agentType = toText(req.body?.agent_type);
  const buyer = toText(req.body?.buyer);
  const seller = toText(req.body?.seller);
  const listDate = toDateValue(req.body?.list_date);
  // transaction_date is immutable and is set on first load/creation only
  const txDate = new Date().toISOString();
  // status_change_date starts at creation time and auto-updates on status transitions
  const statusChangeDate = txDate;
  const expectedDate = toDateValue(req.body?.expected_date);

  if (!transactionStatus || !ALLOWED_STATUSES.includes(transactionStatus as (typeof ALLOWED_STATUSES)[number])) {
    return res.status(400).json({ error: `transaction_status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    const assocLookup = sourceAssociateId
      ? await pool.query<{ id: string; source_market_center_id: string | null }>(
          `SELECT id::text AS id, source_market_center_id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
          [sourceAssociateId]
        )
      : { rows: [] as Array<{ id: string; source_market_center_id: string | null }> };
    const associateId = assocLookup.rows[0]?.id ? Number(assocLookup.rows[0].id) : null;

    const sourceMarketCenterId = assocLookup.rows[0]?.source_market_center_id ?? sourceMarketCenterIdInput;

    const mcLookup = sourceMarketCenterId
      ? await pool.query<{ id: string; source_market_center_id: string | null }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [sourceMarketCenterId]
        )
      : { rows: [] as Array<{ id: string }> };
    const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

    const insert = await pool.query<{ id: string }>(
      `
      INSERT INTO migration.core_transactions (
        source_transaction_id,
        source_associate_id,
        associate_id,
        market_center_id,
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
        split_percentage,
        net_comm,
        total_gci,
        sale_type,
        agent_type,
        buyer,
        seller,
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
        $23::timestamptz,$24::timestamptz,$25::timestamptz,$26::timestamptz,
        NOW()
      )
      RETURNING id::text
      `,
      [
        sourceTransactionId,
        sourceAssociateId,
        associateId,
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
        splitPct,
        netComm,
        totalGci,
        saleType,
        agentType,
        buyer,
        seller,
        listDate,
        txDate,
        statusChangeDate,
        expectedDate,
      ]
    );

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

  const sourceAssociateId = toText(req.body?.source_associate_id) ?? '';
  const sourceMarketCenterIdInput = toText(req.body?.source_market_center_id);
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
  const splitPct = toNumber(req.body?.split_percentage);
  const netComm = toNumber(req.body?.net_comm);
  const totalGci = toNumber(req.body?.total_gci);
  const saleType = toText(req.body?.sale_type);
  const agentType = toText(req.body?.agent_type);
  const buyer = toText(req.body?.buyer);
  const seller = toText(req.body?.seller);
  const listDate = toDateValue(req.body?.list_date);
  const expectedDate = toDateValue(req.body?.expected_date);

  if (!transactionStatus || !ALLOWED_STATUSES.includes(transactionStatus as (typeof ALLOWED_STATUSES)[number])) {
    return res.status(400).json({ error: `transaction_status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    const assocLookup = sourceAssociateId
      ? await pool.query<{ id: string; source_market_center_id: string | null }>(
          `SELECT id::text AS id, source_market_center_id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
          [sourceAssociateId]
        )
      : { rows: [] as Array<{ id: string; source_market_center_id: string | null }> };
    const associateId = assocLookup.rows[0]?.id ? Number(assocLookup.rows[0].id) : null;

    const sourceMarketCenterId = assocLookup.rows[0]?.source_market_center_id ?? sourceMarketCenterIdInput;

    const mcLookup = sourceMarketCenterId
      ? await pool.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [sourceMarketCenterId]
        )
      : { rows: [] as Array<{ id: string }> };
    const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

    const update = await pool.query<{ id: string }>(
      `
      UPDATE migration.core_transactions
      SET
        source_associate_id = $1,
        associate_id = $2,
        market_center_id = $3,
        transaction_number = $4,
        transaction_status = $5,
        transaction_type = $6,
        source_listing_id = $7,
        listing_number = $8,
        address = $9,
        suburb = $10,
        city = $11,
        sales_price = $12,
        list_price = $13,
        gci_excl_vat = $14,
        split_percentage = $15,
        net_comm = $16,
        total_gci = $17,
        sale_type = $18,
        agent_type = $19,
        buyer = $20,
        seller = $21,
        list_date = $22::timestamptz,
        status_change_date = CASE
          WHEN COALESCE(transaction_status, '') <> COALESCE($5, '') THEN NOW()
          ELSE status_change_date
        END,
        expected_date = $23::timestamptz,
        updated_at = NOW()
      WHERE id = $24
      RETURNING id::text
      `,
      [
        sourceAssociateId,
        associateId,
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
        splitPct,
        netComm,
        totalGci,
        saleType,
        agentType,
        buyer,
        seller,
        listDate,
        expectedDate,
        id,
      ]
    );

    if (update.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    return res.json({ id: update.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
