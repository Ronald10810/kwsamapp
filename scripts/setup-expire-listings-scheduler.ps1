param(
    [string]$ProjectId = "kwsa-mapp",
    [string]$Region = "africa-south1",
    [string]$ServiceName = "kwsa-backend-prod",
    [string]$JobName = "kwsa-expire-listings-daily",
    [string]$Schedule = "0 4 * * *",
    [string]$TimeZone = "Africa/Johannesburg",
    [string]$AutomationJobTokenSecretName = "AUTOMATION_JOB_TOKEN",
    [string]$SchedulerServiceAccountEmail = "",
    [switch]$UseOidc,
    [switch]$SkipSecretCreation,
    [switch]$ForceRegenerateToken
)

$ErrorActionPreference = "Stop"

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

if (-not (Test-Path $gcloudCmd)) {
    Ensure-Command "gcloud"
    $gcloudCmd = "gcloud"
}

Write-Step "Checking active gcloud account"
$activeAccount = & $gcloudCmd auth list --filter=status:ACTIVE --format="value(account)"
if (-not $activeAccount) {
    throw "No active gcloud account found. Run 'gcloud auth login' first."
}
Write-Host "Active account: $activeAccount"

Write-Step "Setting gcloud project to $ProjectId"
& $gcloudCmd config set project $ProjectId | Out-Null

Write-Step "Resolving backend service URL"
$serviceUrl = & $gcloudCmd run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)"
if (-not $serviceUrl) {
    throw "Could not resolve Cloud Run service URL for '$ServiceName'."
}
$targetUrl = "$serviceUrl/api/ops/expire-listings/run"
Write-Host "Target URL: $targetUrl"

if ($UseOidc -and [string]::IsNullOrWhiteSpace($SchedulerServiceAccountEmail)) {
    throw "-UseOidc requires -SchedulerServiceAccountEmail."
}

if (-not $SkipSecretCreation) {
    $secretExists = & $gcloudCmd secrets describe $AutomationJobTokenSecretName --project $ProjectId --format "value(name)" 2>$null
    if (-not $secretExists) {
        Write-Step "Creating $AutomationJobTokenSecretName secret"
        & $gcloudCmd secrets create $AutomationJobTokenSecretName --project $ProjectId --replication-policy="automatic" | Out-Null
    }

    if ($ForceRegenerateToken -or -not $secretExists) {
        Write-Step "Generating automation job token secret version"
        $token = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
        $tokenFile = Join-Path $env:TEMP "automation-job-token-$([guid]::NewGuid().ToString('N')).txt"
        Set-Content -Path $tokenFile -Value $token -Encoding ASCII
        try {
            & $gcloudCmd secrets versions add $AutomationJobTokenSecretName --project $ProjectId --data-file=$tokenFile | Out-Null
        }
        finally {
            Remove-Item -Path $tokenFile -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Step "Accessing latest automation token secret value"
$jobToken = & $gcloudCmd secrets versions access latest --secret $AutomationJobTokenSecretName --project $ProjectId
if (-not $jobToken) {
    throw "Could not read latest value for secret '$AutomationJobTokenSecretName'."
}

$headers = "Content-Type=application/json,x-internal-job-token=$jobToken"
$bodyFile = Join-Path $env:TEMP "expire-listings-body-$([guid]::NewGuid().ToString('N')).json"
'{}' | Set-Content -Path $bodyFile -Encoding ASCII

try {
    Write-Step "Creating or updating Cloud Scheduler job $JobName"
    $jobExists = & $gcloudCmd scheduler jobs describe $JobName --location $Region --project $ProjectId --format "value(name)" 2>$null

    $commonArgs = @(
        "--project", $ProjectId,
        "--location", $Region,
        "--schedule", $Schedule,
        "--time-zone", $TimeZone,
        "--uri", $targetUrl,
        "--http-method", "POST",
        "--headers", $headers,
        "--message-body-from-file", $bodyFile
    )

    if ($UseOidc) {
        $commonArgs += @(
            "--oidc-service-account-email", $SchedulerServiceAccountEmail,
            "--oidc-token-audience", $serviceUrl
        )
    }

    if ($jobExists) {
        & $gcloudCmd scheduler jobs update http $JobName @commonArgs | Out-Null
        Write-Host "Updated existing scheduler job $JobName" -ForegroundColor Green
    }
    else {
        & $gcloudCmd scheduler jobs create http $JobName @commonArgs | Out-Null
        Write-Host "Created scheduler job $JobName" -ForegroundColor Green
    }
}
finally {
    Remove-Item -Path $bodyFile -Force -ErrorAction SilentlyContinue
}

Write-Step "Summary"
Write-Host "Cloud Run service: $ServiceName"
Write-Host "Scheduler job:   $JobName"
Write-Host "Schedule:        $Schedule ($TimeZone)"
Write-Host "Target URL:      $targetUrl"
Write-Host "Secret name:     $AutomationJobTokenSecretName"
if ($UseOidc) {
    Write-Host "OIDC SA:         $SchedulerServiceAccountEmail"
}
