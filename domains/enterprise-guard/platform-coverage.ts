import type { Platform } from '../../platform/install/platforms.js';

export type EnterpriseGuardCoverageLevel = 'enforced-project' | 'rules-and-ci';

export interface EnterpriseGuardCoverage {
  level: EnterpriseGuardCoverageLevel;
  installationScope: 'project or user-local' | 'rules only';
  enforcedTools: readonly string[];
  fallback: string;
}

const CLAUDE_COVERAGE: EnterpriseGuardCoverage = {
  level: 'enforced-project',
  installationScope: 'project or user-local',
  enforcedTools: ['Write', 'Edit', 'Bash'],
  fallback: 'remote CI remains required against local tampering',
};

const FALLBACK_COVERAGE: EnterpriseGuardCoverage = {
  level: 'rules-and-ci',
  installationScope: 'rules only',
  enforcedTools: [],
  fallback: 'rules injection + CI fallback',
};

export function enterpriseGuardCoverage(platform: Pick<Platform, 'id'>): EnterpriseGuardCoverage {
  return platform.id === 'claude' ? CLAUDE_COVERAGE : FALLBACK_COVERAGE;
}

export function isEnterpriseGuardEnforcedPlatform(platform: Pick<Platform, 'id'>): boolean {
  return enterpriseGuardCoverage(platform).level === 'enforced-project';
}
