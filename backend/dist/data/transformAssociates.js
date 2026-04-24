import { closePool, runInTransaction } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        await client.query(`
      INSERT INTO migration.associates_prepared (
        source_associate_id,
        first_name,
        last_name,
        full_name,
        email,
        status_name,
        market_center_name,
        team_name,
        kwuid,
        image_url,
        mobile_number,
        office_number,
        national_id,
        ffc_number,
        kwsa_email,
        private_email,
        growth_share_sponsor,
        proposed_growth_share_sponsor,
        temporary_growth_share_sponsor,
        start_date,
        end_date,
        anniversary_date,
        cap_date,
        total_cap_amount,
        manual_cap,
        agent_split,
        last_seen_at,
        prepared_at
      )
      SELECT DISTINCT ON (source_associate_id)
        source_associate_id,
        first_name,
        last_name,
        CONCAT_WS(' ', first_name, last_name) AS full_name,
        email,
        status_name,
        market_center_name,
        team_name,
        kwuid,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'AssociateImageUrl',
          raw_payload->>'AssociateImagePreviewUrl',
          raw_payload->>'_ext_image_url',
          ''
        )), '') AS image_url,
        NULLIF(REGEXP_REPLACE(TRIM(COALESCE(
          raw_payload->>'MobileNumber',
          raw_payload->>'_ext_mobile_number',
          ''
        )), '\\s+', '', 'g'), '') AS mobile_number,
        NULLIF(REGEXP_REPLACE(TRIM(COALESCE(
          raw_payload->>'OfficeNumber',
          raw_payload->>'_ext_office_number',
          ''
        )), '\\s+', '', 'g'), '') AS office_number,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'NationalId',
          raw_payload->>'NationalID',
          raw_payload->>'national_id',
          raw_payload->>'_ext_national_id',
          ''
        )), '') AS national_id,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'FFCNumber',
          raw_payload->>'ffc_number',
          raw_payload->>'_ext_ffc_number',
          ''
        )), '') AS ffc_number,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'KWSAEmail',
          raw_payload->>'kwsa_email',
          raw_payload->>'_ext_kwsa_email',
          ''
        )), '') AS kwsa_email,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'PrivateEmail',
          raw_payload->>'private_email',
          raw_payload->>'_ext_private_email',
          ''
        )), '') AS private_email,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'GrowthShareSponsor',
          raw_payload->>'growth_share_sponsor',
          raw_payload->>'_ext_growth_share_sponsor',
          ''
        )), '') AS growth_share_sponsor,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'ProposedGrowthShareSponsor',
          raw_payload->>'_ext_proposed_growth_share_sponsor',
          ''
        )), '') AS proposed_growth_share_sponsor,
        NULLIF(TRIM(COALESCE(
          raw_payload->>'TemporaryGrowthShareSponsor',
          raw_payload->>'_ext_temporary_growth_share_sponsor',
          ''
        )), '') AS temporary_growth_share_sponsor,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'StartDate', raw_payload->>'_ext_start_date', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'StartDate', raw_payload->>'_ext_start_date', '')), '')::date
             ELSE NULL END AS start_date,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'EndDate', raw_payload->>'_ext_end_date', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'EndDate', raw_payload->>'_ext_end_date', '')), '')::date
             ELSE NULL END AS end_date,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'AnniversaryDate', raw_payload->>'_ext_anniversary_date', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'AnniversaryDate', raw_payload->>'_ext_anniversary_date', '')), '')::date
             ELSE NULL END AS anniversary_date,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'CapDate', raw_payload->>'_ext_cap_date', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'CapDate', raw_payload->>'_ext_cap_date', '')), '')::date
             ELSE NULL END AS cap_date,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'TotalCapAmount', raw_payload->>'TotalCap', raw_payload->>'_ext_total_cap_amount', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'TotalCapAmount', raw_payload->>'TotalCap', raw_payload->>'_ext_total_cap_amount', '')), '')::numeric
             ELSE NULL END AS total_cap_amount,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'ManualCap', raw_payload->>'_ext_manual_cap', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'ManualCap', raw_payload->>'_ext_manual_cap', '')), '')::numeric
             ELSE NULL END AS manual_cap,
        CASE WHEN NULLIF(TRIM(COALESCE(raw_payload->>'AgentSplit', raw_payload->>'CommissionSplitPercentageToAgent', raw_payload->>'_ext_agent_split', '')), '') IS NOT NULL
             THEN NULLIF(TRIM(COALESCE(raw_payload->>'AgentSplit', raw_payload->>'CommissionSplitPercentageToAgent', raw_payload->>'_ext_agent_split', '')), '')::numeric
             ELSE NULL END AS agent_split,
        COALESCE(source_updated_at, loaded_at) AS last_seen_at,
        NOW() AS prepared_at
      FROM staging.associates_raw
      ORDER BY source_associate_id, COALESCE(source_updated_at, loaded_at) DESC
      ON CONFLICT (source_associate_id)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        status_name = EXCLUDED.status_name,
        market_center_name = EXCLUDED.market_center_name,
        team_name = EXCLUDED.team_name,
        kwuid = EXCLUDED.kwuid,
        image_url = COALESCE(EXCLUDED.image_url, migration.associates_prepared.image_url),
        mobile_number = COALESCE(EXCLUDED.mobile_number, migration.associates_prepared.mobile_number),
        office_number = COALESCE(EXCLUDED.office_number, migration.associates_prepared.office_number),
        national_id = COALESCE(EXCLUDED.national_id, migration.associates_prepared.national_id),
        ffc_number = COALESCE(EXCLUDED.ffc_number, migration.associates_prepared.ffc_number),
        kwsa_email = COALESCE(EXCLUDED.kwsa_email, migration.associates_prepared.kwsa_email),
        private_email = COALESCE(EXCLUDED.private_email, migration.associates_prepared.private_email),
        growth_share_sponsor = COALESCE(EXCLUDED.growth_share_sponsor, migration.associates_prepared.growth_share_sponsor),
        proposed_growth_share_sponsor = COALESCE(EXCLUDED.proposed_growth_share_sponsor, migration.associates_prepared.proposed_growth_share_sponsor),
        temporary_growth_share_sponsor = COALESCE(EXCLUDED.temporary_growth_share_sponsor, migration.associates_prepared.temporary_growth_share_sponsor),
        start_date = COALESCE(EXCLUDED.start_date, migration.associates_prepared.start_date),
        end_date = COALESCE(EXCLUDED.end_date, migration.associates_prepared.end_date),
        anniversary_date = COALESCE(EXCLUDED.anniversary_date, migration.associates_prepared.anniversary_date),
        cap_date = COALESCE(EXCLUDED.cap_date, migration.associates_prepared.cap_date),
        total_cap_amount = COALESCE(EXCLUDED.total_cap_amount, migration.associates_prepared.total_cap_amount),
        manual_cap = COALESCE(EXCLUDED.manual_cap, migration.associates_prepared.manual_cap),
        agent_split = COALESCE(EXCLUDED.agent_split, migration.associates_prepared.agent_split),
        last_seen_at = EXCLUDED.last_seen_at,
        prepared_at = NOW();
    `);
    });
    console.log('Associates transformed into migration.associates_prepared.');
}
main()
    .catch((error) => {
    console.error('Failed to transform associates:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=transformAssociates.js.map