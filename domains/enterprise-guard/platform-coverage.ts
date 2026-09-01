import type { Platform } from '../../platform/install/platforms.js';
import {
  enterpriseGuardPlatformProfile,
  type EnterpriseGuardCoverageLevel,
  type EnterpriseGuardPlatformProfile,
} from './platform-profiles.js';

export type { EnterpriseGuardCoverageLevel };

export interface EnterpriseGuardCoverage {
  level: EnterpriseGuardCoverageLevel;
  installationScope: 'project or user-local' | 'rules only';
  enforcedTools: readonly string[];
  fallback: string;
}

const LEVEL_BY_ENFORCEMENT = {
  managed: 'enforced-managed',
  project: 'enforced-project',
  'managed-plugin': 'enforced-managed-plugin',
  'best-effort': 'best-effort',
  none: 'rules-and-ci',
} as const;

const VERIFIED_ENFORCEMENT: Record<EnterpriseGuardPlatformProfile['enforcement'], boolean> = {
  managed: true,
  project: true,
  'managed-plugin': true,
  'best-effort': false,
  none: false,
};

export function enterpriseGuardCoverage(platform: Pick<Platform, 'id'>): EnterpriseGuardCoverage {
  const profile = enterpriseGuardPlatformProfile(platform);
  const level = LEVEL_BY_ENFORCEMENT[profile.enforcement];
  const enforced = VERIFIED_ENFORCEMENT[profile.enforcement];
  return {
    level,
    installationScope: enforced ? 'project or user-local' : 'rules only',
    enforcedTools: profile.coveredTools,
    fallback: enforced
      ? 'remote CI remains required against local tampering'
      : 'rules injection + CI fallback',
  };
}

export function isEnterpriseGuardEnforcedPlatform(platform: Pick<Platform, 'id'>): boolean {
  return enterpriseGuardCoverage(platform).level === 'enforced-project';
}
