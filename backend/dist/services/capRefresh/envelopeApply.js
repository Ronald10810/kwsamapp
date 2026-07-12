import { buildActualEnvelopeEntries, buildProjectedEnvelopeEntries, determinePreviewMode } from './envelopeCalculator.js';
import { startCapRefreshAudit, completeCapRefreshAudit, failCapRefreshAudit } from './auditLogger.js';
import { buildCapRefreshDiffRows, checkProtectedFieldMismatches, fetchCurrentEnvelopeTacRows } from './envelopeDiff.js';
import { resolveCapRefreshContext } from './envelopeResolver.js';
function filterRowsForEnvelope(rows, envelopeKey) {
    return rows.filter((row) => row.envelopeKey === envelopeKey);
}
function buildBeforeSnapshot(rows) {
    return rows.map((row) => ({
        transactionAgentId: row.transactionAgentId,
        transactionId: row.transactionId,
        transactionNumber: row.transactionNumber,
        transactionStatus: row.transactionStatus,
        envelopeKey: row.envelopeKey,
        values: row.current,
    }));
}
function buildAfterSnapshot(rows) {
    return rows.map((row) => ({
        transactionAgentId: row.transactionAgentId,
        transactionId: row.transactionId,
        transactionNumber: row.transactionNumber,
        transactionStatus: row.transactionStatus,
        envelopeKey: row.envelopeKey,
        values: row.proposed,
    }));
}
export async function acquireEnvelopeLocks(db, envelopeKeys) {
    const sorted = [...new Set(envelopeKeys)].sort((left, right) => left.localeCompare(right));
    for (const envelopeKey of sorted) {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [envelopeKey]);
    }
}
export async function persistEnvelopeChanges(db, rows) {
    for (const row of rows) {
        await db.query(`
      UPDATE migration.transaction_agent_calculations
      SET
        market_center_dollar = $2::numeric(18,2),
        team_dollar = $3::numeric(18,2),
        associate_dollar = $4::numeric(18,2),
        cap_contribution = $5::numeric(18,2),
        cap_remaining = $6::numeric(18,2),
        updated_at = NOW()
      WHERE transaction_agent_id = $1
      `, [
            row.transactionAgentId,
            row.proposed.market_center_dollar,
            row.proposed.team_dollar,
            row.proposed.associate_dollar,
            row.proposed.cap_contribution,
            row.proposed.cap_remaining,
        ]);
    }
}
export async function dryRunCapRefresh(db, transactionId) {
    const context = await resolveCapRefreshContext(db, transactionId);
    const currentByAgentId = await fetchCurrentEnvelopeTacRows(db, context.envelopeEntries.map((entry) => entry.row.transaction_agent_id));
    const actualEntries = buildActualEnvelopeEntries(context.envelopeEntries);
    const actualDiffRows = buildCapRefreshDiffRows(currentByAgentId, actualEntries, false);
    const protectedFieldCheck = checkProtectedFieldMismatches(currentByAgentId, actualEntries);
    const previewMode = determinePreviewMode(context.targetEntries);
    const previewEntries = previewMode === 'projected'
        ? buildProjectedEnvelopeEntries(context.envelopeEntries, context.targetEntries.map((entry) => entry.row.transaction_agent_id))
        : actualEntries;
    const previewDiffRows = buildCapRefreshDiffRows(currentByAgentId, previewEntries, previewMode === 'projected');
    return {
        transactionId: context.transactionId,
        transactionNumber: context.transactionNumber,
        previewMode,
        stale: actualDiffRows.length > 0,
        impactedEnvelopes: context.impactedEnvelopes,
        rowsScanned: context.envelopeEntries.length,
        rowsChanged: previewDiffRows.length,
        actualRowsChanged: actualDiffRows.length,
        protectedFieldCheck,
        items: previewDiffRows,
    };
}
export async function applyCapRefresh(db, actor, transactionId) {
    const context = await resolveCapRefreshContext(db, transactionId);
    await acquireEnvelopeLocks(db, context.impactedEnvelopes.map((envelope) => envelope.envelopeKey));
    const currentByAgentId = await fetchCurrentEnvelopeTacRows(db, context.envelopeEntries.map((entry) => entry.row.transaction_agent_id));
    const actualEntries = buildActualEnvelopeEntries(context.envelopeEntries);
    const protectedFieldCheck = checkProtectedFieldMismatches(currentByAgentId, actualEntries);
    if (!protectedFieldCheck.ok) {
        throw new Error('Cap refresh protected-field assertion failed.');
    }
    const diffRows = buildCapRefreshDiffRows(currentByAgentId, actualEntries, false);
    const startedAt = new Date();
    const auditIds = [];
    try {
        for (const envelope of context.impactedEnvelopes) {
            const envelopeRows = filterRowsForEnvelope(diffRows, envelope.envelopeKey);
            const auditId = await startCapRefreshAudit(db, {
                actor,
                transactionId: context.transactionId,
                transactionNumber: context.transactionNumber,
                envelope,
                rowsScanned: context.envelopeEntries.filter((entry) => `${entry.cap_progress_key}|${entry.row.cap_cycle_start_date}` === envelope.envelopeKey).length,
                rowsAffected: envelopeRows.length,
                beforeSnapshot: buildBeforeSnapshot(envelopeRows),
                afterSnapshot: buildAfterSnapshot(envelopeRows),
                protectedFieldCheck,
                startedAt,
            });
            if (auditId) {
                auditIds.push(auditId);
            }
        }
        await persistEnvelopeChanges(db, diffRows);
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        for (const auditId of auditIds) {
            await completeCapRefreshAudit(db, auditId, completedAt, durationMs);
        }
    }
    catch (error) {
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        const message = error instanceof Error ? error.message : 'Unknown cap refresh apply error';
        for (const auditId of auditIds) {
            await failCapRefreshAudit(db, auditId, completedAt, durationMs, message);
        }
        throw error;
    }
    return {
        transactionId: context.transactionId,
        transactionNumber: context.transactionNumber,
        impactedEnvelopes: context.impactedEnvelopes,
        rowsScanned: context.envelopeEntries.length,
        rowsUpdated: diffRows.length,
        protectedFieldCheck,
        items: diffRows,
        auditIds,
    };
}
//# sourceMappingURL=envelopeApply.js.map