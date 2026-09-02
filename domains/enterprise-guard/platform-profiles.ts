import type { Platform } from '../../platform/install/platforms.js';

export type EnterpriseGuardCoverageLevel =
  | 'enforced-managed'
  | 'enforced-project'
  | 'enforced-managed-plugin'
  | 'best-effort'
  | 'rules-and-ci';

export interface EnterpriseGuardPlatformProfile {
  platformId: string;
  host: 'command-hook' | 'plugin-hook' | 'native-boundary' | 'none';
  inputCodec: string | null;
  decisionCodec: string | null;
  installStrategy: 'composite-gateway' | 'managed-plugin' | 'not-installed';
  enforcement: 'managed' | 'project' | 'managed-plugin' | 'best-effort' | 'none';
  coveredTools: readonly string[];
  orderingGuarantee: 'final' | 'verified' | 'unknown';
}

const CLAUDE_PROFILE: EnterpriseGuardPlatformProfile = {
  platformId: 'claude',
  host: 'command-hook',
  inputCodec: 'claude',
  decisionCodec: 'comet-command-hook',
  installStrategy: 'composite-gateway',
  enforcement: 'best-effort',
  coveredTools: ['Write', 'Edit', 'Bash'],
  orderingGuarantee: 'unknown',
};

const OPENCODE_PROFILE: EnterpriseGuardPlatformProfile = {
  platformId: 'opencode',
  host: 'plugin-hook',
  inputCodec: null,
  decisionCodec: null,
  installStrategy: 'not-installed',
  enforcement: 'none',
  coveredTools: [],
  orderingGuarantee: 'unknown',
};

const UNINSTRUMENTED_PROFILE: Omit<EnterpriseGuardPlatformProfile, 'platformId'> = {
  host: 'none',
  inputCodec: null,
  decisionCodec: null,
  installStrategy: 'not-installed',
  enforcement: 'none',
  coveredTools: [],
  orderingGuarantee: 'unknown',
};

export function enterpriseGuardPlatformProfile(
  platform: Pick<Platform, 'id'>,
): EnterpriseGuardPlatformProfile {
  if (platform.id === 'claude') {
    return CLAUDE_PROFILE;
  }
  if (platform.id === 'opencode') {
    return OPENCODE_PROFILE;
  }
  return { platformId: platform.id, ...UNINSTRUMENTED_PROFILE };
}
