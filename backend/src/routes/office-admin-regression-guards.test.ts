import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('office admin regression guards', () => {
  it('canonicalizes office admin context market-centre ids in permission resolution', () => {
    const source = readWorkspaceFile('src/middleware/permissions.ts');

    expect(source).toContain('const resolveCanonicalMarketCenterId = async (rawId: string | null | undefined): Promise<string | null> => {');
    expect(source).toContain('WHERE id::text = $1 OR source_market_center_id = $1');
    expect(source).toContain('marketCenterId = canonicalClaimed ?? await resolveCanonicalMarketCenterId(claimedMcId) ?? claimedMcId;');
  });

  it('keeps a shared market-centre scope check for associate details and updates', () => {
    const source = readWorkspaceFile('src/routes/agents.ts');

    expect(source).toContain('async function resolveMarketCenterScopeMatch(');
    expect(source).toContain('router.get(\'/:id/details\', resolvePermissions');
    expect(source).toContain('router.put(\'/:id\', resolvePermissions');
    expect(source).toContain('resolveMarketCenterScopeMatch(pool, id, perms.marketCenterId)');
  });

  it('keeps report scoping fallback to associate source market centre ids', () => {
    const source = readWorkspaceFile('src/routes/reports.ts');

    expect(source).toContain("COALESCE(mc_assoc.source_market_center_id, ca.source_market_center_id, '')");
    expect(source).toContain('NULLIF(TRIM(mc_assoc.source_market_center_id), \'\')');
    expect(source).toContain('NULLIF(TRIM(ca.source_market_center_id), \'\')');
    expect(source).toContain('LEFT JOIN migration.core_market_centers mc_assoc_source ON mc_assoc_source.source_market_center_id = ca.source_market_center_id');
    expect(source).toContain('WHERE id::text = input.raw_value');
    expect(source).toContain("OR LOWER(TRIM(COALESCE(source_market_center_id, ''))) = LOWER(TRIM(input.raw_value))");
    expect(source).toContain("const requestedMarketCenterIds = parseCsvParam(req.query.market_center_ids);");
    expect(source).toContain("let marketCenterIds = requestedMarketCenterIds;");
  });

  it('treats status_name=1 as active in deregistration eligibility queries', () => {
    const source = readWorkspaceFile('src/routes/agentDeregistration.ts');

    expect(source).toContain("LOWER(TRIM(COALESCE(a.status_name, ''))) IN ('active', '1')");
    expect(source).toContain("LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')");
    expect(source).toContain("LOWER(TRIM(COALESCE(status_name, ''))) IN ('active', '1')");
  });
});
