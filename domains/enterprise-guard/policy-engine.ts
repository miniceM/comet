import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_ENTERPRISE_HOOK_INPUT_BYTES = 256 * 1024;
export const MAX_ENTERPRISE_HOOK_FIELD_BYTES = 64 * 1024;

type Enforcement = 'hard' | 'soft';
type Decision = 'allow' | 'deny' | 'warn' | 'abstain';
type ParseStatus = 'complete' | 'partial' | 'failed' | 'unavailable';
type ExceptionScopeKind = 'path' | 'branch' | 'repository' | 'command';

export type CapturedString = {
  value: string | null;
  capturedBytes: number;
  originalBytes: number;
  truncated: boolean;
};

export type CapturedJson = {
  value: unknown;
  capturedBytes: number;
  originalBytes: number;
  truncated: boolean;
};

export type EnterpriseHookInput = {
  schemaVersion: 'comet.enterprise-hook-input.v1';
  platform: {
    id: string;
    surface: 'project' | 'managed-global' | 'ci' | 'unknown';
    version?: string | null;
  };
  event: { name: string; preAction: boolean; blockingCapable: boolean };
  workingDirectory: CapturedString;
  tool: { name: CapturedString; input: CapturedJson };
  command: CapturedString;
  writes: Array<{
    operation: 'create' | 'edit' | 'delete' | 'rename' | 'unknown';
    path: CapturedString;
    fragment: CapturedString;
  }>;
  parse: { status: ParseStatus; errors: string[] };
  truncation: {
    maxCapturedBytes: number;
    fields: Array<{
      path: string;
      capturedBytes: number;
      originalBytes: number;
      truncated: boolean;
    }>;
  };
};

export type EnterpriseRuleResult = {
  schemaVersion: 'comet.enterprise-rule-result.v1';
  ruleId: string;
  ruleVersion: number;
  enforcement: Enforcement;
  decision: Decision;
  reason: string;
  evidence: Array<{
    kind: 'path' | 'command' | 'write-fragment' | 'parse' | 'policy' | 'exception';
    subject: string;
    redacted?: boolean;
  }>;
  exceptionId: string | null;
  inputDigest: string;
};

export type EnterpriseExceptionRecord = {
  schemaVersion: 'comet.enterprise-exception.v1';
  exceptionId: string;
  ruleId: string;
  scope: { kind: ExceptionScopeKind; value: string };
  reason: string;
  owner: string;
  expiresAt: string;
  approval: { changeId: string; approvedBy: string; approvedAt: string; protectedRef: string };
  ci: { provider: string; runId: string; conclusion: 'passed'; protectedRef: string };
  status: 'active' | 'revoked' | 'expired';
};

export type EnterpriseGuardDecision = {
  allowed: boolean;
  ruleId: string | null;
  reason: string;
  warningRuleIds: string[];
  results: EnterpriseRuleResult[];
};

export type EnterprisePolicyOptions = {
  exceptions?: readonly EnterpriseExceptionRecord[];
  now?: Date;
  protectedBranches?: readonly string[];
};

type JsonRecord = Record<string, unknown>;

