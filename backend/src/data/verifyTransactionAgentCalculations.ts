import { closePool, withClient } from './db.js';

type RowCount = { count: string };
type StatusCount = { transaction_status: string | null; rows: string };

async function main(): Promise<void> {
  const report = await withClient(async (client) => {
    const totalResult = await client.query<RowCount>(
      'SELECT COUNT(*)::text AS count FROM migration.transaction_agent_calculations'
    );

    const mcZeroMismatchResult = await client.query<RowCount>(`
      SELECT COUNT(*)::text AS count
      FROM migration.transaction_agent_calculations tac
      WHERE COALESCE(tac.is_outside_agent, FALSE) = FALSE
        AND COALESCE(tac.market_center_split_pct, 0) > 0
        AND COALESCE(tac.market_center_dollar, 0) <= 0
    `);

    const statusBreakdownResult = await client.query<StatusCount>(`
      SELECT COALESCE(ct.transaction_status, 'Unknown') AS transaction_status,
             COUNT(*)::text AS rows
      FROM migration.transaction_agent_calculations tac
      JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      GROUP BY COALESCE(ct.transaction_status, 'Unknown')
      ORDER BY COUNT(*) DESC
    `);

    return {
      total_rows: Number(totalResult.rows[0]?.count ?? 0),
      mc_split_gt_zero_but_mc_dollar_zero_or_less_rows: Number(mcZeroMismatchResult.rows[0]?.count ?? 0),
      rows_by_status: statusBreakdownResult.rows.map((row) => ({
        status: row.transaction_status ?? 'Unknown',
        rows: Number(row.rows),
      })),
    };
  });

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('Failed to verify transaction agent calculations:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
