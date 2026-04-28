# Frontend

## Vision

The frontend will be a React + TypeScript application with a modern console experience:

- Clean dashboard and navigation
- Responsive layout for desktop and tablet
- Polished tables, filters, forms, and detail pages
- Clear status and action affordances for listings, transactions, and transfers
- Fast, local-first developer feedback loop

## Proposed technologies

- React + TypeScript
- Material UI or similar component library for consistent design
- React Router for page routing
- Axios or Fetch for API communication
- Formik or React Hook Form for form state and validation

## Goals

- Separate presentation from business logic.
- Surface meaningful summaries and action flows.
- Provide fast search, paging, and filtered index screens.
- Keep the new UX better than the legacy system.

## Environment variables

- `VITE_API_BASE_URL`: Browser runtime API base URL used for frontend requests to `/api/*` and `/uploads/*`.
	- Local development: leave empty to use same-origin paths with the Vite proxy.
	- Live testing deploy: set to the live backend URL, for example `https://kwsa-backend-test-xxxxx.a.run.app`.
- `VITE_API_PROXY_TARGET`: Local Vite dev server proxy target (defaults to `http://localhost:3000`).

## Local development

1. Copy `.env.example` to `.env.local`.
2. Keep `VITE_API_BASE_URL=` empty.
3. Set `VITE_API_PROXY_TARGET=http://localhost:3000` (or your local backend URL).
4. Run `npm.cmd run dev`.

## Live testing deployment (Cloud Run image deploy)

Use this when you need a fast, shareable URL for multiple testers.

```powershell
cd c:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console\frontend

$IMAGE="africa-south1-docker.pkg.dev/kwsa-mapp/cloud-run-source-deploy/kwsa-frontend-test:live-20260423-1"

docker build \
  --build-arg VITE_API_BASE_URL=https://kwsa-backend-test-hvz5ax66zq-bq.a.run.app \
  --build-arg VITE_GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com \
  -t $IMAGE .

# If docker-credential-gcloud is unavailable, use a temporary Docker config for login/push.
$env:DOCKER_CONFIG = Join-Path (Get-Location) ".docker-temp"
New-Item -ItemType Directory -Force -Path $env:DOCKER_CONFIG | Out-Null
'{}' | Set-Content -Path (Join-Path $env:DOCKER_CONFIG "config.json") -Encoding ascii
$token = & "C:\Users\ronal\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" auth print-access-token
$token | docker login -u oauth2accesstoken --password-stdin https://africa-south1-docker.pkg.dev
docker push $IMAGE

& "C:\Users\ronal\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy kwsa-frontend-test `
  --image $IMAGE `
  --region africa-south1 `
  --allow-unauthenticated `
  --port 8080
```
