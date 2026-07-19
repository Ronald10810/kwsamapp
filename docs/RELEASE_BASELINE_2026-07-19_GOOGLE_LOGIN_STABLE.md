# Release Baseline 2026-07-19 - Google Login Stable

Status: LIVE and verified

## Purpose
This baseline locks the state that restored stable Google login and fixed API routing regressions.
Use this as a rollback anchor if future changes break login or parity.

## Production Revisions Locked
- Backend service: kwsa-backend-prod
- Backend revision: kwsa-backend-prod-00289-sbr
- Backend URL: https://kwsa-backend-prod-hvz5ax66zq-bq.a.run.app

- Frontend service: kwsa-frontend-prod
- Frontend revision: kwsa-frontend-prod-00220-5pg
- Frontend URL: https://kwsa-frontend-prod-hvz5ax66zq-uc.a.run.app
- Vanity URL: https://kwmapp.co.za

## Critical Frontend Build Inputs
- VITE_API_BASE_URL=https://kwsa-backend-prod-hvz5ax66zq-bq.a.run.app
- VITE_GOOGLE_CLIENT_ID=768625368107-oficd2i4fn505g3lf7dt6sjmlv77b109.apps.googleusercontent.com
- VITE_COMMUNICATIONS_CONSOLE_ENABLED=false
- VITE_PORTAL_RECOVERY_ENABLED=true
- VITE_TRAINING_HUB_ENABLED=true

## Verified Outcomes
- Production login page renders Google sign-in button.
- Production bundle contains prod backend API base URL.
- Production bundle contains Google client id.
- UAT login remains functional.

## Recovery Procedure
If a future release regresses login or routing:
1. Re-route Cloud Run frontend traffic to revision kwsa-frontend-prod-00220-5pg.
2. Re-route Cloud Run backend traffic to revision kwsa-backend-prod-00289-sbr.
3. Validate https://kwmapp.co.za/login in an incognito session.
4. Confirm auth calls resolve to backend and not frontend nginx /api path.

## Local/UAT Parity Notes
- Local parity file synced from UAT source:
  - frontend/src/pages/Login.tsx
- Deterministic frontend build input file:
  - frontend/env.production.generated

