import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hookLifecycleDependencies,
  inspectEnterpriseGuard,
  installEnterpriseGuard,
  removeEnterpriseGuard,
} from '../../../domains/enterprise-guard/hook-lifecycle.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';

type ClaudeHook = { type: string; command: string; args?: string[] };

type ClaudeSettings = {
  hooks: {
    PreToolUse: Array<{ matcher: string; hooks: ClaudeHook[] }>;
  };
};

describe('enterprise guard managed Hook lifecycle', () => {
  let temporaryRoot: string;
  const claude = PLATFORMS.find((platform) => platform.id === 'claude');
  const codex = PLATFORMS.find((platform) => platform.id === 'codex');
  const opencode = PLATFORMS.find((platform) => platform.id === 'opencode');

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-enterprise-guard-'));
    expect(claude).toBeDefined();
    expect(codex).toBeDefined();
    expect(opencode).toBeDefined();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  function settingsPath(): string {
    return path.join(temporaryRoot, '.claude', 'settings.local.json');
  }

  async function writeClaudeSettings(settings: ClaudeSettings): Promise<void> {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  async function readClaudeSettings(): Promise<ClaudeSettings> {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as ClaudeSettings;
  }

  function readHooks(settings: ClaudeSettings): ClaudeHook[] {
    return settings.hooks.PreToolUse.flatMap((group) => group.hooks);
  }

  function includesScript(hook: ClaudeHook, scriptName: string): boolean {
    return (
      hook.command.includes(scriptName) ||
      (hook.args ?? []).some((argument) => argument.includes(scriptName))
    );
  }

  function legacyHookCommands(): { routerCommand: string; retiredCommand: string } {
    const routerCommand = `node ${JSON.stringify(
      path.join(temporaryRoot, '.claude', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
    )} --platform "claude" --project-root ${JSON.stringify(temporaryRoot)}`;
    const retiredCommand = `node ${JSON.stringify(
      path.join(
        temporaryRoot,
        '.claude',
        'skills',
        'comet',
        'scripts',
        'comet-enterprise-hook.mjs',
      ),
    )} --platform "claude"`;
    return { routerCommand, retiredCommand };
  }

  async function writeGatewayScript(): Promise<void> {
    const scriptPath = path.join(
      temporaryRoot,
      '.claude',
      'skills',
      'comet',
      'scripts',
      'comet-enterprise-gateway.mjs',
    );
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, '#!/usr/bin/env node\n', 'utf8');
  }

  function legacySettings(): ClaudeSettings {
    const { routerCommand, retiredCommand } = legacyHookCommands();
    return {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Write|Edit|Bash',
            hooks: [{ type: 'command', command: 'node user-hook.mjs' }],
          },
          {
            matcher: 'Write|Edit',
            hooks: [{ type: 'command', command: routerCommand }],
          },
          {
            matcher: 'Write|Edit|Bash',
            hooks: [{ type: 'command', command: retiredCommand }],
          },
        ],
      },
    };
  }

  it('installs a single Gateway and retires the legacy enterprise and router Hooks', async () => {
    if (!claude) throw new Error('Claude platform fixture is missing');
    await writeGatewayScript();
    await writeClaudeSettings(legacySettings());

    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toMatchObject({
      status: 'installed',
    });

    const hooks = readHooks(await readClaudeSettings());
    expect(
      hooks.filter((hook) => includesScript(hook, 'comet-enterprise-gateway.mjs')),
    ).toHaveLength(1);
    expect(hooks.some((hook) => includesScript(hook, 'comet-hook-router.mjs'))).toBe(false);
    expect(hooks.some((hook) => includesScript(hook, 'comet-enterprise-hook.mjs'))).toBe(false);
    expect(hooks).toContainEqual({ type: 'command', command: 'node user-hook.mjs' });

    await expect(inspectEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      present: true,
    });
  });

  it('keeps the legacy Hooks when the Gateway install fails', async () => {
    if (!claude) throw new Error('Claude platform fixture is missing');
    await writeClaudeSettings(legacySettings());
    const installSpy = vi.spyOn(hookLifecycleDependencies, 'installManagedHooksForPlatform');
    const removeSpy = vi.spyOn(hookLifecycleDependencies, 'removeManagedHooksForPlatform');

    installSpy.mockResolvedValueOnce({ status: 'failed', reason: 'gateway bundle missing' });
    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      status: 'failed',
      reason: 'gateway bundle missing',
    });

    installSpy.mockRejectedValueOnce(new Error('gateway bundle crashed'));
    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      status: 'failed',
      reason: 'gateway bundle crashed',
    });

    expect(installSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).not.toHaveBeenCalled();

    const hooks = readHooks(await readClaudeSettings());
    expect(hooks).toContainEqual({ type: 'command', command: 'node user-hook.mjs' });
    expect(hooks.some((hook) => includesScript(hook, 'comet-hook-router.mjs'))).toBe(true);
    expect(hooks.some((hook) => includesScript(hook, 'comet-enterprise-hook.mjs'))).toBe(true);
    expect(hooks.some((hook) => includesScript(hook, 'comet-enterprise-gateway.mjs'))).toBe(false);
  });

  it('reports a repairable state while legacy Hooks coexist with the Gateway', async () => {
    if (!claude) throw new Error('Claude platform fixture is missing');
    await writeGatewayScript();
    await writeClaudeSettings(legacySettings());
    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toMatchObject({
      status: 'installed',
    });

    const settings = await readClaudeSettings();
    const { routerCommand } = legacyHookCommands();
    settings.hooks.PreToolUse.push({
      matcher: 'Write|Edit',
      hooks: [{ type: 'command', command: routerCommand }],
    });
    await writeClaudeSettings(settings);

    await expect(inspectEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      present: true,
      legacyPresent: true,
    });
  });

  it('uninstalls the Gateway and retired Enterprise Hook while keeping the Router and user Hooks', async () => {
    if (!claude) throw new Error('Claude platform fixture is missing');
    await writeClaudeSettings(legacySettings());
    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toMatchObject({
      status: 'installed',
    });

    const settings = await readClaudeSettings();
    const { routerCommand, retiredCommand } = legacyHookCommands();
    settings.hooks.PreToolUse.push(
      { matcher: 'Write|Edit', hooks: [{ type: 'command', command: routerCommand }] },
      { matcher: 'Write|Edit|Bash', hooks: [{ type: 'command', command: retiredCommand }] },
    );
    await writeClaudeSettings(settings);

    await expect(removeEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      removed: 2,
      failed: 0,
    });

    const hooks = readHooks(await readClaudeSettings());
    expect(hooks).toContainEqual({ type: 'command', command: 'node user-hook.mjs' });
    expect(hooks.some((hook) => includesScript(hook, 'comet-hook-router.mjs'))).toBe(true);
    expect(hooks.some((hook) => includesScript(hook, 'comet-enterprise-gateway.mjs'))).toBe(false);
    expect(hooks.some((hook) => includesScript(hook, 'comet-enterprise-hook.mjs'))).toBe(false);
  });

  it('reports failure when the legacy Hook cleanup fails after a successful Gateway install', async () => {
    if (!claude) throw new Error('Claude platform fixture is missing');
    await writeClaudeSettings(legacySettings());
    vi.spyOn(hookLifecycleDependencies, 'removeManagedHooksForPlatform').mockResolvedValueOnce({
      removed: 0,
      failed: 1,
    });

    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      status: 'failed',
      reason: 'enterprise Gateway installed but legacy Hook cleanup failed',
      cleanupFailed: 1,
    });
  });

  it('does not install an Enterprise Guard Hook on a rules-and-CI fallback platform', async () => {
    if (!codex) throw new Error('Codex platform fixture is missing');

    await expect(installEnterpriseGuard(temporaryRoot, codex, 'project')).resolves.toEqual({
      status: 'skipped',
      reason: 'Enterprise Guard uses rules injection + CI fallback on Codex',
    });
    await expect(inspectEnterpriseGuard(temporaryRoot, codex, 'project')).resolves.toEqual({
      present: false,
    });
    await expect(removeEnterpriseGuard(temporaryRoot, codex, 'project')).resolves.toEqual({
      removed: 0,
      failed: 0,
    });
    await expect(fs.access(path.join(temporaryRoot, '.codex', 'hooks.json'))).rejects.toThrow();
  });

  describe('OpenCode managed plugin', () => {
    function pluginsDir(): string {
      return path.join(temporaryRoot, '.opencode', 'plugins');
    }

    function pluginPath(): string {
      return path.join(pluginsDir(), 'comet-enterprise-guard.js');
    }

    function runnerPath(): string {
      return path.join(
        temporaryRoot,
        '.opencode',
        'skills',
        'comet',
        'scripts',
        'comet-enterprise-runner.mjs',
      );
    }

    it('installs one auto-discovered managed plugin without replacing user plugins', async () => {
      if (!opencode) throw new Error('OpenCode platform fixture is missing');
      await fs.mkdir(pluginsDir(), { recursive: true });
      await fs.writeFile(path.join(pluginsDir(), 'user-guard.mjs'), 'export {};\n', 'utf8');

      for (let index = 0; index < 2; index++) {
        await expect(installEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
          status: 'installed',
        });
      }

      const plugin = await fs.readFile(pluginPath(), 'utf8');
      await expect(fs.readFile(runnerPath(), 'utf8')).resolves.toContain('EG-HARD-GIT-001');
      expect(plugin).toContain('comet.enterprise-managed-opencode-guard.v1');
      expect(plugin).toContain('tool.execute.before');
      expect(plugin).toContain('comet-enterprise-runner.mjs');
      await expect(fs.readFile(path.join(pluginsDir(), 'user-guard.mjs'), 'utf8')).resolves.toBe(
        'export {};\n',
      );
      await expect(
        fs.access(path.join(temporaryRoot, '.opencode', 'opencode.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(inspectEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
        present: true,
      });
    });

    it('preserves a user-owned file occupying the managed plugin path', async () => {
      if (!opencode) throw new Error('OpenCode platform fixture is missing');
      await fs.mkdir(pluginsDir(), { recursive: true });
      await fs.writeFile(pluginPath(), 'export const userPlugin = true;\n', 'utf8');

      await expect(installEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
        status: 'failed',
        reason: 'managed plugin path contains a user-owned plugin',
      });
      await expect(
        inspectEnterpriseGuard(temporaryRoot, opencode, 'project'),
      ).resolves.toMatchObject({
        present: false,
        managedPresent: true,
        error: 'managed plugin path contains a user-owned plugin',
      });
      await expect(removeEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
        removed: 0,
        failed: 1,
        reason: 'managed plugin path contains a user-owned plugin',
      });
      await expect(fs.readFile(pluginPath(), 'utf8')).resolves.toBe(
        'export const userPlugin = true;\n',
      );
    });

    it('does not read or write the project OpenCode config', async () => {
      if (!opencode) throw new Error('OpenCode platform fixture is missing');
      await fs.mkdir(path.join(temporaryRoot, '.opencode'), { recursive: true });
      const configPath = path.join(temporaryRoot, '.opencode', 'opencode.json');
      const config = '{ "model": "local/model", "plugin": ["user-guard.mjs"] }\n';
      await fs.writeFile(configPath, config, 'utf8');

      await expect(installEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
        status: 'installed',
      });
      await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(config);
    });

    it('reports damaged, outdated, or duplicate managed runtimes for repair', async () => {
      if (!opencode) throw new Error('OpenCode platform fixture is missing');
      await installEnterpriseGuard(temporaryRoot, opencode, 'project');
      await fs.writeFile(runnerPath(), 'export {};\n', 'utf8');
      await fs.writeFile(
        path.join(pluginsDir(), 'another-comet-guard.mjs'),
        '// comet.enterprise-managed-opencode-guard.v1\nexport {};\n',
        'utf8',
      );

      await expect(
        inspectEnterpriseGuard(temporaryRoot, opencode, 'project'),
      ).resolves.toMatchObject({
        present: true,
        managedPresent: true,
        duplicatePresent: true,
        error: expect.stringContaining('outdated managed runner runtime'),
      });
    });

    it('uninstalls only managed plugin artifacts and keeps user plugins', async () => {
      if (!opencode) throw new Error('OpenCode platform fixture is missing');
      await installEnterpriseGuard(temporaryRoot, opencode, 'project');
      await fs.writeFile(path.join(pluginsDir(), 'user-guard.mjs'), 'export {};\n', 'utf8');

      await expect(removeEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
        removed: 2,
        failed: 0,
      });
      await expect(fs.access(pluginPath())).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.access(runnerPath())).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(path.join(pluginsDir(), 'user-guard.mjs'), 'utf8')).resolves.toBe(
        'export {};\n',
      );
      await expect(inspectEnterpriseGuard(temporaryRoot, opencode, 'project')).resolves.toEqual({
        present: false,
      });
    });
  });
});
