import { describe, expect, it } from 'vitest';

import { enterpriseGuardPlatformProfile } from '../../../domains/enterprise-guard/platform-profiles.js';
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

  it('separates host capability from verified enforcement', () => {
    expect(enterpriseGuardPlatformProfile({ id: 'claude' })).toEqual({
      platformId: 'claude',
      host: 'command-hook',
      inputCodec: 'claude',
      decisionCodec: 'comet-command-hook',
      installStrategy: 'composite-gateway',
      enforcement: 'project',
      coveredTools: ['Write', 'Edit', 'Bash'],
      orderingGuarantee: 'final',
    });
    expect(enterpriseGuardPlatformProfile({ id: 'opencode' })).toMatchObject({
      host: 'plugin-hook',
      installStrategy: 'not-installed',
      enforcement: 'none',
      orderingGuarantee: 'unknown',
    });
    expect(enterpriseGuardCoverage({ id: 'opencode' }).level).toBe('rules-and-ci');
  });
});
