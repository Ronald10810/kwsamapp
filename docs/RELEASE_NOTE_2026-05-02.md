# KWSA Cloud Console Release Note

Date: 2026-05-02
Environment: Live (Production)
Public URL: https://kwmapp.co.za

## Release Summary
This release pushed the current local development state to live for both frontend and backend.

The production site has been reviewed and confirmed working from user validation, and live endpoint checks are healthy.

## Running In Production Now
- Frontend service: kwsa-frontend-prod
- Frontend region: us-central1
- Active frontend revision: kwsa-frontend-prod-00019-62b
- Frontend deployed at: 2026-05-02 09:02:36 UTC
- Frontend deployed by: kwsamapp@gmail.com

- Backend service: kwsa-backend-prod
- Backend region: africa-south1
- Active backend revision: kwsa-backend-prod-00040-vs7
- Backend deployed at: 2026-05-02 09:09:04 UTC
- Backend deployed by: kwsamapp@gmail.com

## Live Health Verification
Checked at: 2026-05-02 09:16:14 UTC
- Backend health endpoint: 200 OK
- Live login page: 200 OK

## What Went Live (Functional Scope)
### UI and UX
- Fixed role-switch dropdown layering so it remains above Listings content and photos.
- Home page cleanup and updates:
  - Removed Native Reports section.
  - Added Quick Links section near top of Home.
  - Included links for KW Command, LOOM, Google Drive, Canva, and KWSA Email.
  - Updated LOOM link to https://portal.loom.co.za/.
  - Adjusted layout so links fit on one row in current desktop layout.

### Listings Behavior
- Agents can create listings.
- Add Listing pre-populates the logged-in Agent as the primary agent.
- Secondary agent selection tightened:
  - Only active agents are available.
  - Selection restricted to agents in the same market centre context.

### Roles and Permissions Hardening
- Enforced role/title/admin-market-centre governance in UI and backend.
- Regional Admin protection:
  - Only Regional Admin users can assign Regional Admin role.
- Market centre administration:
  - Office Admin users can manage office-level administration fields.
- Agent restrictions:
  - Agents cannot change titles, roles, or admin market centres.
- Backend sanitization added to prevent unauthorized updates even if attempted outside UI.

## FrontDoor Status
- Transactions page still shows a Feed to Frontdoor placeholder action.
- No active FrontDoor backend integration route is live yet.
- FrontDoor API contract details are still required before implementation.

## Release Execution Notes
- Frontend was first published via deploy-frontend-live.cmd (frontend Cloud Run target).
- Full release-live.cmd was then executed to include backend deployment.
- During full release, the frontend step was interrupted in terminal, but frontend was already on the latest intended live revision and remained healthy.
- Final state is valid and healthy for both services.

## Known Operational Note
- There are many large image files present in backend/uploads/listings in the current working tree.
- They were not part of this release note scope but should be reviewed for repository hygiene and deployment payload control.

## Post-Release Confidence
- User-side visual review: passed.
- Platform health checks: passed.
- Release status: successful and running.
