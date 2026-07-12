import { beforeEach, describe, expect, it, vi } from 'vitest';
const { queryMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
}));
vi.mock('../config/db.js', () => ({
    getOptionalPgPool: () => ({
        query: queryMock,
    }),
}));
vi.mock('../middleware/permissions.js', () => ({
    resolvePermissions: (req, _res, next) => {
        req.permissions = {
            scope: 'GLOBAL',
            marketCenterId: null,
            homeMcId: null,
            marketCenterName: null,
            associateDbId: null,
        };
        next();
    },
}));
import router from './reports.js';
function createFakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}
function getMonthEndHandler() {
    const monthEndLayer = router.stack.find((layer) => layer.route?.path === '/month-end' && layer.route?.methods?.get);
    if (!monthEndLayer) {
        throw new Error('month-end route not found');
    }
    const routeStack = monthEndLayer.route.stack;
    return routeStack[routeStack.length - 1].handle;
}
describe('month-end report SQL regression guard', () => {
    beforeEach(() => {
        queryMock.mockReset();
    });
    it('uses per_tx_mc split CTE and overall totals from per_tx_global', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [
                {
                    market_center_name: 'KW Dynamic',
                    mc_source_id: '158',
                    contracts: '3',
                    units: '6',
                    total_gci: '100.00',
                    growth_share: '10.00',
                    royalties: '20.00',
                    company_dollar: '30.00',
                    cos_to_gci_pct: '30.00',
                    associate_dollar: '40.00',
                    team_dollar: '50.00',
                    overall_contracts: '5',
                    overall_units: '9',
                    overall_total_gci: '200.00',
                    overall_growth_share: '20.00',
                    overall_royalties: '40.00',
                    overall_company_dollar: '60.00',
                    overall_associate_dollar: '80.00',
                    overall_team_dollar: '100.00',
                },
                {
                    market_center_name: 'KW Pivot',
                    mc_source_id: '124',
                    contracts: '4',
                    units: '7',
                    total_gci: '150.00',
                    growth_share: '15.00',
                    royalties: '30.00',
                    company_dollar: '45.00',
                    cos_to_gci_pct: '30.00',
                    associate_dollar: '60.00',
                    team_dollar: '75.00',
                    overall_contracts: '5',
                    overall_units: '9',
                    overall_total_gci: '200.00',
                    overall_growth_share: '20.00',
                    overall_royalties: '40.00',
                    overall_company_dollar: '60.00',
                    overall_associate_dollar: '80.00',
                    overall_team_dollar: '100.00',
                },
            ],
        });
        const req = {
            query: {
                date_from: '2026-05-01',
                date_to: '2026-05-26',
                transaction_status: 'Registered',
                sale_type: 'For Sale',
            },
            permissions: {
                scope: 'GLOBAL',
                marketCenterId: null,
                homeMcId: null,
            },
        };
        const res = createFakeRes();
        await getMonthEndHandler()(req, res);
        expect(queryMock).toHaveBeenCalledTimes(1);
        const [sql] = queryMock.mock.calls[0];
        expect(sql).toContain('FROM per_tx_mc');
        expect(sql).toContain('FROM per_tx_global');
        expect(sql).toContain('r.transaction_id');
        expect(sql).toContain('GROUP BY r.transaction_id');
        expect(res.statusCode).toBe(200);
        expect(res.body?.rows).toHaveLength(2);
        // Guard: totals must come from overall_* values, not sum of MC rows.
        const rowContractsSum = res.body.rows.reduce((sum, row) => sum + row.contracts, 0);
        expect(rowContractsSum).toBe(7);
        expect(res.body.totals.contracts).toBe(5);
        expect(res.body.kpi.contracts).toBe(5);
        expect(res.body.totals.contracts).not.toBe(rowContractsSum);
    });
});
//# sourceMappingURL=reports.month-end.test.js.map