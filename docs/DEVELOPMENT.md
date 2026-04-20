# Local Development Setup Guide

Complete guide to setting up kwsa-cloud-console for local development.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Setup](#project-setup)
3. [Database Setup](#database-setup)
4. [Environment Configuration](#environment-configuration)
5. [Running the Application](#running-the-application)
6. [Common Issues & Solutions](#common-issues--solutions)
7. [Development Workflow](#development-workflow)
8. [Testing](#testing)
9. [Debugging](#debugging)

---

## Prerequisites

Ensure you have the following installed on your development machine:

### Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | JavaScript runtime |
| npm | 9+ | Package manager |
| Git | Latest | Version control |
| Docker Desktop | Latest | Local PostgreSQL + Redis |
| PostgreSQL Client | Latest | Database management (psql) |
| Visual Studio Code | Latest | IDE (recommended) |

### Installation Instructions

#### Windows 10/11

1. **Node.js & npm**:
   - Download from https://nodejs.org/
   - Choose LTS version
   - Run installer, accept defaults
   - Verify: `node --version` and `npm --version`

2. **Docker Desktop**:
   - Download from https://www.docker.com/products/docker-desktop
   - Install and start Docker
   - Verify: `docker --version`

3. **PostgreSQL Client (psql)**:
   - Download PostgreSQL from https://www.postgresql.org/download/windows/
   - Install only "PostgreSQL Client" component (uncheck server, other tools)
   - Verify: `psql --version`

#### macOS

```bash
# Using Homebrew
brew install node@18 docker postgresql
brew install --cask docker

# Verify
node --version
npm --version
docker --version
psql --version
```

#### Linux (Ubuntu/Debian)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker
sudo apt-get install docker.io docker-compose

# Install PostgreSQL client
sudo apt-get install postgresql-client

# Verify
node --version && npm --version && docker --version && psql --version
```

---

## Project Setup

### 1. Clone the Repository

```bash
cd /path/to/workspace
git clone <repository-url> kwsa-cloud-console
cd kwsa-cloud-console
```

### 2. Install Dependencies

```bash
# Install root dependencies (workspace)
npm install

# Install backend dependencies
npm --prefix backend install

# Install frontend dependencies
npm --prefix frontend install

# Verify installation
npm list --depth=0
```

### 3. Verify Project Structure

```bash
# Check that directories exist
ls -la backend/src
ls -la backend/prisma
ls -la frontend/src
ls -la frontend/public
```

Expected output:
```
backend/src/
├── config/
├── middleware/
├── controllers/
├── services/
├── routes/
├── types/
├── utils/
└── index.ts

frontend/src/
├── components/
├── pages/
├── services/
├── hooks/
├── context/
├── types/
├── utils/
├── styles/
└── main.tsx
```

---

## Database Setup

### 1. Start Docker Compose

Start PostgreSQL and Redis containers:

```bash
# Navigate to project root
cd /path/to/kwsa-cloud-console

# Start containers in background
docker-compose up -d

# Verify containers are running
docker-compose ps

# Expected output:
# NAME                COMMAND                  SERVICE             STATUS              PORTS
# kwsa-postgres       docker-entrypoint.s...   postgres            Up 2 seconds        0.0.0.0:5432->5432/tcp
# kwsa-redis          redis-server *:*         redis               Up 2 seconds        0.0.0.0:6379->6379/tcp
```

### 2. Verify Database Connection

```bash
# Test PostgreSQL connection
psql -h localhost -U kwsa_user -d kwsa_db -c "SELECT version();"

# When prompted for password, enter: kwsa_password

# Expected output:
# password for user kwsa_user:
# PostgreSQL 15.x ...
```

### 3. Run Prisma Migrations

Initialize the database with the schema:

```bash
# Navigate to backend
cd backend

# Create/update database schema
npx prisma migrate dev --name initial_schema

# Prisma will:
# 1. Create schema from migrations/
# 2. Generate Prisma client
# 3. Seed database (if seed script exists)
```

### 4. Verify Database Schema

```bash
# Connect to database
psql -h localhost -U kwsa_user -d kwsa_db

# List all tables
\dt

# Expected output:
# Schema |                         Name
# --------+---------------------------------------------------------------------
# public | _prisma_migrations
# public | Account
# public | Associate
# public | AssociateBusinessDetail
# public | ...

# Exit
\q
```

### 5. Seed Sample Data (Optional)

Create `backend/prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed roles
  const roles = await Promise.all([
    prisma.role.upsert({
      where: { name: 'REGIONAL_ADMIN' },
      update: {},
      create: {
        name: 'REGIONAL_ADMIN',
        description: 'Full access to region'
      }
    }),
    prisma.role.upsert({
      where: { name: 'OFFICE_ADMIN' },
      update: {},
      create: {
        name: 'OFFICE_ADMIN',
        description: 'Full access to office'
      }
    }),
    prisma.role.upsert({
      where: { name: 'AGENT' },
      update: {},
      create: {
        name: 'AGENT',
        description: 'Limited access'
      }
    })
  ]);

  console.log(`Created ${roles.length} roles`);

  // Seed test user
  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      password: 'hashed_password_here',
      firstName: 'Test',
      lastName: 'User',
      isActive: true
    }
  });

  console.log(`Created test user: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Then run seed:

```bash
npx prisma db seed
```

---

## Environment Configuration

### 1. Backend Environment Variables

Create `backend/.env` from template:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```bash
# Database
DATABASE_URL=postgresql://kwsa_user:kwsa_password@localhost:5432/kwsa_db

# Node environment
NODE_ENV=development

# Server
PORT=3000
CORS_ORIGIN=http://localhost:5173

# JWT (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET=your_super_secret_jwt_key_here_min_32_chars
JWT_EXPIRY=7d

# Google Cloud (optional for local dev)
GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=kwsa-cloud-storage
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Redis (for caching)
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=debug

# Email (for local dev, use test credentials or disable)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Feature flags
ENABLE_P24_SYNC=false
ENABLE_KWW_SYNC=false
```

### 2. Frontend Environment Variables

Create `frontend/.env` from template:

```bash
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env`:

```bash
# API Configuration
VITE_API_URL=http://localhost:3000/api

# App Configuration
VITE_APP_NAME=KWSA Cloud Console
VITE_ENVIRONMENT=development
```

### 3. Generate JWT Secret

```bash
# Mac/Linux
openssl rand -hex 32

# Windows PowerShell
[Convert]::ToHexString((New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes(32))
```

Copy the output to `backend/.env` as `JWT_SECRET`.

---

## Running the Application

### Option 1: Run Backend & Frontend Separately (Recommended for Development)

**Terminal 1 - Backend**:
```bash
cd backend
npm run dev

# Output:
# > backend@1.0.0 dev
# > ts-node-dev --respawn src/index.ts
# [Thu Jan 11 2024] Worker restarted
# [server] listening on port 3000
# [health] GET /health endpoint ready
```

**Terminal 2 - Frontend**:
```bash
cd frontend
npm run dev

# Output:
# > frontend@1.0.0 dev
# > vite
#   VITE v4.5.2  dev server running at:
#   ➜  Local:   http://localhost:5173/
#   ➜  press h + enter to show help
```

### Option 2: Run Both with npm workspace command

```bash
# From project root
npm run dev

# This runs both backends and frontend concurrently
```

### Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **API Docs** (if Swagger added): http://localhost:3000/api/docs

---

## Common Issues & Solutions

### Issue 1: Port Already in Use (3000 or 5173)

**Error**: `EADDRINUSE: address already in use :::3000`

**Solution**:
```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Or use different port
PORT=3001 npm run dev  # Backend
```

### Issue 2: PostgreSQL Connection Failed

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Solution**:
```bash
# Check if Docker containers are running
docker-compose ps

# Start Docker if needed
docker-compose up -d

# Verify PostgreSQL is accessible
psql -h localhost -U kwsa_user -d kwsa_db -c "SELECT 1;"
```

### Issue 3: Prisma Client Generation Failed

**Error**: `Error: ENOENT: no such file or directory, open '.prisma/client'`

**Solution**:
```bash
cd backend
rm -rf node_modules/@prisma
npx prisma generate
```

### Issue 4: Database Schema Out of Sync

**Error**: `The database schema is not in sync with the Prisma schema`

**Solution**:
```bash
cd backend

# Option A: Create new migration (if schema.prisma changed)
npx prisma migrate dev --name describe_your_change

# Option B: Reset database (warning: deletes all data!)
npx prisma migrate reset

# Option C: Push schema to database (for local dev only)
npx prisma db push
```

### Issue 5: Frontend can't reach Backend API

**Error**: `CORS error: ...` or `Failed to fetch data`

**Solution**:
1. Verify backend is running on port 3000
2. Check `frontend/.env` has correct `VITE_API_URL`
3. Check `backend/.env` has correct `CORS_ORIGIN=http://localhost:5173`
4. Verify API endpoint exists: `curl http://localhost:3000/health`

### Issue 6: Hot Module Reload Not Working

**Solution**:
```bash
# Clear Vite cache
rm -rf frontend/.vite

# Restart frontend dev server
cd frontend
npm run dev
```

---

## Development Workflow

### Code Structure Best Practices

1. **Services Layer** (Business Logic):
   - `backend/src/services/listings/listing.service.ts`
   - `backend/src/services/transactions/transaction.service.ts`
   - All calculations happen here
   - Thoroughly tested

2. **Controllers Layer** (HTTP Handling):
   - `backend/src/controllers/listings.ts`
   - Calls services, passes data
   - No business logic here

3. **Routes Layer** (HTTP Routing):
   - `backend/src/routes/listings.ts`
   - Attaches routes to controllers

4. **Frontend Components**:
   - Pages under `frontend/src/pages/`
   - Reusable components under `frontend/src/components/`
   - API calls via `frontend/src/services/`

### Adding a New API Endpoint

1. **Create Service Method** (`backend/src/services/`):
```typescript
// backend/src/services/listings/listing.service.ts
export class ListingService {
  async getListingById(id: string): Promise<Listing> {
    return prisma.listing.findUnique({
      where: { id },
      include: { /* relations */ }
    });
  }
}
```

2. **Create Route Handler** (`backend/src/routes/`):
```typescript
// backend/src/routes/listings.ts
router.get('/:id', async (req, res, next) => {
  try {
    const listing = await listingService.getListingById(req.params.id);
    res.json(listing);
  } catch (error) {
    next(error);
  }
});
```

3. **Create Frontend API Client** (`frontend/src/services/`):
```typescript
// frontend/src/services/listings.ts
export const getListingById = async (id: string): Promise<Listing> => {
  const response = await api.get(`/listings/${id}`);
  return response.data;
};
```

4. **Create Frontend Hook** (`frontend/src/hooks/`):
```typescript
// frontend/src/hooks/useListingDetail.ts
export const useListingDetail = (id: string) => {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => getListingById(id)
  });
};
```

5. **Use in Component**:
```typescript
// frontend/src/pages/ListingDetail.tsx
export function ListingDetail() {
  const { id } = useParams();
  const { data: listing, isLoading } = useListingDetail(id!);

  if (isLoading) return <div>Loading...</div>;
  return <div>{listing.description.propertyTitle}</div>;
}
```

---

## Testing

### Running Tests

```bash
# Backend unit tests
cd backend
npm test

# Backend with coverage
npm run test:coverage

# Frontend component tests
cd frontend
npm test

# E2E tests (if configured)
npm run test:e2e
```

### Writing Unit Tests

**Example: LIstingService test**

```typescript
// backend/tests/unit/services/listing.service.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ListingService } from '../../../src/services/listings/listing.service';

describe('ListingService', () => {
  let service: ListingService;

  beforeAll(() => {
    service = new ListingService();
  });

  it('should fetch listing by ID', async () => {
    const listing = await service.getListingById('test-id');
    expect(listing).toBeDefined();
    expect(listing.id).toBe('test-id');
  });

  it('should calculate transfer duty correctly', () => {
    const duty = service.calculateTransferDuty(500000);
    expect(duty).toBe(10000); // 2% of 500k
  });
});
```

### Writing Component Tests

```typescript
// frontend/tests/components/ListingCard.test.tsx
import { render, screen } from '@testing-library/react';
import { ListingCard } from '../../src/components/features/listings/ListingCard';

describe('ListingCard', () => {
  it('should render listing title', () => {
    const listing = { id: '1', title: 'Test Property' };
    render(<ListingCard listing={listing} />);
    expect(screen.getByText('Test Property')).toBeInTheDocument();
  });
});
```

---

## Debugging

### Backend Debugging with VS Code

1. Install VS Code extension: **Debugger for Chrome** by Microsoft

2. Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Backend Debug",
      "program": "${workspaceFolder}/backend/src/index.ts",
      "restart": true,
      "runtimeArgs": ["--require", "ts-node/register"],
      "cwd": "${workspaceFolder}/backend"
    }
  ]
}
```

3. Set breakpoints in VS Code and press F5

### Frontend Debugging

**VS Code DevTools**:
1. Open http://localhost:5173 in browser
2. Press F12 to open DevTools
3. Set breakpoints in Sources tab
4. Reload page to debug

**React DevTools Extension**:
- Install "React Developer Tools" browser extension
- Inspect React component state in DevTools

### API Request Debugging

```bash
# Test API with curl
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/listings

# Pretty print response
curl -s http://localhost:3000/api/listings | jq '.'

# Use built-in API testing in VS Code (Thunder Client or REST Client extension)
```

### Database Debugging

```bash
# Connect to PostgreSQL console
psql -h localhost -U kwsa_user -d kwsa_db

# Run queries
SELECT * FROM "Listing" LIMIT 5;
SELECT * FROM "Associate" WHERE "marketCenterId" = 'market-center-id';

# Check Prisma logs
set log_statement = 'all';
```

### View Logs

```bash
# Backend logs (stdout)
# Already displayed in terminal where npm run dev was executed

# View Docker logs
docker-compose logs postgres    # PostgreSQL logs
docker-compose logs redis       # Redis logs
docker-compose logs --follow postgres  # Follow in real-time
```

---

## Tips for Efficient Development

1. **Use TypeScript Strict Mode**: Catches errors early
2. **Enable Prettier Auto-format**: Format code on save
3. **Use React DevTools**: Inspect component props and state
4. **Use Redux/Zustand DevTools**: Track state changes
5. **Use Network Tab**: Debug API calls
6. **Create git branches** for new features: `git checkout -b feature/my-feature`
7. **Write tests first** (TDD) for complex business logic
8. **Use ESLint** to catch common mistakes: `npm run lint`

---

## Next Steps

Once development environment is set up:

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand system design
2. Read [DATABASE.md](DATABASE.md) to understand data model
3. Read [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) to understand calculations
4. Start Phase 2: User Authentication implementation
5. Create feature branches and submit pull requests

---

## Getting Help

- Check existing issues in repository
- Review code examples in `backend/src/services/` and `frontend/src/components/`
- Consult TypeScript/React/Node.js documentation
- Reach out to team lead with specific questions

---

Happy coding! 🚀
