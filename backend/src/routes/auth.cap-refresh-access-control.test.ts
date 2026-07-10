import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('auth cap refresh access-control contract', () => {
  it('exposes backend-authoritative can_apply_cap_refresh via access_control', () => {
    const source = readWorkspaceFile('src/routes/auth.ts');

    expect(source).toContain('resolveCanApplyCapRefreshForAssociate');
    expect(source).toContain('can_apply_cap_refresh');
    expect(source).toContain('access_control: accessControl');
  });

  it('keeps offline fallback safe by returning can_apply_cap_refresh=false', () => {
    const source = readWorkspaceFile('src/routes/auth.ts');
    expect(source).toContain('can_apply_cap_refresh: false');
  });
});