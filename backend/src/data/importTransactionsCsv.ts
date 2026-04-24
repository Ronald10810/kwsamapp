import { closePool, runInTransaction } from './db.js';
import { optionalArg } from './args.js';
import { getValue, readCsvRows } from './csv.js';

function buildBatchId(): string {
  return `transactions_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}

function parseNum(val: string | null | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseDate(val: string | null | undefined): string | null {
  if (!val || val.trim() === '') return null;
  // Handles "2021/02/15 00:00" and ISO formats
  const d = new Date(val.trim().replace(/\//g, '-'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function main(): Promise<void> {
  const filePath = optionalArg('--file', 'data/incoming/transactions.csv');
  const batchId = optionalArg('--batch', buildBatchId());
  const rows = await readCsvRows(filePath);

  if (rows.length === 0) {
    throw new Error(`No rows found in ${filePath}`);
  }

  // Group rows by source_transaction_id to handle multi-agent transactions
  const transactionMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const sourceTransactionId = getValue(row, ['TransactionId', 'transaction_id']);
    if (!sourceTransactionId) continue;
    
    if (!transactionMap.has(sourceTransactionId)) {
      transactionMap.set(sourceTransactionId, []);
    }
    transactionMap.get(sourceTransactionId)!.push(row);
  }

  let imported = 0;
  const CHUNK = 500;
  const txIds = Array.from(transactionMap.keys());

  for (let i = 0; i < txIds.length; i += CHUNK) {
    const chunk = txIds.slice(i, i + CHUNK);
    await runInTransaction(async (client) => {
      for (const sourceTransactionId of chunk) {
        const txRows = transactionMap.get(sourceTransactionId)!;
        
        // Use first row for transaction-level data (common across all agent rows)
        const firstRow = txRows[0];
        const transactionNumber = getValue(firstRow, ['TransactionNumber', 'transaction_number']) || null;
        const sourceMcId = getValue(firstRow, ['MarketCenterId', 'market_center_id']) || null;
        const mcName = getValue(firstRow, ['MarketCenterName', 'market_center_name']) || null;
        const status = getValue(firstRow, ['TransactionStatus', 'transaction_status']) || null;
        const sourceListingId = getValue(firstRow, ['ListingId', 'listing_id']) || null;
        const listingNumber = getValue(firstRow, ['ListingNumber', 'listing_number']) || null;
        const txType = getValue(firstRow, ['TransactionType', 'transaction_type']) || null;
        const address = getValue(firstRow, ['Address', 'address']) || null;
        const suburb = getValue(firstRow, ['Suburb', 'suburb']) || null;
        const city = getValue(firstRow, ['City', 'city']) || null;
        const salesPrice = parseNum(getValue(firstRow, ['SalesPrice', 'sales_price']));
        const listPrice = parseNum(getValue(firstRow, ['ListPrice', 'list_price']));
        const gci = parseNum(getValue(firstRow, ['ContractGCIExclVAT', 'gci_excl_vat']));
        const netComm = parseNum(getValue(firstRow, ['NetComm', 'net_comm']));
        const totalGci = parseNum(getValue(firstRow, ['TotalGCI', 'total_gci']));
        const saleType = getValue(firstRow, ['SaleType', 'sale_type']) || null;
        const buyer = getValue(firstRow, ['Buyer', 'buyer']) || null;
        const seller = getValue(firstRow, ['Seller', 'seller']) || null;
        const listDate = parseDate(getValue(firstRow, ['ListDate', 'list_date']));
        const txDate = parseDate(getValue(firstRow, ['TransactionDate', 'transaction_date']));
        const statusChangeDate = parseDate(getValue(firstRow, ['StatusChangeDate', 'status_change_date']));
        const expectedDate = parseDate(getValue(firstRow, ['ExpectedDate', 'expected_date']));

        // Insert one transaction record (not duplicated per agent)
        await client.query(
          `INSERT INTO staging.transactions_raw (
            batch_id, source_transaction_id, transaction_number,
            source_market_center_id, market_center_name,
            source_associate_id, associate_name,
            transaction_status, source_listing_id, listing_number,
            list_date, transaction_date, status_change_date, expected_date,
            transaction_type, address, suburb, city,
            sales_price, list_price, gci_excl_vat,
            split_percentage, net_comm, total_gci,
            sale_type, agent_type, buyer, seller,
            raw_payload
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11::timestamptz,$12::timestamptz,$13::timestamptz,$14::timestamptz,
            $15,$16,$17,$18,
            $19,$20,$21,$22,$23,$24,
            $25,$26,$27,$28,
            $29::jsonb
          )`,
          [
            batchId, sourceTransactionId, transactionNumber,
            sourceMcId, mcName,
            '', '', // Leave associate fields empty for multi-agent transactions
            status, sourceListingId, listingNumber,
            listDate, txDate, statusChangeDate, expectedDate,
            txType, address, suburb, city,
            salesPrice, listPrice, gci,
            null, netComm, totalGci,
            saleType, null, buyer, seller,
            JSON.stringify(firstRow),
          ]
        );

        // Get the inserted transaction record ID
        const txResult = await client.query(
          `SELECT id FROM staging.transactions_raw WHERE source_transaction_id = $1 ORDER BY id DESC LIMIT 1`,
          [sourceTransactionId]
        );
        const transactionDbId = txResult.rows[0]?.id;

        // Insert agent records (one per agent in the transaction)
        for (let agentIndex = 0; agentIndex < txRows.length; agentIndex++) {
          const agentRow = txRows[agentIndex];
          const sourceAssociateId = getValue(agentRow, ['AssociateId', 'associate_id']) || null;
          const associateName = getValue(agentRow, ['Associate', 'associate_name']) || null;
          const splitPct = parseNum(getValue(agentRow, ['SplitPercentage', 'split_percentage']));
          const agentType = getValue(agentRow, ['AgentType', 'agent_type']) || null;

          await client.query(
            `INSERT INTO staging.transaction_agents (
              transaction_id, source_associate_id, associate_name,
              split_percentage, agent_type, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [transactionDbId, sourceAssociateId, associateName, splitPct, agentType, agentIndex]
          );
        }

        imported++;
      }
    });
  }

  console.log(`Imported ${imported} transactions with multi-agent support (batch: ${batchId}).`);
}

main()
  .catch((error) => {
    console.error('Failed to import transactions CSV:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
