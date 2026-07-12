import { Router } from 'express';
import { env } from '../config/env.js';
import { acquireTokenRopc, loadToken, saveToken, removeToken, setConsentAccepted, loomGet, loomPost, loomGetBinary, } from '../services/loom-client.js';
// ---------------------------------------------------------------------------
// Public callback handler — kept for backwards compat but no longer used
// (ROPC flow acquires token directly; no browser redirect needed)
// ---------------------------------------------------------------------------
export const handleLoomCallback = (_req, res) => {
    const frontendBase = env.corsOrigins[0] ?? 'http://localhost:5173';
    res.redirect(`${frontendBase}/loom`);
};
// ---------------------------------------------------------------------------
// Protected router — everything below requires a valid KWSA JWT
// ---------------------------------------------------------------------------
const router = Router();
function email(req) {
    return req.user.email;
}
function handleLoomError(err, res) {
    const msg = err instanceof Error ? err.message : 'LOOM API error';
    if (msg === 'LOOM_NOT_CONNECTED' || err.loomNotConnected) {
        res.status(403).json({ error: 'LOOM_NOT_CONNECTED' });
        return;
    }
    res.status(502).json({ error: msg });
}
// ---------------------------------------------------------------------------
// Auth — status + connect URL + disconnect
// ---------------------------------------------------------------------------
router.get('/auth/status', async (req, res) => {
    const stored = await loadToken(email(req));
    res.json({ connected: Boolean(stored), loomEmail: stored?.loomEmail ?? null });
});
// POST — acquire LOOM token via ROPC (service account, no browser redirect needed)
router.post('/auth/connect', async (req, res) => {
    try {
        const tokenResp = await acquireTokenRopc();
        await saveToken(email(req), {
            accessToken: tokenResp.access_token,
            refreshToken: tokenResp.refresh_token ?? null,
            expiresAt: tokenResp.expires_in
                ? new Date(Date.now() + tokenResp.expires_in * 1000)
                : null,
            loomEmail: env.loom.integrationEmail,
        });
        res.json({ ok: true });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'LOOM connect failed';
        res.status(502).json({ error: msg });
    }
});
router.delete('/auth/disconnect', async (req, res) => {
    await removeToken(email(req));
    res.json({ ok: true });
});
// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
router.get('/search', async (req, res) => {
    const { q } = req.query;
    try {
        const data = await loomGet(email(req), '/Search/Search', { Address: q });
        // Log what property keys the search returned so we can debug Property/Get
        try {
            const abp = data;
            const items = Array.isArray(abp.result) ? abp.result : (Array.isArray(data) ? data : []);
            if (items.length > 0) {
                const first = items[0];
                const attrs = first.attributes;
                console.log('[LOOM] Search returned', items.length, 'candidates, first key:', attrs?.property_key, 'scheme_id:', attrs?.scheme_id);
            }
        }
        catch { /* logging only */ }
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.post('/search/advanced', async (req, res) => {
    try {
        const data = await loomPost(email(req), '/Search/AdvanceSearch', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------
// Helper to unwrap ABP { result: ..., success: true } wrapper
function unwrapAbp(data) {
    if (data && typeof data === 'object' && 'result' in data) {
        return data.result;
    }
    return data;
}
router.get('/property', async (req, res) => {
    const { key, unit } = req.query;
    try {
        console.log('[LOOM] /property called with key:', key, 'unit:', unit);
        // PropertyReport/Create returns comprehensive deed/valuation/bond data (unlike Property/Get which is minimal)
        const reportData = await loomPost(email(req), '/PropertyReport/Create', {
            propertyKey: key,
            unitNumber: unit ?? '00000',
            consented: true,
            purchaseValuation: false,
            cachedReport: true,
            includeOwnerCellNumbers: false,
            includeOwnerEmails: false,
        });
        const reportResult = unwrapAbp(reportData);
        if (!reportResult) {
            res.json({});
            return;
        }
        const rpt = reportResult.report;
        if (!rpt) {
            res.json({});
            return;
        }
        const gen = rpt.general ?? {};
        const addr = gen.address ?? {};
        const deeds = rpt.deeds ?? {};
        const transfer = deeds.transfer ?? {};
        const valuation = rpt.valuation ?? {};
        // Bonds — may be in deeds.bonds or deeds.transfer.bonds
        const bondList = Array.isArray(deeds.bonds) ? deeds.bonds :
            Array.isArray(transfer.bonds) ? transfer.bonds : [];
        const firstBond = bondList[0] ?? {};
        res.json({
            propertyKey: key,
            unitNumber: unit,
            address: gen.property_key ? addr.full_address : null,
            municipality: addr.authority_name ?? addr.municipality ?? null,
            province: null,
            suburb: addr.subplace ?? null,
            erf_number: transfer.erf_number ?? addr.erf_number ?? null,
            erfSize: transfer.extent ?? addr.extent ?? null,
            floorArea: null,
            zoning: transfer.property_type_name ?? addr.property_type_name ?? null,
            rates: null,
            levies: null,
            ownerName: Array.isArray(deeds.owners) && deeds.owners[0]
                ? deeds.owners[0].name ?? null
                : null,
            titleDeedNumber: transfer.title_deed ?? null,
            bondAmount: firstBond.bond_amount ?? firstBond.amount ?? null,
            bondHolder: firstBond.bond_holder ?? firstBond.holder ?? null,
            valuationAmount: valuation.estimate ?? valuation.subplace_valuation ?? null,
            valuationDate: valuation.dateString ?? valuation.date ?? null,
            transferHistory: Array.isArray(deeds.transfer_history)
                ? deeds.transfer_history.map((t) => ({
                    saleDate: t.sell_date,
                    registrationDate: t.registration_date,
                    salePrice: t.sell_price,
                    description: t.description,
                }))
                : transfer.sell_price ? [{
                        saleDate: transfer.sell_date,
                        registrationDate: transfer.registration_date,
                        salePrice: transfer.sell_price,
                        description: null,
                    }] : [],
        });
    }
    catch (err) {
        // LOOM returned an error for this property — return empty rather than propagating 502
        const msg = err instanceof Error ? err.message : 'unknown';
        console.warn('[LOOM] Property/Get failed for key:', req.query.key, '—', msg);
        res.json({});
    }
});
router.get('/property/units', async (req, res) => {
    const { key } = req.query;
    try {
        const data = await loomGet(email(req), '/Property/GetUnitNumbers', { propertyKey: key });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// Property sales — extract transfer_history from PropertyReport/Create
router.get('/property/sales', async (req, res) => {
    const { key, unit } = req.query;
    try {
        const reportData = await loomPost(email(req), '/PropertyReport/Create', {
            propertyKey: key,
            unitNumber: unit ?? '00000',
            consented: true,
            purchaseValuation: false,
            cachedReport: true,
            includeOwnerCellNumbers: false,
            includeOwnerEmails: false,
        });
        const reportResult = unwrapAbp(reportData);
        if (!reportResult) {
            res.json([]);
            return;
        }
        const rpt = reportResult.report;
        if (!rpt) {
            res.json([]);
            return;
        }
        const deeds = rpt.deeds ?? {};
        const transferHistory = Array.isArray(deeds.transfer_history)
            ? deeds.transfer_history
            : [];
        const sales = transferHistory.map(t => ({
            salePrice: t.sell_price,
            saleDate: t.sell_date,
            registrationDate: t.registration_date,
            buyerName: null,
            sellerName: null,
            description: t.description,
        }));
        res.json(sales);
    }
    catch (err) {
        res.json([]);
    }
});
router.get('/property/sales-buckets', async (req, res) => {
    try {
        const data = await loomGet(email(req), '/Report/GetSalesBuckets');
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/property/owner', async (req, res) => {
    const { key, unit } = req.query;
    try {
        const data = await loomGet(email(req), '/Property/GetOwnerNameAndIds', { propertyKey: key, unitNumber: unit, Consent: 'false' });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Reports — Property
// ---------------------------------------------------------------------------
router.get('/reports/property', async (req, res) => {
    try {
        // Report/GetAll?type=property is the only working LOOM endpoint for listing reports
        const data = await loomGet(email(req), '/Report/GetAll', {
            type: 'property',
            MaxResultCount: '20',
        });
        const inner = unwrapAbp(data);
        res.json({ items: inner?.items ?? [], totalCount: inner?.totalCount ?? 0 });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        console.warn('[LOOM] Report/GetAll (property) failed:', msg);
        res.json({ items: [], totalCount: 0 });
    }
});
router.post('/reports/property', async (req, res) => {
    try {
        // PropertyReportGetPropertyRequestDto: propertyKey, unitNumber, consented, purchaseValuation,
        // cachedReport, includeOwnerCellNumbers, includeOwnerEmails
        const incoming = req.body;
        const body = {
            propertyKey: incoming.propertyKey,
            unitNumber: incoming.unitNumber ?? '00000',
            consented: true,
            purchaseValuation: false,
            cachedReport: true,
            includeOwnerCellNumbers: false,
            includeOwnerEmails: false,
        };
        const data = await loomPost(email(req), '/PropertyReport/Create', body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/reports/property/download', async (req, res) => {
    const { versionId } = req.query;
    try {
        const { buffer, contentType, fileName } = await loomGetBinary(email(req), '/PropertyReport/GetReport', { versionId });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', String(buffer.length));
        res.end(buffer);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Reports — Area
// ---------------------------------------------------------------------------
router.get('/reports/area', async (req, res) => {
    // Area reports are based on saved areas (polygon IDs), not property keys.
    // Return saved area reports list — user must have created areas first.
    try {
        // List the user's saved area reports (most recent 10)
        const data = await loomGet(email(req), '/Report/GetAll', {
            MaxResultCount: '10',
            SortingOrder: 'desc',
        });
        const inner = unwrapAbp(data);
        res.json({ items: inner?.items ?? [], totalCount: inner?.totalCount ?? 0 });
    }
    catch (err) {
        // Avoid frontend hard failures when LOOM intermittently errors on area report listing.
        const msg = err instanceof Error ? err.message : 'unknown';
        console.warn('[LOOM] Report/GetAll failed:', msg);
        res.json({ items: [], totalCount: 0 });
    }
});
router.post('/reports/area', async (req, res) => {
    try {
        // Create area report — body must include { id: <saved-area-id> }
        const data = await loomPost(email(req), '/AreaReport/Create', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/reports/area/download', async (req, res) => {
    const { versionId } = req.query;
    try {
        const { buffer, contentType, fileName } = await loomGetBinary(email(req), '/AreaReport/GetReport', { versionId });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', String(buffer.length));
        res.end(buffer);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Reports — Street
// ---------------------------------------------------------------------------
router.get('/reports/street', async (_req, res) => {
    // Street reports are based on saved streets, not property keys.
    // Return empty list — street reports require a saved street first.
    res.json({ items: [], totalCount: 0 });
});
router.post('/reports/street', async (req, res) => {
    try {
        // Create street report — body must include { id: <saved-street-id> }
        const data = await loomPost(email(req), '/StreetReport/Create', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/reports/street/download', async (req, res) => {
    const { versionId } = req.query;
    try {
        const { buffer, contentType, fileName } = await loomGetBinary(email(req), '/StreetReport/GetReport', { versionId });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', String(buffer.length));
        res.end(buffer);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------
router.get('/area/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        res.json([]);
        return;
    }
    try {
        const data = await loomGet(email(req), '/Search/Search', { Address: q });
        const arr = Array.isArray(data) ? data : data.result ?? [];
        // Filter to only Location/RiskscapeSuburb results (areas, not street addresses)
        const areas = (Array.isArray(arr) ? arr : [])
            .filter((item) => {
            if (!item || typeof item !== 'object')
                return false;
            const obj = item;
            const subcat = String(obj.subcategory ?? '').toLowerCase();
            return subcat.includes('suburb') || subcat.includes('location') || subcat.includes('area');
        });
        res.json(areas);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/area', async (req, res) => {
    const { id } = req.query;
    if (!id) {
        // No area id — list all saved areas instead
        try {
            const data = await loomGet(email(req), '/Area/GetAll', { MaxResultCount: '20' });
            const inner = unwrapAbp(data);
            res.json({ items: inner?.items ?? [], totalCount: inner?.totalCount ?? 0 });
        }
        catch (err) {
            handleLoomError(err, res);
        }
        return;
    }
    try {
        const data = await loomGet(email(req), '/Area/Get', { Id: id });
        res.json(unwrapAbp(data));
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/area/saved', async (req, res) => {
    try {
        const data = await loomGet(email(req), '/Area/GetAll', { MaxResultCount: '20', SortingOrder: 'desc' });
        const inner = unwrapAbp(data);
        res.json({ items: inner?.items ?? [], totalCount: inner?.totalCount ?? 0 });
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.post('/area/save', async (req, res) => {
    try {
        const data = await loomPost(email(req), '/Area/Create', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Street
// ---------------------------------------------------------------------------
router.get('/street/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        res.json([]);
        return;
    }
    try {
        const data = await loomGet(email(req), '/Search/Search', { Address: q });
        const arr = Array.isArray(data) ? data : data.result ?? [];
        // Filter to StreetAddress/StreetNumberMain results (streets, not suburbs)
        const streets = (Array.isArray(arr) ? arr : [])
            .filter((item) => {
            if (!item || typeof item !== 'object')
                return false;
            const obj = item;
            const cat = String(obj.category ?? '').toLowerCase();
            const subcat = String(obj.subcategory ?? '').toLowerCase();
            return cat === 'streetaddress' || subcat.includes('street');
        });
        res.json(streets);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
// GET /consent/terms and GET /consent both map to /Consent/Get (returns HTML content + version id)
router.get('/consent/terms', async (req, res) => {
    try {
        const data = await loomGet(email(req), '/Consent/Get');
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/consent', async (req, res) => {
    try {
        const token = await loadToken(email(req));
        const data = await loomGet(email(req), '/Consent/Get');
        const inner = unwrapAbp(data) ?? {};
        res.json({ ...inner, accepted: token?.consentAccepted ?? false });
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.post('/consent', async (req, res) => {
    // Consent acceptance is handled client-side for POPIA; return the latest terms
    try {
        await setConsentAccepted(email(req));
        const data = await loomGet(email(req), '/Consent/Get');
        const inner = unwrapAbp(data) ?? {};
        res.json({ ...inner, accepted: true });
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.delete('/consent', async (_req, res) => {
    // No delete consent in LOOM API — return ok
    res.json({ ok: true });
});
// ---------------------------------------------------------------------------
// Contact Details
// ---------------------------------------------------------------------------
// Request contacts for a specific property (via Street/RequestContactDetails)
router.post('/contacts', async (req, res) => {
    const body = req.body;
    try {
        // StreetContactDetailRequestModel: propertyKey, unitNumber, fullNameAndId, contactNumber,
        // consented, estimation (dry-run), maxNumbers, saleAll/ageAll/etc. (default false)
        const requestBody = {
            propertyKey: body.propertyKey,
            unitNumber: body.unitNumber ?? '00000',
            fullNameAndId: true,
            contactNumber: true,
            contactEmail: false,
            consented: true, // consent is managed by the LOOM Consent/Get acceptance
            estimation: false, // false = actual request (true = just estimate cost)
            maxNumbers: 1,
            saleAll: false,
            ageAll: false,
            fullTitle: true,
            sectionalTitle: true,
        };
        const data = await loomPost(email(req), '/Street/RequestContactDetails', requestBody);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// List saved contact batches for the current user, or fetch property owner contacts
router.get('/contacts', async (req, res) => {
    const { propertyKey, unit } = req.query;
    if (propertyKey) {
        // Fetch owner contacts via PropertyReport/Create with includeOwnerCellNumbers
        try {
            const reportData = await loomPost(email(req), '/PropertyReport/Create', {
                propertyKey,
                unitNumber: unit ?? '00000',
                consented: true,
                purchaseValuation: false,
                cachedReport: true,
                includeOwnerCellNumbers: true,
                includeOwnerEmails: true,
            });
            const reportResult = unwrapAbp(reportData);
            const rpt = reportResult?.report;
            const deeds = rpt?.deeds ?? {};
            const owners = Array.isArray(deeds.owners) ? deeds.owners : [];
            const contacts = owners.map(o => ({
                name: o.name,
                idNumber: o.id,
                type: o.type,
                maritalStatus: o.marital_status,
                cellNumber: o.cell_number,
                email: o.email,
                hasConsent: o.hasConsent,
                consentDate: o.consent_Date,
            }));
            res.json({ items: contacts, totalCount: contacts.length });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown';
            console.warn('[LOOM] contacts fetch failed:', msg);
            res.json({ items: [], totalCount: 0 });
        }
        return;
    }
    try {
        const data = await loomGet(email(req), '/ContactDetails/GetAll', {
            MaxResultCount: '10',
            SortingOrder: 'desc',
        });
        const inner = unwrapAbp(data);
        res.json({ items: inner?.items ?? [], totalCount: inner?.totalCount ?? 0 });
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// Get a specific contact batch by ID
router.get('/contacts/batch', async (req, res) => {
    const { id } = req.query;
    try {
        const data = await loomGet(email(req), '/ContactDetails/Get', { Id: id });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// CIPC
// ---------------------------------------------------------------------------
router.post('/cipc/search', async (req, res) => {
    const body = req.body;
    try {
        const searchBody = {
            registrationNumber: body.registrationNumber ?? null,
            companyName: body.companyName ?? body.q ?? null,
            pageNumber: body.pageNumber ?? 1,
        };
        const data = await loomPost(email(req), '/Cipc/CompanySearchWithFilters', searchBody);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// Keep GET for backwards compat with frontend
router.get('/cipc/search', async (req, res) => {
    const { q, regNo } = req.query;
    try {
        const searchBody = {
            registrationNumber: regNo ?? null,
            companyName: q ?? null,
            pageNumber: 1,
        };
        const data = await loomPost(email(req), '/Cipc/CompanySearchWithFilters', searchBody);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/cipc/detail', async (req, res) => {
    const { reportid } = req.query;
    try {
        const data = await loomGet(email(req), '/Cipc/GetCipcCompanyReportById', { reportid });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/cipc/contacts', async (req, res) => {
    const { reportid } = req.query;
    try {
        const data = await loomGet(email(req), '/Cipc/GetDirectorContactDetailsAllByReportId', { reportid });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------
router.post('/trust/search', async (req, res) => {
    try {
        const data = await loomPost(email(req), '/Trust/TrustSearch', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
// Keep GET for backwards compat
router.get('/trust/search', async (req, res) => {
    const { q } = req.query;
    try {
        const data = await loomPost(email(req), '/Trust/TrustSearch', { trustName: q, trustNumber: q });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.post('/trust/detail', async (req, res) => {
    try {
        const data = await loomPost(email(req), '/Trust/GetTrustDetails', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/trust/detail', async (req, res) => {
    const { reportId } = req.query;
    try {
        const data = await loomGet(email(req), '/Trust/GetTrustReport', { reportId });
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.post('/trust/contacts', async (req, res) => {
    try {
        const data = await loomPost(email(req), '/Trust/GeTrusteeContactDetails', req.body);
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
router.get('/trust/contacts', async (_req, res) => {
    // Legacy GET — trust contacts require a POST with trustee details
    res.json([]);
});
// ---------------------------------------------------------------------------
// Map token
// ---------------------------------------------------------------------------
router.get('/map/token', async (req, res) => {
    try {
        const data = await loomGet(email(req), '/Map/GetToken');
        res.json(data);
    }
    catch (err) {
        handleLoomError(err, res);
    }
});
export default router;
//# sourceMappingURL=loom.js.map