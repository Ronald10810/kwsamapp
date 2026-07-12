param(
    [string]$ProjectId = "kwsa-mapp",
    [string]$Region = "africa-south1",
    [string]$ServiceName = "kwsa-backend-prod",
    [string]$CloudSqlConnectionName = "kwsa-mapp:africa-south1:kwsa-postgres",
    [string]$DatabaseUrlSecretName = "DATABASE_URL",
    [string]$OpenAiApiKeySecretName = "OPENAI_API_KEY",
    [string]$SupportSmtpPassSecretName = "SUPPORT_SMTP_PASS",
    [string]$Property24ApiKeySecretName = "PROPERTY24_API_KEY",
    [string]$PrivatePropertyUsernameSecretName = "PRIVATE_PROPERTY_USERNAME",
    [string]$PrivatePropertyPasswordSecretName = "PRIVATE_PROPERTY_PASSWORD",
    [string]$PrivatePropertyPasswordAltSecretName = "PRIVATE_PROPERTY_PASSWORD_ALT",
    [string]$KwwApiKeySecretName = "KWW_API_KEY",
    [string]$KwwApiSecretSecretName = "KWW_API_SECRET",
    [string]$EntegralGlobalAuthSecretName = "ENTEGRAL_GLOBAL_AUTH",
    [Parameter(Mandatory = $true)]
    [string]$CorsOrigin,
    [ValidateSet("warning", "error", "info", "debug")]
    [string]$LogLevel = "warning",
    [ValidateSet("postgres")]
    [string]$DbClient = "postgres",
    [ValidateSet("gcs")]
    [string]$StorageBackend = "gcs",
    [string]$GcsBucketName = "kwsa-mapp-uploads",
    [string]$OpenAiModel = "gpt-5",
    [string]$GoogleClientId = "768625368107-oficd2i4fn505g3lf7dt6sjmlv77b109.apps.googleusercontent.com",
    [string]$GoogleCloudProject = "",
    [string]$SupportSmtpHost = "smtp.gmail.com",
    [string]$SupportSmtpPort = "465",
    [string]$SupportSmtpUser = "support@kwsa.co.za",
    [string]$SupportFromEmail = "support@kwsa.co.za",
    [string]$SupportFromName = "MAPP Support",
    [string]$SupportReplyTo = "support@kwsa.co.za",
    [string]$SupportSmokeAllowlist = "support@kwsa.co.za",
    [string]$SupportEmailLogoUrl = "https://storage.googleapis.com/kwsa-mapp-uploads/support/email/KWSA_White.png",
    [string]$Property24BaseUrl = "https://api.property24.com/listing/v51/",
    [string]$Property24ListingsEndpoint = "listings",
    [string]$Property24DefaultAgencyId = "37061",
    [string]$PrivatePropertyBaseUrl = "https://services.privateproperty.co.za/AgentImport/AgentImport.asmx",
    [string]$KwwBaseUrl = "https://partners.api.kw.com/v2/listings",
    [string]$EntegralBaseUrl = "http://sync.entegral.net/api",
    [string]$EntegralSourceId = "6",
    [bool]$LocalAssociateSuspensionEnabled = $true,
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

    Write-Step "Granting runtime secret access to Compute service account"
    $projectNumber = & $gcloudCmd projects describe $ProjectId --format="value(projectNumber)"
    if (-not $projectNumber) {
        throw "Could not resolve project number for project '$ProjectId'."
    }
    $runtimeServiceAccount = "${projectNumber}-compute@developer.gserviceaccount.com"

    foreach ($secretName in @(
        $DatabaseUrlSecretName,
        $OpenAiApiKeySecretName,
        $SupportSmtpPassSecretName,
        $Property24ApiKeySecretName,
        $PrivatePropertyUsernameSecretName,
        $PrivatePropertyPasswordSecretName,
        $PrivatePropertyPasswordAltSecretName,
        $KwwApiKeySecretName,
        $KwwApiSecretSecretName,
        $EntegralGlobalAuthSecretName
    )) {
        & $gcloudCmd secrets add-iam-policy-binding $secretName `
            --project $ProjectId `
            --member "serviceAccount:$runtimeServiceAccount" `
            --role "roles/secretmanager.secretAccessor" | Out-Null
    }

    if (-not $GoogleCloudProject) {
        $GoogleCloudProject = $ProjectId
    }

    Write-Step "Deploying $ServiceName to Cloud Run (production profile)"
    $envFilePath = Join-Path $backendDir ".cloudrun-prod-env.generated.yaml"
    @(
        'NODE_ENV: "production"',
        "LOG_LEVEL: `"$LogLevel`"",
        "CORS_ORIGIN: `"$CorsOrigin`"",
        'TRUST_PROXY: "true"',
        "DB_CLIENT: `"$DbClient`"",
        "STORAGE_BACKEND: `"$StorageBackend`"",
        "GCS_BUCKET_NAME: `"$GcsBucketName`"",
        "OPENAI_MODEL: `"$OpenAiModel`"",
        "GOOGLE_CLIENT_ID: `"$GoogleClientId`"",
        "GOOGLE_CLOUD_PROJECT: `"$GoogleCloudProject`"",
        'TRAINING_HUB_ENABLED: "true"',
        'SUPPORT_EMAIL_ENABLED: "true"',
        "SUPPORT_SMTP_HOST: `"$SupportSmtpHost`"",
        "SUPPORT_SMTP_PORT: `"$SupportSmtpPort`"",
        'SUPPORT_SMTP_SECURE: "true"',
        "SUPPORT_SMTP_USER: `"$SupportSmtpUser`"",
        "SUPPORT_FROM_EMAIL: `"$SupportFromEmail`"",
        "SUPPORT_FROM_NAME: `"$SupportFromName`"",
        "SUPPORT_REPLY_TO: `"$SupportReplyTo`"",
        "SUPPORT_SMOKE_ALLOWLIST: `"$SupportSmokeAllowlist`"",
        "SUPPORT_EMAIL_LOGO_URL: `"$SupportEmailLogoUrl`"",
        "PROPERTY24_BASE_URL: `"$Property24BaseUrl`"",
        "PROPERTY24_LISTINGS_ENDPOINT: `"$Property24ListingsEndpoint`"",
        "PROPERTY24_DEFAULT_AGENCY_ID: `"$Property24DefaultAgencyId`"",
        "PRIVATE_PROPERTY_BASE_URL: `"$PrivatePropertyBaseUrl`"",
        "KWW_BASE_URL: `"$KwwBaseUrl`"",
        "ENTEGRAL_BASE_URL: `"$EntegralBaseUrl`"",
        "ENTEGRAL_SOURCE_ID: `"$EntegralSourceId`"",
        "LOCAL_ASSOCIATE_SUSPENSION_ENABLED: `"$($LocalAssociateSuspensionEnabled.ToString().ToLowerInvariant())`""
    ) | Set-Content -Path $envFilePath -Encoding UTF8

    $serviceSecrets = @(
        "DATABASE_URL=${DatabaseUrlSecretName}:latest",
        "OPENAI_API_KEY=${OpenAiApiKeySecretName}:latest",
        "SUPPORT_SMTP_PASS=${SupportSmtpPassSecretName}:latest",
        "PROPERTY24_API_KEY=${Property24ApiKeySecretName}:latest",
        "PRIVATE_PROPERTY_USERNAME=${PrivatePropertyUsernameSecretName}:latest",
        "PRIVATE_PROPERTY_PASSWORD=${PrivatePropertyPasswordSecretName}:latest",
        "PRIVATE_PROPERTY_PASSWORD_ALT=${PrivatePropertyPasswordAltSecretName}:latest",
        "KWW_API_KEY=${KwwApiKeySecretName}:latest",
        "KWW_API_SECRET=${KwwApiSecretSecretName}:latest",
        "ENTEGRAL_GLOBAL_AUTH=${EntegralGlobalAuthSecretName}:latest"
    ) -join ","

    $allowUnauthArg = if ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }

    try {
        & $gcloudCmd run deploy $ServiceName `
            --source . `
            --project $ProjectId `
            --region $Region `
            $allowUnauthArg `
            --add-cloudsql-instances $CloudSqlConnectionName `
            --env-vars-file $envFilePath `
            --set-secrets $serviceSecrets `
            --quiet
    }
    finally {
        Remove-Item -Path $envFilePath -Force -ErrorAction SilentlyContinue
    }

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
