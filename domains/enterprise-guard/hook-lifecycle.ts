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
import { enterpriseGuardCoverage, usesEnterpriseGuardGateway } from './platform-coverage.js';

export const hookLifecycleDependencies = {
  installManagedHooksForPlatform,
  removeManagedHooksForPlatform,
  inspectManagedHooksForPlatform,
};

export function enterpriseGatewayHookConfigForPlatform(
  platform: Platform,
): Record<string, HookConfig> {
  return {
    'comet/scripts/comet-enterprise-gateway.mjs': {
      matcher: platform.hookMatcher ?? 'Write|Edit|Bash',
      description: 'Enterprise Guard and Comet workflow enforcement',
      arguments: ['--platform', platform.id],
    },
  };
}

export const enterpriseGatewayHookConfig: Record<string, HookConfig> = {
  'comet/scripts/comet-enterprise-gateway.mjs': {
    matcher: 'Write|Edit|Bash',
    description: 'Enterprise Guard and Comet workflow enforcement',
    arguments: ['--platform', 'claude'],
  },
};

function retiredEnterpriseHookConfigForPlatform(platform: Platform): Record<string, HookConfig> {
  return {
    'comet/scripts/comet-enterprise-hook.mjs': {
      matcher: platform.hookMatcher ?? 'Write|Edit|Bash',
      description: 'Enterprise Guard hard-rule enforcement',
      arguments: ['--platform', platform.id],
    },
  };
}

const ROUTER_HOOK_CONFIG: Record<string, HookConfig> = {
  'comet/scripts/comet-hook-router.mjs': {
    matcher: 'Write|Edit',
    description: 'Route each write to the selected Comet Native or Classic phase guard',
  },
};

function retiredManagedHookConfigsForPlatform(platform: Platform): Record<string, HookConfig> {
  return {
    ...retiredEnterpriseHookConfigForPlatform(platform),
    ...ROUTER_HOOK_CONFIG,
  };
}

function supportsEnterpriseGuard(platform: Platform): boolean {
  return Boolean(platform.supportsHooks) && usesEnterpriseGuardGateway(platform);
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
  const gatewayConfig = enterpriseGatewayHookConfigForPlatform(platform);
  let install: HookInstallResult;
  try {
    install = await hookLifecycleDependencies.installManagedHooksForPlatform(
      baseDir,
      platform,
      scope,
      gatewayConfig,
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
      retiredManagedHookConfigsForPlatform(platform),
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
  const gatewayConfig = enterpriseGatewayHookConfigForPlatform(platform);
  const gateway = await hookLifecycleDependencies.inspectManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    gatewayConfig,
  );
  if (gateway.error) return gateway;
  const retired = await hookLifecycleDependencies.inspectManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    retiredManagedHookConfigsForPlatform(platform),
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
  const gatewayConfig = enterpriseGatewayHookConfigForPlatform(platform);
  const gateway = await hookLifecycleDependencies.removeManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    gatewayConfig,
  );
  const retired = await hookLifecycleDependencies.removeManagedHooksForPlatform(
    baseDir,
    platform,
    scope,
    retiredEnterpriseHookConfigForPlatform(platform),
  );
  return {
    removed: gateway.removed + retired.removed,
    failed: gateway.failed + retired.failed,
  };
}
