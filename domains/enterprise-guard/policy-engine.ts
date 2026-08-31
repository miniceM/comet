export const MAX_ENTERPRISE_HOOK_INPUT_BYTES = 256 * 1024;

export type EnterpriseHookInput = {
  schema: 'comet.enterprise-hook-input.v1';
  platform: 'claude';
  event: 'PreToolUse';
  tool: string | null;
  cwd: string | null;
  paths: string[];
  command: string | null;
  writeFragments: string[];
  truncated: boolean;
};

export type EnterpriseGuardDecision = {
  allowed: boolean;
  ruleId: string | null;
  reason: string;
};

type JsonRecord = Record<string, unknown>;

const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/u;
const COMMAND_START = String.raw`(?:^|(?:&&|\|\||[;&|])\s*)`;
const SYSTEM_EXECUTABLE = String.raw`(?:\/(?:usr\/)?bin\/)?`;
const FORCE_PUSH = new RegExp(
  String.raw`${COMMAND_START}(?:(?:sudo|command)\s+)*${SYSTEM_EXECUTABLE}git(?:\s+(?:-c|--config-env|-C)\s+\S+|\s+--no-pager)*\s+push\b[^\n]*(?:\s--force(?:-with-lease)?(?:[=\s]|$)|\s-f(?:\s|$))`,
  'u',
);
const ROOT_DELETE = new RegExp(
  String.raw`${COMMAND_START}(?:(?:sudo|command)\s+)*${SYSTEM_EXECUTABLE}rm\s+(?=[^\n;&|]*(?:-[^\s]*[rf][^\s]*|--(?:recursive|force))(?:\s|$))(?:-[^\s]+\s+|--\s+)*\/(?:\s|$)`,
  'u',
);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringValues(...values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function boundedSource(source: string): { source: string; truncated: boolean } {
  const bytes = Buffer.from(source, 'utf8');
  if (bytes.length <= MAX_ENTERPRISE_HOOK_INPUT_BYTES) return { source, truncated: false };
  return {
    source: bytes.subarray(0, MAX_ENTERPRISE_HOOK_INPUT_BYTES).toString('utf8'),
    truncated: true,
  };
}

function pathValues(input: JsonRecord): string[] {
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  return stringValues(toolInput.file_path, toolInput.path, toolInput.filePath);
}

function writeFragments(input: JsonRecord): string[] {
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  return stringValues(toolInput.content, toolInput.new_string, toolInput.patch);
}

function isExamplePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  return (
    normalized.includes('/test/fixtures/') ||
    normalized.startsWith('test/fixtures/') ||
    normalized.includes('/docs/example/') ||
    normalized.startsWith('docs/example/') ||
    normalized.includes('/docs/examples/') ||
    normalized.startsWith('docs/examples/') ||
    /(?:^|\/)\.env(?:\.[^/]+)?\.example(?:\.[^/]+)?$/u.test(normalized)
  );
}

function isEnvironmentFile(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  return /(?:^|\/)\.env(?:$|\.[^/]+$)/u.test(normalized);
}

function denied(ruleId: string, detail: string): EnterpriseGuardDecision {
  return {
    allowed: false,
    ruleId,
    reason: `Enterprise Guard blocked ${ruleId}: ${detail}`,
  };
}

/** Convert Claude Code's raw PreToolUse stdin into the stable enterprise policy contract. */
export function parseClaudeEnterpriseHookInput(source: string): EnterpriseHookInput {
  const bounded = boundedSource(source);
  let input: JsonRecord = {};
  try {
    const parsed = JSON.parse(bounded.source) as unknown;
    if (isRecord(parsed)) input = parsed;
  } catch {
    // Parse failures are deliberately non-blocking: a broken local hook must not become a DoS.
  }
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};

  return {
    schema: 'comet.enterprise-hook-input.v1',
    platform: 'claude',
    event: 'PreToolUse',
    tool: stringValue(input.tool_name),
    cwd: stringValue(input.cwd),
    paths: pathValues(input),
    command: stringValue(toolInput.command),
    writeFragments: writeFragments(input),
    truncated: bounded.truncated,
  };
}

/** Evaluate the approved, built-in HARD rules. Reasons intentionally never include matched content. */
export function evaluateEnterpriseHookInput(input: EnterpriseHookInput): EnterpriseGuardDecision {
  if (input.truncated) {
    return denied('EG.HARD.TRUNCATED_INPUT', 'Hook input exceeds the supported size');
  }

  const mutablePaths = input.paths.filter((path) => !isExamplePath(path));
  if (mutablePaths.some(isEnvironmentFile)) {
    return denied('EG.HARD.ENV_WRITE', 'writing environment files is not permitted');
  }

  const content = input.writeFragments.join('\n');
  if (!mutablePaths.every(isExamplePath) && AWS_ACCESS_KEY.test(content)) {
    return denied('EG.HARD.EMBEDDED_SECRET', 'embedded access credentials are not permitted');
  }
  if (!mutablePaths.every(isExamplePath) && PRIVATE_KEY.test(content)) {
    return denied('EG.HARD.PRIVATE_KEY', 'embedded private keys are not permitted');
  }

  if (input.command && ROOT_DELETE.test(input.command)) {
    return denied(
      'EG.HARD.DESTRUCTIVE_DELETE',
      'recursive deletion of the filesystem root is not permitted',
    );
  }
  if (input.command && FORCE_PUSH.test(input.command)) {
    return denied('EG.HARD.FORCE_PUSH', 'force-pushing is not permitted');
  }

  return { allowed: true, ruleId: null, reason: '' };
}
