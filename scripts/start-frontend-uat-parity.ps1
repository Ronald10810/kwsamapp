param(
  [string]$BackendUrl = "https://kwsa-backend-test-hvz5ax66zq-bq.a.run.app",
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot 'frontend'
$envFile = Join-Path $frontendDir '.env.local'

if (-not (Test-Path $frontendDir)) {
  throw "Frontend directory not found at $frontendDir"
}

$content = @(
  '# Auto-generated for local UAT parity mode'
  "VITE_API_PROXY_TARGET=$BackendUrl"
  'VITE_API_BASE_URL='
)

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "Wrote $envFile" -ForegroundColor Green
Write-Host "VITE_API_PROXY_TARGET=$BackendUrl" -ForegroundColor Cyan

if ($NoStart) {
  Write-Host 'NoStart flag set. Frontend was not started.' -ForegroundColor Yellow
  exit 0
}

Set-Location $repoRoot
npm.cmd run dev:frontend
