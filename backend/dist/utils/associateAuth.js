export function normalizeAuthEmail(email) {
    return email.trim().toLowerCase();
}
export function normalizeAuthName(name) {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
export async function resolveAssociateIdForAuth(client, email, displayName) {
    const normalizedEmail = normalizeAuthEmail(email);
    const normalizedName = normalizeAuthName(displayName ?? '');
    if (!normalizedEmail && !normalizedName) {
        return null;
    }
    const lookup = await client.query(`SELECT a.id::text AS id
       FROM migration.core_associates a
      WHERE (
        $1 <> ''
        AND (
          LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1
          OR LOWER(TRIM(COALESCE(a.email, ''))) = $1
          OR LOWER(TRIM(COALESCE(a.private_email, ''))) = $1
        )
      )
         OR (
           $2 <> ''
           AND LOWER(REGEXP_REPLACE(TRIM(COALESCE(a.full_name, CONCAT_WS(' ', a.first_name, a.last_name), '')), '\\s+', ' ', 'g')) = $2
         )
      ORDER BY CASE
        WHEN LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active' OR TRIM(COALESCE(a.status_name, '')) = '1' THEN 0
        ELSE 1
      END,
      CASE
        WHEN $1 <> '' AND LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1 THEN 0
        WHEN $1 <> '' AND LOWER(TRIM(COALESCE(a.email, ''))) = $1 THEN 1
        WHEN $1 <> '' AND LOWER(TRIM(COALESCE(a.private_email, ''))) = $1 THEN 2
        WHEN $2 <> '' AND LOWER(REGEXP_REPLACE(TRIM(COALESCE(a.full_name, CONCAT_WS(' ', a.first_name, a.last_name), '')), '\\s+', ' ', 'g')) = $2 THEN 3
        ELSE 4
      END,
      a.updated_at DESC NULLS LAST,
      a.id DESC
      LIMIT 1`, [normalizedEmail, normalizedName]);
    return lookup.rows[0]?.id ?? null;
}
export async function isRegisteredAssociateEmail(client, email, displayName) {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) {
        return false;
    }
    return (await resolveAssociateIdForAuth(client, normalizedEmail, displayName ?? null)) !== null;
}
export async function getAssociateAccessState(client, email, displayName) {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) {
        return {
            isRegistered: false,
            associateId: null,
            isSuspended: false,
            suspendedReason: null,
        };
    }
    const associateId = await resolveAssociateIdForAuth(client, normalizedEmail, displayName ?? null);
    if (!associateId) {
        return {
            isRegistered: false,
            associateId: null,
            isSuspended: false,
            suspendedReason: null,
        };
    }
    try {
        const suspension = await client.query(`SELECT is_temporarily_suspended, suspended_reason
         FROM migration.associate_access_suspension
        WHERE associate_id = $1
        LIMIT 1`, [associateId]);
        const row = suspension.rows[0];
        return {
            isRegistered: true,
            associateId,
            isSuspended: Boolean(row?.is_temporarily_suspended),
            suspendedReason: row?.suspended_reason ?? null,
        };
    }
    catch {
        // If the suspension table is not present yet, treat as not suspended.
        return {
            isRegistered: true,
            associateId,
            isSuspended: false,
            suspendedReason: null,
        };
    }
}
//# sourceMappingURL=associateAuth.js.map