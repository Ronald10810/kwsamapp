param(
    [string]$ProjectId = "kwsa-mapp",
    [string]$Region = "africa-south1",
    [string]$ServiceName = "kwsa-backend-prod",
    [string]$CloudSqlConnectionName = "kwsa-mapp:africa-south1:kwsa-postgres",
    [string]$DatabaseUrlSecretName = "DATABASE_URL",
    [Parameter(Mandatory = $true)]
    [string]$CorsOrigin,
    [ValidateSet("warning", "error", "info", "debug")]
    [string]$LogLevel = "warning",
    [ValidateSet("postgres")]
    [string]$DbClient = "postgres",
    [ValidateSet("gcs")]
    [string]$StorageBackend = "gcs",
    [string]$GoogleCloudProject = "",
    [switch]$AllowUnauthenticated,
    [switch]$SkipLockfileSync
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$backendDir = Resolve-Path (Join-Path $repoRoot "backend")
$gcloudCmd = "C:\Users\ronal\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

if ($CorsOrigin -match "localhost|127\.0\.0\.1") {
    throw "Production deployment blocked: CORS_ORIGIN cannot be localhost/127.0.0.1. Provide your live frontend URL."
}

if (-not (Test-Path $gcloudCmd)) {
    Ensure-Command "gcloud"
    $gcloudCmd = "gcloud"
}

Ensure-Command "npm.cmd"

Push-Location $backendDir
try {
    Write-Step "Checking active gcloud account"
    $activeAccount = & $gcloudCmd auth list --filter=status:ACTIVE --format="value(account)"
    if (-not $activeAccount) {
        throw "No active gcloud account found. Run 'gcloud auth login' first."
    }
    Write-Host "Active account: $activeAccount"

    Write-Step "Setting gcloud project to $ProjectId"
    & $gcloudCmd config set project $ProjectId | Out-Null

    if (-not $SkipLockfileSync) {
        Write-Step "Syncing backend lockfile for Cloud Build npm ci"
        & npm.cmd install --package-lock-only --workspaces=false
    }

    Write-Step "Granting secret accessor on $DatabaseUrlSecretName to Compute service account"
    $projectNumber = & $gcloudCmd projects describe $ProjectId --format="value(projectNumber)"
    if (-not $projectNumber) {
        throw "Could not resolve project number for project '$ProjectId'."
    }
    $runtimeServiceAccount = "${projectNumber}-compute@developer.gserviceaccount.com"

    & $gcloudCmd secrets add-iam-policy-binding $DatabaseUrlSecretName `
        --project $ProjectId `
        --member "serviceAccount:$runtimeServiceAccount" `
        --role "roles/secretmanager.secretAccessor" | Out-Null

    if (-not $GoogleCloudProject) {
        $GoogleCloudProject = $ProjectId
    }

    Write-Step "Deploying $ServiceName to Cloud Run (production profile)"
    $envVars = @(
        "NODE_ENV=production",
        "LOG_LEVEL=$LogLevel",
        "CORS_ORIGIN=$CorsOrigin",
        "TRUST_PROXY=true",
        "DB_CLIENT=$DbClient",
        "STORAGE_BACKEND=$StorageBackend",
        "GOOGLE_CLOUD_PROJECT=$GoogleCloudProject"
    ) -join ","

    $allowUnauthArg = if ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }

    & $gcloudCmd run deploy $ServiceName `
        --source . `
        --project $ProjectId `
        --region $Region `
        $allowUnauthArg `
        --add-cloudsql-instances $CloudSqlConnectionName `
        --set-env-vars $envVars `
        --set-secrets "DATABASE_URL=${DatabaseUrlSecretName}:latest" `
        --quiet

    Write-Step "Fetching service URL"
    $serviceUrl = & $gcloudCmd run services describe $ServiceName `
        --project $ProjectId `
        --region $Region `
        --format "value(status.url)"

    if (-not $serviceUrl) {
        throw "Deploy command finished but service URL was empty."
    }

    Write-Host "Production deployment complete." -ForegroundColor Green
    Write-Host "Service URL: $serviceUrl"
    Write-Host "Health URL: $serviceUrl/health"
}
finally {
    Pop-Location
}
