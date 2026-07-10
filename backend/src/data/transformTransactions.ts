import { closePool, runInTransaction, withClient } from './db.js';
import { recomputeAllTransactionAgentCalculations } from '../services/transactionCalculations.js';

async function main(): Promise<void> {
  await runInTransaction(async (client) => {
    // Transform staging transactions into migration.core_transactions (one per transaction ID)
    await client.query(`
      ALTER TABLE migration.core_transactions
        ADD COLUMN IF NOT EXISTS source_market_center_id TEXT,
        ADD COLUMN IF NOT EXISTS market_center_name TEXT,
        ADD COLUMN IF NOT EXISTS source_team_id TEXT,
        ADD COLUMN IF NOT EXISTS team_name TEXT,
        ADD COLUMN IF NOT EXISTS current_source_market_center_id TEXT,
        ADD COLUMN IF NOT EXISTS current_market_center_name TEXT,
        ADD COLUMN IF NOT EXISTS current_source_team_id TEXT,
        ADD COLUMN IF NOT EXISTS current_team_name TEXT,
        ADD COLUMN IF NOT EXISTS listing_office_name TEXT,
        ADD COLUMN IF NOT EXISTS variance_per NUMERIC(18,6),
        ADD COLUMN IF NOT EXISTS contract_gci_excl_vat NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS avg_comms_per NUMERIC(18,6),
        ADD COLUMN IF NOT EXISTS transaction_gci_excl_vat NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS growth_share NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS production_royalties NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS cap_remaining NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS associate_dollar NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS mc_dollar NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS company_dollar NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS team_dollar NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS transfer_attorney TEXT,
        ADD COLUMN IF NOT EXISTS ta_mobile_phone TEXT,
        ADD COLUMN IF NOT EXISTS ta_email TEXT,
        ADD COLUMN IF NOT EXISTS bond_attorney_contact_id TEXT,
        ADD COLUMN IF NOT EXISTS bond_attorney TEXT,
        ADD COLUMN IF NOT EXISTS ba_mobile_phone TEXT,
        ADD COLUMN IF NOT EXISTS ba_email TEXT,
        ADD COLUMN IF NOT EXISTS bond_originator TEXT,
        ADD COLUMN IF NOT EXISTS bond_due_date TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS bond_amount NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS transaction_financial_institution_id TEXT,
        ADD COLUMN IF NOT EXISTS transaction_financial_institution TEXT,
        ADD COLUMN IF NOT EXISTS financial_institution_other TEXT,
        ADD COLUMN IF NOT EXISTS transaction_financing_type_id TEXT,
        ADD COLUMN IF NOT EXISTS transaction_financing_type TEXT,
        ADD COLUMN IF NOT EXISTS all_parties_invoiced TEXT,
        ADD COLUMN IF NOT EXISTS manual_financial_override BOOLEAN DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE migration.core_transactions
        ALTER COLUMN variance_per TYPE NUMERIC(18,6),
        ALTER COLUMN avg_comms_per TYPE NUMERIC(18,6);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS migration.transaction_documents (
        id BIGSERIAL PRIMARY KEY,
        transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
        source_document_id TEXT,
        source_transaction_document_type_id TEXT,
        transaction_document_type TEXT,
        file_name TEXT,
        document_url TEXT,
        preview_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await client.query(`DELETE FROM migration.transaction_agents`);
    await client.query(`DELETE FROM migration.transaction_documents`);
    await client.query(`DELETE FROM migration.core_transactions`);

    await client.query(`
      WITH latest_transactions_raw AS (
        SELECT DISTINCT ON (source_transaction_id)
          id,
          source_transaction_id,
          transaction_number,
          source_market_center_id,
          transaction_status,
          market_center_name,
          source_team_id,
          team_name,
          current_source_market_center_id,
          current_market_center_name,
          current_source_team_id,
          current_team_name,
          listing_office_name,
          source_listing_id,
          listing_number,
          transaction_type,
          address,
          suburb,
          city,
          sales_price,
          list_price,
          variance_per,
          contract_gci_excl_vat,
          avg_comms_per,
          transaction_gci_excl_vat,
          gci_excl_vat,
          net_comm,
          total_gci,
          growth_share,
          production_royalties,
          cap_remaining,
          associate_dollar,
          mc_dollar,
          company_dollar,
          team_dollar,
          sale_type,
          buyer,
          seller,
          transfer_attorney,
          ta_mobile_phone,
          ta_email,
          bond_attorney_contact_id,
          bond_attorney,
          ba_mobile_phone,
          ba_email,
          bond_originator,
          bond_due_date,
          bond_amount,
          transaction_financial_institution_id,
          transaction_financial_institution,
          financial_institution_other,
          transaction_financing_type_id,
          transaction_financing_type,
          all_parties_invoiced,
          list_date,
          transaction_date,
          status_change_date,
          expected_date,
          loaded_at
        FROM staging.transactions_raw
        ORDER BY source_transaction_id, loaded_at DESC, id DESC
      ),
      latest_transaction_bonds AS (
        SELECT DISTINCT ON (source_transaction_id)
          source_transaction_id,
          bond_amount,
          bond_due_date,
          bond_originator,
          other_financial_institution,
          financing_type,
          financial_institution,
          financing_channel,
          transfer_attorney,
          bond_attorney
        FROM staging.transaction_bonds
        ORDER BY source_transaction_id, bond_due_date DESC NULLS LAST
      )
      INSERT INTO migration.core_transactions (
        source_transaction_id,
        transaction_number,
        source_market_center_id,
        market_center_name,
        source_team_id,
        team_name,
        current_source_market_center_id,
        current_market_center_name,
        current_source_team_id,
        current_team_name,
        listing_office_name,
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
        variance_per,
        contract_gci_excl_vat,
        avg_comms_per,
        transaction_gci_excl_vat,
        gci_excl_vat,
        net_comm,
        total_gci,
        growth_share,
        production_royalties,
        cap_remaining,
        associate_dollar,
        mc_dollar,
        company_dollar,
        team_dollar,
        sale_type,
        buyer,
        seller,
        transfer_attorney,
        ta_mobile_phone,
        ta_email,
        bond_attorney_contact_id,
        bond_attorney,
        ba_mobile_phone,
        ba_email,
        bond_originator,
        bond_due_date,
        bond_amount,
        transaction_financial_institution_id,
        transaction_financial_institution,
        financial_institution_other,
        transaction_financing_type_id,
        transaction_financing_type,
        all_parties_invoiced,
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
        str.source_market_center_id,
        str.market_center_name,
        str.source_team_id,
        str.team_name,
        str.current_source_market_center_id,
        str.current_market_center_name,
        str.current_source_team_id,
        str.current_team_name,
        str.listing_office_name,
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
        str.variance_per,
        str.contract_gci_excl_vat,
        str.avg_comms_per,
        str.transaction_gci_excl_vat,
        str.gci_excl_vat,
        str.net_comm,
        str.total_gci,
        str.growth_share,
        str.production_royalties,
        str.cap_remaining,
        str.associate_dollar,
        str.mc_dollar,
        str.company_dollar,
        str.team_dollar,
        str.sale_type,
        TRIM(str.buyer),
        TRIM(str.seller),
        COALESCE(NULLIF(TRIM(str.transfer_attorney), ''), NULLIF(TRIM(ltb.transfer_attorney), '')),
        NULLIF(TRIM(str.ta_mobile_phone), ''),
        NULLIF(TRIM(str.ta_email), ''),
        NULLIF(TRIM(str.bond_attorney_contact_id), ''),
        COALESCE(NULLIF(TRIM(str.bond_attorney), ''), NULLIF(TRIM(ltb.bond_attorney), '')),
        NULLIF(TRIM(str.ba_mobile_phone), ''),
        NULLIF(TRIM(str.ba_email), ''),
        COALESCE(NULLIF(TRIM(str.bond_originator), ''), NULLIF(TRIM(ltb.bond_originator), '')),
        COALESCE(str.bond_due_date, ltb.bond_due_date),
        COALESCE(str.bond_amount, ltb.bond_amount),
        NULLIF(TRIM(str.transaction_financial_institution_id), ''),
        COALESCE(NULLIF(TRIM(str.transaction_financial_institution), ''), NULLIF(TRIM(ltb.financial_institution), '')),
        COALESCE(NULLIF(TRIM(str.financial_institution_other), ''), NULLIF(TRIM(ltb.other_financial_institution), '')),
        NULLIF(TRIM(str.transaction_financing_type_id), ''),
        COALESCE(NULLIF(TRIM(str.transaction_financing_type), ''), NULLIF(TRIM(ltb.financing_type), '')),
        NULLIF(TRIM(str.all_parties_invoiced), ''),
        str.list_date,
        COALESCE(str.transaction_date, str.loaded_at, NOW()),
        str.status_change_date,
        str.expected_date,
        NOW(),
        NOW()
      FROM latest_transactions_raw str
      LEFT JOIN latest_transaction_bonds ltb
        ON ltb.source_transaction_id = str.source_transaction_id
      LEFT JOIN migration.core_market_centers cmc 
        ON str.source_market_center_id = cmc.source_market_center_id
    `);

    await client.query(`
      INSERT INTO migration.transaction_documents (
        transaction_id,
        source_document_id,
        source_transaction_document_type_id,
        transaction_document_type,
        file_name,
        document_url,
        preview_url,
        created_at,
        updated_at,
        deleted_at
      )
      SELECT
        ct.id,
        td.source_document_id,
        td.source_transaction_document_type_id,
        td.transaction_document_type,
        NULLIF(TRIM(td.file_name), ''),
        NULLIF(TRIM(td.document_url), ''),
        NULLIF(TRIM(td.preview_url), ''),
        COALESCE(td.created_at, NOW()),
        COALESCE(td.updated_at, NOW()),
        CASE WHEN COALESCE(td.soft_delete, false) THEN NOW() ELSE NULL END
      FROM staging.transaction_documents_raw td
      JOIN migration.core_transactions ct
        ON ct.source_transaction_id = td.source_transaction_id
    `);

    // Transform agents from staging to migration
    await client.query(`
      WITH latest_transactions_raw AS (
        SELECT DISTINCT ON (source_transaction_id)
          id,
          source_transaction_id
        FROM staging.transactions_raw
        ORDER BY source_transaction_id, loaded_at DESC, id DESC
      ),
      deduped_internal AS (
        SELECT
          ltr.source_transaction_id,
          sta.source_associate_id,
          MIN(sta.associate_name) AS agent_name,
          CASE
            WHEN BOOL_OR(LOWER(TRIM(COALESCE(sta.agent_type, ''))) = 'seller')
             AND BOOL_OR(LOWER(TRIM(COALESCE(sta.agent_type, ''))) = 'buyer') THEN 'Both'
            ELSE COALESCE(MAX(NULLIF(TRIM(sta.agent_type), '')), '')
          END AS agent_role,
          COALESCE(SUM(COALESCE(sta.split_percentage, 0)), 0) AS split_percentage,
          MIN(COALESCE(sta.sort_order, 0)) AS sort_order,
          false AS outside_agency
        FROM staging.transaction_agents sta
        JOIN latest_transactions_raw ltr ON sta.transaction_id = ltr.id
        WHERE sta.source_associate_id IS NOT NULL AND TRIM(sta.source_associate_id) != ''
        GROUP BY ltr.source_transaction_id, sta.source_associate_id
      ),
      outside_rows AS (
        SELECT
          ltr.source_transaction_id,
          NULL::text AS source_associate_id,
          COALESCE(
            NULLIF(TRIM(sta.associate_name), ''),
            NULLIF(TRIM(CONCAT_WS(' ', sta.outside_first_name, sta.outside_last_name)), ''),
            NULLIF(TRIM(sta.outside_agency_name), ''),
            'Outside Agent'
          ) AS agent_name,
          COALESCE(NULLIF(TRIM(sta.agent_type), ''), 'Outside Agent') AS agent_role,
          COALESCE(sta.split_percentage, 0) AS split_percentage,
          COALESCE(sta.sort_order, 0) AS sort_order,
          true AS outside_agency
        FROM staging.transaction_agents sta
        JOIN latest_transactions_raw ltr ON sta.transaction_id = ltr.id
        WHERE COALESCE(sta.outside_agency, false) = true
           OR NULLIF(TRIM(sta.outside_agency_name), '') IS NOT NULL
           OR (
             (sta.source_associate_id IS NULL OR TRIM(sta.source_associate_id) = '')
             AND LOWER(TRIM(COALESCE(sta.agent_type, ''))) IN ('outside agent', 'outside agency', 'outside agency referral')
           )
      ),
      combined AS (
        SELECT * FROM deduped_internal
        UNION ALL
        SELECT * FROM outside_rows
      )
      INSERT INTO migration.transaction_agents (
        transaction_id,
        associate_id,
        source_associate_id,
        agent_name,
        agent_role,
        split_percentage,
        sort_order,
        outside_agency,
        created_at,
        updated_at
      )
      SELECT
        ct.id,
        ca.id,
        combined.source_associate_id,
        combined.agent_name,
        combined.agent_role,
        combined.split_percentage,
        combined.sort_order,
        combined.outside_agency,
        NOW(),
        NOW()
      FROM combined
      JOIN migration.core_transactions ct ON combined.source_transaction_id = ct.source_transaction_id
      LEFT JOIN migration.core_associates ca ON combined.source_associate_id = ca.source_associate_id
      ORDER BY combined.sort_order
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
