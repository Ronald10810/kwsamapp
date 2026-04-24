import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';

const router = Router();
const pool = getOptionalPgPool();

// TODO: Implement associate routes based on legacy AssociateService
// GET /api/associates - List associates (with filters, search, pagination)
// POST /api/associates - Create new associate
// GET /api/associates/:id - Get associate details
// PUT /api/associates/:id - Update associate
// POST /api/associates/:id/transfer - Create associate transfer
// GET /api/associates/:id/transfers - Get pending transfers
// PUT /api/associates/transfers/:transferId - Process transfer

router.get('/', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const limitInput = Number(req.query.limit ?? 25);
  const offsetInput = Number(req.query.offset ?? 0);
  const searchInput = String(req.query.search ?? '').trim();
  const statusInput = String(req.query.status ?? '').trim();

  const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
  const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;

  try {
    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_associates') AS exists`
    );

    if (!exists.rows[0]?.exists) {
      return res.json({ total: 0, limit, offset, items: [] });
    }

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (searchInput.length > 0) {
      params.push(`%${searchInput}%`);
      const searchParam = `$${params.length}`;
      whereClauses.push(
        `(ca.full_name ILIKE ${searchParam} OR ca.first_name ILIKE ${searchParam} OR ca.last_name ILIKE ${searchParam} OR ca.email ILIKE ${searchParam} OR ca.kwuid ILIKE ${searchParam} OR ca.source_associate_id ILIKE ${searchParam} OR mc.name ILIKE ${searchParam})`
      );
    }

    if (statusInput.length > 0) {
      params.push(statusInput.toLowerCase());
      const statusParam = `$${params.length}`;
      whereClauses.push(`LOWER(TRIM(COALESCE(ca.status_name, ''))) = ${statusParam}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const totalResult = await pool.query<{ total: string }>(
      `
      SELECT COUNT(*)::text AS total
      FROM migration.core_associates ca
      LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
      ${whereSql}
      `,
      params
    );

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const dataResult = await pool.query<{
      id: string;
      source_associate_id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      status_name: string | null;
      kwuid: string | null;
      source_market_center_id: string | null;
      source_team_id: string | null;
      market_center_name: string | null;
      market_center_logo_url: string | null;
      updated_at: string;
    }>(
      `
      SELECT
        ca.id,
        ca.source_associate_id,
        ca.full_name,
        ca.first_name,
        ca.last_name,
        ca.email,
        ca.status_name,
        ca.kwuid,
        ca.source_market_center_id,
        ca.source_team_id,
        COALESCE(mc.name, ca.source_market_center_id) AS market_center_name,
        mc.logo_image_url AS market_center_logo_url,
        ca.updated_at::text
      FROM migration.core_associates ca
      LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
      ${whereSql}
      ORDER BY COALESCE(ca.full_name, ca.first_name, ca.last_name, ca.source_associate_id) ASC, ca.id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      params
    );

    return res.json({
      total: Number(totalResult.rows[0]?.total ?? 0),
      limit,
      offset,
      items: dataResult.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
