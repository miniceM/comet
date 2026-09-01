import path from 'path';

import {
  COMET_HOOK_PLATFORM_IDS,
  parseCometHookRequest,
  renderCometHookDecision,
} from '../comet-entry/hook-adapter.js';
import type {
  CometHookDecision,
  CometHookProcessOutput,
  CometHookRequest,
} from '../comet-entry/hook-types.js';
import { inspectCometHook } from '../comet-entry/hook-router.js';
import { projectRootFrom } from '../comet-entry/hook-router-entry.js';
import { runWithHookReadCache } from '../../platform/process/hook-read-cache.js';
import type { GuardServiceRequest } from './guard-service.js';
import { evaluateEnterpriseGuardSource } from './guard-service.js';
import type { EnterpriseGuardEvaluation } from './normalized-event.js';

const USAGE =
  'Usage: comet-enterprise-gateway --platform <platform-id> [--project-root <project-root>]';

export interface EnterpriseGatewayDependencies {
  evaluateGuard(request: GuardServiceRequest): Promise<EnterpriseGuardEvaluation>;
  inspectRouter(projectRoot: string, request: CometHookRequest): Promise<CometHookDecision>;
}

const DEFAULT_DEPENDENCIES: EnterpriseGatewayDependencies = {
  evaluateGuard: evaluateEnterpriseGuardSource,
  inspectRouter: inspectCometHook,
};

interface ParsedGatewayArgs {
  platformId: string;
  projectRoot?: string;
}

function parseGatewayArgs(args: readonly string[]): ParsedGatewayArgs {
  let platformId: string | undefined;
  let projectRoot: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--platform') {
      platformId = args[++index];
      continue;
    }
    if (arg === '--project-root') {
      projectRoot = args[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!platformId || platformId.startsWith('--')) throw new Error('--platform is required');
  if (!COMET_HOOK_PLATFORM_IDS.has(platformId)) {
    throw new Error(`unsupported Hook platform: ${platformId}`);
  }
  if (projectRoot?.startsWith('--')) throw new Error('--project-root requires a value');
  return { platformId, ...(projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}) };
}

export async function executeEnterpriseGateway(
  args: readonly string[],
  source: string,
  overrides: Partial<EnterpriseGatewayDependencies> = {},
): Promise<CometHookProcessOutput> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  let parsed: ParsedGatewayArgs;
  try {
    parsed = parseGatewayArgs(args);
  } catch (error) {
    return {
      exitCode: 64,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`,
    };
  }

  let guard: EnterpriseGuardEvaluation;
  try {
    guard = await dependencies.evaluateGuard({
      platformId: parsed.platformId,
      source,
      projectRoot: parsed.projectRoot ?? null,
    });
  } catch (error) {
    return {
      exitCode: 64,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`,
    };
  }
  if (!guard.decision.allowed) {
    return renderCometHookDecision(parsed.platformId, guard.decision);
  }

  let routerDecision: CometHookDecision;
  try {
    const request = parseCometHookRequest(source);
    const projectRoot = await projectRootFrom(parsed, request);
    routerDecision = projectRoot
      ? await runWithHookReadCache(() => dependencies.inspectRouter(projectRoot, request))
      : { allowed: true, reason: 'No Comet project discovered' };
  } catch (error) {
    routerDecision = {
      allowed: false,
      reason: `Comet Hook Router failed closed during project discovery: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return renderCometHookDecision(parsed.platformId, routerDecision);
}
