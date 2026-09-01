import type { Platform } from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import {
  installManagedHooksForPlatform,
  type HookConfig,
  type HookInstallResult,
} from '../skill/platform-install.js';
import {
  inspectManagedHooksForPlatform,
  type HookInspectionResult,
} from '../skill/platform-inspect.js';
import { removeManagedHooksForPlatform, type RemovalResult } from '../skill/uninstall.js';
import { enterpriseGuardCoverage, isEnterpriseGuardEnforcedPlatform } from './platform-coverage.js';

export const hookLifecycleDependencies = {
  installManagedHooksForPlatform,
  removeManagedHooksForPlatform,
  inspectManagedHooksForPlatform,
};

export const enterpriseGatewayHookConfig: Record<string, HookConfig> = {
  'comet/scripts/comet-enterprise-gateway.mjs': {
    matcher: 'Write|Edit|Bash',
    description: 'Enterprise Guard and Comet workflow enforcement',
    arguments: ['--platform', 'claude'],
  },
};

const RETIRED_ENTERPRISE_HOOK_CONFIG: Record<string, HookConfig> = {
  'comet/scripts/comet-enterprise-hook.mjs': {
    matcher: 'Write|Edit|Bash',
    description: 'Enterprise Guard hard-rule enforcement',
    arguments: ['--platform', 'claude'],
  },
};

const ROUTER_HOOK_CONFIG: Record<string, HookConfig> = {
  'comet/scripts/comet-hook-router.mjs': {
    matcher: 'Write|Edit',
    description: 'Route each write to the selected Comet Native or Classic phase guard',
  },
};

const RETIRED_MANAGED_HOOK_CONFIGS: Record<string, HookConfig> = {
  ...RETIRED_ENTERPRISE_HOOK_CONFIG,
  ...ROUTER_HOOK_CONFIG,
};

function supportsEnterpriseGuard(platform: Platform): boolean {
  return platform.hookFormat === 'claude-code' && isEnterpriseGuardEnforcedPlatform(platform);
}

function unsupportedPlatformReason(platform: Platform): string {
  return `Enterprise Guard uses ${enterpriseGuardCoverage(platform).fallback} on ${platform.name}`;
}

export async function installEnterpriseGuard(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<HookInstallResult> {
  if (!supportsEnterpriseGuard(platform)) {
    return { status: 'skipped', reason: unsupportedPlatformReason(platform) };
  }
  let install: HookInstallResult;
  try {
    install = await hookLifecycleDependencies.installManagedHooksForPlatform(
      baseDir,
      platform,
      scope,
      enterpriseGatewayHookConfig,
      { allowGlobal: true },
    );
  } catch (err) {
    return { status: 'failed', reason: (err as Error).message };
  }
  if (install.status !== 'installed') return install;

  let cleanup: RemovalResult;
  try {
    cleanup = await hookLifecycleDependencies.removeManagedHooksForPlatform(
      baseDir,
      platform,
      scope,
      RETIRED_MANAGED_HOOK_CONFIGS,
    );
  } catch {
    cleanup = { removed: 0, failed: 1 };
  }
  if (cleanup.failed > 0) {
    return {
      status: 'failed',
      reason: 'enterprise Gateway installed but legacy Hook cleanup failed',
      cleanupFailed: cleanup.failed,
    };
  }
  return install;
}

export async function inspectEnterpriseGuard(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<HookInspectionResult> {
  if (!supportsEnterpriseGuard(platform)) return { present: false };
  const gateway = await hookLifecycleDependencies.inspectManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    enterpriseGatewayHookConfig,
  );
  if (gateway.error) return gateway;
  const retired = await hookLifecycleDependencies.inspectManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    RETIRED_MANAGED_HOOK_CONFIGS,
  );
  if (retired.error) {
    if (retired.present || retired.managedPresent) return { ...gateway, legacyPresent: true };
    return { ...gateway, present: false, error: retired.error };
  }
  const retiredPresent = retired.present || retired.managedPresent || retired.legacyPresent;
  return retiredPresent ? { ...gateway, legacyPresent: true } : gateway;
}

export async function removeEnterpriseGuard(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<RemovalResult> {
  if (!supportsEnterpriseGuard(platform)) return { removed: 0, failed: 0 };
  const gateway = await hookLifecycleDependencies.removeManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    enterpriseGatewayHookConfig,
  );
  const retired = await hookLifecycleDependencies.removeManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    RETIRED_ENTERPRISE_HOOK_CONFIG,
  );
  return {
    removed: gateway.removed + retired.removed,
    failed: gateway.failed + retired.failed,
  };
}
