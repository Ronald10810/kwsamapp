param(
    [string]$ProjectId = "kwsa-mapp",
    [string]$Region = "africa-south1",
    [string]$BackendServiceName = "kwsa-backend-prod",
    [string]$GcsBucketName = "kwsa-mapp-uploads",
    [string]$FrontendServiceName = "kwsa-frontend-test",
    [string]$FrontendTestRegion = "africa-south1",
    [string]$FrontendLiveRegion = "us-central1",
    [string]$FrontendLiveServiceName = "kwsa-frontend-prod",
    [ValidateSet("Test", "Live")]
    [string]$FrontendReleaseTarget = "Test",
    [string]$FrontendHostingProjectId = "kwsa-cloud-prod",
    [string]$FrontendHostingSite = "",
    [string]$FrontendLiveUrl = "https://kwmapp.co.za",
    [string]$CloudSqlConnectionName = "kwsa-mapp:africa-south1:kwsa-postgres",
    [string]$DatabaseUrlSecretName = "DATABASE_URL",
    [string]$OpenAiApiKeySecretName = "OPENAI_API_KEY",
    [string]$OpenAiModel = "gpt-5",
    [string]$GoogleClientId = "768625368107-oficd2i4fn505g3lf7dt6sjmlv77b109.apps.googleusercontent.com",
    [string]$CorsOrigin = "https://kwmapp.co.za,https://uat.kwmapp.co.za,https://kwsa-frontend-test-768625368107.africa-south1.run.app",
    [string]$BackendUrlOverride = "",
    [bool]$CommunicationsConsoleEnabled = $false,
    [switch]$SkipSecretAccessorGrant = $true,
    [switch]$UseCloudBuildForFrontend = $true,
    [switch]$WaitForFrontendDeploy,
    [switch]$SkipBackup,
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$SkipLockfileSync
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$backendDir = Resolve-Path (Join-Path $repoRoot "backend")
$frontendDir = Resolve-Path (Join-Path $repoRoot "frontend")
$backupRoot = Join-Path $repoRoot "backups"

$frontendRegion = if ($FrontendReleaseTarget -eq "Live") { $FrontendLiveRegion } else { $FrontendTestRegion }
$frontendService = if ($FrontendReleaseTarget -eq "Live") { $FrontendLiveServiceName } else { $FrontendServiceName }

$gcloudCmd = "C:\Users\ronal\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if (-not (Test-Path $gcloudCmd)) {
    $gcloudCmd = "gcloud"
}

$npxCmd = "npx.cmd"
if (-not (Get-Command $npxCmd -ErrorAction SilentlyContinue)) {
    $npxCmd = "npx"
}

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
    param([string]$Name)
    if (Test-Path $Name) {
        return
    }
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Invoke-CheckedCommand {
    param(
        [string]$Description,
        [scriptblock]$Command
    )

    $script:LASTEXITCODE = 0
    $result = & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }

    return $result
}

function Get-EnvValue {
    param(
        [string]$FilePath,
        [string]$Key
    )

    if (-not (Test-Path $FilePath)) {
        return ""
    }

    $line = Get-Content -Path $FilePath | Where-Object {
        $_ -match "^\s*$Key\s*="
    } | Select-Object -First 1

    if (-not $line) {
        return ""
    }

    $value = ($line -replace "^\s*$Key\s*=\s*", "").Trim()
    return $value.Trim('"').Trim("'")
}

function Resolve-CloudRunServiceUrl {
    param(
        [string]$ProjectId,
        [string]$Region,
        [string]$ServiceName
    )

    $url = (& $gcloudCmd run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)").Trim()
    if ($url) {
        return $url
    }

    $describeOutput = & $gcloudCmd run services describe $ServiceName --project $ProjectId --region $Region
    if ($LASTEXITCODE -ne 0) {
        return ""
    }

    $urlLine = $describeOutput | Where-Object { $_ -match '^URL:\s+' } | Select-Object -First 1
    if (-not $urlLine) {
        return ""
    }

    return ($urlLine -replace '^URL:\s+', '').Trim()
}

function New-BackupSnapshot {
    param([string]$RootPath)

    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path $backupRoot "kwsa-cloud-console-$ts"

    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

    Push-Location $RootPath
    try {
        git status --short | Set-Content -Path (Join-Path $backupDir "status.txt") -Encoding UTF8
        git diff > (Join-Path $backupDir "working-tree.diff")
        git diff --staged > (Join-Path $backupDir "staged.diff")
        git rev-parse HEAD | Set-Content -Path (Join-Path $backupDir "base-commit.txt") -Encoding ASCII
        git bundle create (Join-Path $backupDir "repo-all.bundle") --all
    }
    finally {
        Pop-Location
    }

    return $backupDir
}

Ensure-Command "git"
Ensure-Command "npm.cmd"
Ensure-Command $gcloudCmd
if ($FrontendReleaseTarget -eq "Live") {
    Ensure-Command $npxCmd
    if (-not $UseCloudBuildForFrontend) {
        Ensure-Command "docker"
    }
}

