import { closePool, runInTransaction } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        await client.query(`
      INSERT INTO migration.teams_prepared (
        source_team_id,
        source_market_center_id,
        name,
        status_name,
        last_seen_at,
        prepared_at
      )
      SELECT DISTINCT ON (source_team_id)
        source_team_id,
        source_market_center_id,
        name,
        status_name,
        COALESCE(source_updated_at, loaded_at) AS last_seen_at,
        NOW() AS prepared_at
      FROM staging.teams_raw
      ORDER BY source_team_id, COALESCE(source_updated_at, loaded_at) DESC
      ON CONFLICT (source_team_id)
      DO UPDATE SET
        source_market_center_id = EXCLUDED.source_market_center_id,
        name = EXCLUDED.name,
        status_name = EXCLUDED.status_name,
        last_seen_at = EXCLUDED.last_seen_at,
        prepared_at = NOW();
    `);
    });
    console.log('Teams transformed into migration.teams_prepared.');
}
main()
    .catch((error) => {
    console.error('Failed to transform teams:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=transformTeams.js.map