import {
  MAX_ENTERPRISE_HOOK_INPUT_BYTES,
  isWriteTool,
  type EnterpriseGuardInputCodec,
  type EnterpriseHookInput,
} from '../normalized-event.js';
import {
  boundedJson,
  boundedString,
  capturedRawInput,
  isRecord,
  truncationField,
  type JsonRecord,
} from './shared.js';

function normalizedOpenCodeToolName(value: string): string {
  return value.trim().toLowerCase();
}

function claudeToolName(value: string | null): string | null {
  switch (value) {
    case 'bash':
      return 'Bash';
    case 'write':
      return 'Write';
    case 'edit':
    case 'apply_patch':
      return 'Edit';
    default:
      return value;
  }
}

function writeOperation(
  toolName: string | null,
): EnterpriseHookInput['writes'][number]['operation'] {
  if (toolName === 'Write') return 'create';
  if (toolName === 'Edit') return 'edit';
  return 'unknown';
}

const READ_ONLY_OPENCODE_TOOLS = new Set(['glob', 'grep', 'ls', 'read', 'view', 'list', 'find']);

/** Convert OpenCode tool.execute.before JSON into the EnterpriseHookInput v1 contract. */
export function parseOpenCodePluginInput(source: string): EnterpriseHookInput {
  const raw = capturedRawInput(source);
  const fields = [raw.field];
  let parsed: JsonRecord = {};
  let parse: EnterpriseHookInput['parse'] = { status: 'complete', errors: [] };
  try {
    const value = JSON.parse(raw.source) as unknown;
    if (!isRecord(value)) throw new Error('Plugin input must be a JSON object');
    parsed = value;
  } catch (error) {
    parse = {
      status: raw.field.truncated ? 'partial' : 'failed',
      errors: [
        error instanceof Error
          ? error.message.replace(/\s+at position \d+$/u, '')
          : 'Invalid plugin input',
      ],
    };
  }

  const selectedToolInput = parsed.tool_input ?? parsed.args;
  const toolInputValue = isRecord(selectedToolInput) ? selectedToolInput : {};
  const workingDirectory = boundedString(parsed.cwd);
  const rawToolName = boundedString(parsed.tool ?? parsed.tool_name);
  const toolName = boundedString(
    rawToolName.value ? claudeToolName(normalizedOpenCodeToolName(rawToolName.value)) : null,
  );
  const toolInput = boundedJson(toolInputValue);
  const command = boundedString(toolInputValue.command);
  fields.push(
    truncationField('workingDirectory', workingDirectory),
    truncationField('tool.name', toolName),
    truncationField('tool.input', toolInput),
    truncationField('command', command),
  );

  const pathValue = boundedString(
    toolInputValue.file_path ?? toolInputValue.filePath ?? toolInputValue.path,
  );
  const fragmentValue = boundedString(
    toolInputValue.content ??
      toolInputValue.new_string ??
      toolInputValue.newString ??
      toolInputValue.patch ??
      toolInputValue.diff,
  );
  const mutableToolName = toolName.value ?? rawToolName.value;
  const isKnownCommandTool = mutableToolName === 'Bash';
  const isReadOnlyTool = mutableToolName !== null && READ_ONLY_OPENCODE_TOOLS.has(mutableToolName);
  const isMutatingUnknown =
    !isWriteTool(mutableToolName) &&
    !isKnownCommandTool &&
    !isReadOnlyTool &&
    parse.status === 'complete' &&
    true;
  const writes =
    isWriteTool(mutableToolName) || isMutatingUnknown
      ? [{ operation: writeOperation(mutableToolName), path: pathValue, fragment: fragmentValue }]
      : [];
  for (const [index, write] of writes.entries()) {
    fields.push(
      truncationField(`writes.${index}.path`, write.path),
      truncationField(`writes.${index}.fragment`, write.fragment),
    );
  }
  if (parse.status === 'complete' && fields.some((field) => field.truncated)) {
    parse = { status: 'partial', errors: ['Plugin input exceeded a bounded capture limit'] };
  }

  return {
    schemaVersion: 'comet.enterprise-hook-input.v1',
    platform: { id: 'opencode', surface: 'project', version: null },
    event: { name: 'tool.execute.before', preAction: true, blockingCapable: true },
    workingDirectory,
    tool: { name: toolName, input: toolInput },
    command,
    writes,
    parse,
    truncation: { maxCapturedBytes: MAX_ENTERPRISE_HOOK_INPUT_BYTES, fields },
  };
}

export const opencodeEnterpriseGuardCodec: EnterpriseGuardInputCodec = {
  id: 'opencode',
  parse: parseOpenCodePluginInput,
};