if (-not $SkipBackup) {
    Write-Step "Creating local backup snapshot"
    $createdBackup = New-BackupSnapshot -RootPath $repoRoot
    Write-Host "Backup created at: $createdBackup" -ForegroundColor Green
}

if (-not $SkipBackend) {
    Write-Step "Deploying backend production service from local source"
    Push-Location $backendDir
    try {
        if (-not $SkipLockfileSync) {
            Write-Step "Syncing backend lockfile for Cloud Build npm ci"
            Invoke-CheckedCommand "Sync backend lockfile" { & npm.cmd install --package-lock-only --workspaces=false }
        }

        if (-not $SkipSecretAccessorGrant) {
            Write-Step "Granting secret accessor on $DatabaseUrlSecretName to Compute service account"
            $projectNumber = (Invoke-CheckedCommand "Resolve project number" {
                & $gcloudCmd projects describe $ProjectId --format="value(projectNumber)"
            }).Trim()
            if (-not $projectNumber) {
                throw "Could not resolve project number for project '$ProjectId'."
            }
            $runtimeServiceAccount = "${projectNumber}-compute@developer.gserviceaccount.com"

            Invoke-CheckedCommand "Grant secret accessor (DATABASE_URL)" {
                & $gcloudCmd secrets add-iam-policy-binding $DatabaseUrlSecretName `
                    --project $ProjectId `
                    --member "serviceAccount:$runtimeServiceAccount" `
                    --role "roles/secretmanager.secretAccessor" `
                    --quiet | Out-Null
            } | Out-Null

            Invoke-CheckedCommand "Grant secret accessor (OPENAI_API_KEY)" {
                & $gcloudCmd secrets add-iam-policy-binding $OpenAiApiKeySecretName `
                    --project $ProjectId `
                    --member "serviceAccount:$runtimeServiceAccount" `
                    --role "roles/secretmanager.secretAccessor" `
                    --quiet | Out-Null
            } | Out-Null
        }

        Write-Step "Deploying backend service to Cloud Run"
        $backendEnvFilePath = Join-Path $backendDir ".cloudrun-publish-env.generated.yaml"
        @(
            'NODE_ENV: "production"',
            'LOG_LEVEL: "warn"',
            "CORS_ORIGIN: `"$CorsOrigin`"",
            'TRUST_PROXY: "true"',
            'DB_CLIENT: "postgres"',
            'STORAGE_BACKEND: "gcs"',
            "GCS_BUCKET_NAME: `"$GcsBucketName`"",
            "OPENAI_MODEL: `"$OpenAiModel`"",
            "GOOGLE_CLIENT_ID: `"$GoogleClientId`"",
            "GOOGLE_CLOUD_PROJECT: `"$ProjectId`""
        ) | Set-Content -Path $backendEnvFilePath -Encoding UTF8

        try {
            Invoke-CheckedCommand "Deploy backend service" {
                & $gcloudCmd run deploy $BackendServiceName `
                    --source . `
                    --project $ProjectId `
                    --region $Region `
                    --allow-unauthenticated `
                    --add-cloudsql-instances $CloudSqlConnectionName `
                    --env-vars-file $backendEnvFilePath `
                    --set-secrets "DATABASE_URL=${DatabaseUrlSecretName}:latest,OPENAI_API_KEY=${OpenAiApiKeySecretName}:latest" `
                    --quiet
            }
        }
        finally {
            Remove-Item -Path $backendEnvFilePath -Force -ErrorAction SilentlyContinue
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $SkipFrontend) {
    Write-Step "Resolving backend URL for frontend build"
    $backendUrl = $BackendUrlOverride.Trim()

    if (-not $backendUrl) {
        if ($FrontendReleaseTarget -eq "Test") {
            $backendUrl = Get-EnvValue -FilePath (Join-Path $frontendDir ".env.staging") -Key "VITE_API_BASE_URL"
            if ($backendUrl) {
                Write-Host "Using VITE_API_BASE_URL from frontend/.env.staging" -ForegroundColor DarkGray
            }
        }
        else {
            $backendUrl = Get-EnvValue -FilePath (Join-Path $frontendDir ".env.production") -Key "VITE_API_BASE_URL"
            if ($backendUrl) {
                Write-Host "Using VITE_API_BASE_URL from frontend/.env.production" -ForegroundColor DarkGray
            }
        }
    }

    if (-not $backendUrl) {
        $backendUrl = (Invoke-CheckedCommand "Resolve backend service URL from Cloud Run" {
            Resolve-CloudRunServiceUrl -ProjectId $ProjectId -Region $Region -ServiceName $BackendServiceName
        }).Trim()
    }
    if (-not $backendUrl) {
        throw "Could not resolve backend URL for service '$BackendServiceName'."
    }

    Write-Host "Frontend target: $FrontendReleaseTarget" -ForegroundColor DarkGray
    Write-Host "Frontend service: $frontendService" -ForegroundColor DarkGray
    Write-Host "Frontend region: $frontendRegion" -ForegroundColor DarkGray
    Write-Host "Backend URL: $backendUrl" -ForegroundColor DarkGray

    $frontendEnvBaseFile = Join-Path $frontendDir ".env.production"
    $frontendEnvGeneratedFile = Join-Path $frontendDir "env.production.generated"

    $envLines = @()
    if (Test-Path $frontendEnvBaseFile) {
        $envLines = Get-Content -Path $frontendEnvBaseFile
    }

    $envLines = $envLines | Where-Object {
        $_ -notmatch '^\s*VITE_API_BASE_URL\s*=' -and
        $_ -notmatch '^\s*VITE_GOOGLE_CLIENT_ID\s*=' -and
        $_ -notmatch '^\s*VITE_COMMUNICATIONS_CONSOLE_ENABLED\s*=' -and
        $_ -notmatch '^\s*VITE_PORTAL_RECOVERY_ENABLED\s*=' -and
        $_ -notmatch '^\s*VITE_TRAINING_HUB_ENABLED\s*='
    }
    $envLines += "VITE_API_BASE_URL=$backendUrl"
    $envLines += "VITE_GOOGLE_CLIENT_ID=$GoogleClientId"
    $envLines += "VITE_COMMUNICATIONS_CONSOLE_ENABLED=$($CommunicationsConsoleEnabled.ToString().ToLowerInvariant())"
    $envLines += "VITE_PORTAL_RECOVERY_ENABLED=true"
    $envLines += "VITE_TRAINING_HUB_ENABLED=true"

    Set-Content -Path $frontendEnvGeneratedFile -Value $envLines -Encoding UTF8
    Write-Host "Generated frontend env override: $frontendEnvGeneratedFile" -ForegroundColor DarkGray

    if (-not $UseCloudBuildForFrontend) {
        throw "Frontend publishing currently expects -UseCloudBuildForFrontend."
    }

    try {
        if ($FrontendReleaseTarget -eq "Live") {
            Write-Step "Deploying live frontend from local source via Cloud Build"
            Write-Host "Using Cloud Build for live deploy to avoid local Docker dependency." -ForegroundColor DarkGray
            Push-Location $repoRoot
            try {
                Invoke-CheckedCommand "Deploy live frontend service" {
                    $deployArgs = @(
                        "run", "deploy", $frontendService,
                        "--source", "./frontend",
                        "--project", $ProjectId,
                        "--region", $frontendRegion,
                        "--allow-unauthenticated",
                        "--port", "8080",
                        "--set-build-env-vars", "VITE_API_BASE_URL=$backendUrl,VITE_TRAINING_HUB_ENABLED=true",
                        "--clear-base-image"
                    )

                    if (-not $WaitForFrontendDeploy) {
                        $deployArgs += "--async"
                    }

                    & $gcloudCmd @deployArgs
                }
            }
            finally {
                Pop-Location
            }
        }
        else {
            Write-Step "Deploying test frontend from local source via Cloud Build"
            Write-Host "This step can take a few minutes while Cloud Build creates a new image." -ForegroundColor DarkGray
            if (-not $WaitForFrontendDeploy) {
                Write-Host "Running in async mode so this command returns immediately." -ForegroundColor DarkGray
            }
            Push-Location $repoRoot
            try {
                Invoke-CheckedCommand "Deploy test frontend service" {
                    $deployArgs = @(
                        "run", "deploy", $frontendService,
                        "--source", "./frontend",
                        "--project", $ProjectId,
                        "--region", $frontendRegion,
                        "--allow-unauthenticated",
                        "--port", "8080",
                        "--set-build-env-vars", "VITE_API_BASE_URL=$backendUrl,VITE_TRAINING_HUB_ENABLED=true",
                        "--clear-base-image"
                    )

                    if (-not $WaitForFrontendDeploy) {
                        $deployArgs += "--async"
                    }

                    & $gcloudCmd @deployArgs
                }
            }
            finally {
                Pop-Location
            }
        }
    }
    finally {
        Remove-Item -Path $frontendEnvGeneratedFile -Force -ErrorAction SilentlyContinue
    }

    $frontendUrl = (Invoke-CheckedCommand "Resolve frontend URL" {
        & $gcloudCmd run services describe $frontendService --project $ProjectId --region $frontendRegion --format "value(status.url)"
    }).Trim()

    if ($WaitForFrontendDeploy) {
        Write-Host "$FrontendReleaseTarget frontend deployment complete." -ForegroundColor Green
    }
    else {
        Write-Host "$FrontendReleaseTarget frontend deployment started." -ForegroundColor Green
        Write-Host "Monitor progress with:" -ForegroundColor DarkGray
        Write-Host "  gcloud run revisions list --service $frontendService --project $ProjectId --region $frontendRegion --limit 5"
    }

    if ($FrontendReleaseTarget -eq "Live") {
        Write-Host "Live site URL: $FrontendLiveUrl"
    }
    else {
        Write-Host "Test frontend URL: $frontendUrl"
    }
}

Write-Step "Publish workflow completed"
