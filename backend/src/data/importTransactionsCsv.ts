import { closePool, runInTransaction } from './db.js';
import { optionalArg } from './args.js';
import { getValue, readCsvRows } from './csv.js';

function buildBatchId(): string {
  return `transactions_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}

function parseNum(val: string | null | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseDate(val: string | null | undefined): string | null {
  if (!val || val.trim() === '') return null;
  // Handles "2021/02/15 00:00" and ISO formats
  const d = new Date(val.trim().replace(/\//g, '-'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isOutsideAgentType(val: string | null | undefined): boolean {
  if (!val) return false;
  const normalized = val.trim().toLowerCase();
  return normalized === 'outside agent'
    || normalized === 'outside agency'
    || normalized === 'outside agency referral';
}

async function main(): Promise<void> {
  const filePath = optionalArg('--file', 'data/incoming/transactions.csv');
  const batchId = optionalArg('--batch', buildBatchId());
  const rows = await readCsvRows(filePath);

  if (rows.length === 0) {
    throw new Error(`No rows found in ${filePath}`);
  }

  // Group rows by source_transaction_id to handle multi-agent transactions
  const transactionMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const sourceTransactionId = getValue(row, ['TransactionId', 'transaction_id']);
    if (!sourceTransactionId) continue;
    
    if (!transactionMap.has(sourceTransactionId)) {
      transactionMap.set(sourceTransactionId, []);
    }
    transactionMap.get(sourceTransactionId)!.push(row);
  }

  let imported = 0;
  const CHUNK = 500;
  const txIds = Array.from(transactionMap.keys());

  for (let i = 0; i < txIds.length; i += CHUNK) {
    const chunk = txIds.slice(i, i + CHUNK);
    await runInTransaction(async (client) => {
      for (const sourceTransactionId of chunk) {
        const txRows = transactionMap.get(sourceTransactionId)!;
        
        // Use first row for transaction-level data (common across all agent rows)
        const firstRow = txRows[0];
        const transactionNumber = getValue(firstRow, ['TransactionNumber', 'transaction_number']) || null;
        const sourceMcId = getValue(firstRow, ['MarketCenterId', 'market_center_id']) || null;
        const mcName = getValue(firstRow, ['MarketCenterName', 'market_center_name']) || null;
        const sourceTeamId = getValue(firstRow, ['TeamId', 'team_id']) || null;
        const teamName = getValue(firstRow, ['TeamName', 'team_name']) || null;
        const currentSourceMcId = getValue(firstRow, ['CurrentMarketCenterId', 'current_market_center_id']) || null;
        const currentMcName = getValue(firstRow, ['CurrentMarketCenterName', 'current_market_center_name']) || null;
        const currentSourceTeamId = getValue(firstRow, ['CurrentTeamId', 'current_team_id']) || null;
        const currentTeamName = getValue(firstRow, ['CurrentTeamName', 'current_team_name']) || null;
        const listingOfficeName = getValue(firstRow, ['ListingOfficeName', 'listing_office_name']) || null;
        const status = getValue(firstRow, ['TransactionStatus', 'transaction_status']) || null;
        const sourceListingId = getValue(firstRow, ['ListingId', 'listing_id']) || null;
        const listingNumber = getValue(firstRow, ['ListingNumber', 'listing_number']) || null;
        const txType = getValue(firstRow, ['TransactionType', 'transaction_type']) || null;
        const address = getValue(firstRow, ['Address', 'address']) || null;
        const suburb = getValue(firstRow, ['Suburb', 'suburb']) || null;
        const city = getValue(firstRow, ['City', 'city']) || null;
        const salesPrice = parseNum(getValue(firstRow, ['SalesPrice', 'sales_price']));
        const listPrice = parseNum(getValue(firstRow, ['ListPrice', 'list_price']));
        const variancePer = parseNum(getValue(firstRow, ['VariancePer', 'variance_per']));
        const contractGciExclVat = parseNum(getValue(firstRow, ['ContractGCIExclVAT', 'contract_gci_excl_vat']));
        const avgCommsPer = parseNum(getValue(firstRow, ['AvgCommsPer', 'avg_comms_per']));
        const transactionGciExclVat = parseNum(getValue(firstRow, ['TransactionCGIExclVAT', 'transaction_gci_excl_vat', 'transaction_cgi_excl_vat']));
        const gci = parseNum(getValue(firstRow, ['ContractGCIExclVAT', 'gci_excl_vat']));
        const netComm = parseNum(getValue(firstRow, ['NetComm', 'net_comm']));
        const totalGci = parseNum(getValue(firstRow, ['TotalGCI', 'total_gci']));
        const growthShare = parseNum(getValue(firstRow, ['GrowthShare', 'growth_share']));
        const productionRoyalties = parseNum(getValue(firstRow, ['ProductionRoyalties', 'production_royalties']));
        const capRemaining = parseNum(getValue(firstRow, ['CapRemaining', 'cap_remaining']));
        const associateDollar = parseNum(getValue(firstRow, ['AssociateDollar', 'associate_dollar']));
        const mcDollar = parseNum(getValue(firstRow, ['MCDollar', 'mc_dollar']));
        const companyDollar = parseNum(getValue(firstRow, ['CompanyDollar', 'company_dollar']));
        const teamDollar = parseNum(getValue(firstRow, ['TeamDollar', 'team_dollar']));
        const saleType = getValue(firstRow, ['SaleType', 'sale_type']) || null;
        const buyer = getValue(firstRow, ['Buyer', 'buyer']) || null;
        const seller = getValue(firstRow, ['Seller', 'seller']) || null;
        const transferAttorney = getValue(firstRow, ['TransferAttorney', 'transfer_attorney']) || null;
        const taMobilePhone = getValue(firstRow, ['TAMobilePhone', 'ta_mobile_phone']) || null;
        const taEmail = getValue(firstRow, ['TAEmail', 'ta_email']) || null;
        const bondAttorneyContactId = getValue(firstRow, ['BondAttorneyContactId', 'bond_attorney_contact_id']) || null;
        const bondAttorney = getValue(firstRow, ['BondAttorney', 'bond_attorney']) || null;
        const baMobilePhone = getValue(firstRow, ['BAMobilePhone', 'ba_mobile_phone']) || null;
        const baEmail = getValue(firstRow, ['BAEmail', 'ba_email']) || null;
        const bondOriginator = getValue(firstRow, ['BondOriginator', 'bond_originator']) || null;
        const bondDueDate = parseDate(getValue(firstRow, ['BondDueDate', 'bond_due_date']));
        const bondAmount = parseNum(getValue(firstRow, ['BondAmount', 'bond_amount']));
        const transactionFinancialInstitutionId = getValue(firstRow, ['TransactionFinancialInstitutionId', 'transaction_financial_institution_id']) || null;
        const transactionFinancialInstitution = getValue(firstRow, ['TransactionFinancialInstitution', 'transaction_financial_institution']) || null;
        const financialInstitutionOther = getValue(firstRow, ['FinancialInstitutionOther', 'financial_institution_other']) || null;
        const transactionFinancingTypeId = getValue(firstRow, ['TransactionFinancingTypeId', 'transaction_financing_type_id']) || null;
        const transactionFinancingType = getValue(firstRow, ['TransactionFinancingType', 'transaction_financing_type']) || null;
        const allPartiesInvoiced = getValue(firstRow, ['AllPartiesInvoiced', 'all_parties_invoiced']) || null;
        const listDate = parseDate(getValue(firstRow, ['ListDate', 'list_date']));
        const txDate = parseDate(getValue(firstRow, ['TransactionDate', 'transaction_date']));
        const statusChangeDate = parseDate(getValue(firstRow, ['StatusChangeDate', 'status_change_date']));
        const expectedDate = parseDate(getValue(firstRow, ['ExpectedDate', 'expected_date']));

        // Insert one transaction record (not duplicated per agent)
        await client.query(
          `INSERT INTO staging.transactions_raw (
            batch_id, source_transaction_id, transaction_number,
            source_market_center_id, market_center_name,
            source_team_id, team_name,
            current_source_market_center_id, current_market_center_name,
            current_source_team_id, current_team_name,
            listing_office_name,
            source_associate_id, associate_name,
            transaction_status, source_listing_id, listing_number,
            list_date, transaction_date, status_change_date, expected_date,
            transaction_type, address, suburb, city,
            variance_per, contract_gci_excl_vat, avg_comms_per, transaction_gci_excl_vat,
            sales_price, list_price, gci_excl_vat,
            split_percentage, net_comm, total_gci,
            growth_share, production_royalties, cap_remaining,
            associate_dollar, mc_dollar, company_dollar, team_dollar,
            sale_type, agent_type, buyer, seller,
            transfer_attorney, ta_mobile_phone, ta_email,
            bond_attorney_contact_id, bond_attorney, ba_mobile_phone, ba_email,
            bond_originator, bond_due_date, bond_amount,
            transaction_financial_institution_id, transaction_financial_institution,
            financial_institution_other, transaction_financing_type_id, transaction_financing_type,
            all_parties_invoiced,
            raw_payload
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,
            $18::timestamptz,$19::timestamptz,$20::timestamptz,$21::timestamptz,
            $22,$23,$24,$25,
            $26,$27,$28,$29,$30,$31,$32,
            $33,$34,$35,
            $36,$37,$38,
            $39,$40,$41,$42,
            $43,$44,$45,$46,
            $47,$48,$49,
            $50,$51,$52,$53,
            $54,$55::timestamptz,$56,
            $57,$58,
            $59,$60,$61,
            $62,
            $63::jsonb
          )`,
          [
            batchId, sourceTransactionId, transactionNumber,
            sourceMcId, mcName,
            sourceTeamId, teamName,
            currentSourceMcId, currentMcName,
            currentSourceTeamId, currentTeamName,
            listingOfficeName,
            '', '', // Leave associate fields empty for multi-agent transactions
            status, sourceListingId, listingNumber,
            listDate, txDate, statusChangeDate, expectedDate,
            txType, address, suburb, city,
            variancePer, contractGciExclVat, avgCommsPer, transactionGciExclVat,
            salesPrice, listPrice, gci,
            null, netComm, totalGci,
            growthShare, productionRoyalties, capRemaining,
            associateDollar, mcDollar, companyDollar, teamDollar,
            saleType, null, buyer, seller,
            transferAttorney, taMobilePhone, taEmail,
            bondAttorneyContactId, bondAttorney, baMobilePhone, baEmail,
            bondOriginator, bondDueDate, bondAmount,
            transactionFinancialInstitutionId, transactionFinancialInstitution,
            financialInstitutionOther, transactionFinancingTypeId, transactionFinancingType,
            allPartiesInvoiced,
            JSON.stringify(firstRow),
          ]
        );

        // Get the inserted transaction record ID
        const txResult = await client.query(
          `SELECT id FROM staging.transactions_raw WHERE source_transaction_id = $1 ORDER BY id DESC LIMIT 1`,
          [sourceTransactionId]
        );
        const transactionDbId = txResult.rows[0]?.id;

        // Insert agent records (one per agent in the transaction)
        for (let agentIndex = 0; agentIndex < txRows.length; agentIndex++) {
          const agentRow = txRows[agentIndex];
          const sourceAssociateId = getValue(agentRow, ['AssociateId', 'associate_id']) || null;
          const associateName = getValue(agentRow, ['Associate', 'associate_name']) || null;
          const splitPct = parseNum(getValue(agentRow, ['SplitPercentage', 'split_percentage']));
          const agentType = getValue(agentRow, ['AgentType', 'agent_type']) || null;
          const outsideAgencyName = getValue(agentRow, ['OutsideAgency', 'outside_agency', 'OutsideAgencyName', 'outside_agency_name']) || null;
          const outsideFirstName = getValue(agentRow, ['OutsideFirstName', 'outside_first_name', 'FirstName', 'first_name']) || null;
          const outsideLastName = getValue(agentRow, ['OutsideLastName', 'outside_last_name', 'LastName', 'last_name']) || null;
          const outsideEmail = getValue(agentRow, ['OutsideEmail', 'outside_email', 'Email', 'email']) || null;
          const outsidePhone = getValue(agentRow, ['OutsidePhone', 'outside_phone', 'Phone', 'phone', 'PhoneNumber', 'phone_number']) || null;
          const outsideAgency = isOutsideAgentType(agentType) || Boolean(outsideAgencyName);

          await client.query(
            `INSERT INTO staging.transaction_agents (
              transaction_id, source_associate_id, associate_name,
              split_percentage, agent_type, outside_agency,
              outside_agency_name, outside_first_name, outside_last_name,
              outside_email, outside_phone, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)` ,
            [
              transactionDbId,
              sourceAssociateId,
              associateName,
              splitPct,
              agentType,
              outsideAgency,
              outsideAgencyName,
              outsideFirstName,
              outsideLastName,
              outsideEmail,
              outsidePhone,
              agentIndex,
            ]
          );
        }

        imported++;
      }
    });
  }

  console.log(`Imported ${imported} transactions with multi-agent support (batch: ${batchId}).`);
}

main()
  .catch((error) => {
    console.error('Failed to import transactions CSV:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
