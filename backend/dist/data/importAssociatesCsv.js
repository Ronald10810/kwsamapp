import { closePool, runInTransaction } from './db.js';
import { optionalArg } from './args.js';
import { getValue, readCsvRows } from './csv.js';
function buildBatchId() {
    return `associates_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}
async function main() {
    const filePath = optionalArg('--file', 'data/incoming/associates.csv');
    const batchId = optionalArg('--batch', buildBatchId());
    const rows = await readCsvRows(filePath);
    if (rows.length === 0) {
        throw new Error(`No rows found in ${filePath}`);
    }
    await runInTransaction(async (client) => {
        for (const row of rows) {
            const sourceAssociateId = getValue(row, ['associate_id', 'id', 'AssociateId']);
            if (!sourceAssociateId) {
                continue;
            }
            const firstName = getValue(row, ['first_name', 'firstName', 'FirstName']);
            const lastName = getValue(row, ['last_name', 'lastName', 'LastName']);
            const email = getValue(row, ['email', 'Email', 'KWSAEmail', 'PrivateEmail']);
            const statusName = getValue(row, ['status', 'status_name', 'Status', 'AssociateStatus']);
            const marketCenterName = getValue(row, ['market_center', 'market_center_name', 'MarketCenter', 'MarketCentre']);
            const teamName = getValue(row, ['team', 'team_name', 'Team', 'TeamName']);
            const kwuid = getValue(row, ['kwuid', 'KWUID']);
            const sourceUpdatedAt = getValue(row, ['updated_at', 'source_updated_at', 'UpdatedAt', 'AssociateStartDate', 'StartDate']);
            // Extended fields — present in fuller CSV exports from the source system
            const nationalId = getValue(row, ['national_id', 'NationalId', 'NationalID', 'NationalIdNumber', 'national_id_number']);
            const ffcNumber = getValue(row, ['ffc_number', 'FFCNumber', 'FFC', 'ffc']);
            const kwsaEmail = getValue(row, ['kwsa_email', 'KWSAEmail', 'kwsa_email']);
            const privateEmail = getValue(row, ['private_email', 'PrivateEmail', 'private_email_address']);
            const mobileNumber = getValue(row, ['mobile_number', 'MobileNumber', 'Mobile', 'mobile']);
            const officeNumber = getValue(row, ['office_number', 'OfficeNumber', 'Office', 'office']);
            const growthShareSponsor = getValue(row, ['growth_share_sponsor', 'GrowthShareSponsor', 'SponsorName']);
            const proposedGrowthShareSponsor = getValue(row, ['proposed_growth_share_sponsor', 'ProposedGrowthShareSponsor']);
            const temporaryGrowthShareSponsor = getValue(row, ['temporary_growth_share_sponsor', 'TemporaryGrowthShareSponsor']);
            const startDate = getValue(row, ['start_date', 'StartDate', 'AssociateStartDate']);
            const endDate = getValue(row, ['end_date', 'EndDate', 'AssociateEndDate']);
            const anniversaryDate = getValue(row, ['anniversary_date', 'AnniversaryDate', 'Anniversary']);
            const capDate = getValue(row, ['cap_date', 'CapDate']);
            const totalCapAmount = getValue(row, ['total_cap_amount', 'TotalCapAmount', 'TotalCap', 'total_cap', 'cap']);
            const manualCap = getValue(row, ['manual_cap', 'ManualCap', 'manual_cap_override']);
            const agentSplit = getValue(row, ['agent_split', 'AgentSplit', 'CommissionSplitPercentageToAgent', 'commission_split']);
            const jobTitle = getValue(row, ['job_title', 'JobTitle', 'job_titles']);
            const serviceommunity = getValue(row, ['service_community', 'ServiceCommunity', 'service_communities']);
            const role = getValue(row, ['role', 'Role', 'roles', 'RoleName']);
            const extendedPayload = {
                ...row,
                _ext_national_id: nationalId,
                _ext_ffc_number: ffcNumber,
                _ext_kwsa_email: kwsaEmail,
                _ext_private_email: privateEmail,
                _ext_mobile_number: mobileNumber,
                _ext_office_number: officeNumber,
                _ext_growth_share_sponsor: growthShareSponsor,
                _ext_proposed_growth_share_sponsor: proposedGrowthShareSponsor,
                _ext_temporary_growth_share_sponsor: temporaryGrowthShareSponsor,
                _ext_start_date: startDate,
                _ext_end_date: endDate,
                _ext_anniversary_date: anniversaryDate,
                _ext_cap_date: capDate,
                _ext_total_cap_amount: totalCapAmount,
                _ext_manual_cap: manualCap,
                _ext_agent_split: agentSplit,
                _ext_job_title: jobTitle,
                _ext_service_community: serviceommunity,
                _ext_role: role,
            };
            await client.query(`
        INSERT INTO staging.associates_raw (
          batch_id,
          source_associate_id,
          first_name,
          last_name,
          email,
          status_name,
          market_center_name,
          team_name,
          kwuid,
          source_updated_at,
          raw_payload
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          $10::timestamptz,
          $11::jsonb
        )
      `, [
                batchId,
                sourceAssociateId,
                firstName,
                lastName,
                email,
                statusName,
                marketCenterName,
                teamName,
                kwuid,
                sourceUpdatedAt,
                JSON.stringify(extendedPayload),
            ]);
        }
    });
    console.log(`Imported ${rows.length} rows into staging.associates_raw (batch: ${batchId}).`);
}
main()
    .catch((error) => {
    console.error('Failed to import associates CSV:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=importAssociatesCsv.js.map