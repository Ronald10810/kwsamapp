import { closePool, withClient } from './db.js';
import {
  DEFAULT_CAP004_STRICT_TRANSACTION_NUMBERS,
  previewScopedTransactionAgentCalculations,
} from '../services/transactionCalculations.js';

type CliArgs = {
  transactionNumbers: string[];
};

export function parseScopedDryRunArgsForTesting(argv: string[]): CliArgs {
  const transactionNumbers: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--write' || token === '--apply' || token === '--commit') {
      throw new Error('Write mode is blocked. Scoped recalculation currently supports dry-run only.');
    }

    if (token === '--transactions') {
      const value = argv[index + 1] ?? '';
      index += 1;
      const parsed = value
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter((item) => item.length > 0);
      transactionNumbers.push(...parsed);
      continue;
    }

    if (token.startsWith('--transactions=')) {
      const rawValue = token.slice('--transactions='.length);
      const parsed = rawValue
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter((item) => item.length > 0);
      transactionNumbers.push(...parsed);
      continue;
    }
  }

  const strictUnique = Array.from(new Set(transactionNumbers));

  return {
    transactionNumbers: strictUnique.length > 0
      ? strictUnique
      : [...DEFAULT_CAP004_STRICT_TRANSACTION_NUMBERS],
  };
}

function printDryRunSummary(result: Awaited<ReturnType<typeof previewScopedTransactionAgentCalculations>>): void {
  console.log('Scoped TAC dry-run complete. No writes were performed.');
  console.log(`Strict transactions: ${result.strict_transaction_numbers.join(', ')}`);
  console.log(`Envelope rows included: ${result.envelope_rows_count}`);
  console.log(`Rows that would change: ${result.changed_rows_count}`);
  console.log('--- STRICT TRANSACTION BEFORE/AFTER ---');
  console.table(result.strict_transaction_summaries);
  console.log('--- TH44357 EXPECTED CHECK ---');
  console.table([result.th44357_expected_check]);

  if (result.team_nagel_cap_impact) {
    console.log('--- TEAM NAGEL CAP IMPACT (DRY-RUN ONLY) ---');
    console.table([result.team_nagel_cap_impact]);
  } else {
    console.log('--- TEAM NAGEL CAP IMPACT (DRY-RUN ONLY) ---');
    console.log('No Team Nagel cap context found.');
  }

  console.log('--- WOULD-CHANGE ROWS (ENVELOPE) ---');
  console.table(result.changed_rows);
  console.log('--- ENVELOPE TRANSACTION_AGENT_IDS ---');
  console.log(result.envelope_transaction_agent_ids.join(','));
  console.log('--- JSON OUTPUT ---');
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const args = parseScopedDryRunArgsForTesting(process.argv.slice(2));

  const result = await withClient(async (client) => {
    return previewScopedTransactionAgentCalculations(client, args.transactionNumbers);
  });

  printDryRunSummary(result);
}

main()
  .catch((error) => {
    console.error('Scoped TAC dry-run failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