const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]{1,40})? PRIVATE KEY-----/u;
const SECRET_ASSIGNMENT =
  /\b(?:api[_-]?key|access[_-]?key|secret|token|password)\b\s*=\s*[^\s'"`]{8,}/iu;
const RULE_VERSION = 1;
const DEFAULT_PROTECTED_BRANCHES = new Set(['main', 'master']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function boundedString(value: unknown, maxBytes = MAX_ENTERPRISE_HOOK_FIELD_BYTES): CapturedString {
  if (typeof value !== 'string') {
    return { value: null, capturedBytes: 0, originalBytes: 0, truncated: false };
  }
  const bytes = Buffer.from(value, 'utf8');
  const captured = bytes.subarray(0, maxBytes);
  return {
    value: captured.toString('utf8'),
    capturedBytes: captured.length,
    originalBytes: bytes.length,
    truncated: bytes.length > maxBytes,
  };
}

function boundedJson(value: unknown): CapturedJson {
  const serialized = JSON.stringify(value ?? null);
  const captured = boundedString(serialized);
  return {
    value: captured.truncated ? null : (value ?? null),
    capturedBytes: captured.capturedBytes,
    originalBytes: captured.originalBytes,
    truncated: captured.truncated,
  };
}

function truncationField(fieldPath: string, value: CapturedString | CapturedJson) {
  return {
    path: fieldPath,
    capturedBytes: value.capturedBytes,
    originalBytes: value.originalBytes,
    truncated: value.truncated,
  };
}

function rawInput(source: string): { source: string; field: ReturnType<typeof truncationField> } {
  const bytes = Buffer.from(source, 'utf8');
  const captured = bytes.subarray(0, MAX_ENTERPRISE_HOOK_INPUT_BYTES);
  return {
    source: captured.toString('utf8'),
    field: {
      path: 'raw',
      capturedBytes: captured.length,
      originalBytes: bytes.length,
      truncated: bytes.length > MAX_ENTERPRISE_HOOK_INPUT_BYTES,
    },
  };
}

function writeOperation(
  toolName: string | null,
): EnterpriseHookInput['writes'][number]['operation'] {
  if (toolName === 'Write') return 'create';
  if (toolName === 'Edit') return 'edit';
  return 'unknown';
}

function inputDigest(input: EnterpriseHookInput): string {
  return sha256(
    JSON.stringify({
      platform: input.platform.id,
      event: input.event.name,
      tool: input.tool.name.value,
      cwd: input.workingDirectory.value,
      command: input.command.value,
      writes: input.writes.map((write) => [
        write.operation,
        write.path.value,
        write.fragment.value,
      ]),
      parse: input.parse.status,
      truncation: input.truncation.fields.map((field) => [field.path, field.truncated]),
    }),
  );
}

function result(
  input: EnterpriseHookInput,
  ruleId: string,
  enforcement: Enforcement,
  decision: Decision,
  reason: string,
  evidence: EnterpriseRuleResult['evidence'] = [],
): EnterpriseRuleResult {
  return {
    schemaVersion: 'comet.enterprise-rule-result.v1',
    ruleId,
    ruleVersion: RULE_VERSION,
    enforcement,
    decision,
    reason,
    evidence,
    exceptionId: null,
    inputDigest: inputDigest(input),
  };
}

function isWriteTool(name: string | null): boolean {
  return name === 'Write' || name === 'Edit';
}

function isBashTool(name: string | null): boolean {
  return name === 'Bash';
}

function isEnvironmentFile(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return (
    /^\.env(?:\.[^/]+)?$/u.test(basename) &&
    !/\.env\.(?:example|sample)(?:\.[^/]+)?$/u.test(basename)
  );
}

function isExamplePlaceholder(value: string): boolean {
  return /^(?:replace[-_ ]?me|your[-_ ]?(?:key|token|secret)|example|changeme)$/iu.test(
    value.trim(),
  );
}

function containsHardSecret(value: string): boolean {
  if (AWS_ACCESS_KEY.test(value) || PRIVATE_KEY.test(value)) return true;
  const assignment = value.match(
    /\b(?:api[_-]?key|access[_-]?key|secret|token|password)\b\s*=\s*([^\s'"`]+)/iu,
  );
  return Boolean(
    assignment?.[1] && assignment[1].length >= 16 && !isExamplePlaceholder(assignment[1]),
  );
}

function containsSoftSecret(value: string): boolean {
  return SECRET_ASSIGNMENT.test(value) && !containsHardSecret(value);
}

function commandSegments(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|&()\n]/u)
    .map((segment) => segment.trim().split(/\s+/u).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

function commandName(token: string): string {
  return token.split('/').at(-1) ?? token;
}

function hasRecursiveAndForce(tokens: readonly string[]): boolean {
  const shortFlags = tokens.filter((token) => /^-[^-]+$/u.test(token)).join('');
  return (
    (shortFlags.includes('r') && shortFlags.includes('f')) ||
    (tokens.includes('--recursive') && tokens.includes('--force'))
  );
}

function protectedDeleteTarget(target: string, workingDirectory: string | null): boolean {
  if (!target || target === '/' || target === '.' || target === '..' || target === '~') return true;
  if (target.includes('*') || target.includes('?') || target.includes('$') || target.includes('`'))
    return true;
  if (!workingDirectory) return true;
  const root = path.resolve(workingDirectory);
  const resolved = path.resolve(root, target);
  return (
    resolved === root ||
    root.startsWith(`${resolved}${path.sep}`) ||
    resolved === path.parse(resolved).root
  );
}

function recursiveDelete(input: EnterpriseHookInput): 'deny' | 'warn' | 'abstain' {
  const command = input.command.value;
  if (!command) return 'abstain';
  for (const tokens of commandSegments(command)) {
    const rmIndex = tokens.findIndex((token) => commandName(token) === 'rm');
    if (rmIndex < 0) continue;
    const commandTokens = tokens.slice(rmIndex + 1);
    if (!hasRecursiveAndForce(commandTokens)) continue;
    const targets = commandTokens.filter(
      (token) => !token.startsWith('-') && token !== 'sudo' && token !== 'command',
    );
    if (
      targets.length === 0 ||
      targets.some((target) => protectedDeleteTarget(target, input.workingDirectory.value))
    ) {
      return 'deny';
    }
    return 'warn';
  }
  return 'abstain';
}

function normalizedBranch(value: string): string {
  const branch = value.includes(':') ? (value.split(':').at(-1) ?? '') : value;
  return branch.replace(/^refs\/heads\//u, '');
}

function forcePush(
  input: EnterpriseHookInput,
  protectedBranches: ReadonlySet<string>,
): 'deny' | 'warn' | 'abstain' {
  const command = input.command.value;
  if (!command) return 'abstain';
  for (const tokens of commandSegments(command)) {
    const gitIndex = tokens.findIndex((token) => commandName(token) === 'git');
    if (gitIndex < 0) continue;
    const pushIndex = tokens.findIndex((token, index) => index > gitIndex && token === 'push');
    if (pushIndex < 0) continue;
    const pushTokens = tokens.slice(pushIndex + 1);
    const forced = pushTokens.some(
      (token) => token === '-f' || token === '--force' || token.startsWith('--force-with-lease'),
    );
    if (!forced) continue;
    const targets = pushTokens.filter((token) => !token.startsWith('-'));
    const branch = targets.length >= 2 ? normalizedBranch(targets[1]) : null;
    if (!branch || protectedBranches.has(branch)) return 'deny';
    return 'warn';
  }
  return 'abstain';
}

function aggregate(results: EnterpriseRuleResult[]): EnterpriseGuardDecision {
  const blocking = results.find(
    (candidate) => candidate.enforcement === 'hard' && candidate.decision === 'deny',
  );
  const warningRuleIds = results
    .filter((candidate) => candidate.decision === 'warn')
    .map((candidate) => candidate.ruleId);
  return {
    allowed: !blocking,
    ruleId: blocking?.ruleId ?? null,
    reason: blocking ? `Enterprise Guard blocked ${blocking.ruleId}: ${blocking.reason}` : '',
    warningRuleIds,
    results,
  };
}

function inputFailure(input: EnterpriseHookInput): EnterpriseRuleResult {
  return result(input, 'EG-HARD-INPUT-001', 'hard', 'deny', 'Required Hook input is unavailable', [
    { kind: 'parse', subject: input.parse.status, redacted: true },
  ]);
}

/** Convert Claude Code raw PreToolUse stdin into the versioned EnterpriseHookInput v1 contract. */
export function parseClaudeEnterpriseHookInput(source: string): EnterpriseHookInput {
  const raw = rawInput(source);
  const fields = [raw.field];
  let parsed: JsonRecord = {};
  let parse: EnterpriseHookInput['parse'] = { status: 'complete', errors: [] };
  try {
    const value = JSON.parse(raw.source) as unknown;
    if (!isRecord(value)) throw new Error('Hook input must be a JSON object');
    parsed = value;
  } catch (error) {
    parse = {
      status: 'failed',
      errors: [
        error instanceof Error
          ? error.message.replace(/\s+at position \d+$/u, '')
          : 'Invalid JSON input',
      ],
    };
  }
  const toolInputValue = isRecord(parsed.tool_input) ? parsed.tool_input : {};
  const workingDirectory = boundedString(parsed.cwd);
  const toolName = boundedString(parsed.tool_name);
  const toolInput = boundedJson(toolInputValue);
  const command = boundedString(toolInputValue.command);
  fields.push(
    truncationField('workingDirectory', workingDirectory),
    truncationField('tool.name', toolName),
    truncationField('tool.input', toolInput),
    truncationField('command', command),
  );

  const pathValue = boundedString(
    toolInputValue.file_path ?? toolInputValue.path ?? toolInputValue.filePath,
  );
  const fragmentValue = boundedString(
    toolInputValue.content ?? toolInputValue.new_string ?? toolInputValue.patch,
  );
  const writes = isWriteTool(toolName.value)
    ? [{ operation: writeOperation(toolName.value), path: pathValue, fragment: fragmentValue }]
    : [];
  for (const [index, write] of writes.entries()) {
    fields.push(
      truncationField(`writes.${index}.path`, write.path),
      truncationField(`writes.${index}.fragment`, write.fragment),
    );
  }
  if (parse.status === 'complete' && fields.some((field) => field.truncated)) {
    parse = { status: 'partial', errors: ['Hook input exceeded a bounded capture limit'] };
  }

  return {
    schemaVersion: 'comet.enterprise-hook-input.v1',
    platform: { id: 'claude', surface: 'project', version: null },
    event: { name: 'PreToolUse', preAction: true, blockingCapable: true },
    workingDirectory,
    tool: { name: toolName, input: toolInput },
    command,
    writes,
    parse,
    truncation: { maxCapturedBytes: MAX_ENTERPRISE_HOOK_INPUT_BYTES, fields },
  };
}

/** Evaluate each Enterprise Guard rule independently, then aggregate platform-safe HARD/SOFT decisions. */
function exceptionIsValid(exception: EnterpriseExceptionRecord, now: Date): boolean {
  if (
    exception.schemaVersion !== 'comet.enterprise-exception.v1' ||
    exception.status !== 'active' ||
    !/^EGE-[A-Z0-9-]+$/u.test(exception.exceptionId) ||
    !/^EG-(?:HARD|SOFT)-[A-Z]+-[0-9]{3}$/u.test(exception.ruleId) ||
    !['path', 'command', 'repository', 'branch'].includes(exception.scope.kind) ||
    !exception.scope.value ||
    exception.scope.value.includes('*') ||
    exception.reason.length < 16 ||
    exception.reason.length > 500 ||
    !exception.owner ||
    !exception.approval.changeId ||
    !exception.approval.approvedBy ||
    !exception.approval.approvedAt ||
    !exception.approval.protectedRef ||
    !exception.ci.provider ||
    !exception.ci.runId ||
    exception.ci.conclusion !== 'passed' ||
    exception.ci.protectedRef !== exception.approval.protectedRef
  ) {
    return false;
  }

  const expiresAt = Date.parse(exception.expiresAt);
  const approvedAt = Date.parse(exception.approval.approvedAt);
  return Number.isFinite(expiresAt) && Number.isFinite(approvedAt) && expiresAt > now.getTime();
}

function exceptionApplies(
  exception: EnterpriseExceptionRecord,
  input: EnterpriseHookInput,
  rule: EnterpriseRuleResult,
): boolean {
  if (exception.ruleId !== rule.ruleId || rule.decision !== 'deny') return false;

  switch (exception.scope.kind) {
    case 'path':
      return input.writes.some((write) => write.path.value === exception.scope.value);
    case 'command':
      return input.command.value === exception.scope.value;
    case 'repository':
      return input.workingDirectory.value === exception.scope.value;
    case 'branch': {
      const commandTokens = (input.command.value ?? '').trim().split(/\s+/u);
      return commandTokens.some(
        (token) => token === exception.scope.value || token.endsWith(`:${exception.scope.value}`),
      );
    }
    default:
      return false;
  }
}

function applyException(
  rule: EnterpriseRuleResult,
  input: EnterpriseHookInput,
  exceptions: readonly EnterpriseExceptionRecord[],
  now: Date,
): EnterpriseRuleResult {
  const exception = exceptions.find(
    (candidate) => exceptionIsValid(candidate, now) && exceptionApplies(candidate, input, rule),
  );
  if (!exception) return rule;

  return {
    ...rule,
    decision: 'warn',
    reason: 'A bounded Enterprise Guard exception requires review',
    evidence: [
      ...rule.evidence,
      { kind: 'exception', subject: 'approved-exception', redacted: true },
    ],
    exceptionId: exception.exceptionId,
  };
}

export function evaluateEnterpriseHookInput(
  input: EnterpriseHookInput,
  options: EnterprisePolicyOptions = {},
): EnterpriseGuardDecision {
  const toolName = input.tool.name.value;
  if (input.parse.status !== 'complete') {
    return aggregate([inputFailure(input)]);
  }
  if (
    isWriteTool(toolName) &&
    (input.writes.length !== 1 || !input.writes[0].path.value || !input.writes[0].fragment.value)
  ) {
    return aggregate([inputFailure(input)]);
  }
  if (isBashTool(toolName) && !input.command.value) return aggregate([inputFailure(input)]);

  const results: EnterpriseRuleResult[] = [];
  const write = input.writes[0];
  if (isWriteTool(toolName) && write) {
    const text = write.fragment.value ?? '';
    const envWrite = Boolean(write.path.value && isEnvironmentFile(write.path.value));
    const hardSecret = containsHardSecret(text);
    const softSecret = containsSoftSecret(text);
    results.push(
      result(
        input,
        'EG-HARD-ENV-001',
        'hard',
        envWrite ? 'deny' : 'allow',
        envWrite
          ? 'Environment file writes are not permitted'
          : 'No environment-file write detected',
        write.path.value ? [{ kind: 'path', subject: write.path.value, redacted: true }] : [],
      ),
      result(
        input,
        'EG-HARD-SECRET-001',
        'hard',
        hardSecret ? 'deny' : 'allow',
        hardSecret
          ? 'High-confidence credential material is not permitted'
          : 'No high-confidence credential material detected',
        [{ kind: 'write-fragment', subject: 'write-payload', redacted: true }],
      ),
      result(
        input,
        'EG-SOFT-SECRET-002',
        'soft',
        softSecret ? 'warn' : 'abstain',
        softSecret ? 'Credential-like material requires review' : 'Rule not applicable',
        [{ kind: 'write-fragment', subject: 'write-payload', redacted: true }],
      ),
    );
  } else {
    results.push(
      result(input, 'EG-HARD-ENV-001', 'hard', 'abstain', 'Rule not applicable'),
      result(input, 'EG-HARD-SECRET-001', 'hard', 'abstain', 'Rule not applicable'),
      result(input, 'EG-SOFT-SECRET-002', 'soft', 'abstain', 'Rule not applicable'),
    );
  }

  if (isBashTool(toolName)) {
    const command = input.command.value ?? '';
    const deleteDecision = recursiveDelete(input);
    const pushDecision = forcePush(
      input,
      new Set(options.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES),
    );
    const hardSecret = containsHardSecret(command);
    const softSecret = containsSoftSecret(command);
    results.push(
      result(
        input,
        'EG-HARD-RM-001',
        'hard',
        deleteDecision === 'deny' ? 'deny' : deleteDecision === 'warn' ? 'allow' : 'abstain',
        deleteDecision === 'deny'
          ? 'Recursive forced deletion targets a protected or unresolved path'
          : deleteDecision === 'warn'
            ? 'Deletion is outside protected paths'
            : 'Rule not applicable',
        deleteDecision === 'abstain'
          ? []
          : [{ kind: 'command', subject: 'recursive-delete', redacted: true }],
      ),
      result(
        input,
        'EG-SOFT-DELETE-002',
        'soft',
        deleteDecision === 'warn' ? 'warn' : 'abstain',
        deleteDecision === 'warn' ? 'Broad deletion requires review' : 'Rule not applicable',
        deleteDecision === 'warn'
          ? [{ kind: 'command', subject: 'recursive-delete', redacted: true }]
          : [],
      ),
      result(
        input,
        'EG-HARD-GIT-001',
        'hard',
        pushDecision === 'deny' ? 'deny' : pushDecision === 'warn' ? 'allow' : 'abstain',
        pushDecision === 'deny'
          ? 'Force push targets a protected or unresolved branch'
          : pushDecision === 'warn'
            ? 'Force push targets a non-protected branch'
            : 'Rule not applicable',
        pushDecision === 'abstain'
          ? []
          : [{ kind: 'command', subject: 'force-push', redacted: true }],
      ),
      result(
        input,
        'EG-SOFT-GIT-002',
        'soft',
        pushDecision === 'warn' ? 'warn' : 'abstain',
        pushDecision === 'warn'
          ? 'Non-protected force push requires review'
          : 'Rule not applicable',
        pushDecision === 'warn' ? [{ kind: 'command', subject: 'force-push', redacted: true }] : [],
      ),
      result(
        input,
        'EG-HARD-SECRET-001',
        'hard',
        hardSecret ? 'deny' : 'abstain',
        hardSecret ? 'High-confidence credential material is not permitted' : 'Rule not applicable',
        [{ kind: 'command', subject: 'command-arguments', redacted: true }],
      ),
      result(
        input,
        'EG-SOFT-SECRET-002',
        'soft',
        softSecret ? 'warn' : 'abstain',
        softSecret ? 'Credential-like material requires review' : 'Rule not applicable',
        [{ kind: 'command', subject: 'command-arguments', redacted: true }],
      ),
    );
  } else {
    results.push(
      result(input, 'EG-HARD-RM-001', 'hard', 'abstain', 'Rule not applicable'),
      result(input, 'EG-SOFT-DELETE-002', 'soft', 'abstain', 'Rule not applicable'),
      result(input, 'EG-HARD-GIT-001', 'hard', 'abstain', 'Rule not applicable'),
      result(input, 'EG-SOFT-GIT-002', 'soft', 'abstain', 'Rule not applicable'),
    );
  }

  const now = options.now ?? new Date();
  const exceptions = options.exceptions ?? [];
  return aggregate(results.map((rule) => applyException(rule, input, exceptions, now)));
}
