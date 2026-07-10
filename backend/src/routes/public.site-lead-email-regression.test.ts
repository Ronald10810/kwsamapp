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

function getSiteLeadPostHandler(): (req: any, res: any) => Promise<any> {
  const layer = (router as any).stack.find((entry: any) => {
    if (!entry.route?.methods?.post) return false;
    const path = entry.route.path;
    return path === '/site/:kwuid/lead';
  });

  if (!layer) {
    throw new Error('Site lead route not found');
  }

  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

describe('public site lead email regression guard', () => {
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

  it('sends homepage agent enquiry email with separate website context and Email/WhatsApp actions', async () => {
    queryMock.mockResolvedValueOnce({
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
    });

    const req = {
      params: {
        kwuid: '546077',
      },
      body: {
        firstName: 'Ronald',
        lastName: 'van Scheltema',
        email: 'ronald.vanscheltema@kwsa.co.za',
        phone: '+27658339187',
        message: 'Test home page',
        website: '',
      },
      ip: '127.0.0.1',
    };
    const res = createFakeRes();

    await getSiteLeadPostHandler()(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const mailArg = sendMailMock.mock.calls[0]?.[0] as { html: string; text: string; subject: string };
    expect(mailArg.subject).toContain('New Website Enquiry');
    expect(mailArg.text).toContain('New KW Homes website enquiry received');
    expect(mailArg.text).toContain('Website agent: Ronald van Scheltema');
    expect(mailArg.text).toContain('Profile URL: https://kwhomes.co.za/546077');
    expect(mailArg.text).not.toContain('Listing URL:');
    expect(mailArg.text).not.toContain('Listing Agent Details:');

    expect(mailArg.html).toContain('Website Enquiry');
    expect(mailArg.html).toContain('Website agent details');
    expect(mailArg.html).toContain('Email Ronald');
    expect(mailArg.html).toContain('WhatsApp Ronald');
    expect(mailArg.html).toContain('https://kwhomes.co.za/546077');
    expect(mailArg.html).toContain('Ronald%20van%20Scheltema');
    expect(mailArg.html).toContain('KW%20Jacaranda');
    expect(mailArg.html).not.toContain('Listing details');
  });
});
