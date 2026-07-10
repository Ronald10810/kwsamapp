import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/db.js', () => ({
  getOptionalPgPool: () => null,
}));

vi.mock('../middleware/permissions.js', () => ({
  resolvePermissions: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

import router from './listings.js';

type FakeRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
};

function createFakeRes(): FakeRes {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe('listings validation route regression guard', () => {
  it('keeps POST /validate-new-listing mounted and returns 503 when DB is unavailable', async () => {
    const layer = (router as any).stack.find(
      (entry: any) => entry.route?.path === '/validate-new-listing' && entry.route?.methods?.post
    );

    expect(layer).toBeTruthy();

    const routeStack = layer.route.stack;
    const handler = routeStack[routeStack.length - 1].handle as (req: any, res: any) => Promise<unknown>;

    const req = { body: {} };
    const res = createFakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'DATABASE_URL is not configured.' });
  });
});
