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

export const ENTERPRISE_GUARD_HOOK_OWNER = 'comet.enterprise-guard.v1';

/** The script path is the ownership boundary used by install, doctor, and uninstall. */
export const enterpriseGuardHookConfig: Record<string, HookConfig> = {
  'comet/scripts/comet-enterprise-hook.mjs': {
    matcher: 'Write|Edit|Bash',
    description: 'Enterprise Guard hard-rule enforcement',
    arguments: ['--platform', 'claude'],
  },
};

function supportsEnterpriseGuard(platform: Platform): boolean {
  return platform.id === 'claude' && platform.hookFormat === 'claude-code';
}

export async function installEnterpriseGuard(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<HookInstallResult> {
  if (!supportsEnterpriseGuard(platform)) {
    return { status: 'skipped', reason: 'enterprise guard prototype supports Claude Code only' };
  }
  return installManagedHooksForPlatform(baseDir, platform, scope, enterpriseGuardHookConfig, {
    allowGlobal: true,
  });
}

export async function inspectEnterpriseGuard(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<HookInspectionResult> {
  if (!supportsEnterpriseGuard(platform)) return { present: false };
  return inspectManagedHooksForPlatform(baseDir, platform, scope, enterpriseGuardHookConfig);
}

export async function removeEnterpriseGuard(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<RemovalResult> {
  if (!supportsEnterpriseGuard(platform)) return { removed: 0, failed: 0 };
  return removeManagedHooksForPlatform(baseDir, platform, scope, enterpriseGuardHookConfig);
}
