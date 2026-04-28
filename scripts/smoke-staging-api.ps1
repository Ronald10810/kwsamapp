param(
    [string]$ApiBaseUrl = "https://kwsa-backend-test-hvz5ax66zq-bq.a.run.app"
)

$ErrorActionPreference = "Stop"

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Url,
        [int[]]$ExpectedStatusCodes
    )

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 30
        $status = [int]$response.StatusCode
    }
    catch {
        $status = [int]$_.Exception.Response.StatusCode.value__
        if (-not $status) {
            throw "Request failed for $Name ($Url): $($_.Exception.Message)"
        }
    }

    if ($ExpectedStatusCodes -notcontains $status) {
        throw "$Name failed. Status: $status. Expected: $($ExpectedStatusCodes -join ', ')"
    }

    Write-Host "PASS $Name -> $status"
}

Write-Host "Running staging smoke checks against: $ApiBaseUrl"

Test-Endpoint -Name "Health" -Url "$ApiBaseUrl/health" -ExpectedStatusCodes @(200)
Test-Endpoint -Name "Ops Summary (auth enforced)" -Url "$ApiBaseUrl/api/ops/summary" -ExpectedStatusCodes @(401)
Test-Endpoint -Name "Agents list (auth enforced)" -Url "$ApiBaseUrl/api/agents" -ExpectedStatusCodes @(401)

Write-Host "Smoke checks completed successfully."
