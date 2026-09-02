import { describe, expect, it } from 'vitest';

import { parseEnterpriseGuardInput } from '../../../domains/enterprise-guard/input-codecs/index.js';
import { evaluateEnterpriseHookInput } from '../../../domains/enterprise-guard/policy-engine.js';

describe('Enterprise Guard input codecs', () => {
  it('normalizes Claude Bash and Write without losing policy fields', () => {
    const bash = parseEnterpriseGuardInput(
      'claude',
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: '/workspace/comet',
        tool_name: 'Bash',
        tool_input: { command: 'git push --force origin main' },
      }),
    );
    expect(bash.command.value).toBe('git push --force origin main');
    expect(bash.event).toEqual({ name: 'PreToolUse', preAction: true, blockingCapable: true });

    const write = parseEnterpriseGuardInput(
      'claude',
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'TOKEN=value' },
      }),
    );
    expect(write.writes[0]).toMatchObject({ operation: 'create' });
    expect(write.writes[0].path.value).toBe('.env');
    expect(write.writes[0].fragment.value).toBe('TOKEN=value');
  });

  it('marks oversized or malformed security input as unsafe', () => {
    const oversized = parseEnterpriseGuardInput(
      'claude',
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'x'.repeat(300 * 1024) },
      }),
    );
    expect(oversized.parse.status).toBe('partial');
    expect(oversized.truncation.fields.some((field) => field.truncated)).toBe(true);
    expect(parseEnterpriseGuardInput('claude', '{').parse.status).toBe('failed');
  });

  it('normalizes OpenCode Bash and write tools into the shared policy contract', () => {
    const bash = parseEnterpriseGuardInput(
      'opencode',
      JSON.stringify({
        tool: 'bash',
        cwd: '/workspace/comet',
        tool_input: { command: 'git push --force origin main' },
      }),
    );
    expect(bash.event).toEqual({
      name: 'tool.execute.before',
      preAction: true,
      blockingCapable: true,
    });
    expect(bash.tool.name.value).toBe('Bash');
    expect(bash.command.value).toBe('git push --force origin main');
    expect(bash.writes).toEqual([]);

    const write = parseEnterpriseGuardInput(
      'opencode',
      JSON.stringify({
        tool: 'write',
        tool_input: { file_path: '.env', content: 'TOKEN=value' },
      }),
    );
    expect(write.writes[0]).toMatchObject({ operation: 'create' });
    expect(write.writes[0].path.value).toBe('.env');
    expect(write.writes[0].fragment.value).toBe('TOKEN=value');

    const patch = parseEnterpriseGuardInput(
      'opencode',
      JSON.stringify({
        tool: 'apply_patch',
        tool_input: { path: 'src/index.ts', diff: '+++ b/src/index.ts\n' },
      }),
    );
    expect(patch.writes[0]).toMatchObject({
      operation: 'edit',
      path: { value: 'src/index.ts' },
      fragment: { value: '+++ b/src/index.ts\n' },
    });
  });

  it('abstains only for a known read-only OpenCode tool', () => {
    const input = parseEnterpriseGuardInput(
      'opencode',
      JSON.stringify({ tool: 'Read', tool_input: { path: 'src/index.ts' } }),
    );

    expect(input.tool.name.value).toBe('read');
    expect(input.writes).toEqual([]);
    expect(evaluateEnterpriseHookInput(input).allowed).toBe(true);
  });

  it('fails closed for malformed, truncated, and unknown mutating OpenCode tools', () => {
    const malformed = parseEnterpriseGuardInput('opencode', '{');
    expect(malformed.parse.status).toBe('failed');
    expect(evaluateEnterpriseHookInput(malformed)).toMatchObject({
      allowed: false,
      ruleId: 'EG-HARD-INPUT-001',
    });

    const oversized = parseEnterpriseGuardInput(
      'opencode',
      JSON.stringify({
        tool: 'write',
        tool_input: { file_path: '.env', content: 'x'.repeat(300 * 1024) },
      }),
    );
    expect(oversized.parse.status).toBe('partial');
    expect(oversized.truncation.fields.some((field) => field.truncated)).toBe(true);
    expect(evaluateEnterpriseHookInput(oversized)).toMatchObject({
      allowed: false,
      ruleId: 'EG-HARD-INPUT-001',
    });

    for (const toolInput of [
      { command: 'deploy --production' },
      { file_path: 'src/generated.ts', content: 'export {};' },
      { path: 'src/generated.ts' },
      {},
    ]) {
      const unknown = parseEnterpriseGuardInput(
        'opencode',
        JSON.stringify({ tool: 'custom_deployer', tool_input: toolInput }),
      );
      expect(unknown.writes[0]).toMatchObject({ operation: 'unknown' });
      expect(evaluateEnterpriseHookInput(unknown)).toMatchObject({
        allowed: false,
        ruleId: 'EG-HARD-INPUT-001',
      });
    }
  });

  it('rejects an unregistered platform codec', () => {
    expect(() => parseEnterpriseGuardInput('not-a-platform', '{}')).toThrow(
      'Enterprise Guard input codec is unavailable for platform: not-a-platform',
    );
  });
});
