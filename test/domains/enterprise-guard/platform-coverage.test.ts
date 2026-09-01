import { describe, expect, it } from 'vitest';

import {
  enterpriseGuardCoverage,
  isEnterpriseGuardEnforcedPlatform,
} from '../../../domains/enterprise-guard/platform-coverage.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';

describe('Enterprise Guard platform coverage', () => {
  it('marks Claude Code as the only project-level enforced platform', () => {
    const claude = PLATFORMS.find((platform) => platform.id === 'claude');
    expect(claude).toBeDefined();

    expect(enterpriseGuardCoverage(claude!)).toMatchObject({
      level: 'enforced-project',
      installationScope: 'project or user-local',
      enforcedTools: ['Write', 'Edit', 'Bash'],
      fallback: 'remote CI remains required against local tampering',
    });
    expect(isEnterpriseGuardEnforcedPlatform(claude!)).toBe(true);
  });

  it('labels every other Hook platform as rules injection and CI fallback', () => {
    const fallbackPlatforms = PLATFORMS.filter(
      (platform) => platform.supportsHooks && platform.id !== 'claude',
    );
    expect(fallbackPlatforms).not.toHaveLength(0);

    for (const platform of fallbackPlatforms) {
      expect(enterpriseGuardCoverage(platform)).toMatchObject({
        level: 'rules-and-ci',
        installationScope: 'rules only',
        enforcedTools: [],
        fallback: 'rules injection + CI fallback',
      });
      expect(isEnterpriseGuardEnforcedPlatform(platform)).toBe(false);
    }
  });
});
