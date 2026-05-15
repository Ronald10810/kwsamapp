param(
  [string]$ProjectId = 'kwsa-mapp',
  [string]$InstanceName = 'kwsa-postgres',
  [string]$SourceDb = 'kwsa_import_staging',
  [string]$TargetDb = 'kwsa_uat',
  [string]$ProxyHost = '127.0.0.1',
  [int]$ProxyPort = 9470,
  [string]$BackupId = '1778860105623',
  [string]$DbUrlSecret = 'kwsa-backend-test-db-url',
  [string]$RunId = 'phase5-13b'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$preSql = Join-Path $scriptDir '00-pre-promotion-validation.sql'
$promoteSql = Join-Path $scriptDir '01-promote-staging-to-uat.sql'
$postSql = Join-Path $scriptDir '02-post-promotion-validation.sql'
$utcStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$reportPath = Join-Path $scriptDir ("phase5-promotion-report-$RunId-$utcStamp.log")

$psqlExe = (Get-ChildItem 'C:\Program Files*\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if ([string]::IsNullOrWhiteSpace($psqlExe)) {
  throw 'psql.exe not found under C:\Program Files*\PostgreSQL\*\bin\psql.exe'
}

$rawDbUrl = gcloud secrets versions access latest --secret=$DbUrlSecret --project=$ProjectId --quiet
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rawDbUrl)) {
  throw "Failed to read secret $DbUrlSecret"
}

$m = [regex]::Match($rawDbUrl, '^postgres(?:ql)?://([^:]+):([^@]+)@')
if (-not $m.Success) {
  throw "Failed to parse username/password from $DbUrlSecret"
}

$dbUser = $m.Groups[1].Value
$dbPass = $m.Groups[2].Value
$env:PGPASSWORD = $dbPass

try {
  "=== Phase 5 Promotion Wrapper (Execution-Gated) ===" | Tee-Object -FilePath $reportPath -Append
  "UTC Timestamp: $utcStamp" | Tee-Object -FilePath $reportPath -Append
  "Project: $ProjectId" | Tee-Object -FilePath $reportPath -Append
  "Instance: $InstanceName" | Tee-Object -FilePath $reportPath -Append
  "Source DB: $SourceDb" | Tee-Object -FilePath $reportPath -Append
  "Target DB: $TargetDb" | Tee-Object -FilePath $reportPath -Append
  "Proxy: $ProxyHost`:$ProxyPort" | Tee-Object -FilePath $reportPath -Append
  "Backup ID: $BackupId" | Tee-Object -FilePath $reportPath -Append

  "--- Check source current_database() ---" | Tee-Object -FilePath $reportPath -Append
  & $psqlExe -h $ProxyHost -p $ProxyPort -U $dbUser -d $SourceDb -v ON_ERROR_STOP=1 -t -A -c "SELECT current_database();" | Tee-Object -FilePath $reportPath -Append

  "--- Check target current_database() ---" | Tee-Object -FilePath $reportPath -Append
  & $psqlExe -h $ProxyHost -p $ProxyPort -U $dbUser -d $TargetDb -v ON_ERROR_STOP=1 -t -A -c "SELECT current_database();" | Tee-Object -FilePath $reportPath -Append

  "--- Confirm backup exists and is successful ---" | Tee-Object -FilePath $reportPath -Append
  gcloud sql backups describe $BackupId --instance=$InstanceName --project=$ProjectId --format="value(id,type,status,windowStartTime,windowEndTime)" | Tee-Object -FilePath $reportPath -Append

  "--- Run pre-promotion validation SQL (read-only) ---" | Tee-Object -FilePath $reportPath -Append
  & $psqlExe -h $ProxyHost -p $ProxyPort -U $dbUser -d $TargetDb -v ON_ERROR_STOP=1 -f $preSql | Tee-Object -FilePath $reportPath -Append

  "--- Run promotion SQL (writes to approved migration tables in kwsa_uat) ---" | Tee-Object -FilePath $reportPath -Append
  & $psqlExe -h $ProxyHost -p $ProxyPort -U $dbUser -d $TargetDb -v ON_ERROR_STOP=1 -f $promoteSql | Tee-Object -FilePath $reportPath -Append

  "--- Run post-promotion validation SQL ---" | Tee-Object -FilePath $reportPath -Append
  & $psqlExe -h $ProxyHost -p $ProxyPort -U $dbUser -d $TargetDb -v ON_ERROR_STOP=1 -f $postSql | Tee-Object -FilePath $reportPath -Append

  "--- SUCCESS: Promotion sequence completed ---" | Tee-Object -FilePath $reportPath -Append
  "Report: $reportPath" | Tee-Object -FilePath $reportPath -Append
}
finally {
  if (Test-Path Env:PGPASSWORD) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}
