import { closePool, runInTransaction } from './db.js';
import { recomputeAllTransactionAgentCalculations } from '../services/transactionCalculations.js';
function buildSnapshotTableName(now = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    const mm = pad(now.getUTCMonth() + 1);
    const dd = pad(now.getUTCDate());
    const hh = pad(now.getUTCHours());
    const mi = pad(now.getUTCMinutes());
    const ss = pad(now.getUTCSeconds());
    return `transaction_agent_calculations_snapshot_${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}
async function main() {
    const snapshotTable = process.env.TAC_SNAPSHOT_TABLE?.trim() || buildSnapshotTableName();
    if (!/^[a-zA-Z0-9_]+$/.test(snapshotTable)) {
        throw new Error('Invalid TAC_SNAPSHOT_TABLE value. Only letters, numbers, and underscores are allowed.');
    }
    await runInTransaction(async (client) => {
        const beforeCountResult = await client.query('SELECT COUNT(*)::text AS count FROM migration.transaction_agent_calculations');
        const beforeCount = Number(beforeCountResult.rows[0]?.count ?? 0);
        await client.query(`CREATE TABLE migration.${snapshotTable} AS TABLE migration.transaction_agent_calculations WITH DATA`);
        await recomputeAllTransactionAgentCalculations(client);
        const afterCountResult = await client.query('SELECT COUNT(*)::text AS count FROM migration.transaction_agent_calculations');
        const afterCount = Number(afterCountResult.rows[0]?.count ?? 0);
        console.log(JSON.stringify({
            ok: true,
            snapshot_table: `migration.${snapshotTable}`,
            before_count: beforeCount,
            after_count: afterCount,
        }, null, 2));
    });
}
main()
    .catch((error) => {
    console.error('Failed to run TAC backfill with snapshot:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=backfillTransactionAgentCalculationsWithSnapshot.js.map