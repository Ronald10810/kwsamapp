# Backend

## Vision

The backend will be an ASP.NET Core Web API that implements modern clean architecture with strong separation of concerns:

- `Api/`: public REST endpoints and API operation wiring
- `Application/`: business services, use cases, commands, queries, orchestration
- `Domain/`: entities, enums, value objects, domain rules, integration contracts
- `Infrastructure/`: PostgreSQL persistence, GCP storage, external HTTP integrations, identity

## Goals

- Preserve all legacy business rules and calculations in service code.
- Keep calculations and formulas isolated from UI.
- Make logic testable in unit tests.
- Support role-based access and tenant-aware listing/transaction filters.
- Keep state and integration workflows resilient and observable.

## Local-first dev

- Use Docker Compose for PostgreSQL.
- Use `fsouza/fake-gcs-server` as a local GCS emulator.
- Add runtime configuration for `ConnectionStrings:Default` and `Gcp:Storage:EmulatorUrl`.
