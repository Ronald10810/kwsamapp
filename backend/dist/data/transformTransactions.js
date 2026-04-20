import { closePool, runInTransaction, withClient } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        // Truncate and re-prepare from latest staging data
        await client.query(`DELETE FROM migration.transactions_prepared`);
        await client.query(`
      INSERT INTO migration.transactions_prepared (
        source_transaction_id,
        source_associate_id,
        transaction_number,
        source_market_center_id,
        market_center_name,
        associate_name,
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
        split_percentage,
        net_comm,
        total_gci,
        sale_type,
        agent_type,
        buyer,
        seller,
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        last_seen_at,
        prepared_at
      )
      SELECT DISTINCT ON (source_transaction_id, COALESCE(source_associate_id, ''))
        source_transaction_id,
        COALESCE(source_associate_id, '') AS source_associate_id,
        transaction_number,
        source_market_center_id,
        market_center_name,
        TRIM(associate_name),
        transaction_status,
        source_listing_id,
        listing_number,
        transaction_type,
        TRIM(address),
        TRIM(suburb),
        TRIM(city),
        sales_price,
        list_price,
        gci_excl_vat,
        split_percentage,
        net_comm,
        total_gci,
        sale_type,
        agent_type,
        TRIM(buyer),
        TRIM(seller),
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        MAX(loaded_at) OVER (PARTITION BY source_transaction_id, COALESCE(source_associate_id, '')) AS last_seen_at,
        NOW()
      FROM staging.transactions_raw
      ORDER BY source_transaction_id, COALESCE(source_associate_id, ''), loaded_at DESC
      ON CONFLICT (source_transaction_id, source_associate_id) DO UPDATE SET
        transaction_number    = EXCLUDED.transaction_number,
        source_market_center_id = EXCLUDED.source_market_center_id,
        market_center_name    = EXCLUDED.market_center_name,
        associate_name        = EXCLUDED.associate_name,
        transaction_status    = EXCLUDED.transaction_status,
        source_listing_id     = EXCLUDED.source_listing_id,
        listing_number        = EXCLUDED.listing_number,
        transaction_type      = EXCLUDED.transaction_type,
        address               = EXCLUDED.address,
        suburb                = EXCLUDED.suburb,
        city                  = EXCLUDED.city,
        sales_price           = EXCLUDED.sales_price,
        list_price            = EXCLUDED.list_price,
        gci_excl_vat          = EXCLUDED.gci_excl_vat,
        split_percentage      = EXCLUDED.split_percentage,
        net_comm              = EXCLUDED.net_comm,
        total_gci             = EXCLUDED.total_gci,
        sale_type             = EXCLUDED.sale_type,
        agent_type            = EXCLUDED.agent_type,
        buyer                 = EXCLUDED.buyer,
        seller                = EXCLUDED.seller,
        list_date             = EXCLUDED.list_date,
        transaction_date      = EXCLUDED.transaction_date,
        status_change_date    = EXCLUDED.status_change_date,
        expected_date         = EXCLUDED.expected_date,
        last_seen_at          = EXCLUDED.last_seen_at,
        prepared_at           = NOW()
    `);
    });
    const { rows } = await withClient((client) => client.query(`SELECT COUNT(*) AS cnt FROM migration.transactions_prepared`));
    console.log(`Transactions transformed into migration.transactions_prepared. (${rows[0].cnt} rows)`);
}
main()
    .catch((error) => {
    console.error('Failed to transform transactions:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=transformTransactions.js.map