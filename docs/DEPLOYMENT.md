# Deployment Guide - Google Cloud Platform

Complete guide for deploying kwsa-cloud-console to Google Cloud Platform (GCP).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [GCP Project Setup](#gcp-project-setup)
3. [Database Setup (Cloud SQL)](#database-setup-cloud-sql)
4. [Storage Setup (Cloud Storage)](#storage-setup-cloud-storage)
5. [Deploy Backend (Cloud Run)](#deploy-backend-cloud-run)
6. [Deploy Frontend (Firebase Hosting)](#deploy-frontend-firebase-hosting)
7. [Domain & SSL](#domain--ssl)
8. [Monitoring & Logging](#monitoring--logging)
9. [Backup & Disaster Recovery](#backup--disaster-recovery)
10. [Post-Deployment Checklist](#post-deployment-checklist)

---

## Prerequisites

### Required Tools

```bash
# Install Google Cloud SDK
# Download from: https://cloud.google.com/sdk/docs/install

# Verify installation
gcloud --version
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Required GCP APIs

Enable these APIs in GCP Console:
- Cloud Run API
- Cloud SQL Admin API
- Cloud Storage API
- Cloud Build API
- Artifact Registry API
- Firebase Hosting API
- Cloud Logging API
- Cloud Monitoring API

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firebase.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

### Permissions Required

Your GCP user account needs these roles:
- `roles/editor` or specific roles:
  - `roles/cloudsql.admin`
  - `roles/run.admin`
  - `roles/storage.admin`
  - `roles/firebase.admin`
  - `roles/iam.securityAdmin`

---

## GCP Project Setup

### 1. Create GCP Project

```bash
# Create new project
gcloud projects create kwsa-cloud-prod \
  --name="KWSA Cloud Console" \
  --set-as-default

# Get project ID
gcloud config get-value project
# Output: kwsa-cloud-prod
```

### 2. Set Up Billing

```bash
# Link billing account to project
gcloud billing projects link kwsa-cloud-prod \
  --billing-account=BILLING_ACCOUNT_ID

# Verify billing enabled
gcloud billing projects describe kwsa-cloud-prod
```

### 3. Create Service Account for Application

```bash
# Create service account
gcloud iam service-accounts create kwsa-app-service \
  --display-name="KWSA Cloud Console Application"

# Get service account email
gcloud iam service-accounts list | grep kwsa-app-service
# Output: kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com

# Grant Cloud SQL Client role
gcloud projects add-iam-policy-binding kwsa-cloud-prod \
  --member="serviceAccount:kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Grant Cloud Storage Admin role
gcloud projects add-iam-policy-binding kwsa-cloud-prod \
  --member="serviceAccount:kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

# Grant Secret Manager Secret Accessor role
gcloud projects add-iam-policy-binding kwsa-cloud-prod \
  --member="serviceAccount:kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Create and download key
gcloud iam service-accounts keys create ~/.config/gcloud/kwsa-key.json \
  --iam-account=kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com
```

### 4. Set Up Secret Manager

Store sensitive environment variables securely:

```bash
# Create secrets
echo -n "your_jwt_secret_here" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "your_db_password_here" | gcloud secrets create DB_PASSWORD --data-file=-
echo -n "your_auth_key_here" | gcloud secrets create AUTH_KEY --data-file=-

# List secrets
gcloud secrets list

# Grant access to service account
gcloud secrets add-iam-policy-binding JWT_SECRET \
  --member="serviceAccount:kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## Database Setup (Cloud SQL)

### 1. Create Cloud SQL Instance

```bash
# Create PostgreSQL instance
gcloud sql instances create kwsa-db-prod \
  --database-version=POSTGRES_15 \
  --tier=db-g1-small \
  --region=us-central1 \
  --storage-type=PD_SSD \
  --storage-size=20GB \
  --allocated-ip-range-name=cloudsql-range \
  --backup \
  --backup-start-time=02:00 \
  --enable-bin-log \
  --database-flags=cloudsql_iam_authentication=on

# Get instance IP address
gcloud sql instances describe kwsa-db-prod --format='value(ipAddresses[0].ipAddress)'
```

### 2. Create Database & User

```bash
# Connect to instance
gcloud sql connect kwsa-db-prod --user=postgres

# In PostgreSQL console:
psql> CREATE DATABASE kwsa_db;
psql> CREATE USER kwsa_user WITH PASSWORD 'secure_password_here';
psql> GRANT ALL PRIVILEGES ON DATABASE kwsa_db TO kwsa_user;
psql> ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO kwsa_user;
psql> \q

# Verify connection from local
psql -h INSTANCE_IP -U kwsa_user -d kwsa_db -c "SELECT version();"
```

### 3. Create Cloud SQL Auth Proxy

For secure connection from Cloud Run:

```bash
# Install Cloud SQL Auth Proxy
# Download from: https://cloud.google.com/sql/docs/postgres/sql-proxy

# Or use Cloud Run connection string instead (built-in support)
```

### 4. Run Database Migrations

```bash
# Set connection string
export DATABASE_URL="postgresql://kwsa_user:password@INSTANCE_IP:5432/kwsa_db"

# Run migrations
cd backend
npx prisma migrate deploy

# Seed database (optional)
npx prisma db seed
```

### 5. Configure Backups

```bash
# Automatic backups (daily at 2 AM UTC)
gcloud sql backups create \
  --instance=kwsa-db-prod \
  --description="Manual backup before deployment"

# List backups
gcloud sql backups list --instance=kwsa-db-prod
```

---

## Storage Setup (Cloud Storage)

### 1. Create Storage Bucket

```bash
# Create bucket
gsutil mb -c STANDARD -l us-central1 gs://kwsa-cloud-storage

# Enable versioning (optional)
gsutil versioning set on gs://kwsa-cloud-storage

# Set lifecycle policy (auto-delete temp files after 30 days)
cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 30, "matchesPrefix": ["temp/"]}
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 90, "matchesPrefix": ["reports/"]}
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://kwsa-cloud-storage
```

### 2. Configure CORS

```bash
# Create CORS configuration
cat > cors.json << EOF
[
  {
    "origin": ["https://kwsa-cloud.io", "https://www.kwsa-cloud.io"],
    "method": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "responseHeader": ["Content-Type", "Accept"],
    "maxAgeSeconds": 3600
  }
]
EOF

gsutil cors set cors.json gs://kwsa-cloud-storage
```

### 3. Configure Access Control

```bash
# Make bucket private by default
gsutil uniformbucketlevelaccess set on gs://kwsa-cloud-storage

# Grant service account bucket admin
gsutil iam ch serviceAccount:kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com:objectAdmin \
  gs://kwsa-cloud-storage
```

---

## Deploy Backend (Cloud Run)

### 1. Build Docker Image

```bash
# Navigate to backend
cd backend

# Build image
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/kwsa-cloud-prod/kwsa-backend/api:latest

# Or build locally and push
docker build -t us-central1-docker.pkg.dev/kwsa-cloud-prod/kwsa-backend/api:latest .
docker push us-central1-docker.pkg.dev/kwsa-cloud-prod/kwsa-backend/api:latest
```

### 2. Deploy to Cloud Run

```bash
# Deploy
gcloud run deploy kwsa-api \
  --image us-central1-docker.pkg.dev/kwsa-cloud-prod/kwsa-backend/api:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=production \
  --set-env-vars=GCS_PROJECT_ID=kwsa-cloud-prod \
  --set-env-vars=GCS_BUCKET_NAME=kwsa-cloud-storage \
  --set-env-vars=JWT_EXPIRY=7d \
  --service-account=kwsa-app-service@kwsa-cloud-prod.iam.gserviceaccount.com \
  --add-cloudsql-instances=kwsa-cloud-prod:us-central1:kwsa-db-prod \
  --memory=1Gi \
  --cpu=1 \
  --timeout=3600

# Get service URL
gcloud run services describe kwsa-api --region us-central1 --format='value(status.url)'
```

### 3. Set Environment Variables via Secret Manager

```bash
# Update Cloud Run service with secret references
gcloud run services update kwsa-api \
  --region us-central1 \
  --set-env-vars=JWT_SECRET=projects/kwsa-cloud-prod/secrets/JWT_SECRET/versions/latest \
  --set-env-vars=DATABASE_URL=projects/kwsa-cloud-prod/secrets/DATABASE_URL/versions/latest
```

### 4. Configure Cloud Run Settings

```bash
# Increase max instances for auto-scaling
gcloud run services update kwsa-api \
  --region us-central1 \
  --max-instances=100 \
  --min-instances=1

# Set concurrency
gcloud run services update kwsa-api \
  --region us-central1 \
  --concurrency=80
```

### 5. Setup CI/CD with Cloud Build

Create `cloudbuild.yaml` in repository root:

```yaml
steps:
  # Build Docker image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:$SHORT_SHA'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:latest'
      - './backend'

  # Push to Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:$SHORT_SHA']

  # Deploy to Cloud Run
  - name: 'gcr.io/cloud-builders/gke-deploy'
    args:
      - 'run'
      - '-f'
      - 'backend/'
      - '-i'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:$SHORT_SHA'
      - '-l'
      - 'kwsa-api'
      - '-o'
      - '/workspace/output'

  # Deploy using gcloud
  - name: 'gcr.io/cloud-builders/gcloud'
    args:
      - 'run'
      - 'deploy'
      - 'kwsa-api'
      - '--image'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:$SHORT_SHA'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'

images:
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:$SHORT_SHA'
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/kwsa-backend/api:latest'
```

---

## Deploy Frontend (Firebase Hosting)

### 1. Initialize Firebase

```bash
# Install Firebase tools
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize project
cd frontend
firebase init hosting --project=kwsa-cloud-prod
```

### 2. Build Frontend

```bash
# Build optimized production bundle
npm run build

# Verify build output
ls -la dist/
```

### 3. Deploy to Firebase

```bash
# Deploy
firebase deploy --project=kwsa-cloud-prod

# Get hosting URL
firebase hosting:channel:list --project=kwsa-cloud-prod
```

### 4. Configure Redirects

Create `firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.{js,css}",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=31536000, immutable"
          }
        ]
      }
    ]
  }
}
```

### 5. Setup CI/CD for Frontend

Add to `cloudbuild.yaml`:

```yaml
  # Build frontend
  - name: 'gcr.io/cloud-builders/npm'
    args: ['install']
    dir: 'frontend'

  - name: 'gcr.io/cloud-builders/npm'
    args: ['run', 'build']
    dir: 'frontend'

  # Deploy to Firebase
  - name: 'gcr.io/cloud-builders/firebase'
    args:
      - 'deploy'
      - '--project=kwsa-cloud-prod'
      - '--only=hosting'
```

---

## Domain & SSL

### 1. Configure Custom Domain

```bash
# Add domain to Firebase Hosting
firebase hosting:channel:deploy prod --project=kwsa-cloud-prod

# In GCP Console:
# 1. Navigate to Cloud Run > kwsa-api > Manage Custom Domains
# 2. Add custom domain (api.kwsa-cloud.io)
# 3. Update DNS records
```

### 2. Set Up DNS

Update DNS records in your registrar:

**For Firebase Hosting**:
```
Type: A
Host: www
Value: 199.36.158.100

Type: AAAA
Host: www
Value: 2607:f8b0:4004:809::2004
```

**For Cloud Run**:
```
Type: CNAME
Host: api
Value: kwsa-api.run.app
```

### 3. Enable HTTPS & SSL

```bash
# SSL is auto-enabled by Firebase and Cloud Run
# Certificate auto-provisioned and renewed

# Verify SSL
gcloud run services describe kwsa-api --region us-central1 --format='value(status.conditions[0].message)'
```

### 4. Force HTTPS

Update `firebase.json`:

```json
{
  "hosting": {
    "headers": [
      {
        "source": "/**",
        "headers": [
          {
            "key": "Strict-Transport-Security",
            "value": "max-age=31536000; includeSubDomains; preload"
          }
        ]
      }
    ]
  }
}
```

---

## Monitoring & Logging

### 1. Setup Cloud Logging

```bash
# View backend logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=kwsa-api" \
  --limit 50 --format=json

# View logs in real-time
gcloud logging tail "resource.type=cloud_run_revision" --limit 50

# Export logs to BigQuery
gcloud logging sinks create kwsa-logs \
  bigquery.googleapis.com/projects/kwsa-cloud-prod/datasets/logs \
  --log-filter='resource.type="cloud_run_revision"'
```

### 2. Setup Cloud Monitoring

```bash
# Create uptime check
gcloud monitoring uptime-check create https-api-health \
  --resource-type=uptime-url \
  --monitored-resource-labels=host=api.kwsa-cloud.io \
  --http-check-path=/health \
  --display-name="API Health Check"

# Create alert policy
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="API Error Rate Alert"
```

### 3. Setup Application Performance Monitoring

Add Application Error Reporting to backend:

```typescript
// backend/src/config/logger.ts
import { ErrorReporting } from '@google-cloud/error-reporting';

const errorReporting = new ErrorReporting({
  projectId: process.env.GCP_PROJECT_ID
});

export function reportError(error: Error) {
  errorReporting.report(error);
}
```

---

## Backup & Disaster Recovery

### 1. Database Backups

```bash
# Automatic backups (already configured)
gcloud sql backups list --instance=kwsa-db-prod

# Manual backup
gcloud sql backups create \
  --instance=kwsa-db-prod \
  --description="Pre-release backup"
```

### 2. Storage Backups

```bash
# Enable object versioning (already done)
gsutil versioning get gs://kwsa-cloud-storage

# Set retention policy (requires Terraform or console)
# Retains all versions for 90 days
```

### 3. Database Restore

```bash
# List backups
gcloud sql backups list --instance=kwsa-db-prod

# Restore from backup
gcloud sql backups restore BACKUP_ID \
  --backup-instance=kwsa-db-prod \
  --backup-configuration=default
```

### 4. Disaster Recovery Plan

**RTO (Recovery Time Objective)**: 1 hour
**RPO (Recovery Point Objective)**: 1 day

- Failover database to standby instance (manual)
- Restore Cloud Storage from versioning
- Re-deploy backend/frontend from Cloud Build history
- Update DNS to failover IP addresses

---

## Post-Deployment Checklist

- [ ] Backend API responding at https://api.kwsa-cloud.io/health
- [ ] Frontend loading at https://kwsa-cloud.io
- [ ] Database migrations completed successfully
- [ ] Cloud Storage bucket accessible
- [ ] SSL certificates valid
- [ ] Monitoring & alerts configured
- [ ] Backups running automatically
- [ ] Load testing completed
- [ ] Security audit passed
- [ ] Team trained on deployment process
- [ ] Documentation updated with production URLs

---

## Production Configuration Checklist

**Security**:
- [ ] Service account key stored securely
- [ ] Secrets in Secret Manager, not env vars
- [ ] Database password complex & unique
- [ ] JWT secret strong (32+ chars)
- [ ] CORS restricted to known domains
- [ ] SQL Auth Proxy or Private IP enabled
- [ ] Cloud Armor (WAF) configured

**Performance**:
- [ ] Cloud CDN enabled for static assets
- [ ] Database replicated for high availability
- [ ] Cloud Run auto-scaling configured
- [ ] Connection pooling enabled
- [ ] CloudSQL Proxy connection pooling set up

**Monitoring**:
- [ ] Error reporting configured
- [ ] Performance metrics collected
- [ ] Uptime checks active
- [ ] Alert policies created
- [ ] Log archival to BigQuery

**Compliance**:
- [ ] Data residency compliant (data in US)
- [ ] Audit logging enabled
- [ ] Backup retention policy set
- [ ] PII data handled per GDPR/POPIA
- [ ] Encryption at-rest and in-transit enabled

---

## Troubleshooting

### Cloud Run Service Not Starting

```bash
# Check service logs
gcloud run services describe kwsa-api --region us-central1

# View detailed logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=kwsa-api" \
  --limit 100 --format=json --reverse
```

### Database Connection Failed

```bash
# Test connection
gcloud sql connect kwsa-db-prod --user=postgres

# Check Cloud SQL Auth Proxy
gcloud sql instances describe kwsa-db-prod --format='value(ipAddresses[0])'
```

### Frontend Not Loading

```bash
# Check Firebase deployment
firebase hosting:sites:list --project=kwsa-cloud-prod

# View Firebase logs
firebase hosting:log --project=kwsa-cloud-prod
```

---

## Rollback Procedure

If deployment fails:

```bash
# Rollback Cloud Run to previous revision
gcloud run deployments update kwsa-api \
  --region us-central1 \
  --image PREVIOUS_IMAGE_SHA

# Rollback database if needed
gcloud sql backups restore BACKUP_ID \
  --backup-instance=kwsa-db-prod

# Rollback frontend
firebase hosting:channel:deploy prod --project=kwsa-cloud-prod
```

---

## Cost Optimization

**Monthly Estimated Costs**:
- Cloud SQL (db-g1-small): ~$40
- Cloud Run (1Gi, low traffic): ~$25
- Cloud Storage (100GB): ~$2.30
- Firebase Hosting (1GB/day): free
- Cloud Logging: ~$5
- **Total**: ~$72/month (minimal traffic)

**Ways to Reduce Costs**:
- Move cold storage to NEARLINE (~50% savings)
- Use reserved instances for Cloud SQL
- Optimize Cloud Run memory allocation
- Enable Cloud CDN for static assets (may cost extra)

---

This deployment guide provides a complete production-ready setup on Google Cloud Platform. Follow each step carefully and validate at each stage before proceeding.

For questions or issues, consult:
- [GCP Documentation](https://cloud.google.com/docs)
- [Cloud Run Guide](https://cloud.google.com/run/docs)
- [Cloud SQL Guide](https://cloud.google.com/sql/docs)
- [Firebase Hosting Guide](https://firebase.google.com/docs/hosting)
