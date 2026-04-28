# export-azure-to-csv.ps1
# Exports Azure SQL (readonly) data to CSV files using JOIN queries that match
# the shape of the existing staging.* tables.

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

# Use ADO.NET SqlDataReader for streaming large result sets
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

Invoke-AzureQuery "market_centers_raw" @"
SELECT
    CAST(mc.Id AS NVARCHAR)                             AS source_market_center_id,
    mc.Name                                             AS name,
    ISNULL(s.Name, '')                                  AS status_name,
    ISNULL(CAST(mc.FrontdoorId AS NVARCHAR), '')        AS frontdoor_id,
    ISNULL(CONVERT(NVARCHAR, mc.WhenUpdated, 127), '')  AS source_updated_at
FROM MarketCenter mc
LEFT JOIN MarketCenterStatus s ON s.Id = mc.MarketCenterStatusId
"@

Invoke-AzureQuery "teams_raw" @"
SELECT
    CAST(t.Id AS NVARCHAR)                              AS source_team_id,
    CAST(t.MarketCenterId AS NVARCHAR)                  AS source_market_center_id,
    t.Name                                              AS name,
    ISNULL(s.Name, '')                                  AS status_name,
    ISNULL(CONVERT(NVARCHAR, t.WhenUpdated, 127), '')   AS source_updated_at
FROM Team t
LEFT JOIN TeamStatus s ON s.Id = t.TeamStatusId
"@

Invoke-AzureQuery "associates_raw" @"
SELECT
    CAST(a.Id AS NVARCHAR)                              AS source_associate_id,
    a.FirstName                                         AS first_name,
    a.LastName                                          AS last_name,
    a.NationalId                                        AS national_id,
    a.FFCNumber                                         AS ffc_number,
    acd.Email                                           AS email,
    acd.PrivateEmail                                    AS private_email,
    acd.MobileNumber                                    AS mobile_number,
    acd.OfficeNumber                                    AS office_number,
    ISNULL(s.Name, '')                                  AS status_name,
    ISNULL(mc.Name, '')                                 AS market_center_name,
    CAST(mc.Id AS NVARCHAR)                             AS source_market_center_id,
    ISNULL(t.Name, '')                                  AS team_name,
    CAST(t.Id AS NVARCHAR)                              AS source_team_id,
    abd.KWUID                                           AS kwuid,
    CAST(abd.GrowthShareSponsorId AS NVARCHAR)          AS growth_share_sponsor_source_id,
    abd.ProposedGrowthShareSponsor                      AS proposed_growth_share_sponsor,
    CASE WHEN abd.TemporaryGrowthShareSponsor=1 THEN 'true' ELSE 'false' END AS temporary_growth_share_sponsor,
    CASE WHEN abd.Vested=1 THEN 'true' ELSE 'false' END AS vested,
    CONVERT(NVARCHAR, abd.VestingStartPeriod, 127)      AS vesting_start_period,
    CASE WHEN abd.ListingApprovalRequired=1 THEN 'true' ELSE 'false' END AS listing_approval_required,
    CASE WHEN abd.ExcludeFromIndividualReports=1 THEN 'true' ELSE 'false' END AS exclude_from_individual_reports,
    ISNULL(CONVERT(NVARCHAR, a.WhenUpdated, 127), '')   AS source_updated_at
FROM Associate a
LEFT JOIN AssociateContactDetail    acd ON acd.AssociateId = a.Id
LEFT JOIN AssociateBusinessDetail   abd ON abd.AssociateId = a.Id
LEFT JOIN AssociateStatus           s   ON s.Id = a.AssociateStatusId
LEFT JOIN MarketCenter              mc  ON mc.Id = abd.MarketCenterId
LEFT JOIN Team                      t   ON t.Id  = abd.TeamId
"@

