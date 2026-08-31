import { describe, expect, it } from 'vitest';

import {
  evaluateEnterpriseHookInput,
  parseClaudeEnterpriseHookInput,
} from '../../../domains/enterprise-guard/policy-engine.js';

describe('enterprise guard policy engine', () => {
  it('maps Claude Write, Edit, and Bash input to the versioned policy contract', () => {
    expect(
      parseClaudeEnterpriseHookInput(
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          cwd: '/workspace/project',
          tool_name: 'Write',
          tool_input: { file_path: 'src/config.ts', content: 'export const port = 3000;' },
        }),
      ),
    ).toMatchObject({
      schema: 'comet.enterprise-hook-input.v1',
      platform: 'claude',
      event: 'PreToolUse',
      tool: 'Write',
      cwd: '/workspace/project',
      paths: ['src/config.ts'],
      writeFragments: ['export const port = 3000;'],
      command: null,
      truncated: false,
    });

    expect(
      parseClaudeEnterpriseHookInput(
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          cwd: '/workspace/project',
          tool_name: 'Edit',
          tool_input: { file_path: 'src/config.ts', new_string: 'export const port = 4000;' },
        }),
      ).writeFragments,
    ).toEqual(['export const port = 4000;']);

    expect(
      parseClaudeEnterpriseHookInput(
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          cwd: '/workspace/project',
          tool_name: 'Bash',
          tool_input: { command: 'git status --short' },
        }),
      ),
    ).toMatchObject({
      tool: 'Bash',
      command: 'git status --short',
      writeFragments: [],
    });
  });

  it('blocks the approved HARD rule set without echoing secret material', () => {
    const fixtures = [
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Write',
          cwd: '/workspace/project',
          paths: ['.env'],
          command: null,
          writeFragments: ['TOKEN=value'],
          truncated: false,
        },
        ruleId: 'EG.HARD.ENV_WRITE',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Write',
          cwd: '/workspace/project',
          paths: ['src/config.ts'],
          command: null,
          writeFragments: [`const key = '${'AKIA' + '0'.repeat(16)}';`],
          truncated: false,
        },
        ruleId: 'EG.HARD.EMBEDDED_SECRET',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Write',
          cwd: '/workspace/project',
          paths: ['src/tls.ts'],
          command: null,
          writeFragments: ['-----BEGIN PRIVATE KEY-----'],
          truncated: false,
        },
        ruleId: 'EG.HARD.PRIVATE_KEY',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Bash',
          cwd: '/workspace/project',
          paths: [],
          command: 'rm -rf /',
          writeFragments: [],
          truncated: false,
        },
        ruleId: 'EG.HARD.DESTRUCTIVE_DELETE',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Bash',
          cwd: '/workspace/project',
          paths: [],
          command: 'git push --force origin main',
          writeFragments: [],
          truncated: false,
        },
        ruleId: 'EG.HARD.FORCE_PUSH',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Bash',
          cwd: '/workspace/project',
          paths: [],
          command: 'sudo rm -rf -- /',
          writeFragments: [],
          truncated: false,
        },
        ruleId: 'EG.HARD.DESTRUCTIVE_DELETE',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Bash',
          cwd: '/workspace/project',
          paths: [],
          command: '/bin/rm -rf /',
          writeFragments: [],
          truncated: false,
        },
        ruleId: 'EG.HARD.DESTRUCTIVE_DELETE',
      },
      {
        input: {
          schema: 'comet.enterprise-hook-input.v1' as const,
          platform: 'claude' as const,
          event: 'PreToolUse' as const,
          tool: 'Bash',
          cwd: '/workspace/project',
          paths: [],
          command: 'git -c core.sshCommand=ssh push --force origin main',
          writeFragments: [],
          truncated: false,
        },
        ruleId: 'EG.HARD.FORCE_PUSH',
      },
    ];

    for (const fixture of fixtures) {
      const decision = evaluateEnterpriseHookInput(fixture.input);
      expect(decision).toMatchObject({ allowed: false, ruleId: fixture.ruleId });
      expect(decision.reason).not.toContain('AKIA');
      expect(decision.reason).not.toContain('TOKEN=value');
    }
  });

  it('allows documented .env examples and ordinary work', () => {
    const example = evaluateEnterpriseHookInput({
      schema: 'comet.enterprise-hook-input.v1',
      platform: 'claude',
      event: 'PreToolUse',
      tool: 'Write',
      cwd: '/workspace/project',
      paths: ['.env.example'],
      command: null,
      writeFragments: ['API_TOKEN=replace-me'],
      truncated: false,
    });
    const ordinary = evaluateEnterpriseHookInput({
      schema: 'comet.enterprise-hook-input.v1',
      platform: 'claude',
      event: 'PreToolUse',
      tool: 'Bash',
      cwd: '/workspace/project',
      paths: [],
      command: 'pnpm test --runInBand',
      writeFragments: [],
      truncated: false,
    });

    expect(example).toMatchObject({ allowed: true, ruleId: null });
    expect(ordinary).toMatchObject({ allowed: true, ruleId: null });
  });

  it('does not treat an arbitrary documentation path as an environment-file exception', () => {
    const decision = evaluateEnterpriseHookInput({
      schema: 'comet.enterprise-hook-input.v1',
      platform: 'claude',
      event: 'PreToolUse',
      tool: 'Write',
      cwd: '/workspace/project',
      paths: ['docs/guide/.env'],
      command: null,
      writeFragments: ['TOKEN=value'],
      truncated: false,
    });

    expect(decision).toMatchObject({ allowed: false, ruleId: 'EG.HARD.ENV_WRITE' });
  });

  it('fails closed when the Hook input exceeds its supported size', () => {
    const input = parseClaudeEnterpriseHookInput(
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'x'.repeat(300 * 1024) },
      }),
    );

    expect(input.truncated).toBe(true);
    expect(evaluateEnterpriseHookInput(input)).toMatchObject({
      allowed: false,
      ruleId: 'EG.HARD.TRUNCATED_INPUT',
    });
  });
});
