import { describe, expect, it } from 'vitest';

import { runEnterpriseGuard } from '../../../domains/enterprise-guard/enterprise-hook-entry.js';

describe('enterprise guard Claude Hook entry', () => {
  it('denies harmful Write, Edit, and Bash stdin using Claude Code’s blocking contract', () => {
    const inputs = [
      {
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'TOKEN=value' },
      },
      {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'src/config.ts',
          new_string: `const key = '${'AKIA' + '0'.repeat(16)}';`,
        },
      },
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    ];

    for (const input of inputs) {
      const result = runEnterpriseGuard('claude', JSON.stringify(input));
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Enterprise Guard blocked EG.HARD.');
      expect(result.stderr).not.toContain('TOKEN=value');
      expect(result.stderr).not.toContain('AKIA');
    }
  });

  it('allows safe PreToolUse input without altering the existing workflow', () => {
    const result = runEnterpriseGuard(
      'claude',
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: '/workspace/project',
        tool_name: 'Write',
        tool_input: { file_path: 'src/config.ts', content: 'export const port = 3000;' },
      }),
    );

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('denies oversized raw stdin instead of discarding policy context', () => {
    const result = runEnterpriseGuard(
      'claude',
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'x'.repeat(300 * 1024) },
      }),
    );

    expect(result).toMatchObject({ exitCode: 2, stdout: '' });
    expect(result.stderr).toContain('EG.HARD.TRUNCATED_INPUT');
  });

  it('rejects unknown platforms before evaluating input', () => {
    expect(runEnterpriseGuard('unknown', '{}')).toEqual({
      exitCode: 64,
      stdout: '',
      stderr: 'Unsupported Comet Hook platform: unknown\n',
    });
  });
});
