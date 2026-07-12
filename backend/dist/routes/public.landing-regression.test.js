import { beforeEach, describe, expect, it, vi } from 'vitest';
const { queryMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
}));
vi.mock('../config/publicDb.js', () => ({
    getPublicReadOnlyPgPool: () => ({
        query: queryMock,
    }),
}));
vi.mock('../config/logger.js', () => ({
    logger: {
        warn: vi.fn(),
    },
}));
vi.mock('../config/env.js', () => ({
    env: {
        nodeEnv: 'test',
        isDevelopment: false,
    },
}));
import router from './public.js';
function createFakeRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        setHeader(key, value) {
            this.headers[key] = value;
            return this;
        },
    };
}
function getLandingHandler() {
    const layer = router.stack.find((entry) => {
        if (!entry.route?.methods?.get)
            return false;
        const path = entry.route.path;
        if (Array.isArray(path)) {
            return path.includes('/landing/:kwuid/:listingNumber');
        }
        return path === '/landing/:kwuid/:listingNumber';
    });
    if (!layer) {
        throw new Error('Landing route not found');
    }
    const routeStack = layer.route.stack;
    return routeStack[routeStack.length - 1].handle;
}
describe('public landing regression guard', () => {
    beforeEach(() => {
        queryMock.mockReset();
    });
    it('keeps summed feature-count SQL and includes youtube payload fields', async () => {
        queryMock
            .mockResolvedValueOnce({
            rows: [
                {
                    id: 29496,
                    kwuid: '546077',
                    first_name: 'Ronald',
                    last_name: 'van Scheltema',
                    full_name: 'Ronald van Scheltema',
                    email: 'ronald@example.com',
                    kwsa_email: 'ronald@example.com',
                    mobile_number: '0658339187',
                    office_number: null,
                    image_url: null,
                    status_name: 'Active',
                    market_center_name: 'KW Jacaranda',
                    market_center_contact_number: null,
                    market_center_contact_email: null,
                    market_center_logo_url: null,
                    primary_role: 'Regional Admin',
                    primary_job_title: 'Operating Partner',
                },
            ],
        })
            .mockResolvedValueOnce({
            rows: [
                {
                    id: 2217263,
                    listing_number: 'KWL317755',
                    listing_status_tag: 'For Sale',
                    sale_or_rent: 'For Sale',
                    price: '2950000',
                    suburb: 'Erasmusrand',
                    city: 'Pretoria',
                    province: 'Gauteng',
                    property_type: null,
                    property_sub_type: null,
                    bedroom_count: 4,
                    bathroom_count: 3,
                    garage_count: 1,
                    parking_count: 1,
                    floor_area: '330',
                    erf_size: '807',
                    listing_images_json: ['https://example.com/a.jpg'],
                    property_title: 'Spacious Erasmusrand Family Home',
                    short_title: null,
                    short_description: 'Short description',
                    property_description: 'Long description',
                    address_line: '293A Albertus Lane',
                    updated_at: '2026-07-01T00:00:00.000Z',
                },
            ],
        })
            .mockResolvedValueOnce({
            rows: [
                {
                    url: 'https://youtu.be/El9AXv14qjc',
                    url_type: 'YouTube',
                    display_name: 'YouTube',
                    sort_order: 0,
                },
            ],
        });
        const req = {
            params: {
                kwuid: '546077',
                listingNumber: 'KWL317755',
            },
            ip: '127.0.0.1',
        };
        const res = createFakeRes();
        await getLandingHandler()(req, res);
        expect(queryMock).toHaveBeenCalledTimes(3);
        const [listingSql] = queryMock.mock.calls[1];
        expect(listingSql).toContain('SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int');
        expect(listingSql).not.toContain('MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END)');
        expect(res.statusCode).toBe(200);
        const body = res.body;
        expect(body?.listing?.bedrooms).toBe(4);
        expect(body?.listing?.bathrooms).toBe(3);
        expect(body?.listing?.garages).toBe(1);
        expect(body?.listing?.parking).toBe(1);
        expect(body?.listing?.marketing_urls?.length).toBe(1);
        expect(body?.listing?.videoUrl).toBe('https://www.youtube.com/watch?v=El9AXv14qjc');
        expect(body?.listing?.youtubeEmbedUrl).toBe('https://www.youtube.com/embed/El9AXv14qjc');
    });
});
//# sourceMappingURL=public.landing-regression.test.js.map