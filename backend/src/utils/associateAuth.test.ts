import { describe, it, expect } from 'vitest';
import { isRegisteredAssociateEmail, normalizeAuthEmail, normalizeAuthName, resolveAssociateIdForAuth, type AssociateEmailLookupClient } from './associateAuth.js';

describe('associateAuth', () => {
  describe('normalizeAuthEmail', () => {
    it('normalizes casing and surrounding whitespace', () => {
      expect(normalizeAuthEmail('  Agent.One@KWSA.co.za  ')).toBe('agent.one@kwsa.co.za');
    });
  });

  describe('normalizeAuthName', () => {
    it('normalizes casing and repeated whitespace', () => {
      expect(normalizeAuthName('  Ronald   van   Scheltema  ')).toBe('ronald van scheltema');
    });
  });

  describe('isRegisteredAssociateEmail', () => {
    it('returns true when query returns a match', async () => {
      const client: AssociateEmailLookupClient = {
        query: async <T>(sql: string, values?: unknown[]) => {
          expect(values).toEqual(['agent@kwsa.co.za', '']);
          expect(sql).toContain("COALESCE(a.kwsa_email, '')");
          expect(sql).toContain("COALESCE(a.private_email, '')");
          expect(sql).toContain("COALESCE(a.email, '')");
          return { rowCount: 1, rows: [{ id: '42' }] as T[] };
        },
      };

      const allowed = await isRegisteredAssociateEmail(client, ' Agent@KWSA.co.za ');
      expect(allowed).toBe(true);
    });

    it('returns false when query returns no rows', async () => {
      const client: AssociateEmailLookupClient = {
        query: async () => ({ rowCount: 0, rows: [] }),
      };

      const allowed = await isRegisteredAssociateEmail(client, 'support@kwsa.co.za');
      expect(allowed).toBe(false);
    });

    it('returns false when email is blank, even when name is provided', async () => {
      let queryCalled = false;
      const client: AssociateEmailLookupClient = {
        query: async <T>() => {
          queryCalled = true;
          return { rowCount: 1, rows: [{ id: '1999' }] as T[] };
        },
      };

      const allowed = await isRegisteredAssociateEmail(client, '   ', ' Ronald  van  Scheltema ');
      expect(allowed).toBe(false);
      expect(queryCalled).toBe(false);
    });

    it('returns false for blank email and blank name without querying', async () => {
      let queryCalled = false;
      const client: AssociateEmailLookupClient = {
        query: async () => {
          queryCalled = true;
          return { rowCount: 0, rows: [] };
        },
      };

      const allowed = await isRegisteredAssociateEmail(client, '   ', '   ');
      expect(allowed).toBe(false);
      expect(queryCalled).toBe(false);
    });
  });

  describe('resolveAssociateIdForAuth', () => {
    it('prefers active records and supports all email fields', async () => {
      const client: AssociateEmailLookupClient = {
        query: async <T>(sql: string, values?: unknown[]) => {
          expect(values).toEqual(['ronald.vanscheltema@kwsa.co.za', 'ronald van scheltema']);
          expect(sql).toContain("COALESCE(a.status_name, '')");
          expect(sql).toContain("COALESCE(a.kwsa_email, '')");
          expect(sql).toContain("COALESCE(a.email, '')");
          expect(sql).toContain("COALESCE(a.private_email, '')");
          return { rowCount: 1, rows: [{ id: '29496' }] as T[] };
        },
      };

      const id = await resolveAssociateIdForAuth(client, ' Ronald.VanScheltema@kwsa.co.za ', ' Ronald  van  Scheltema ');
      expect(id).toBe('29496');
    });

    it('returns null for blank email and blank name without querying', async () => {
      let queryCalled = false;
      const client: AssociateEmailLookupClient = {
        query: async () => {
          queryCalled = true;
          return { rowCount: 0, rows: [] };
        },
      };

      const id = await resolveAssociateIdForAuth(client, '   ', '   ');
      expect(id).toBeNull();
      expect(queryCalled).toBe(false);
    });
  });
});
