import { closePool, runInTransaction } from './db.js';
import { recomputeAllTransactionAgentCalculations } from '../services/transactionCalculations.js';

async function main(): Promise<void> {
  await runInTransaction(async (client) => {
    await recomputeAllTransactionAgentCalculations(client);
  });

  console.log('Transaction agent calculations recomputed.');
}

main()
  .catch((error) => {
    console.error('Failed to recompute transaction agent calculations:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
