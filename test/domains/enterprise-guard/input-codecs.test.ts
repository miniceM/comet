import { describe, expect, it } from 'vitest';

import { parseEnterpriseGuardInput } from '../../../domains/enterprise-guard/input-codecs/index.js';

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

  it('rejects a platform without a registered codec', () => {
    expect(() => parseEnterpriseGuardInput('opencode', '{}')).toThrow(
      'Enterprise Guard input codec is unavailable for platform: opencode',
    );
  });
});
