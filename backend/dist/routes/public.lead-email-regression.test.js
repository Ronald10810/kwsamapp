import { beforeEach, describe, expect, it, vi } from 'vitest';
const { queryMock, sendMailMock, createTransportMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    sendMailMock: vi.fn(),
    createTransportMock: vi.fn(),
}));
vi.mock('../config/publicDb.js', () => ({
    getPublicReadOnlyPgPool: () => ({
        query: queryMock,
    }),
}));
vi.mock('../config/logger.js', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));
vi.mock('../config/env.js', () => ({
    env: {
        nodeEnv: 'test',
        isDevelopment: false,
    },
}));
vi.mock('nodemailer', () => ({
    default: {
        createTransport: createTransportMock,
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
function getLeadPostHandler() {
    const layer = router.stack.find((entry) => {
        if (!entry.route?.methods?.post)
            return false;
        const path = entry.route.path;
        if (Array.isArray(path)) {
            return path.includes('/landing/:kwuid/:listingNumber/lead');
        }
        return path === '/landing/:kwuid/:listingNumber/lead';
    });
    if (!layer) {
        throw new Error('Lead landing route not found');
    }
    const routeStack = layer.route.stack;
    return routeStack[routeStack.length - 1].handle;
}
describe('public lead email regression guard', () => {
    beforeEach(() => {
        queryMock.mockReset();
        sendMailMock.mockReset();
        createTransportMock.mockReset();
        process.env.PUBLIC_LEAD_EMAIL_ENABLED = 'true';
        process.env.PUBLIC_LEAD_SMTP_USER = 'info@kwsa.co.za';
        process.env.PUBLIC_LEAD_SMTP_PASS = 'dummy-test-pass';
        createTransportMock.mockReturnValue({
            sendMail: sendMailMock,
        });
        sendMailMock.mockResolvedValue({});
    });
    it('removes landing page row, includes listing agent details, and uses Email/WhatsApp lead actions', async () => {
        queryMock
            .mockResolvedValueOnce({
            rows: [
                {
                    id: 29496,
                    kwuid: '546077',
                    first_name: 'Ronald',
                    last_name: 'van Scheltema',
                    full_name: 'Ronald van Scheltema',
                    email: 'ronald@kwsa.co.za',
                    kwsa_email: 'ronald@kwsa.co.za',
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
                    listing_number: 'KWL315667',
                    property_title: 'Spacious 7-Bedroom Family Home',
                    short_title: null,
                    suburb: 'Mooikloof',
                    city: 'Pretoria',
                    province: 'Gauteng',
                    sale_or_rent: 'For Sale',
                    price: '4900000',
                    agent_full_name: 'Jane Agent',
                    agent_mobile_number: '0821234567',
                    agent_office_number: null,
                    agent_email: 'jane.agent@kwsa.co.za',
                    agent_kwsa_email: null,
                    agent_market_center_name: 'KW Jacaranda',
                },
            ],
        });
        const req = {
            params: {
                kwuid: '546077',
                listingNumber: 'KWL315667',
            },
            body: {
                firstName: 'Ronald',
                lastName: 'van Scheltema',
                email: 'ronald.vanscheltema@kwsa.co.za',
                phone: '+27658339187',
                message: 'Please contact me about this listing.',
                website: '',
            },
            ip: '127.0.0.1',
        };
        const res = createFakeRes();
        await getLeadPostHandler()(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(sendMailMock).toHaveBeenCalledTimes(1);
        const mailArg = sendMailMock.mock.calls[0]?.[0];
        expect(mailArg.text).not.toContain('Landing page:');
        expect(mailArg.text).toContain('Listing URL:');
        expect(mailArg.text).toContain('Listing Agent Details:');
        expect(mailArg.text).toContain('Name: Jane Agent');
        expect(mailArg.html).not.toContain('Landing page');
        expect(mailArg.html).toContain('Listing Agent Details');
        expect(mailArg.html).toContain('Email Ronald');
        expect(mailArg.html).toContain('WhatsApp Ronald');
        expect(mailArg.html).toContain('padding-right:10px');
        expect(mailArg.html).toContain('Jane Agent');
        expect(mailArg.html).toContain('jane.agent@kwsa.co.za');
        expect(mailArg.html).toContain('Ronald%20van%20Scheltema');
        expect(mailArg.html).toContain('KW%20Jacaranda');
    });
});
//# sourceMappingURL=public.lead-email-regression.test.js.map