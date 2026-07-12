import { Router } from 'express';
import { env } from '../config/env.js';
import { getRequiredPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
const router = Router();
function selfBaseUrl() {
    return `http://127.0.0.1:${env.port ?? 3000}`;
}
function normalizeInputs(rawInputs) {
    if (!Array.isArray(rawInputs))
        return [];
    const values = rawInputs
        .flatMap((value) => String(value ?? '').split(/[\s,;]+/g))
        .map((value) => value.trim())
        .filter(Boolean);
    return [...new Set(values)];
}
function isKwlNumber(value) {
    return /^KWL\d+$/i.test(value.trim());
}
function isNumericId(value) {
    return /^\d+$/.test(value.trim());
}
function kwwHeaders(apiKey, apiSecret, kwuid) {
    return {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'ascii').toString('base64')}`,
        'x-consumer-token-user-id': kwuid,
        'x-kwuid': kwuid,
        'API-Key': apiKey,
        'Content-Type': 'application/json',
    };
}
async function parseJsonSafely(response) {
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function extractKwwSource(body) {
    if (!body || typeof body !== 'object')
        return null;
    const root = body;
    const hitsObj = root.hits;
    if (!hitsObj || typeof hitsObj !== 'object')
        return null;
    const innerHits = hitsObj.hits;
    if (!Array.isArray(innerHits) || innerHits.length === 0)
        return null;
    const first = innerHits[0];
    if (!first || typeof first !== 'object')
        return null;
    const source = first._source;
    if (!source || typeof source !== 'object')
        return null;
    return source;
}
async function callListingApi(path, token, activeContext) {
    const url = `${selfBaseUrl()}/api${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
    if (activeContext)
        headers['x-active-context'] = activeContext;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(60000),
        });
        const body = await parseJsonSafely(response);
        return { ok: response.ok, status: response.status, body };
    }
    catch (error) {
        return {
            ok: false,
            status: 0,
            body: { error: error instanceof Error ? error.message : String(error) },
        };
    }
}
function ensureRegionalAdminAccess(req, res) {
    const perms = req.permissions;
    if (!perms || !perms.isRegionalAdmin || perms.scope !== 'GLOBAL') {
        res.status(403).json({
            error: 'Only Regional Admin users in Regional Admin context can access Portal Recovery.',
        });
        return false;
    }
    return true;
}
router.use(resolvePermissions);
router.post('/run', async (req, res) => {
    if (!env.portalRecovery.enabled && !env.isDevelopment) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!ensureRegionalAdminAccess(req, res))
        return;
    const mode = String(req.body?.mode ?? '').trim().toLowerCase();
    const dryRun = Boolean(req.body?.dryRun);
    const validateOnly = Boolean(req.body?.validateOnly);
    const rawInputs = normalizeInputs(req.body?.listingNumbers);
    if (mode !== 'fix-owner-publish' && mode !== 'force-withdraw') {
        return res.status(400).json({ error: 'mode must be fix-owner-publish or force-withdraw.' });
    }
    if (rawInputs.length === 0) {
        return res.status(400).json({ error: 'At least one listing number is required.' });
    }
    const kwwBaseUrl = env.kww.baseUrl?.replace(/\/$/, '') ?? '';
    const kwwApiKey = env.kww.apiKey ?? '';
    const kwwApiSecret = env.kww.apiSecret ?? '';
    if (!kwwBaseUrl || !kwwApiKey || !kwwApiSecret) {
        return res.status(501).json({ error: 'KWW integration is not configured.' });
    }
    const authHeader = String(req.headers.authorization ?? '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const activeContext = String(req.headers['x-active-context'] ?? '').trim() || null;
    const pool = getRequiredPgPool();
    const requesterKwuidResult = await pool.query(`SELECT kwuid::text
       FROM migration.core_associates
      WHERE id::text = $1
      LIMIT 1`, [req.permissions?.associateDbId ?? '']);
    const requesterKwuid = requesterKwuidResult.rows[0]?.kwuid?.trim() || '813774';
    const results = [];
    for (const input of rawInputs) {
        const normalizedInput = input.trim().toUpperCase();
        const actions = [];
        try {
            if (mode === 'fix-owner-publish') {
                if (!isKwlNumber(normalizedInput)) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'validation-error',
                        success: false,
                        message: 'Owner fix mode expects KWL listing numbers (e.g. KWL298436).',
                        actions,
                    });
                    continue;
                }
                const localResult = await pool.query(`SELECT cl.id::text,
                  cl.listing_number,
                  cl.kww_sync_status,
                  a.kwuid::text AS target_kwuid
             FROM migration.core_listings cl
             LEFT JOIN migration.listing_agents la ON la.listing_id::text = cl.id::text
             LEFT JOIN migration.core_associates a ON a.id::text = la.associate_id::text
            WHERE cl.listing_number = $1
            ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
            LIMIT 1`, [normalizedInput]);
                if (localResult.rowCount === 0) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'not-found',
                        success: false,
                        message: 'Listing not found in local database.',
                        actions,
                    });
                    continue;
                }
                const local = localResult.rows[0];
                const targetKwuid = local.target_kwuid?.trim() ?? null;
                if (!targetKwuid) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'validation-error',
                        success: false,
                        message: 'Primary agent KWUID is missing on the local listing.',
                        localListingId: local.id,
                        localListingNumber: local.listing_number,
                        actions,
                    });
                    continue;
                }
                const lookupUrl = `${kwwBaseUrl}?filter[list_key][is]=${encodeURIComponent(`KWW_KWZA-${normalizedInput}`)}`;
                actions.push('lookup-by-list-key');
                const lookupResponse = await fetch(lookupUrl, {
                    method: 'GET',
                    headers: kwwHeaders(kwwApiKey, kwwApiSecret, targetKwuid),
                    signal: AbortSignal.timeout(30000),
                });
                const lookupBody = await parseJsonSafely(lookupResponse);
                const source = extractKwwSource(lookupBody);
                if (!source) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'not-found',
                        success: false,
                        message: 'Listing not found on KWW by list key.',
                        localListingId: local.id,
                        localListingNumber: local.listing_number,
                        targetKwuid,
                        actions,
                    });
                    continue;
                }
                const listUuid = source.list_uuid ? String(source.list_uuid) : null;
                const listId = source.list_id != null ? String(source.list_id) : null;
                const ownerKwuid = source.list_kw_uid != null ? String(source.list_kw_uid) : null;
                const remote = {
                    listId,
                    listUuid,
                    listKey: source.list_key ? String(source.list_key) : null,
                    ownerKwuid,
                    listStatus: source.list_status ? String(source.list_status) : null,
                    listStatusId: Number.isFinite(Number(source.list_status_id)) ? Number(source.list_status_id) : null,
                    manualEntry: typeof source.manual_entry === 'boolean' ? source.manual_entry : null,
                };
                if (!listUuid) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'error',
                        success: false,
                        message: 'KWW listing does not expose list_uuid.',
                        localListingId: local.id,
                        localListingNumber: local.listing_number,
                        targetKwuid,
                        remote,
                        actions,
                    });
                    continue;
                }
                if (dryRun || validateOnly) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'dry-run',
                        success: true,
                        message: 'Validation succeeded. Listing is ready for owner-fix and publish.',
                        localListingId: local.id,
                        localListingNumber: local.listing_number,
                        targetKwuid,
                        remote,
                        actions,
                    });
                    continue;
                }
                actions.push('patch-owner-and-manual-entry');
                const patchResponse = await fetch(`${kwwBaseUrl}/${encodeURIComponent(listUuid)}`, {
                    method: 'PATCH',
                    headers: kwwHeaders(kwwApiKey, kwwApiSecret, targetKwuid),
                    body: JSON.stringify({
                        list_uuid: listUuid,
                        manual_entry: true,
                        list_kw_uid: Number(targetKwuid),
                        list_agent_office: { list_agent_key: targetKwuid },
                    }),
                    signal: AbortSignal.timeout(30000),
                });
                let patchBody = await parseJsonSafely(patchResponse);
                let patchOk = patchResponse.ok;
                let patchStatus = patchResponse.status;
                if (!patchOk) {
                    const initialErrorCode = String(patchBody?.errorCode ?? '').toUpperCase();
                    if (initialErrorCode === 'FORBIDDEN' && requesterKwuid && requesterKwuid !== targetKwuid) {
                        actions.push('retry-owner-patch-with-requester-kwuid');
                        const retryPatchResponse = await fetch(`${kwwBaseUrl}/${encodeURIComponent(listUuid)}`, {
                            method: 'PATCH',
                            headers: kwwHeaders(kwwApiKey, kwwApiSecret, requesterKwuid),
                            body: JSON.stringify({
                                list_uuid: listUuid,
                                manual_entry: true,
                                list_kw_uid: Number(targetKwuid),
                                list_agent_office: { list_agent_key: targetKwuid },
                            }),
                            signal: AbortSignal.timeout(30000),
                        });
                        patchBody = await parseJsonSafely(retryPatchResponse);
                        patchOk = retryPatchResponse.ok;
                        patchStatus = retryPatchResponse.status;
                    }
                }
                if (!patchOk) {
                    const errorCode = String(patchBody?.errorCode ?? '').toUpperCase();
                    if (errorCode === 'FORBIDDEN') {
                        actions.push('verify-owner-alignment-after-forbidden');
                        const verifyOwnerResponse = await fetch(lookupUrl, {
                            method: 'GET',
                            headers: kwwHeaders(kwwApiKey, kwwApiSecret, requesterKwuid),
                            signal: AbortSignal.timeout(30000),
                        });
                        const verifyOwnerBody = await parseJsonSafely(verifyOwnerResponse);
                        const verifiedOwnerSource = extractKwwSource(verifyOwnerBody);
                        const ownerAligned = verifiedOwnerSource?.list_kw_uid != null && String(verifiedOwnerSource.list_kw_uid) === targetKwuid;
                        if (!ownerAligned) {
                            actions.push('owner-not-verified-after-patch-forbidden-continue');
                        }
                        else {
                            actions.push('owner-aligned-despite-patch-forbidden');
                        }
                    }
                    else {
                        results.push({
                            input,
                            normalizedInput,
                            status: 'error',
                            success: false,
                            message: String(patchBody?.message ?? `KWW patch failed with status ${patchStatus}`),
                            localListingId: local.id,
                            localListingNumber: local.listing_number,
                            targetKwuid,
                            remote,
                            actions,
                            details: { patchStatus, patchBody },
                        });
                        continue;
                    }
                }
                if (!token) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'error',
                        success: false,
                        message: 'Bearer token missing on request; cannot trigger publish step.',
                        localListingId: local.id,
                        localListingNumber: local.listing_number,
                        targetKwuid,
                        remote,
                        actions,
                    });
                    continue;
                }
                actions.push('publish-to-kww');
                const publishResult = await callListingApi(`/listings/${encodeURIComponent(local.id)}/publish-to-kww`, token, activeContext);
                const publishBody = (publishResult.body && typeof publishResult.body === 'object')
                    ? publishResult.body
                    : null;
                const publishOk = publishResult.ok && publishBody?.success === true;
                if (!publishOk) {
                    const publishMessage = String(publishBody?.message ?? `Publish step failed with status ${publishResult.status}`);
                    const isKwwPermissionDenied = /permissions\s+to\s+edit\s+this\s+listing/i.test(publishMessage);
                    if (isKwwPermissionDenied) {
                        actions.push('sync-local-from-kww-after-owner-fix');
                        const verifyAfterOwnerResponse = await fetch(lookupUrl, {
                            method: 'GET',
                            headers: kwwHeaders(kwwApiKey, kwwApiSecret, targetKwuid),
                            signal: AbortSignal.timeout(30000),
                        });
                        const verifyAfterOwnerBody = await parseJsonSafely(verifyAfterOwnerResponse);
                        const verifiedAfterOwner = extractKwwSource(verifyAfterOwnerBody);
                        const syncedReferenceId = verifiedAfterOwner?.list_id != null ? String(verifiedAfterOwner.list_id) : listId;
                        const syncedListUuid = verifiedAfterOwner?.list_uuid ? String(verifiedAfterOwner.list_uuid) : listUuid;
                        const syncedListKey = verifiedAfterOwner?.list_key ? String(verifiedAfterOwner.list_key) : remote.listKey;
                        await pool.query(`UPDATE migration.core_listings
                 SET kww_property_reference = COALESCE($1, kww_property_reference),
                     kww_ref1 = COALESCE($2, kww_ref1),
                     kww_ref2 = COALESCE($3, kww_ref2),
                     kww_sync_status = 'Active',
                     updated_at = NOW()
               WHERE id::text = $4`, [syncedReferenceId, syncedListUuid, syncedListKey, local.id]);
                        results.push({
                            input,
                            normalizedInput,
                            status: 'success',
                            success: true,
                            message: 'Owner was fixed on KWW. Full publish is blocked by KWW permissions for this listing, so local KWW references were synced instead.',
                            localListingId: local.id,
                            localListingNumber: local.listing_number,
                            targetKwuid,
                            remote: {
                                listId: syncedReferenceId,
                                listUuid: syncedListUuid,
                                listKey: syncedListKey,
                                ownerKwuid: verifiedAfterOwner?.list_kw_uid != null ? String(verifiedAfterOwner.list_kw_uid) : targetKwuid,
                                listStatus: verifiedAfterOwner?.list_status ? String(verifiedAfterOwner.list_status) : remote.listStatus,
                                listStatusId: Number.isFinite(Number(verifiedAfterOwner?.list_status_id)) ? Number(verifiedAfterOwner?.list_status_id) : remote.listStatusId,
                                manualEntry: typeof verifiedAfterOwner?.manual_entry === 'boolean' ? verifiedAfterOwner.manual_entry : true,
                            },
                            actions,
                            details: { publishStatus: publishResult.status, publishBody },
                        });
                        continue;
                    }
                    results.push({
                        input,
                        normalizedInput,
                        status: 'error',
                        success: false,
                        message: publishMessage,
                        localListingId: local.id,
                        localListingNumber: local.listing_number,
                        targetKwuid,
                        remote,
                        actions,
                        details: { publishStatus: publishResult.status, publishBody },
                    });
                    continue;
                }
                actions.push('verify-after-publish');
                const verifyResponse = await fetch(lookupUrl, {
                    method: 'GET',
                    headers: kwwHeaders(kwwApiKey, kwwApiSecret, targetKwuid),
                    signal: AbortSignal.timeout(30000),
                });
                const verifyBody = await parseJsonSafely(verifyResponse);
                const verified = extractKwwSource(verifyBody);
                results.push({
                    input,
                    normalizedInput,
                    status: 'success',
                    success: true,
                    message: 'Owner fixed, publish completed, and listing verified on KWW.',
                    localListingId: local.id,
                    localListingNumber: local.listing_number,
                    targetKwuid,
                    remote: {
                        listId: verified?.list_id != null ? String(verified.list_id) : listId,
                        listUuid: verified?.list_uuid ? String(verified.list_uuid) : listUuid,
                        listKey: verified?.list_key ? String(verified.list_key) : remote.listKey,
                        ownerKwuid: verified?.list_kw_uid != null ? String(verified.list_kw_uid) : targetKwuid,
                        listStatus: verified?.list_status ? String(verified.list_status) : remote.listStatus,
                        listStatusId: Number.isFinite(Number(verified?.list_status_id)) ? Number(verified?.list_status_id) : remote.listStatusId,
                        manualEntry: typeof verified?.manual_entry === 'boolean' ? verified.manual_entry : true,
                    },
                    actions,
                    details: { publishStatus: publishResult.status },
                });
            }
            else {
                if (!isNumericId(normalizedInput) && !isKwlNumber(normalizedInput)) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'validation-error',
                        success: false,
                        message: 'Withdraw mode expects a numeric KWW list ID or a KWL listing number.',
                        actions,
                    });
                    continue;
                }
                const lookupUrl = isNumericId(normalizedInput)
                    ? `${kwwBaseUrl}?filter[list_id][is]=${encodeURIComponent(normalizedInput)}`
                    : `${kwwBaseUrl}?filter[list_key][is]=${encodeURIComponent(`KWW_KWZA-${normalizedInput}`)}`;
                actions.push(isNumericId(normalizedInput) ? 'lookup-by-list-id' : 'lookup-by-list-key');
                const lookupResponse = await fetch(lookupUrl, {
                    method: 'GET',
                    headers: kwwHeaders(kwwApiKey, kwwApiSecret, requesterKwuid),
                    signal: AbortSignal.timeout(30000),
                });
                const lookupBody = await parseJsonSafely(lookupResponse);
                const source = extractKwwSource(lookupBody);
                if (!source) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'not-found',
                        success: false,
                        message: 'Listing not found on KWW.',
                        actions,
                    });
                    continue;
                }
                const listUuid = source.list_uuid ? String(source.list_uuid) : null;
                const ownerKwuid = source.list_kw_uid != null ? String(source.list_kw_uid) : null;
                const remote = {
                    listId: source.list_id != null ? String(source.list_id) : null,
                    listUuid,
                    listKey: source.list_key ? String(source.list_key) : null,
                    ownerKwuid,
                    listStatus: source.list_status ? String(source.list_status) : null,
                    listStatusId: Number.isFinite(Number(source.list_status_id)) ? Number(source.list_status_id) : null,
                    manualEntry: typeof source.manual_entry === 'boolean' ? source.manual_entry : null,
                };
                if ((remote.listStatus ?? '').toLowerCase() === 'withdrawn' && remote.listStatusId === 11) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'already-correct',
                        success: true,
                        message: 'Listing is already withdrawn.',
                        remote,
                        actions,
                    });
                    continue;
                }
                if (!listUuid || !ownerKwuid) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'error',
                        success: false,
                        message: 'KWW listing does not expose list_uuid or owner kwuid.',
                        remote,
                        actions,
                    });
                    continue;
                }
                if (dryRun || validateOnly) {
                    results.push({
                        input,
                        normalizedInput,
                        status: 'dry-run',
                        success: true,
                        message: 'Validation succeeded. Listing is ready for forced withdraw.',
                        remote,
                        actions,
                    });
                    continue;
                }
                actions.push('patch-withdrawn');
                const patchResponse = await fetch(`${kwwBaseUrl}/${encodeURIComponent(listUuid)}`, {
                    method: 'PATCH',
                    headers: kwwHeaders(kwwApiKey, kwwApiSecret, ownerKwuid),
                    body: JSON.stringify({
                        list_uuid: listUuid,
                        manual_entry: true,
                        list_status: 'Withdrawn',
                        list_status_id: 11,
                        kwls_status: 'Withdrawn',
                    }),
                    signal: AbortSignal.timeout(30000),
                });
                const patchBody = await parseJsonSafely(patchResponse);
                if (!patchResponse.ok) {
                    const errorCode = String(patchBody?.errorCode ?? '').toUpperCase();
                    results.push({
                        input,
                        normalizedInput,
                        status: errorCode === 'FORBIDDEN' ? 'forbidden' : 'error',
                        success: false,
                        message: String(patchBody?.message ?? `Withdraw patch failed with status ${patchResponse.status}`),
                        remote,
                        actions,
                        details: { patchStatus: patchResponse.status, patchBody },
                    });
                    continue;
                }
                actions.push('verify-withdrawn');
                const verifyResponse = await fetch(lookupUrl, {
                    method: 'GET',
                    headers: kwwHeaders(kwwApiKey, kwwApiSecret, ownerKwuid),
                    signal: AbortSignal.timeout(30000),
                });
                const verifyBody = await parseJsonSafely(verifyResponse);
                const verified = extractKwwSource(verifyBody);
                const verifiedStatus = verified?.list_status ? String(verified.list_status) : remote.listStatus;
                const verifiedStatusId = Number.isFinite(Number(verified?.list_status_id))
                    ? Number(verified?.list_status_id)
                    : remote.listStatusId;
                const success = (verifiedStatus ?? '').toLowerCase() === 'withdrawn' || verifiedStatusId === 11;
                results.push({
                    input,
                    normalizedInput,
                    status: success ? 'success' : 'error',
                    success,
                    message: success ? 'Listing withdrawn successfully.' : 'Withdraw patch was accepted but verification did not confirm withdrawn state.',
                    remote: {
                        listId: verified?.list_id != null ? String(verified.list_id) : remote.listId,
                        listUuid: verified?.list_uuid ? String(verified.list_uuid) : remote.listUuid,
                        listKey: verified?.list_key ? String(verified.list_key) : remote.listKey,
                        ownerKwuid: verified?.list_kw_uid != null ? String(verified.list_kw_uid) : remote.ownerKwuid,
                        listStatus: verifiedStatus,
                        listStatusId: verifiedStatusId,
                        manualEntry: typeof verified?.manual_entry === 'boolean' ? verified.manual_entry : remote.manualEntry,
                    },
                    actions,
                });
            }
        }
        catch (error) {
            results.push({
                input,
                normalizedInput,
                status: 'error',
                success: false,
                message: error instanceof Error ? error.message : String(error),
                actions,
            });
        }
    }
    const counts = results.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
    }, {});
    return res.json({
        mode,
        dryRun,
        validateOnly,
        total: rawInputs.length,
        counts,
        results,
    });
});
export default router;
//# sourceMappingURL=portalRecovery.js.map