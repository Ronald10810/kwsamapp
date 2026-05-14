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
- [ ] Pre-import backup complete
- [ ] Schema comparison complete
- [ ] Azure export/import plan complete
- [ ] kwsa_uat created or confirmed for final cutover baseline
- [ ] kwsa_prod created or confirmed
- [x] MAPP 2.0 custom tables identified (initial)
- [x] MAPP 2.0 custom fields identified (initial)
- [ ] Azure to PostgreSQL mapping approved

## Import and Validation
- [ ] kwsa_uat import complete
- [ ] kwsa_uat validated
- [ ] kwsa_prod prepared
- [ ] kwsa_prod validated

## Environment Mapping
- [ ] Local points to kwsa_uat
- [!] UAT points to kwsa_uat (requires secret-value verification)
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
- [ ] Approval 2: Backups/snapshots/schema exports may be created
- [ ] Approval 3: kwsa_uat and kwsa_prod may be created/prepared
- [ ] Approval 4: Latest Azure import may run into staging or kwsa_uat
- [ ] Approval 5: Validation fixes may be applied
- [ ] Approval 6: kwsa_prod may be prepared from validated kwsa_uat
- [ ] Approval 7: Asset migration dry-run may run
- [ ] Approval 8: Asset migration batch run 1 may run
- [ ] Approval 9: Local and UAT may be pointed to kwsa_uat
- [ ] Approval 10: Production may be pointed to kwsa_prod
