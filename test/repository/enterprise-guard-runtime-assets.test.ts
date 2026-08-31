import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import manifest from '../../assets/manifest.json';

const generatedHook = path.resolve(
  'assets',
  'skills',
  'comet',
  'scripts',
  'comet-enterprise-hook.mjs',
);
const builder = path.resolve('scripts', 'build', 'build-enterprise-guard-runtime.mjs');

describe('enterprise guard release asset', () => {
  it('publishes a fresh, self-contained Claude Guard Hook bundle', async () => {
    expect(manifest.skills).toContain('comet/scripts/comet-enterprise-hook.mjs');
    const source = await fs.readFile(generatedHook, 'utf8');

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(source).toContain('comet.enterprise-hook-input.v1');
    expect(source).not.toContain('comet-hook-router.mjs');
    execFileSync(process.execPath, [builder, '--check'], { stdio: 'pipe' });
  });

  it('uses Claude’s blocking exit code for harmful raw stdin', () => {
    const result = spawnSync(process.execPath, [generatedHook, '--platform', 'claude'], {
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git push --force origin main' },
      }),
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('EG-HARD-GIT-001');
  });

  it('drains oversized stdin before enforcing the size limit', () => {
    const result = spawnSync(process.execPath, [generatedHook, '--platform', 'claude'], {
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '.env', content: 'x'.repeat(300 * 1024) },
      }),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('EG-HARD-INPUT-001');
  });
});
