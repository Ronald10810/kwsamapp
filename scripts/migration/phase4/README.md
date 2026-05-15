# Phase 4 Patch Set (Approval 9 Scope)

These scripts are prepared for review only in Approval 9. They were not executed.

Execution order (when approved):

1. Run existing core transform
   - scripts/transform-staging-to-migration.sql
2. Apply listing description merge patch
   - scripts/migration/phase4/01-core-listings-description-merge.sql
3. Run existing enrichment baseline
   - scripts/enrich-migration-schema.sql
4. Apply Group C patch
   - scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql
5. Apply Group D patch
   - scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql
6. Run post-validation pack
   - scripts/migration/phase4/04-post-phase4-validation.sql

Guardrails:

- Target database: kwsa_import_staging only
- No writes to kwsa_uat, kwsa_prod, or kwsa
- No env var, secret, deploy, or asset migration actions
- No promotion to public app tables in this phase
