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

## Next steps

- Implement backend project scaffolding in `backend/`
- Implement frontend project scaffolding in `frontend/`
- Build domain services from existing legacy business rules
- Add tests for calculations and workflow logic