Invoke-AzureQuery "listings_raw" @"
SELECT
    CAST(l.Id AS NVARCHAR)                              AS source_listing_id,
    l.ListingNumber                                     AS listing_number,
    ISNULL(ls.Name, '')                                 AS status_name,
    ''                                                  AS market_center_name,
    ''                                                  AS source_market_center_id,
    ISNULL(srt.Name, '')                                AS sale_or_rent,
    a.StreetNumber                                      AS street_number,
    a.StreetName                                        AS street_name,
    sb.Name                                             AS suburb,
    ci.Name                                             AS city,
    p.Name                                              AS province,
    co.Name                                             AS country,
    lpd.Price                                           AS price,
    CONVERT(NVARCHAR, l.ExpiryDate, 127)                AS expiry_date,
    CONVERT(NVARCHAR, l.ListingDate, 127)               AS listing_date,
    ISNULL(CONVERT(NVARCHAR, l.WhenUpdated, 127), '')   AS source_updated_at,
    ld.PropertyTitle                                    AS property_title,
    ld.ShortDescription                                 AS short_title,
    ld.PropertyDescription                              AS property_description,
    lpd.AgentPropertyValuation                          AS agent_property_valuation,
    CASE WHEN ISNULL(lpd.POA, 0)=1 THEN 'true' ELSE 'false' END AS poa,
    CASE WHEN ISNULL(l.NoTransferDuty, 0)=1 THEN 'true' ELSE 'false' END AS no_transfer_duty,
    lmi.SignedDate                                      AS signed_date,
    lmi.OnMarketSince                                   AS on_market_since,
    lmi.RatesTaxes                                      AS rates_taxes,
    lmi.MonthlyLevy                                     AS monthly_levy,
    ISNULL(mt.Name, '')                                 AS mandate_type
FROM Listing l
LEFT JOIN ListingStatus             ls  ON ls.Id  = l.ListingStatusId
LEFT JOIN ListingSaleOrRentTypes    srt ON srt.Id = l.SaleOrRentTypeId
LEFT JOIN Address                   a   ON a.Id   = l.AddressId
LEFT JOIN Suburb                    sb  ON sb.Id  = a.SuburbId
LEFT JOIN City                      ci  ON ci.Id  = a.CityId
LEFT JOIN Province                  p   ON p.Id   = a.ProvinceId
LEFT JOIN Country                   co  ON co.Id  = a.CountryId
LEFT JOIN ListingPriceDetails       lpd ON lpd.ListingId = l.Id
LEFT JOIN ListingDescription        ld  ON ld.ListingId  = l.Id
LEFT JOIN ListingMandateInfo        lmi ON lmi.ListingId = l.Id
LEFT JOIN ListingMandateType        mt  ON mt.Id = lmi.ListingMandateTypeId
"@

Invoke-AzureQuery "transactions_raw" @"
SELECT
    CAST(tr.Id AS NVARCHAR)                             AS source_transaction_id,
    tr.TransactionNumber                                AS transaction_number,
    ''                                                  AS source_market_center_id,
    ''                                                  AS market_center_name,
    ISNULL(ts.Name, '')                                 AS transaction_status,
    CAST(l.Id AS NVARCHAR)                              AS source_listing_id,
    l.ListingNumber                                     AS listing_number,
    CONVERT(NVARCHAR, l.ListingDate, 127)               AS list_date,
    CONVERT(NVARCHAR, td.TransactionDate, 127)          AS transaction_date,
    CONVERT(NVARCHAR, td.SoldDate, 127)                 AS status_change_date,
    CONVERT(NVARCHAR, td.ExpectedDate, 127)             AS expected_date,
    ISNULL(la.StreetNumber, '') + ' ' + ISNULL(la.StreetName, '') AS address,
    sb.Name                                             AS suburb,
    ci.Name                                             AS city,
    td.SoldPrice                                        AS sales_price,
    lpd.Price                                           AS list_price,
    td.ContractGCIExclVAT                               AS gci_excl_vat,
    ISNULL(srt.Name, '')                                AS sale_type,
    td.PaymentNotes                                     AS payment_notes,
    td.ReturnNotes                                      AS return_notes,
    ISNULL(CONVERT(NVARCHAR, tr.WhenUpdated, 127), '')  AS source_updated_at
