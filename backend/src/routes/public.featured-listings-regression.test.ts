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

type FakeRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
  setHeader: (key: string, value: string) => FakeRes;
};

function createFakeRes(): FakeRes {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
  };
}

function getListingsHandler(): (req: any, res: any) => Promise<any> {
  const layer = (router as any).stack.find((entry: any) => {
    if (!entry.route?.methods?.get) return false;
    const path = entry.route.path;
    return path === '/listings';
  });

  if (!layer) {
    throw new Error('Listings route not found');
  }

  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

describe('public listings featured ordering regression guard', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('prioritizes associate featured listings when kwuid is provided', async () => {
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
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 111,
            listing_number: 'KWL111111',
            listing_status_tag: 'For Sale',
            sale_or_rent: 'For Sale',
            price: '1000000',
            suburb: 'A',
            city: 'B',
            province: 'C',
            property_type: 'House',
            property_sub_type: null,
            floor_area: '120',
            erf_size: '400',
            property_title: 'Featured Listing',
            short_title: null,
            short_description: 'Featured',
            address_line: 'Address 1',
            updated_at: '2026-07-01T00:00:00.000Z',
            image_url: 'https://example.com/1.jpg',
            agent_id: null,
            agent_kwuid: null,
            agent_first_name: null,
            agent_last_name: null,
            agent_full_name: null,
            agent_email: null,
            agent_kwsa_email: null,
            agent_mobile_number: null,
            agent_office_number: null,
            agent_image_url: null,
            agent_market_center_name: null,
            agent_market_center_logo_url: null,
          },
          {
            id: 222,
            listing_number: 'KWL222222',
            listing_status_tag: 'For Sale',
            sale_or_rent: 'For Sale',
            price: '900000',
            suburb: 'A',
            city: 'B',
            province: 'C',
            property_type: 'House',
            property_sub_type: null,
            floor_area: '100',
            erf_size: '300',
            property_title: 'Latest Listing',
            short_title: null,
            short_description: 'Latest',
            address_line: 'Address 2',
            updated_at: '2026-06-30T00:00:00.000Z',
            image_url: 'https://example.com/2.jpg',
            agent_id: null,
            agent_kwuid: null,
            agent_first_name: null,
            agent_last_name: null,
            agent_full_name: null,
            agent_email: null,
            agent_kwsa_email: null,
            agent_mobile_number: null,
            agent_office_number: null,
            agent_image_url: null,
            agent_market_center_name: null,
            agent_market_center_logo_url: null,
          },
        ],
      });

    const req = {
      query: {
        kwuid: '546077',
        page: '1',
        pageSize: '6',
      },
      ip: '127.0.0.1',
    };
    const res = createFakeRes();

    await getListingsHandler()(req, res);

    expect(queryMock).toHaveBeenCalledTimes(3);

    const [totalSql, totalParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(totalSql).toContain('LEFT JOIN migration.associate_featured_listings afl');
    expect(totalParams[totalParams.length - 1]).toBe(29496);

    const [listSql, listParams] = queryMock.mock.calls[2] as [string, unknown[]];
    expect(listSql).toContain('ORDER BY CASE WHEN afl.id IS NULL THEN 1 ELSE 0 END, afl.id ASC, cl.updated_at DESC, cl.id DESC');
    expect(listParams[listParams.length - 3]).toBe(29496);
    expect(listParams[listParams.length - 2]).toBe(6);
    expect(listParams[listParams.length - 1]).toBe(0);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body?.items?.[0]?.listingNumber).toBe('KWL111111');
    expect(body?.items?.[1]?.listingNumber).toBe('KWL222222');
  });
});
