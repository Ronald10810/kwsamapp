# ENVIRONMENT_DATABASE_MAPPING

Date: 2026-05-13
Status: Planning only; no environment variable changes applied.

## Current Mapping (Observed)

### Local development
- Backend env file: backend/.env
- DATABASE_URL target: host=localhost (masked), db=kwsa
- UAT_DATABASE_URL target: host=34.35***.173 (masked), db=kwsa_uat
- PUBLIC_DATABASE_URL target: host=34.35***.173 (masked), db=kwsa_uat
- ENFORCE_LOCAL_UAT_DB=false (local safety guard currently disabled)

### UAT
- Backend service: kwsa-backend-test (africa-south1)
- Cloud SQL attachment: kwsa-mapp:africa-south1:kwsa-postgres
- DATABASE_URL env source: Secret Manager secret kwsa-backend-test-db-url
- Exact DB name in secret value: NOT VERIFIED (no secret access in current operator context)

### Production
- Backend service: kwsa-backend-prod (africa-south1)
- Cloud SQL attachment: kwsa-mapp:africa-south1:kwsa-postgres
- DATABASE_URL env source: Secret Manager secret DATABASE_URL
- Exact DB name in secret value: NOT VERIFIED (no secret access in current operator context)

### Frontend targets
- frontend/.env.production -> VITE_API_BASE_URL points to kwsa-backend-prod service URL
- frontend/.env.staging -> VITE_API_BASE_URL points to kwsa-backend-test service URL
- frontend/.env and .env.local use local proxy target (localhost backend)

## Target Mapping (Required)
- Local development -> kwsa_uat
- UAT -> kwsa_uat
- Production -> kwsa_prod

## Environment Variables Involved (Masked)
- Backend:
  - DATABASE_URL=[MASKED]
  - UAT_DATABASE_URL=[MASKED]
  - PUBLIC_DATABASE_URL=[MASKED]
  - DB_CLIENT=postgres
  - GOOGLE_CLOUD_PROJECT=kwsa-mapp
  - GCS_BUCKET_NAME=[MASKED-NAME]
- Frontend:
  - VITE_API_BASE_URL=[MASKED-URL]
  - VITE_GOOGLE_CLIENT_ID=[MASKED]
  - VITE_GOOGLE_MAPS_API_KEY=[MASKED]

## Deployment / Cutover Steps (Planned)
1. Verify current secret values point to expected DB names (masked verification output only).
2. Back up all involved DBs.
3. Validate kwsa_uat after import.
4. Update UAT secret/env if needed to kwsa_uat.
5. Re-validate UAT app.
6. Update production secret/env to kwsa_prod only after explicit approval.
7. Validate production app and roll back immediately if checks fail.

## Rollback Steps (Planned)
1. Restore previous DATABASE_URL secret version for affected service.
2. Redeploy/restart service revision with previous secret version.
3. Validate health + smoke endpoints.
4. If data rollback required: restore Cloud SQL backup/snapshot.

## Open Verification Gaps
- Need explicit secret-value DB-name confirmation for:
  - DATABASE_URL
  - kwsa-backend-test-db-url
  - DATABASE_URL_UAT_CLOUDSQL (if used)
