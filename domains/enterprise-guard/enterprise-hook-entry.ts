import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { renderCometHookDecision } from '../comet-entry/hook-adapter.js';
import { readEnterpriseExceptions } from './exceptions.js';
import { recordEnterpriseFindings } from './findings.js';
import {
  evaluateEnterpriseHookInput,
  MAX_ENTERPRISE_HOOK_INPUT_BYTES,
  parseClaudeEnterpriseHookInput,
} from './policy-engine.js';

export function runEnterpriseGuard(platformId: string, source: string) {
  const input = parseClaudeEnterpriseHookInput(source);
  const decision = evaluateEnterpriseHookInput(input);
  return renderCometHookDecision(platformId, decision);
}

/** Evaluate and persist redacted findings before Claude receives the Hook response. */
export async function runEnterpriseGuardWithAudit(
  platformId: string,
  source: string,
  projectRoot: string | null = null,
) {
  const input = parseClaudeEnterpriseHookInput(source);
  const auditRoot = projectRoot ?? input.workingDirectory.value;
  const decision = evaluateEnterpriseHookInput(
    input,
    auditRoot ? { exceptions: await readEnterpriseExceptions(auditRoot) } : {},
  );
  if (platformId === 'claude') {
    if (!auditRoot) return renderCometHookDecision(platformId, decision);
    try {
      await recordEnterpriseFindings(auditRoot, input, decision);
    } catch {
      return renderCometHookDecision(platformId, {
        allowed: false,
        reason: 'Enterprise Guard audit persistence is unavailable',
      });
    }
  }
  return renderCometHookDecision(platformId, decision);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  try {
    const chunks: Buffer[] = [];
    const maxCapturedBytes = MAX_ENTERPRISE_HOOK_INPUT_BYTES + 1;
    let capturedBytes = 0;

    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const bytesToCapture = Math.min(bytes.length, maxCapturedBytes - capturedBytes);
      if (bytesToCapture > 0) {
        chunks.push(Buffer.from(bytes.subarray(0, bytesToCapture)));
        capturedBytes += bytesToCapture;
      }
    }

    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  }
}

export function isDirectEntry(
  entry: string | undefined,
  moduleUrl: string = import.meta.url,
): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return moduleUrl === pathToFileURL(entry).href;
  }
}

function platformFromArgs(args: readonly string[]): string {
  const index = args.indexOf('--platform');
  return index >= 0 ? (args[index + 1] ?? '') : '';
}

if (isDirectEntry(process.argv[1])) {
  void readStdin().then(async (source) => {
    const output = await runEnterpriseGuardWithAudit(
      platformFromArgs(process.argv.slice(2)),
      source,
    );
    if (output.stdout) process.stdout.write(output.stdout);
    if (output.stderr) process.stderr.write(output.stderr);
    process.exitCode = output.exitCode;
  });
}
