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

  let imported = 0;
  const CHUNK = 500;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await runInTransaction(async (client) => {
      for (const row of chunk) {
        const sourceTransactionId = getValue(row, ['TransactionId', 'transaction_id']);
        if (!sourceTransactionId) continue;

        const sourceAssociateId = getValue(row, ['AssociateId', 'associate_id']) || null;
        const transactionNumber = getValue(row, ['TransactionNumber', 'transaction_number']) || null;
        const sourceMcId = getValue(row, ['MarketCenterId', 'market_center_id']) || null;
        const mcName = getValue(row, ['MarketCenterName', 'market_center_name']) || null;
        const associateName = getValue(row, ['Associate', 'associate_name']) || null;
        const status = getValue(row, ['TransactionStatus', 'transaction_status']) || null;
        const sourceListingId = getValue(row, ['ListingId', 'listing_id']) || null;
        const listingNumber = getValue(row, ['ListingNumber', 'listing_number']) || null;
        const txType = getValue(row, ['TransactionType', 'transaction_type']) || null;
        const address = getValue(row, ['Address', 'address']) || null;
        const suburb = getValue(row, ['Suburb', 'suburb']) || null;
        const city = getValue(row, ['City', 'city']) || null;
        const salesPrice = parseNum(getValue(row, ['SalesPrice', 'sales_price']));
        const listPrice = parseNum(getValue(row, ['ListPrice', 'list_price']));
        const gci = parseNum(getValue(row, ['ContractGCIExclVAT', 'gci_excl_vat']));
        const splitPct = parseNum(getValue(row, ['SplitPercentage', 'split_percentage']));
        const netComm = parseNum(getValue(row, ['NetComm', 'net_comm']));
        const totalGci = parseNum(getValue(row, ['TotalGCI', 'total_gci']));
        const saleType = getValue(row, ['SaleType', 'sale_type']) || null;
        const agentType = getValue(row, ['AgentType', 'agent_type']) || null;
        const buyer = getValue(row, ['Buyer', 'buyer']) || null;
        const seller = getValue(row, ['Seller', 'seller']) || null;
        const listDate = parseDate(getValue(row, ['ListDate', 'list_date']));
        const txDate = parseDate(getValue(row, ['TransactionDate', 'transaction_date']));
        const statusChangeDate = parseDate(getValue(row, ['StatusChangeDate', 'status_change_date']));
        const expectedDate = parseDate(getValue(row, ['ExpectedDate', 'expected_date']));

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
            sourceAssociateId, associateName,
            status, sourceListingId, listingNumber,
            listDate, txDate, statusChangeDate, expectedDate,
            txType, address, suburb, city,
            salesPrice, listPrice, gci,
            splitPct, netComm, totalGci,
            saleType, agentType, buyer, seller,
            JSON.stringify(row),
          ]
        );
        imported++;
      }
    });
  }

  console.log(`Imported ${imported} rows into staging.transactions_raw (batch: ${batchId}).`);
}

main()
  .catch((error) => {
    console.error('Failed to import transactions CSV:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
