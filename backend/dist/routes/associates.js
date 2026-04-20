import { Router } from 'express';
import { Pool } from 'pg';
const router = Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
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
    const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
    const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;
    try {
        const exists = await pool.query(`SELECT to_regclass('migration.core_associates') AS exists`);
        if (!exists.rows[0]?.exists) {
            return res.json({ total: 0, limit, offset, items: [] });
        }
        const whereClauses = [];
        const params = [];
        if (searchInput.length > 0) {
            params.push(`%${searchInput}%`);
            const searchParam = `$${params.length}`;
            whereClauses.push(`(full_name ILIKE ${searchParam} OR first_name ILIKE ${searchParam} OR last_name ILIKE ${searchParam} OR email ILIKE ${searchParam} OR kwuid ILIKE ${searchParam} OR source_associate_id ILIKE ${searchParam})`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const totalResult = await pool.query(`SELECT COUNT(*)::text AS total FROM migration.core_associates ${whereSql}`, params);
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const dataResult = await pool.query(`
      SELECT
        id,
        source_associate_id,
        full_name,
        first_name,
        last_name,
        email,
        status_name,
        kwuid,
        source_market_center_id,
        source_team_id,
        updated_at::text
      FROM migration.core_associates
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `, params);
        return res.json({
            total: Number(totalResult.rows[0]?.total ?? 0),
            limit,
            offset,
            items: dataResult.rows,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
export default router;
//# sourceMappingURL=associates.js.map