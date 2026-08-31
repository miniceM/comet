import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  runEnterpriseGuard,
  runEnterpriseGuardWithAudit,
} from '../../../domains/enterprise-guard/enterprise-hook-entry.js';
import { enterpriseExceptionsFile } from '../../../domains/enterprise-guard/exceptions.js';
import { enterpriseFindingsFile } from '../../../domains/enterprise-guard/findings.js';

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
      expect(result.stderr).toContain('Enterprise Guard blocked EG-HARD-');
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
    expect(result.stderr).toContain('EG-HARD-INPUT-001');
  });

  it('rejects unknown platforms before evaluating input', () => {
    expect(runEnterpriseGuard('unknown', '{}')).toEqual({
      exitCode: 64,
      stdout: '',
      stderr: 'Unsupported Comet Hook platform: unknown\n',
    });
  });

  it('writes only redacted findings before returning a Claude deny response', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-enterprise-entry-'));
    const syntheticToken = `AKIA${'0'.repeat(16)}`;
    try {
      const output = await runEnterpriseGuardWithAudit(
        'claude',
        JSON.stringify({
          cwd: projectRoot,
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/config.ts',
            content: `AWS_ACCESS_KEY_ID=${syntheticToken}`,
          },
        }),
        projectRoot,
      );

      const stored = await fs.readFile(enterpriseFindingsFile(projectRoot), 'utf8');
      expect(output).toMatchObject({ exitCode: 2, stdout: '' });
      expect(output.stderr).not.toContain(syntheticToken);
      expect(stored).not.toContain(syntheticToken);
      expect(stored).not.toContain('AWS_ACCESS_KEY_ID');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('consumes only a project-local approved exception before emitting audit findings', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-enterprise-entry-'));
    try {
      const exceptionsFile = enterpriseExceptionsFile(projectRoot);
      await fs.mkdir(path.dirname(exceptionsFile), { recursive: true });
      await fs.writeFile(
        exceptionsFile,
        `${JSON.stringify({
          schemaVersion: 'comet.enterprise-exceptions.v1',
          exceptions: [
            {
              schemaVersion: 'comet.enterprise-exception.v1',
              exceptionId: 'EGE-HOOK-123',
              ruleId: 'EG-HARD-ENV-001',
              scope: { kind: 'path', value: 'config/.env' },
              reason: 'Protected workflow reviewed the generated file.',
              owner: 'security@example.test',
              expiresAt: '2026-12-31T00:00:00.000Z',
              approval: {
                changeId: 'CHG-123',
                approvedBy: 'security@example.test',
                approvedAt: '2026-08-31T00:00:00.000Z',
                protectedRef: 'refs/heads/main',
              },
              ci: {
                provider: 'github-actions',
                runId: '456',
                conclusion: 'passed',
                protectedRef: 'refs/heads/main',
              },
              status: 'active',
            },
          ],
        })}\n`,
        'utf8',
      );

      const output = await runEnterpriseGuardWithAudit(
        'claude',
        JSON.stringify({
          cwd: projectRoot,
          tool_name: 'Write',
          tool_input: { file_path: 'config/.env', content: 'TOKEN=value' },
        }),
        projectRoot,
      );
      const stored = await fs.readFile(enterpriseFindingsFile(projectRoot), 'utf8');

      expect(output).toEqual({ exitCode: 0, stdout: '', stderr: '' });
      expect(stored).toContain('EGE-HOOK-123');
      expect(stored).toContain('EG-HARD-ENV-001');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails closed without exposing Hook input when findings cannot be persisted', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-enterprise-entry-'));
    try {
      await fs.writeFile(path.join(projectRoot, '.comet'), 'not-a-directory\n', 'utf8');
      const output = await runEnterpriseGuardWithAudit(
        'claude',
        JSON.stringify({
          cwd: projectRoot,
          tool_name: 'Write',
          tool_input: { file_path: '.env', content: 'TOKEN=internal-value' },
        }),
        projectRoot,
      );

      expect(output).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: 'Enterprise Guard audit persistence is unavailable\n',
      });
      expect(output.stderr).not.toContain('internal-value');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});
