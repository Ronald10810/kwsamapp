# Test To Live Workflow

This repository now has two explicit frontend release targets:

- Test frontend: Cloud Run service `kwsa-frontend-test`
- Live frontend: Cloud Run service `kwsa-frontend-prod` in `us-central1`

The backend remains on Cloud Run.

## What each target means

### Test

- Source of truth: your current local code
- Deploy target: `kwsa-frontend-test` on Cloud Run
- Purpose: verify the exact local frontend on a hosted test URL before a live push

### Live

- Source of truth: the same local code you already validated on test
- Deploy target: Cloud Run service `kwsa-frontend-prod` in `us-central1`
- Public URL: `https://kwmapp.co.za`
- Domain mapping: `kwmapp.co.za` points to `kwsa-frontend-prod`
- Backend target: `https://kwsa-backend-prod-768625368107.africa-south1.run.app`

## One command releases

Run these from the repo root.

If you are using Windows PowerShell, prefer `npm.cmd` instead of `npm`, or use the checked-in `.cmd` launcher files below.

### Full local to live release (recommended)

This is the safest command for production pushes. It deploys backend first, waits for a new healthy backend revision, deploys live frontend, waits for a new frontend revision, and checks the live login URL.

```powershell
.\release-live.cmd
```

or

```powershell
npm.cmd run release:live
```

### Frontend to test

```powershell
.\deploy-frontend-test.cmd
```

Alternative:

```powershell
.\scripts\publish-kwmapp-local.ps1 -SkipBackup -SkipBackend -FrontendReleaseTarget Test -UseCloudBuildForFrontend
```

If you want to use the npm script from PowerShell:

```powershell
npm.cmd run deploy:test:frontend
```

### Frontend to live

```powershell
.\deploy-frontend-live.cmd
```

Alternative:

```powershell
.\scripts\publish-kwmapp-local.ps1 -SkipBackup -SkipBackend -FrontendReleaseTarget Live -UseCloudBuildForFrontend
```

If you want to use the npm script from PowerShell:

```powershell
npm.cmd run deploy:live:frontend
```

## Recommended release flow

1. Work locally.
2. Publish frontend to the hosted test site.
3. Validate the test URL.
4. Run `.\release-live.cmd`.
5. Hard refresh `https://kwmapp.co.za` and verify the smoke checks.

## What release-live checks for you

1. Captures current backend and frontend revisions.
2. Deploys backend production with required env values.
3. Waits for a new ready backend revision.
4. Verifies backend health endpoint.
5. Deploys live frontend against the production backend URL.
6. Waits for a new ready frontend revision.
7. Verifies the live login page responds.

## Smoke checks after every live push

1. Login page loads correctly.
2. Listings page loads.
3. P24 links use the local pattern.
4. Private Property links use the local pattern.
5. KWW links use the local pattern.

## Why this is safer

- Test and live are now separate targets.
- The release command tells you which target it is deploying.
- Live frontend publishing targets the actual Cloud Run service behind `kwmapp.co.za`.
- Test frontend stays isolated in `africa-south1` while live stays on `us-central1`.

## Crossover path later

Before crossover, the backend can remain on its current Cloud Run service while the frontend is promoted from test to live.

At crossover time, harden this further with CI so deployments come from a pipeline instead of an interactive shell.