import { describe, expect, it } from 'vitest';

import { enterpriseGuardPlatformProfile } from '../../../domains/enterprise-guard/platform-profiles.js';
import {
  enterpriseGuardCoverage,
  isEnterpriseGuardEnforcedPlatform,
  usesEnterpriseGuardGateway,
} from '../../../domains/enterprise-guard/platform-coverage.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';

describe('Enterprise Guard platform coverage', () => {
  const GATEWAY_PLATFORM_IDS = new Set([
    'claude',
    'codex',
    'amazon-q',
    'qwen',
    'gemini',
    'github-copilot',
    'trae',
    'trae-cn',
    'oh-my-pi',
    'dsh',
  ]);

  it('installs the composite Gateway for verified command-hook platforms without overstating peer-Hook guarantees', () => {
    const gatewayPlatforms = PLATFORMS.filter((platform) => GATEWAY_PLATFORM_IDS.has(platform.id));
    expect(gatewayPlatforms.length).toBe(GATEWAY_PLATFORM_IDS.size);

    for (const platform of gatewayPlatforms) {
      const coverage = enterpriseGuardCoverage(platform);
      expect(coverage.level).toBe('best-effort');
      expect(coverage.installationScope).toBe('project or user-local');
      expect(coverage.enforcedTools.length).toBeGreaterThan(0);
      expect(coverage.fallback).toContain('local Gateway + rules injection + CI fallback');
      expect(isEnterpriseGuardEnforcedPlatform(platform)).toBe(false);
      expect(usesEnterpriseGuardGateway(platform)).toBe(true);
    }
  });

  it('labels uninstrumented or unverified platforms as rules injection and CI fallback', () => {
    const fallbackPlatforms = PLATFORMS.filter(
      (platform) => !GATEWAY_PLATFORM_IDS.has(platform.id),
    );
    expect(fallbackPlatforms.length).toBeGreaterThan(0);

    for (const platform of fallbackPlatforms) {
      expect(enterpriseGuardCoverage(platform)).toMatchObject({
        level: 'rules-and-ci',
        installationScope: 'rules only',
        enforcedTools: [],
        fallback: 'rules injection + CI fallback',
      });
      expect(isEnterpriseGuardEnforcedPlatform(platform)).toBe(false);
      expect(usesEnterpriseGuardGateway(platform)).toBe(false);
    }
  });

  it('separates host capability from verified enforcement across platform profiles', () => {
    expect(enterpriseGuardPlatformProfile({ id: 'claude' })).toEqual({
      platformId: 'claude',
      host: 'command-hook',
      inputCodec: 'claude',
      decisionCodec: 'comet-command-hook',
      installStrategy: 'composite-gateway',
      enforcement: 'best-effort',
      coveredTools: ['Write', 'Edit', 'Bash'],
      orderingGuarantee: 'unknown',
    });

    expect(enterpriseGuardPlatformProfile({ id: 'qwen' })).toEqual({
      platformId: 'qwen',
      host: 'command-hook',
      inputCodec: 'qwen',
      decisionCodec: 'comet-command-hook',
      installStrategy: 'composite-gateway',
      enforcement: 'best-effort',
      coveredTools: ['write_file', 'edit_file', 'execute_command', 'Write', 'Edit', 'Bash'],
      orderingGuarantee: 'unknown',
    });

    expect(enterpriseGuardPlatformProfile({ id: 'gemini' })).toEqual({
      platformId: 'gemini',
      host: 'command-hook',
      inputCodec: 'gemini',
      decisionCodec: 'comet-command-hook',
      installStrategy: 'composite-gateway',
      enforcement: 'best-effort',
      coveredTools: ['WriteFile', 'EditFile', 'Shell'],
      orderingGuarantee: 'unknown',
    });

    expect(enterpriseGuardPlatformProfile({ id: 'github-copilot' })).toEqual({
      platformId: 'github-copilot',
      host: 'command-hook',
      inputCodec: 'copilot',
      decisionCodec: 'copilot-json',
      installStrategy: 'composite-gateway',
      enforcement: 'best-effort',
      coveredTools: ['editFiles', 'runCommand', 'applyPatch'],
      orderingGuarantee: 'unknown',
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
