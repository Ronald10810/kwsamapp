import { closePool, runInTransaction } from './db.js';

function optionalArg(name: string): string | undefined {
  const key = `--${name}`;
  const index = process.argv.indexOf(key);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  await runInTransaction(async (client) => {
    const explicitBatchId = optionalArg('batch-id') ?? process.env.ASSOC_BATCH_ID;
    const inferredBatchId = explicitBatchId
      ? explicitBatchId
      : (
          await client.query<{ batch_id: string }>(
            `
            SELECT batch_id
            FROM staging.associates_raw
            WHERE batch_id IS NOT NULL
            ORDER BY loaded_at DESC
            LIMIT 1
            `
          )
        ).rows[0]?.batch_id;
    const transformBatchId = inferredBatchId ?? null;

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
      WITH ar_latest AS (
        SELECT DISTINCT ON (source_associate_id)
          source_associate_id,
          first_name,
          last_name,
          email AS ar_email,
          status_name,
          market_center_name,
          team_name,
          kwuid,
          raw_payload,
          COALESCE(source_updated_at, loaded_at) AS last_updated
        FROM staging.associates_raw
        WHERE ($1::text IS NULL OR batch_id = $1::text)
        ORDER BY source_associate_id, COALESCE(source_updated_at, loaded_at) DESC
      ),
      cd_latest AS (
        SELECT DISTINCT ON (source_associate_id)
          source_associate_id,
          email,
          private_email,
          mobile_number,
          office_number
        FROM staging.associate_contact_details_raw
        WHERE source_associate_id IS NOT NULL
        ORDER BY source_associate_id, loaded_at DESC NULLS LAST, id DESC
      ),
      bd_latest AS (
        SELECT DISTINCT ON (source_associate_id)
          source_associate_id,
          source_market_center_id
        FROM staging.associate_business_details_raw
        WHERE source_associate_id IS NOT NULL
      ),
      dt_latest AS (
        SELECT DISTINCT ON (source_associate_id)
          source_associate_id,
          start_date,
          end_date,
          anniversary_date,
          cap_date
        FROM staging.associate_dates_raw
        WHERE source_associate_id IS NOT NULL
      ),
      cm_latest AS (
        SELECT DISTINCT ON (source_associate_id)
          source_associate_id,
          total_cap_amount,
          manual_cap,
          commission_split_pct
        FROM staging.associate_commissions_raw
        WHERE source_associate_id IS NOT NULL
      ),
      details_latest AS (
        SELECT DISTINCT ON (source_associate_id)
          source_associate_id,
          associate_status,
          associate_status_id,
          associate_image_url,
          loaded_at
        FROM staging.associates_details_raw
        WHERE source_associate_id IS NOT NULL
        ORDER BY source_associate_id, loaded_at DESC NULLS LAST, id DESC
      ),
      mc_lookup AS (
        SELECT DISTINCT ON (source_market_center_id)
          source_market_center_id,
          name
        FROM staging.market_centers_raw
        WHERE source_market_center_id IS NOT NULL
        ORDER BY source_market_center_id, loaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        ar.source_associate_id,
        ar.first_name,
        ar.last_name,
        CONCAT_WS(' ', ar.first_name, ar.last_name) AS full_name,
        COALESCE(NULLIF(BTRIM(cd.email), ''), NULLIF(BTRIM(cd.private_email), ''), NULLIF(BTRIM(ar.ar_email), '')) AS email,
        CASE
          WHEN NULLIF(BTRIM(details.associate_status_id), '') = '1' THEN 'Active'
          WHEN NULLIF(BTRIM(details.associate_status_id), '') = '2' THEN 'Inactive'
          WHEN LOWER(NULLIF(BTRIM(details.associate_status), '')) = 'active' THEN 'Active'
          WHEN LOWER(NULLIF(BTRIM(details.associate_status), '')) = 'inactive' THEN 'Inactive'
          WHEN NULLIF(BTRIM(ar.status_name), '') = '1' THEN 'Active'
          WHEN NULLIF(BTRIM(ar.status_name), '') = '2' THEN 'Inactive'
          ELSE ar.status_name
        END AS status_name,
        COALESCE(NULLIF(BTRIM(ar.market_center_name), ''), NULLIF(BTRIM(mc.name), '')) AS market_center_name,
        ar.team_name,
        ar.kwuid,
        NULLIF(BTRIM(details.associate_image_url), '') AS image_url,
        NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(cd.mobile_number, ar.raw_payload->>'MobileNumber', '')), '\\s+', '', 'g'), '') AS mobile_number,
        NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(cd.office_number, ar.raw_payload->>'OfficeNumber', '')), '\\s+', '', 'g'), '') AS office_number,
        NULLIF(BTRIM(COALESCE(
          ar.raw_payload->>'NationalId',
          ar.raw_payload->>'NationalID',
          ar.raw_payload->>'national_id',
          ar.raw_payload->>'_ext_national_id',
          ''
        )), '') AS national_id,
        NULLIF(BTRIM(COALESCE(
          ar.raw_payload->>'FFCNumber',
          ar.raw_payload->>'ffc_number',
          ar.raw_payload->>'_ext_ffc_number',
          ''
        )), '') AS ffc_number,
        NULLIF(BTRIM(COALESCE(
          ar.raw_payload->>'KWSAEmail',
          ar.raw_payload->>'kwsa_email',
          ar.raw_payload->>'_ext_kwsa_email',
          ''
        )), '') AS kwsa_email,
        NULLIF(BTRIM(cd.private_email), '') AS private_email,
        NULLIF(BTRIM(COALESCE(
          ar.raw_payload->>'GrowthShareSponsor',
          ar.raw_payload->>'growth_share_sponsor',
          ar.raw_payload->>'_ext_growth_share_sponsor',
          ''
        )), '') AS growth_share_sponsor,
        NULLIF(BTRIM(COALESCE(
          ar.raw_payload->>'ProposedGrowthShareSponsor',
          ar.raw_payload->>'_ext_proposed_growth_share_sponsor',
          ''
        )), '') AS proposed_growth_share_sponsor,
        NULLIF(BTRIM(COALESCE(
          ar.raw_payload->>'TemporaryGrowthShareSponsor',
          ar.raw_payload->>'_ext_temporary_growth_share_sponsor',
          ''
        )), '') AS temporary_growth_share_sponsor,
        CASE WHEN NULLIF(BTRIM(COALESCE(dt.start_date, ar.raw_payload->>'StartDate', ar.raw_payload->>'_ext_start_date', '')), '') IS NOT NULL
             THEN NULLIF(BTRIM(COALESCE(dt.start_date, ar.raw_payload->>'StartDate', ar.raw_payload->>'_ext_start_date', '')), '')::date
             ELSE NULL END AS start_date,
        CASE WHEN NULLIF(BTRIM(COALESCE(dt.end_date, ar.raw_payload->>'EndDate', ar.raw_payload->>'_ext_end_date', '')), '') IS NOT NULL
             THEN NULLIF(BTRIM(COALESCE(dt.end_date, ar.raw_payload->>'EndDate', ar.raw_payload->>'_ext_end_date', '')), '')::date
             ELSE NULL END AS end_date,
        CASE WHEN NULLIF(BTRIM(COALESCE(dt.anniversary_date, ar.raw_payload->>'AnniversaryDate', ar.raw_payload->>'_ext_anniversary_date', '')), '') IS NOT NULL
             THEN NULLIF(BTRIM(COALESCE(dt.anniversary_date, ar.raw_payload->>'AnniversaryDate', ar.raw_payload->>'_ext_anniversary_date', '')), '')::date
             ELSE NULL END AS anniversary_date,
        CASE WHEN NULLIF(BTRIM(COALESCE(dt.cap_date, ar.raw_payload->>'CapDate', ar.raw_payload->>'_ext_cap_date', '')), '') IS NOT NULL
             THEN NULLIF(BTRIM(COALESCE(dt.cap_date, ar.raw_payload->>'CapDate', ar.raw_payload->>'_ext_cap_date', '')), '')::date
             ELSE NULL END AS cap_date,
        CASE WHEN NULLIF(BTRIM(COALESCE(cm.total_cap_amount, ar.raw_payload->>'TotalCapAmount', ar.raw_payload->>'TotalCap', ar.raw_payload->>'_ext_total_cap_amount', '')), '') IS NOT NULL
             THEN NULLIF(BTRIM(COALESCE(cm.total_cap_amount, ar.raw_payload->>'TotalCapAmount', ar.raw_payload->>'TotalCap', ar.raw_payload->>'_ext_total_cap_amount', '')), '')::numeric
             ELSE NULL END AS total_cap_amount,
        CASE WHEN NULLIF(BTRIM(cm.manual_cap), '') IS NOT NULL
             THEN (LOWER(BTRIM(cm.manual_cap)) IN ('true', 't', '1', 'yes', 'y'))
             WHEN NULLIF(BTRIM(ar.raw_payload->>'ManualCap'), '') IS NOT NULL
             THEN (LOWER(BTRIM(ar.raw_payload->>'ManualCap')) IN ('true', 't', '1', 'yes', 'y'))
             WHEN NULLIF(BTRIM(ar.raw_payload->>'_ext_manual_cap'), '') IS NOT NULL
             THEN (LOWER(BTRIM(ar.raw_payload->>'_ext_manual_cap')) IN ('true', 't', '1', 'yes', 'y'))
             ELSE NULL END AS manual_cap,
        CASE WHEN NULLIF(BTRIM(COALESCE(cm.commission_split_pct, ar.raw_payload->>'AgentSplit', ar.raw_payload->>'CommissionSplitPercentageToAgent', ar.raw_payload->>'_ext_agent_split', '')), '') IS NOT NULL
             THEN NULLIF(BTRIM(COALESCE(cm.commission_split_pct, ar.raw_payload->>'AgentSplit', ar.raw_payload->>'CommissionSplitPercentageToAgent', ar.raw_payload->>'_ext_agent_split', '')), '')::numeric
             ELSE NULL END AS agent_split,
        ar.last_updated AS last_seen_at,
        NOW() AS prepared_at
      FROM ar_latest ar
      LEFT JOIN cd_latest cd ON cd.source_associate_id = ar.source_associate_id
      LEFT JOIN bd_latest bd ON bd.source_associate_id = ar.source_associate_id
      LEFT JOIN dt_latest dt ON dt.source_associate_id = ar.source_associate_id
      LEFT JOIN cm_latest cm ON cm.source_associate_id = ar.source_associate_id
      LEFT JOIN details_latest details ON details.source_associate_id = ar.source_associate_id
      LEFT JOIN mc_lookup mc ON mc.source_market_center_id = bd.source_market_center_id
      ORDER BY ar.source_associate_id
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
    `, [transformBatchId]);

    if (transformBatchId) {
      console.log(`Associates transform scoped to batch_id=${transformBatchId}.`);
    } else {
      console.log('Associates transform ran without batch scope (no batch_id found).');
    }
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
