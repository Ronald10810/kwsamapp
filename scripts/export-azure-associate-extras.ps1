# export-azure-associate-extras.ps1
# Exports associate-related tables that were missing from the initial export:
#   - ThirdPartyIntegrations (P24, Entegral)
#   - Commissions (split %, cap, manual cap)
#   - Roles (per associate)
#   - Job Titles (per associate)
#   - Service Communities (per associate)
#   - Admin Market Centers (per associate)
#   - Admin Teams (per associate)
#   - Associate Dates (start, end, anniversary, cap)
#
# Usage:
#   $env:AZURE_SQL_USER = "your_user"
#   $env:AZURE_SQL_PASSWORD = "your_password"
#   .\scripts\export-azure-associate-extras.ps1
#
# Or pass credentials directly:
#   .\scripts\export-azure-associate-extras.ps1 -User "u" -Password "p"

param(
    [string]$Server   = "kwsa.database.windows.net,1433",
    [string]$Database = "dbMappUAT",
    [string]$User     = "",
    [string]$Password = "",
    [string]$OutDir   = "$PSScriptRoot\azure-export"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($User)) {
    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_SQL_USER)) {
        $User = $env:AZURE_SQL_USER
    }
}
if ([string]::IsNullOrWhiteSpace($Password)) {
    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_SQL_PASSWORD)) {
        $Password = $env:AZURE_SQL_PASSWORD
    }
}
if ([string]::IsNullOrWhiteSpace($User) -or [string]::IsNullOrWhiteSpace($Password)) {
    throw "Azure SQL credentials are required. Pass -User and -Password or set AZURE_SQL_USER and AZURE_SQL_PASSWORD."
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
Write-Host "[export] Writing CSVs to: $OutDir"

$connString = "Server=$Server;Database=$Database;User Id=$User;Password=$Password;TrustServerCertificate=True;Connection Timeout=60"

function Invoke-AzureQuery {
    param([string]$Name, [string]$Query)

    $outFile = Join-Path $OutDir "$Name.csv"
    Write-Host "[export] $Name -> $outFile"

    $conn = New-Object System.Data.SqlClient.SqlConnection $connString
    $conn.Open()
    $cmd  = New-Object System.Data.SqlClient.SqlCommand $Query, $conn
    $cmd.CommandTimeout = 600
    $reader = $cmd.ExecuteReader()

    $writer = [System.IO.StreamWriter]::new($outFile, $false, [System.Text.Encoding]::UTF8)
    try {
        # Write header
        $cols = 0..($reader.FieldCount - 1) | ForEach-Object { $reader.GetName($_) }
        $writer.WriteLine(($cols | ForEach-Object { "`"$_`"" }) -join ',')

        # Stream rows
        $count = 0
        while ($reader.Read()) {
            $cells = 0..($reader.FieldCount - 1) | ForEach-Object {
                if ($reader.IsDBNull($_)) { '""' }
                else { $v = $reader.GetValue($_).ToString(); "`"$($v -replace '"','""')`"" }
            }
            $writer.WriteLine($cells -join ',')
            $count++
        }
        Write-Host "         $count rows"
    } finally {
        $writer.Close()
        $reader.Close()
        $conn.Close()
    }
}

# ── 1. Third-party integrations (P24, Entegral) ────────────────────────────
Invoke-AzureQuery "associate_third_party_raw" @"
SELECT
    CAST(a.Id AS NVARCHAR)                                              AS source_associate_id,
    CASE WHEN ISNULL(atpi.FeedToP24,0)=1 THEN 'true' ELSE 'false' END  AS feed_to_p24,
    ISNULL(CAST(NULLIF(atpi.P24AgentId,0) AS NVARCHAR),'')             AS p24_agent_id,
    ISNULL(atpi.EntegralAgentId,'')                                     AS entegral_agent_id,
    CASE WHEN ISNULL(atpi.FeedToEntegral,0)=1 THEN 'true' ELSE 'false' END AS feed_to_entegral,
    ISNULL(atpi.EntegralSyncMessage,'')                                 AS entegral_sync_message
FROM Associate a
INNER JOIN AssociateThirdPartyIntegration atpi ON atpi.AssociateId = a.Id
"@

# ── 2. Commission (split %, cap amount, manual cap) ────────────────────────
Invoke-AzureQuery "associate_commissions_raw" @"
SELECT
    CAST(a.Id AS NVARCHAR)                                              AS source_associate_id,
    ISNULL(CAST(ac.CommissionSplitPercentageToAgent AS NVARCHAR),'')   AS commission_split_pct,
    ISNULL(CAST(ac.TotalCapAmount AS NVARCHAR),'')                     AS total_cap_amount,
    CASE WHEN ISNULL(ac.ManualCap,0)=1 THEN 'true' ELSE 'false' END   AS manual_cap
FROM Associate a
INNER JOIN AssociateCommission ac ON ac.AssociateId = a.Id
"@

# ── 3. Business details (sponsor, KWUID, vested flags, team/MC) ───────────
Invoke-AzureQuery "associate_business_details_raw" @"
SELECT
    CAST(a.Id AS NVARCHAR)                                              AS source_associate_id,
    ISNULL(abd.KWUID, '')                                               AS kwuid,
    ISNULL(CAST(abd.GrowthShareSponsorId AS NVARCHAR), '')              AS growth_share_sponsor_source_id,
    ISNULL(abd.ProposedGrowthShareSponsor, '')                          AS proposed_growth_share_sponsor,
    CASE WHEN ISNULL(abd.TemporaryGrowthShareSponsor,0)=1 THEN 'true' ELSE 'false' END AS temporary_growth_share_sponsor,
    CASE WHEN ISNULL(abd.Vested,0)=1 THEN 'true' ELSE 'false' END       AS vested,
    ISNULL(CONVERT(NVARCHAR, abd.VestingStartPeriod, 127), '')          AS vesting_start_period,
    CASE WHEN ISNULL(abd.ListingApprovalRequired,0)=1 THEN 'true' ELSE 'false' END AS listing_approval_required,
    CASE WHEN ISNULL(abd.ExcludeFromIndividualReports,0)=1 THEN 'true' ELSE 'false' END AS exclude_from_individual_reports,
    ISNULL(CAST(abd.MarketCenterId AS NVARCHAR), '')                    AS source_market_center_id,
    ISNULL(CAST(abd.TeamId AS NVARCHAR), '')                            AS source_team_id
FROM Associate a
INNER JOIN AssociateBusinessDetail abd ON abd.AssociateId = a.Id
"@

# ── 4. Roles ───────────────────────────────────────────────────────────────
Invoke-AzureQuery "associate_roles_raw" @"
SELECT
    CAST(air.AssociateId AS NVARCHAR)   AS source_associate_id,
    r.Name                              AS role_name
FROM AssociateIdentityRole air
INNER JOIN AspNetRoles r ON r.Id = air.AssociateRolesId
WHERE r.Name IS NOT NULL
"@

# ── 5. Job titles ──────────────────────────────────────────────────────────
Invoke-AzureQuery "associate_job_titles_raw" @"
SELECT
    CAST(ajt.AssociatesId AS NVARCHAR)  AS source_associate_id,
    jt.Name                             AS job_title_name
FROM AssociateJobTitle ajt
INNER JOIN JobTitle jt ON jt.Id = ajt.JobTitlesId
WHERE jt.Name IS NOT NULL
"@

# ── 6. Service communities ─────────────────────────────────────────────────
Invoke-AzureQuery "associate_service_communities_raw" @"
SELECT
    CAST(asc2.AssociatesId AS NVARCHAR)     AS source_associate_id,
    sc.Name                                 AS service_community_name
FROM AssociateServiceCommunity asc2
INNER JOIN ServiceCommunity sc ON sc.Id = asc2.ServiceCommunitiesId
WHERE sc.Name IS NOT NULL
"@

# ── 7. Admin market centers ────────────────────────────────────────────────
Invoke-AzureQuery "associate_admin_market_centers_raw" @"
SELECT
    CAST(aamc.AdminsId AS NVARCHAR)             AS source_associate_id,
    CAST(aamc.AdminMarketCentersId AS NVARCHAR) AS source_market_center_id
FROM AssociateAdminMarketCenter aamc
"@

# ── 8. Admin teams ─────────────────────────────────────────────────────────
Invoke-AzureQuery "associate_admin_teams_raw" @"
SELECT
    CAST(aat.AdminsId AS NVARCHAR)      AS source_associate_id,
    CAST(aat.AdminTeamsId AS NVARCHAR)  AS source_team_id
FROM AssociateAdminTeam aat
"@

# ── 9. Associate dates ─────────────────────────────────────────────────────
Invoke-AzureQuery "associate_dates_raw" @"
SELECT
    CAST(a.Id AS NVARCHAR)                          AS source_associate_id,
    ISNULL(CONVERT(NVARCHAR, ad.StartDate, 127),'') AS start_date,
    ISNULL(CONVERT(NVARCHAR, ad.EndDate, 127),'')   AS end_date,
    ISNULL(CONVERT(NVARCHAR, ad.AnniversaryDate, 127),'') AS anniversary_date,
    ISNULL(CONVERT(NVARCHAR, ad.CapDate, 127),'')   AS cap_date
FROM Associate a
LEFT JOIN AssociateDate ad ON ad.AssociateId = a.Id
"@

Write-Host ""
Write-Host "[export] Complete. Files written to: $OutDir"
Write-Host "[export] Next step: node scripts\load-associate-extras.cjs"
