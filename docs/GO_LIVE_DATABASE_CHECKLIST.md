# GO_LIVE_DATABASE_CHECKLIST

Date: 2026-05-13

Legend:
- [x] verified
- [ ] pending
- [!] blocked/needs explicit verification

## Pre-flight
- [ ] Prod upload completed
- [ ] Full Git backup completed
- [x] Current branch confirmed
- [x] Current commit hash confirmed
- [ ] Working tree clean
- [x] Current app tested (local frontend + backend health)

## Planning and Analysis
- [x] Inspection documents complete
- [x] Pre-import backup complete (2026-05-14 run-004; Cloud SQL on-demand backup + schema/metadata exports)
- [x] Schema comparison complete (Approval 11 planning; source vs kwsa_uat drift documented)
- [ ] Azure export/import plan complete
- [x] kwsa_uat created or confirmed for final cutover baseline
- [x] kwsa_prod created or confirmed (2026-05-14, empty, no data imported)
- [x] MAPP 2.0 custom tables identified (initial)
- [x] MAPP 2.0 custom fields identified (initial)
- [ ] Azure to PostgreSQL mapping approved

## Import and Validation
- [x] Stage 1 import to kwsa_import_staging complete (Approval 7, 5,238,234 rows)
- [x] Phase 4 mapping design and review complete (Approval 8, design only)
- [x] Phase 4 execution and validation complete (Approval 10, run-010)
- [ ] kwsa_uat import complete
- [ ] kwsa_uat validated
- [ ] kwsa_prod prepared
- [ ] kwsa_prod validated

## Environment Mapping
- [ ] Local points to kwsa_uat
- [x] UAT points to kwsa_uat (verified in Approval 11; masked secret inspection)
- [x] Public API points to kwsa_uat (verified in Approval 11; masked secret inspection)
- [x] Production points to kwsa_uat (verified in Approval 11; masked secret inspection)
- [ ] Production prepared to point to kwsa_prod

## Asset Migration
- [ ] Asset migration dry-run complete
- [ ] Asset migration run 1 complete
- [ ] Asset migration validation complete

## Functional Validation
- [ ] App still works with current URL logic
- [ ] UI tested in local
- [ ] UI tested in UAT
- [ ] UI tested in prod after approval
- [ ] Rollback plan confirmed

## Post-import Test Matrix
- [ ] Login
- [ ] Dashboard
- [ ] Market Centres
- [ ] Associates
- [ ] Agent profiles/photos
- [ ] Listings
- [ ] Listing search
- [ ] Listing detail page
- [ ] Listing images
- [ ] Listing documents
- [ ] Listing publish/edit/view flows
- [ ] Transactions
- [ ] Reports
- [ ] Rentals module
- [ ] Permissions/roles
- [ ] Profile switching
- [ ] Admin tools
- [ ] Public listing/API endpoints
- [ ] Image loading
- [ ] Document loading

## Approval Gates
- [x] Approval 1: Inspection docs complete
- [x] Approval 2: Backups/snapshots/schema exports completed (2026-05-14, hash 7661164)
- [x] Approval 3: kwsa_uat and kwsa_prod created (2026-05-14, hash 54ae20e)
- [x] Approval 4: Pre-import baseline backup/export complete (2026-05-14, backup ID 1778765132025, hash 05eb56e)
- [x] Approval 5: Azure import mapping & dry-run plan complete (2026-05-14, docs/migration-runs/2026-05-14-run-005/)
- [x] Approval 6: kwsa_import_staging created; three-stage flow documented (2026-05-14, hash 26b0ae9)
- [x] Approval 7: Stage 1 import to kwsa_import_staging complete (2026-05-15, run-007)
- [x] Approval 8: Phase 4 mapping design and review complete (2026-05-15, run-008; no execution)
- [x] Approval 9: Execute Phase 4 transforms in kwsa_import_staging only, then validate
- [x] Approval 10: Phase 4 validation complete in kwsa_import_staging (run-010)
- [x] Approval 11: Phase 5 promotion planning and safety review only (run-011)
- [ ] Approval 12: Phase 5 pre-execution safety gate (maintenance window + mapped upsert plan signoff)

## Current Blocker
- [!] Do not promote to kwsa_uat immediately while production is pointed to kwsa_uat unless an explicit maintenance window and rollback owner are approved.
