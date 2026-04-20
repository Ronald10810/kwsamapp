# Migration Guide

## From Legacy System

The legacy system (`current-system`) contains the source of truth for business logic. Key preservation areas:

### Must Preserve Exactly
- All financial calculations (GCI, commissions, splits)
- Transaction status workflows
- Associate transfer logic
- P24/KWW integration data mappings
- Lightstone validation rules

### Modernize Freely
- UI/UX design and interactions
- Database schema (EF → PostgreSQL)
- API design (RESTful)
- Infrastructure (Azure → GCP)
- Code organization and patterns

## Migration Phases

1. **Foundation**: Database schema, core entities
2. **Services**: Business logic implementation
3. **APIs**: REST endpoints
4. **Frontend**: React components
5. **Integration**: P24, KWW, Lightstone
6. **Testing**: Comprehensive test coverage
7. **Deployment**: GCP setup