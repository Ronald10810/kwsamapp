/**
 * Listing Transfer Routes
 *
 * Provides a bulk-transfer workflow for Office Admins and Regional Admins:
 *   1. GET  /mc-agents/:mcSourceId          – active agents in a market centre + their primary-listing count
 *   2. GET  /agent-listings/:associateId    – active listings where the given agent is the PRIMARY agent
 *   3. POST /jobs                           – start an async transfer job
 *   4. GET  /jobs/:jobId                    – poll job progress
 *   5. GET  /history                        – completed transfer audit log
 *
 * Transfer flow per listing
 * ─────────────────────────
 *   a) Read original listing state (portal flags, refs)
 *   b) Set original listing status_name = 'Withdrawn' in DB
 *   c) Withdraw original from every live portal that has a stored reference ID
 *   d) Mark original listing permanently Inactive/Withdrawn (is_published = false)
 *   e) Generate a new listing number (KWL...)
 *   f) Duplicate the listing row as a NEW listing (blank portal refs, Active, is_published=true)
 *   g) Copy all sub-tables (property areas, features, images, contacts, etc.) to new listing
 *   h) Add to-agent as primary on the new listing
 *   i) Publish new listing to all portals that were enabled on the original
 *   j) Write one audit-log row
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=listingTransfer.d.ts.map