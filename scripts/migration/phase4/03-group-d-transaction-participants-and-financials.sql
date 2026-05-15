-- Phase 4 patch: Group D mappings for transaction participants and payment details.
-- Primary source is staging.transaction_agents_raw_source and
-- staging.transaction_associate_payment_details_raw.

-- ============================================================
-- 1) Transaction participants from authoritative raw source
-- ============================================================
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
  ct.id AS transaction_id,
  ca.id AS associate_id,
  tas.source_associate_id::text,
  COALESCE(NULLIF(BTRIM(tas.agent_type), ''), 'Agent') AS agent_role,
  COALESCE(tas.split_percentage, 0),
  COALESCE(tas.sort_order, 0),
  now(),
  now()
FROM staging.transaction_agents_raw_source tas
JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = tas.transaction_id::text
LEFT JOIN migration.core_associates ca
  ON ca.source_associate_id::text = tas.source_associate_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR tas.batch_id = current_setting('migration.batch', true)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM migration.transaction_agents existing
    WHERE existing.transaction_id = ct.id
      AND COALESCE(existing.source_associate_id, '') = COALESCE(tas.source_associate_id::text, '')
      AND COALESCE(LOWER(existing.agent_role), '') = COALESCE(LOWER(COALESCE(NULLIF(BTRIM(tas.agent_type), ''), 'Agent')), '')
      AND COALESCE(existing.split_percentage, 0) = COALESCE(tas.split_percentage, 0)
  );

-- Compatibility fallback from legacy mapped staging.transaction_agents
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
  ct.id AS transaction_id,
  ca.id AS associate_id,
  sta.source_associate_id,
  COALESCE(NULLIF(BTRIM(sta.agent_type), ''), 'Agent') AS agent_role,
  COALESCE(sta.split_percentage, 0),
  COALESCE(sta.sort_order, 0),
  now(),
  now()
FROM staging.transaction_agents sta
JOIN staging.transactions_raw str
  ON str.id = sta.transaction_id
JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = str.source_transaction_id::text
LEFT JOIN migration.core_associates ca
  ON ca.source_associate_id::text = sta.source_associate_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR str.batch_id = current_setting('migration.batch', true)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM migration.transaction_agents existing
    WHERE existing.transaction_id = ct.id
      AND existing.source_associate_id IS NOT DISTINCT FROM sta.source_associate_id
  );

INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
SELECT
  'transaction_agents_raw_source',
  tas.id::text,
  'Unresolved source transaction_id in transaction_agents_raw_source',
  COALESCE(
    tas.raw_payload,
    jsonb_build_object(
      'transaction_id', tas.transaction_id,
      'source_associate_id', tas.source_associate_id,
      'associate_name', tas.associate_name,
      'agent_type', tas.agent_type,
      'outside_agency', tas.outside_agency,
      'batch_id', tas.batch_id
    )
  )
FROM staging.transaction_agents_raw_source tas
LEFT JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = tas.transaction_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR tas.batch_id = current_setting('migration.batch', true)
  )
  AND ct.id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.load_rejections r
    WHERE r.entity_name = 'transaction_agents_raw_source'
      AND r.source_id = tas.id::text
      AND r.reason = 'Unresolved source transaction_id in transaction_agents_raw_source'
  );

-- ============================================================
-- 2) Financial/split details to transaction_agent_calculations
-- ============================================================
INSERT INTO migration.transaction_agent_calculations (
  transaction_id,
  transaction_agent_id,
  associate_id,
  agent_name,
  office_name,
  transaction_side,
  effective_reporting_date,
  is_registered,
  split_percentage,
  transaction_gci_before_fees,
  production_royalties,
  growth_share,
  total_pr_and_gs,
  gci_after_fees_excl_vat,
  associate_dollar,
  cap_remaining,
  team_dollar,
  market_center_dollar,
  is_outside_agent,
  created_at,
  updated_at
)
SELECT
  ct.id AS transaction_id,
  ta.id AS transaction_agent_id,
  ta.associate_id,
  COALESCE(ca.full_name, ta.source_associate_id, 'Unknown Agent') AS agent_name,
  mc.name AS office_name,
  COALESCE(NULLIF(BTRIM(ta.agent_role), ''), NULLIF(BTRIM(ct.sale_type), ''), 'Agent') AS transaction_side,
  COALESCE(ct.status_change_date::date, ct.transaction_date::date, ct.created_at::date) AS effective_reporting_date,
  CASE WHEN LOWER(BTRIM(COALESCE(ct.transaction_status, ''))) IN ('registered', 'paid') THEN true ELSE false END AS is_registered,
  tapd.split_percentage,
  tapd.gci_before_fees,
  tapd.production_royalties,
  tapd.growth_share,
  COALESCE(tapd.production_royalties, 0) + COALESCE(tapd.growth_share, 0) AS total_pr_and_gs,
  tapd.gci_after_fees_excl_vat,
  tapd.associate_dollar,
  tapd.cap_remaining,
  tapd.team_dollar,
  tapd.mc_dollar,
  false AS is_outside_agent,
  now(),
  now()
FROM staging.transaction_associate_payment_details_raw tapd
JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = tapd.source_transaction_id::text
LEFT JOIN LATERAL (
  SELECT ta_match.*
  FROM migration.transaction_agents ta_match
  WHERE ta_match.transaction_id = ct.id
    AND ta_match.source_associate_id::text = tapd.source_associate_id::text
  ORDER BY ta_match.id
  LIMIT 1
) ta ON true
LEFT JOIN migration.core_associates ca
  ON ca.id = ta.associate_id
LEFT JOIN migration.core_market_centers mc
  ON mc.id = ca.market_center_id
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR tapd.batch_id = current_setting('migration.batch', true)
  )
  AND ta.id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.transaction_agent_calculations existing
    WHERE existing.transaction_agent_id = ta.id
      AND existing.transaction_id = ct.id
      AND COALESCE(existing.split_percentage, 0) = COALESCE(tapd.split_percentage, 0)
      AND COALESCE(existing.transaction_gci_before_fees, 0) = COALESCE(tapd.gci_before_fees, 0)
  );

INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
SELECT
  'transaction_associate_payment_details_raw',
  tapd.id::text,
  'No matching transaction_agent for payment detail row',
  COALESCE(
    tapd.raw_payload,
    jsonb_build_object(
      'source_transaction_id', tapd.source_transaction_id,
      'source_associate_id', tapd.source_associate_id,
      'split_percentage', tapd.split_percentage,
      'batch_id', tapd.batch_id
    )
  )
FROM staging.transaction_associate_payment_details_raw tapd
JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = tapd.source_transaction_id::text
LEFT JOIN migration.transaction_agents ta
  ON ta.transaction_id = ct.id
 AND ta.source_associate_id::text = tapd.source_associate_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR tapd.batch_id = current_setting('migration.batch', true)
  )
  AND ta.id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.load_rejections r
    WHERE r.entity_name = 'transaction_associate_payment_details_raw'
      AND r.source_id = tapd.id::text
      AND r.reason = 'No matching transaction_agent for payment detail row'
  );
