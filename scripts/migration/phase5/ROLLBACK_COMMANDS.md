# Phase 5 Rollback Commands (kwsa_uat)

Backup rollback anchor:
- Backup ID: 1778860105623
- Instance: kwsa-postgres
- Project: kwsa-mapp

Use only if approved Promotion 13B execution fails and rollback trigger criteria are met.

## 1. Confirm backup exists and successful
```powershell
gcloud sql backups describe 1778860105623 --instance=kwsa-postgres --project=kwsa-mapp
```

## 2. Restore kwsa-postgres instance from backup
```powershell
gcloud sql backups restore 1778860105623 `
  --backup-instance=kwsa-postgres `
  --target-instance=kwsa-postgres `
  --project=kwsa-mapp
```

## 3. Track restore operation
```powershell
gcloud sql operations list --instance=kwsa-postgres --project=kwsa-mapp --limit=10 --sort-by=~startTime
```

## 4. Post-restore validation checks
```powershell
# Example checks after restore completes
$psqlExe = (Get-ChildItem "C:\Program Files*\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$raw = gcloud secrets versions access latest --secret="kwsa-backend-test-db-url" --project="kwsa-mapp" --quiet
$m = [regex]::Match($raw, '^postgres(?:ql)?://([^:]+):([^@]+)@')
$dbUser = $m.Groups[1].Value
$dbPass = $m.Groups[2].Value
$env:PGPASSWORD = $dbPass

& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_uat -v ON_ERROR_STOP=1 -t -A -c "SELECT current_database();"
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_uat -v ON_ERROR_STOP=1 -f "scripts/migration/phase5/02-post-promotion-validation.sql"

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
```

## 5. Service verification after rollback
Run smoke checks against:
- kwsa-backend-prod
- kwsa-backend-test
- kwsa-public-api-uat

Validate:
- login
- dashboard
- listings
- transactions
- critical reports
