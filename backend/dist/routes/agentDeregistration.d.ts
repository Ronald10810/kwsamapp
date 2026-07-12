/**
 * Agent Deregistration Routes
 *
 * Provides the agent deregistration workflow for Office Admins and Regional Admins:
 *   1. GET  /mc-agents/:mcSourceId              – active agents with total listing counts (all roles)
 *   2. GET  /agent-all-listings/:associateId    – all active listings for an agent (any role)
 *   3. POST /withdraw-jobs                      – start async withdrawal of all agent listings
 *   4. GET  /withdraw-jobs/:jobId               – poll withdrawal job progress
 *   5. POST /deactivate                         – deactivate the agent (set status_name = 'Inactive')
 *
 * Withdrawal logic per listing:
 * ─────────────────────────────
 *   Primary agent role:
 *     a) Mark listing Withdrawn in DB (so portal endpoints see correct status)
 *     b) Withdraw from every portal that has a stored reference ID
 *     c) Mark listing permanently Inactive/Withdrawn (is_published = false)
 *
 *   Secondary / other agent role:
 *     a) DELETE the agent row from listing_agents only
 *     b) Listing itself remains active and unaffected
 *
 * Deactivation:
 *   - Sets status_name = 'Inactive' on core_associates
 *   - Removes agent from any remaining secondary listing_agents rows (safety cleanup)
 *   - Writes an audit log row to migration.agent_deregistration_log
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=agentDeregistration.d.ts.map