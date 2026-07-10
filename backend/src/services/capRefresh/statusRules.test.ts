import { describe, expect, it } from 'vitest';

import {
  isCapConsumingStatus,
  isNoCapImpactStatus,
  isProjectedCapStatus,
} from './statusRules.js';

describe('cap refresh status rules', () => {
  it('only Registered consumes cap', () => {
    expect(isCapConsumingStatus('Registered')).toBe(true);
    for (const status of ['Start', 'Working', 'Submitted', 'Pending', 'Accepted', 'Rejected', 'Withdrawn']) {
      expect(isCapConsumingStatus(status)).toBe(false);
    }
  });

  it('Start/Working/Submitted/Pending/Accepted are projected statuses', () => {
    for (const status of ['Start', 'Working', 'Submitted', 'Pending', 'Accepted']) {
      expect(isProjectedCapStatus(status)).toBe(true);
    }
    for (const status of ['Registered', 'Rejected', 'Withdrawn']) {
      expect(isProjectedCapStatus(status)).toBe(false);
    }
  });

  it('Rejected and Withdrawn are no-impact statuses', () => {
    expect(isNoCapImpactStatus('Rejected')).toBe(true);
    expect(isNoCapImpactStatus('Withdrawn')).toBe(true);
    expect(isNoCapImpactStatus('Working')).toBe(false);
  });
});
