export const transactionAgentCalculationDedupCte = `
tac_dedup AS (
  SELECT DISTINCT ON (transaction_agent_id)
    *
  FROM migration.transaction_agent_calculations
  ORDER BY transaction_agent_id, updated_at DESC, created_at DESC
)`;
export const salesOnlyTransactionExclusionSql = `
LOWER(TRIM(COALESCE(ct.transaction_category, 'sales'))) <> 'rentals'
AND LOWER(TRIM(COALESCE(ct.source_type, 'sales'))) <> 'rental_payment'
AND ct.source_rental_id IS NULL
AND ct.source_rental_payment_schedule_id IS NULL
AND COALESCE(ct.transaction_number, '') !~ '^RNTX[0-9]+$'`;
//# sourceMappingURL=reportingSql.js.map