import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import manifest from '../../assets/manifest.json';

const generatedGateway = path.resolve(
  'assets',
  'skills',
  'comet',
  'scripts',
  'comet-enterprise-gateway.mjs',
);
const generatedRunner = path.resolve(
  'assets',
  'skills',
  'comet',
  'scripts',
  'comet-enterprise-runner.mjs',
);
const generatedPlugin = path.resolve(
  'assets',
  'skills',
  'comet',
  'plugins',
  'comet-enterprise-guard.mjs',
);
const builder = path.resolve('scripts', 'build', 'build-enterprise-guard-runtime.mjs');

describe('enterprise guard release asset', () => {
  it('publishes a fresh, self-contained enterprise gateway bundle', async () => {
    expect(manifest.skills).toContain('comet/scripts/comet-enterprise-gateway.mjs');
    expect(manifest.skills).toContain('comet/scripts/comet-enterprise-runner.mjs');
    expect(manifest.skills).toContain('comet/plugins/comet-enterprise-guard.mjs');
    expect(manifest.skills).toContain('comet/enterprise-guard-manifest.json');
    expect(manifest.skills).not.toContain('comet/scripts/comet-enterprise-hook.mjs');
    const source = await fs.readFile(generatedGateway, 'utf8');

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(source).toContain('comet.enterprise-hook-input.v1');
    expect(source).toContain('No Comet project discovered');
    expect(source).not.toContain('comet-hook-router.mjs');

    const manifestFile = path.resolve(
      'assets',
      'skills',
      'comet',
      'enterprise-guard-manifest.json',
    );
    const runtimeManifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    const manifestZhFile = path.resolve(
      'assets',
      'skills-zh',
      'comet',
      'enterprise-guard-manifest.json',
    );
    const runtimeZhManifest = JSON.parse(await fs.readFile(manifestZhFile, 'utf8'));
    expect(runtimeZhManifest).toEqual(runtimeManifest);

    expect(runtimeManifest.schemaVersion).toBe(1);
    expect(runtimeManifest.version).toBe(manifest.version);
    expect(runtimeManifest.rules).toContain('EG-HARD-INPUT-001');
    expect(runtimeManifest.rules).toContain('EG-HARD-GIT-001');
    expect(runtimeManifest.files.gateway.fileName).toBe('comet-enterprise-gateway.mjs');
    expect(runtimeManifest.files.runner.fileName).toBe('comet-enterprise-runner.mjs');
    expect(runtimeManifest.files.opencodePlugin.fileName).toBe('comet-enterprise-guard.mjs');

    execFileSync(process.execPath, [builder, '--check'], { stdio: 'pipe' });
  });

  it('publishes the managed OpenCode bridge as a thin fail-closed ESM plugin', async () => {
    const plugin = await fs.readFile(generatedPlugin, 'utf8');
    const runner = await fs.readFile(generatedRunner, 'utf8');

    expect(plugin.startsWith('#!/usr/bin/env node\n')).toBe(false);
    expect(plugin).toContain('comet.enterprise-managed-opencode-guard.v1');
    expect(plugin).toContain('tool.execute.before');
    expect(plugin).toContain('Enterprise Guard failed closed');
    expect(plugin).toContain('basename(process.execPath)');
    expect(plugin).not.toContain('spawn(process.execPath');
    expect(plugin).not.toContain('EG-HARD-GIT-001');
    expect(runner.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(runner).toContain('comet.enterprise-guard-decision.v1');
    for (const ruleId of [
      'EG-HARD-INPUT-001',
      'EG-HARD-ENV-001',
      'EG-HARD-SECRET-001',
      'EG-HARD-RM-001',
      'EG-HARD-GIT-001',
    ]) {
      expect(runner).toContain(ruleId);
    }
  });

  it('delegates OpenCode tool execution to the managed Runner', async () => {
    const pluginModule = (await import(pathToFileURL(generatedPlugin).href)) as {
      default: (context?: unknown) => Promise<Record<string, unknown>>;
    };
    const plugin = await pluginModule.default({ directory: '/workspace/comet' });
    const hook = plugin['tool.execute.before'];
    expect(typeof hook).toBe('function');
    const execute = hook as (input: unknown, output: unknown) => Promise<void>;

    await expect(
      execute({ tool: 'Bash' }, { args: { command: 'git push --force origin main' } }),
    ).rejects.toThrow('Enterprise Guard blocked EG-HARD-GIT-001');
    await expect(
      execute({ tool: 'Bash' }, { args: { command: 'git status --short' } }),
    ).resolves.toBeUndefined();
  });

  it('makes the managed Runner fail closed on malformed OpenCode input', () => {
    const result = spawnSync(process.execPath, [generatedRunner, '--platform', 'opencode'], {
      encoding: 'utf8',
      input: '{not-json',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"allowed":false');
    expect(result.stdout).toContain('EG-HARD-INPUT-001');
  });

  it('uses Claude’s blocking exit code for harmful raw stdin', () => {
    const result = spawnSync(process.execPath, [generatedGateway, '--platform', 'claude'], {
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
    const result = spawnSync(process.execPath, [generatedGateway, '--platform', 'claude'], {
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

  it('allows a safe write when no Comet project is discovered', () => {
    const result = spawnSync(process.execPath, [generatedGateway, '--platform', 'claude'], {
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: 'src/index.ts', content: 'export {};\n' },
      }),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
