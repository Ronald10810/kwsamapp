import type { Queryable } from '../transactionCalculations.js';
import type { CapEnvelopeDescriptor, CapRefreshActor, ProtectedFieldCheckResult } from './envelopeTypes.js';

type AuditStartInput = {
  actor: CapRefreshActor;
  transactionId: number;
  transactionNumber: string | null;
  envelope: CapEnvelopeDescriptor;
  rowsScanned: number;
  rowsAffected: number;
  beforeSnapshot: unknown[];
  afterSnapshot: unknown[];
  protectedFieldCheck: ProtectedFieldCheckResult;
  startedAt: Date;
};

export async function startCapRefreshAudit(db: Queryable, input: AuditStartInput): Promise<string> {
  const result = await db.query<{ id: string }>(
    `
    INSERT INTO migration.cap_refresh_audit (
      triggered_by_user_id,
      triggered_by_email,
      trigger_source,
      transaction_id,
      transaction_number,
      envelope_key,
      envelope_type,
      cycle_start_date,
      cycle_end_date,
      rows_scanned,
      rows_affected,
      before_snapshot_json,
      after_snapshot_json,
      protected_field_check_json,
      started_at,
      success
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,false)
    RETURNING id::text AS id
    `,
    [
      input.actor.associateDbId,
      input.actor.email,
      'manual_apply',
      input.transactionId,
      input.transactionNumber,
      input.envelope.envelopeKey,
      input.envelope.envelopeType,
      input.envelope.cycleStartDate,
      input.envelope.cycleEndDate,
      input.rowsScanned,
      input.rowsAffected,
      JSON.stringify(input.beforeSnapshot),
      JSON.stringify(input.afterSnapshot),
      JSON.stringify(input.protectedFieldCheck),
      input.startedAt.toISOString(),
    ]
  );

  return result.rows[0]?.id ?? '';
}

export async function completeCapRefreshAudit(db: Queryable, auditId: string, completedAt: Date, durationMs: number): Promise<void> {
  await db.query(
    `
    UPDATE migration.cap_refresh_audit
    SET success = true,
        completed_at = $2,
        duration_ms = $3
    WHERE id = $1::bigint
    `,
    [auditId, completedAt.toISOString(), durationMs]
  );
}

export async function failCapRefreshAudit(db: Queryable, auditId: string, completedAt: Date, durationMs: number, errorMessage: string): Promise<void> {
  await db.query(
    `
    UPDATE migration.cap_refresh_audit
    SET success = false,
        completed_at = $2,
        duration_ms = $3,
        error_message = $4
    WHERE id = $1::bigint
    `,
    [auditId, completedAt.toISOString(), durationMs, errorMessage]
  );
}
