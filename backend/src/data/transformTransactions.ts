import { closePool, runInTransaction, withClient } from './db.js';
import { recomputeAllTransactionAgentCalculations } from '../services/transactionCalculations.js';

async function main(): Promise<void> {
  await runInTransaction(async (client) => {
    // Transform staging transactions into migration.core_transactions (one per transaction ID)
    await client.query(`DELETE FROM migration.transaction_agents`);
    await client.query(`DELETE FROM migration.core_transactions`);

    await client.query(`
      INSERT INTO migration.core_transactions (
        source_transaction_id,
        transaction_number,
        primary_market_center_id,
        transaction_status,
        source_listing_id,
        listing_number,
        transaction_type,
        address,
        suburb,
        city,
        sales_price,
        list_price,
        gci_excl_vat,
        net_comm,
        total_gci,
        sale_type,
        buyer,
        seller,
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        created_at,
        updated_at
      )
      SELECT
        str.source_transaction_id,
        str.transaction_number,
        cmc.id AS primary_market_center_id,
        str.transaction_status,
        str.source_listing_id,
        str.listing_number,
        str.transaction_type,
        TRIM(str.address),
        TRIM(str.suburb),
        TRIM(str.city),
        str.sales_price,
        str.list_price,
        str.gci_excl_vat,
        str.net_comm,
        str.total_gci,
        str.sale_type,
        TRIM(str.buyer),
        TRIM(str.seller),
        str.list_date,
        COALESCE(str.loaded_at, str.transaction_date, NOW()),
        str.status_change_date,
        str.expected_date,
        NOW(),
        NOW()
      FROM (
        SELECT DISTINCT ON (source_transaction_id)
          source_transaction_id,
          transaction_number,
          source_market_center_id,
          transaction_status,
          source_listing_id,
          listing_number,
          transaction_type,
          address,
          suburb,
          city,
          sales_price,
          list_price,
          gci_excl_vat,
          net_comm,
          total_gci,
          sale_type,
          buyer,
          seller,
          list_date,
          transaction_date,
          status_change_date,
          expected_date,
          loaded_at
        FROM staging.transactions_raw
        ORDER BY source_transaction_id, loaded_at DESC
      ) str
      LEFT JOIN migration.core_market_centers cmc 
        ON str.source_market_center_id = cmc.source_market_center_id
    `);

    // Transform agents from staging to migration
    await client.query(`
      INSERT INTO migration.transaction_agents (
        transaction_id,
        associate_id,
        source_associate_id,
        agent_role,
        split_percentage,
        sort_order,
        created_at,
        updated_at
      )
      SELECT
        ct.id,
        ca.id,
        deduped.source_associate_id,
        deduped.agent_type,
        deduped.split_percentage,
        deduped.sort_order,
        NOW(),
        NOW()
      FROM (
        SELECT
          str.source_transaction_id,
          sta.source_associate_id,
          MIN(sta.associate_name) AS associate_name,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(COALESCE(sta.agent_type, ''))) = 'seller')
             AND BOOL_OR(LOWER(TRIM(COALESCE(sta.agent_type, ''))) = 'buyer') THEN 'Both'
            ELSE COALESCE(MAX(NULLIF(TRIM(sta.agent_type), '')), '')
          END AS agent_type,
          COALESCE(SUM(COALESCE(sta.split_percentage, 0)), 0) AS split_percentage,
          MIN(COALESCE(sta.sort_order, 0)) AS sort_order
        FROM staging.transaction_agents sta
        JOIN staging.transactions_raw str ON sta.transaction_id = str.id
        WHERE sta.source_associate_id IS NOT NULL AND TRIM(sta.source_associate_id) != ''
        GROUP BY str.source_transaction_id, sta.source_associate_id
      ) deduped
      JOIN migration.core_transactions ct ON deduped.source_transaction_id = ct.source_transaction_id
      LEFT JOIN migration.core_associates ca ON deduped.source_associate_id = ca.source_associate_id
      ORDER BY deduped.sort_order
    `);

    await recomputeAllTransactionAgentCalculations(client);
  });

  const { rows: txCount } = await withClient((client) =>
    client.query(`SELECT COUNT(*) AS cnt FROM migration.core_transactions`)
  );
  const { rows: agentCount } = await withClient((client) =>
    client.query(`SELECT COUNT(*) AS cnt FROM migration.transaction_agents`)
  );
  console.log(`Transactions transformed: ${txCount[0].cnt} transactions, ${agentCount[0].cnt} agent linkages`);
}

main()
  .catch((error) => {
    console.error('Failed to transform transactions:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
