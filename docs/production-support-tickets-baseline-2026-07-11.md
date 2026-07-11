# Production Baseline: Support Tickets (2026-07-11)

This document captures the known-good production baseline after Support Tickets release hardening.

## Source Baseline

- Release branch: `release/uat-support-tickets-2026-07-11`
- Baseline tag: `uat-support-tickets-2026-07-11-rc11`
- Commit: `b8ff7f0705561d7417ab24a4b197fd2f0f5a416b`

## Live Cloud Run Baseline

### Backend (prod)

- Service: `kwsa-backend-prod`
- Region: `africa-south1`
- URL: `https://kwsa-backend-prod-hvz5ax66zq-bq.a.run.app`
- Serving revision: `kwsa-backend-prod-00251-gj2` (100%)
- Image digest: `sha256:4ebdea785a61fe92150a8911e49d4c9d4823449c1a9f82922931cf5f858a05a0`

### Frontend (prod)

- Service: `kwsa-frontend-prod`
- Region: `us-central1`
- URL: `https://kwsa-frontend-prod-hvz5ax66zq-uc.a.run.app`
- Live domain: `https://kwmapp.co.za`
- Serving revision: `kwsa-frontend-prod-00181-wcc` (100%)
- Image digest: `sha256:e693081847e28182e46b24a98a66f8aa45b583790dba1c690f88868513fd5696`

## Support Email Branding Baseline (prod)

- `SUPPORT_FROM_NAME=MAPP Support`
- `SUPPORT_EMAIL_ENABLED=true`
- `SUPPORT_EMAIL_LOGO_URL=https://storage.googleapis.com/kwsa-mapp-uploads/market-center-white-logos/market-center-white-logo-1783174878915-e0a344d1576d.png`

## Key Operational Guardrails Added

- Frontend deploy script writes deterministic `.env.production` values during publish.
- Frontend deploy no longer injects fragile `--set-build-env-vars` for Vite values.
- Backend deploy script forces traffic to latest revision after deploy to prevent stale pinned revisions.

## Quick Verify Commands

```powershell
gcloud run services describe kwsa-backend-prod --region africa-south1 --project kwsa-mapp --format="value(status.latestReadyRevisionName,status.traffic[0].revisionName,status.traffic[0].percent)"
gcloud run services describe kwsa-frontend-prod --region us-central1 --project kwsa-mapp --format="value(status.latestReadyRevisionName,status.traffic[0].revisionName,status.traffic[0].percent)"
```

## Rollback Commands

### Backend rollback (example to known revision)

```powershell
gcloud run services update-traffic kwsa-backend-prod --region africa-south1 --project kwsa-mapp --to-revisions kwsa-backend-prod-00251-gj2=100
```

### Frontend rollback (example to known revision)

```powershell
gcloud run services update-traffic kwsa-frontend-prod --region us-central1 --project kwsa-mapp --to-revisions kwsa-frontend-prod-00181-wcc=100
```

## Post-Rollback Smoke Checks

1. Load `https://kwmapp.co.za/login` and confirm Google sign-in button renders.
2. Open MC Admin Tools > Support Tickets and confirm no `Not found` banner.
3. Create a support ticket and confirm submitter + support mailbox notifications are sent.
4. Confirm email header shows the approved white KWSA logo.
