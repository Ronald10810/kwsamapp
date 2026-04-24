# Backend Cloud Run Prep

## Current deployment posture

- The backend is ready to run on Cloud Run as a stateless API.
- The server listens on `process.env.PORT` and now binds to `0.0.0.0` explicitly.
- Database configuration is environment-based and centralized.
- Local file uploads are disabled automatically when `STORAGE_BACKEND=gcs`.

## Required non-sensitive variables

- `NODE_ENV=production`
- `PORT=8080` (Cloud Run sets this automatically)
- `LOG_LEVEL=info`
- `CORS_ORIGIN=https://your-frontend-origin.example.com`
- `TRUST_PROXY=true`
- `DB_CLIENT=postgres`
- `STORAGE_BACKEND=local` for temporary testing, or `gcs` when managed object storage is ready
- `UPLOADS_DIR=/tmp/uploads` only if you intentionally allow ephemeral local uploads in Cloud Run
- `GOOGLE_CLOUD_PROJECT=your-project-id`
- `GCS_BUCKET_NAME=your-bucket-name` once managed uploads are implemented

## Required secrets

- `DATABASE_URL`
- `DB_PASSWORD` only if you choose discrete DB variables instead of `DATABASE_URL`

## Known Cloud Run limitations

- The current backend uses PostgreSQL drivers and PostgreSQL-specific SQL.
- Setting `DB_CLIENT=sqlserver` is reserved for future work and will intentionally fail fast today.
- `STORAGE_BACKEND=gcs` disables local upload endpoints until GCS-backed upload persistence is implemented.
- If you keep `STORAGE_BACKEND=local` in Cloud Run, uploaded files will be ephemeral and can disappear on instance restart.

## One-command deployment (Windows PowerShell)

From `kwsa-cloud-console`, run:

```powershell
.\scripts\deploy-backend-cloudrun.ps1
```

The script will:

- Verify an active `gcloud` login.
- Set the target project.
- Sync `backend/package-lock.json` to avoid Cloud Build `npm ci` lock mismatch failures.
- Ensure the Cloud Run runtime service account can access the `DATABASE_URL` secret.
- Deploy the backend from source to Cloud Run.
- Print the final service URL and health URL.

Optional overrides example:

```powershell
.\scripts\deploy-backend-cloudrun.ps1 `
	-ProjectId "kwsa-mapp" `
	-Region "africa-south1" `
	-ServiceName "kwsa-backend-test" `
	-CloudSqlConnectionName "kwsa-mapp:africa-south1:kwsa-postgres" `
	-DatabaseUrlSecretName "DATABASE_URL" `
	-CorsOrigin "https://your-frontend.example.com" `
	-StorageBackend "gcs"
```

If you already regenerated the lockfile and want to skip that step:

```powershell
.\scripts\deploy-backend-cloudrun.ps1 -SkipLockfileSync
```

## One-command production deployment (Windows PowerShell)

From `kwsa-cloud-console`, run:

```powershell
.\scripts\deploy-backend-cloudrun-prod.ps1 -CorsOrigin "https://your-frontend.example.com"
```

Production script behavior:

- Requires `-CorsOrigin` and blocks localhost origins.
- Uses stricter defaults: `LOG_LEVEL=warning`, `STORAGE_BACKEND=gcs`, `NODE_ENV=production`.
- Defaults to private Cloud Run access (`--no-allow-unauthenticated`).
- You can opt-in to public access with `-AllowUnauthenticated`.

Example with explicit options:

```powershell
.\scripts\deploy-backend-cloudrun-prod.ps1 `
	-ProjectId "kwsa-mapp" `
	-Region "africa-south1" `
	-ServiceName "kwsa-backend-prod" `
	-CloudSqlConnectionName "kwsa-mapp:africa-south1:kwsa-postgres" `
	-DatabaseUrlSecretName "DATABASE_URL" `
	-CorsOrigin "https://app.example.com" `
	-AllowUnauthenticated
```