FROM [Transaction] tr
LEFT JOIN TransactionStatus         ts  ON ts.Id  = tr.TransactionStatusId
LEFT JOIN Listing                   l   ON l.Id   = tr.ListingId
LEFT JOIN TransactionDescription    td  ON td.TransactionId = tr.Id
LEFT JOIN ListingSaleOrRentTypes    srt ON srt.Id = l.SaleOrRentTypeId
LEFT JOIN Address                   la  ON la.Id  = l.AddressId
LEFT JOIN Suburb                    sb  ON sb.Id  = la.SuburbId
LEFT JOIN City                      ci  ON ci.Id  = la.CityId
LEFT JOIN ListingPriceDetails       lpd ON lpd.ListingId = l.Id
"@

Invoke-AzureQuery "transaction_agents" @"
SELECT
    CAST(ta.TransactionId AS NVARCHAR)                  AS transaction_id,
    CAST(ta.AssociateId AS NVARCHAR)                    AS source_associate_id,
    a.FirstName + ' ' + a.LastName                      AS associate_name,
    ta.SplitPercentage                                  AS split_percentage,
    ISNULL(tat.Name,'')                                 AS agent_type,
    ta.OutsideAgency                                    AS outside_agency,
    ROW_NUMBER() OVER (PARTITION BY ta.TransactionId ORDER BY ta.Id) AS sort_order
FROM TransactionAssociate ta
LEFT JOIN Associate a ON a.Id = ta.AssociateId
LEFT JOIN TransactionAssociateType tat ON tat.Id = ta.TransactionAssociateTypeId
WHERE ta.SoftDelete = 0
"@

Invoke-AzureQuery "transaction_associate_payment_details" @"
SELECT
    CAST(ta.TransactionId AS NVARCHAR)                  AS source_transaction_id,
    CAST(ta.AssociateId AS NVARCHAR)                    AS source_associate_id,
    ta.SplitPercentage                                  AS split_percentage,
    tapd.TransactionGCIBeforeFees                       AS gci_before_fees,
    tapd.ProductionRoyalties                            AS production_royalties,
    tapd.GrowthShare                                    AS growth_share,
    tapd.GCIAfterFeesExclVAT                            AS gci_after_fees_excl_vat,
    tapd.CapRemaining                                   AS cap_remaining,
    tapd.AssociateDollar                                AS associate_dollar,
    tapd.TeamDollar                                     AS team_dollar,
    tapd.MCDollar                                       AS mc_dollar
FROM TransactionAssociate ta
JOIN TransactionAssociatePaymentDetail tapd ON tapd.TransactionAssociateId = ta.Id
WHERE ta.SoftDelete = 0
"@

Invoke-AzureQuery "listing_associates" @"
SELECT
    CAST(la.ListingId AS NVARCHAR)      AS source_listing_id,
    CAST(la.AssociateId AS NVARCHAR)    AS source_associate_id,
    a.FirstName + ' ' + a.LastName      AS associate_name,
    CASE WHEN la.ListingAssociateTypeId = 1 THEN 'true' ELSE 'false' END AS is_primary
FROM ListingAssociate la
LEFT JOIN Associate a ON a.Id = la.AssociateId
WHERE ISNULL(la.SoftDelete, 0) = 0
"@

Invoke-AzureQuery "listing_images_raw" @"
SELECT
    CAST(li.ListingId AS NVARCHAR)                      AS source_listing_id,
    CAST(li.DocumentId AS NVARCHAR)                     AS document_id,
    d.Url                                               AS image_url,
    d.PreviewUrl                                        AS preview_url,
    d.OrderNumber                                       AS order_number,
    d.ImageCaption                                      AS image_caption
FROM ListingImage li
LEFT JOIN Document d ON d.Id = li.DocumentId
WHERE ISNULL(li.SoftDelete, 0) = 0
"@

Invoke-AzureQuery "listing_marketing_urls_raw" @"
SELECT
    CAST(lmu.ListingId AS NVARCHAR)     AS source_listing_id,
    lmu.Url                             AS url,
    lmu.MarketingUrlTypeId              AS marketing_url_type_id
FROM ListingMarketingUrl lmu
WHERE ISNULL(lmu.SoftDelete, 0) = 0
"@

Write-Host ""
Write-Host "[export] Complete. Files in: $OutDir"
Write-Host "[export] Next step: node scripts\\load-staging-from-csv.cjs"
