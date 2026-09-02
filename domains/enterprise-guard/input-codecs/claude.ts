import {
  MAX_ENTERPRISE_HOOK_FIELD_BYTES,
  MAX_ENTERPRISE_HOOK_INPUT_BYTES,
  isWriteTool,
} from '../normalized-event.js';
import type {
  CapturedJson,
  CapturedString,
  EnterpriseGuardInputCodec,
  EnterpriseHookInput,
} from '../normalized-event.js';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      status: raw.field.truncated ? 'partial' : 'failed',
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

export const claudeEnterpriseGuardCodec: EnterpriseGuardInputCodec = {
  id: 'claude',
  parse: parseClaudeEnterpriseHookInput,
};
