import { withClient } from './db.js';
import { recomputeAllTransactionAgentCalculationsSafe } from '../services/transactionCalculations.js';

async function main(): Promise<void> {
  await withClient(async (client) => {
    const affectedRows = await recomputeAllTransactionAgentCalculationsSafe(client);
    console.log(`Transaction agent calculations safely recomputed. Upserted rows: ${affectedRows}`);
  });
}

main().catch((error) => {
  console.error('Failed to safely recompute transaction agent calculations:', error);
  process.exitCode = 1;
});
