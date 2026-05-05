# kwsa-cloud-console

This folder is the new modern rewrite of the legacy `current-system` platform.

## Purpose

- Preserve legacy business logic, formulas, calculations, and workflows.
- Replace legacy Azure-specific infrastructure with GCP native patterns.
- Deliver a premium modern internal operations console.
- Enable localhost-first development with a clear path to Cloud Run + Cloud Storage.

## Architecture Overview

- `backend/`: ASP.NET Core Web API, clean architecture, business services, PostgreSQL, GCP deployment.
- `frontend/`: React + TypeScript UI with modern dashboards, tables, responsive forms, and polished navigation.
- `docs/`: architecture and migration design documentation.
- `docker-compose.yml`: local PostgreSQL + local Google Cloud Storage emulator.

## Local development

1. Start infrastructure:
   - `docker compose up -d`
2. Backend and frontend projects will be developed in their respective folders.
3. The API will target PostgreSQL, and file uploads will target a local GCS emulator.

## Test To Live Publishing

- Hosted test frontend: Cloud Run service `kwsa-frontend-test`
- Live frontend: Cloud Run service `kwsa-frontend-prod` in `us-central1` for `https://kwmapp.co.za`
- Workflow guide: `docs/TEST_TO_LIVE_WORKFLOW.md`

Useful commands:

- `npm run deploy:test:frontend`
- `npm run deploy:live:frontend`
- `npm run release:live`

On Windows PowerShell use `npm.cmd` instead of `npm`, or run `deploy-frontend-test.cmd` and `deploy-frontend-live.cmd` from the repo root.

## Next steps

- Implement backend project scaffolding in `backend/`
- Implement frontend project scaffolding in `frontend/`
- Build domain services from existing legacy business rules
- Add tests for calculations and workflow logic
