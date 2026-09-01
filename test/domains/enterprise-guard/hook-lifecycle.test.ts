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

type ClaudeSettings = {
  hooks: {
    PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  };
};

describe('enterprise guard managed Hook lifecycle', () => {
  let temporaryRoot: string;
  const claude = PLATFORMS.find((platform) => platform.id === 'claude');
  const codex = PLATFORMS.find((platform) => platform.id === 'codex');

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-enterprise-guard-'));
    expect(claude).toBeDefined();
    expect(codex).toBeDefined();
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

  function readCommands(settings: ClaudeSettings): string[] {
    return settings.hooks.PreToolUse.flatMap((group) => group.hooks.map((hook) => hook.command));
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

    const commands = readCommands(await readClaudeSettings());
    expect(
      commands.filter((command) => command.includes('comet-enterprise-gateway.mjs')),
    ).toHaveLength(1);
    expect(commands.some((command) => command.includes('comet-hook-router.mjs'))).toBe(false);
    expect(commands.some((command) => command.includes('comet-enterprise-hook.mjs'))).toBe(false);
    expect(commands).toContain('node user-hook.mjs');

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

    const commands = readCommands(await readClaudeSettings());
    expect(commands).toContain('node user-hook.mjs');
    expect(commands.some((command) => command.includes('comet-hook-router.mjs'))).toBe(true);
    expect(commands.some((command) => command.includes('comet-enterprise-hook.mjs'))).toBe(true);
    expect(commands.some((command) => command.includes('comet-enterprise-gateway.mjs'))).toBe(
      false,
    );
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

    const commands = readCommands(await readClaudeSettings());
    expect(commands).toContain('node user-hook.mjs');
    expect(commands.some((command) => command.includes('comet-hook-router.mjs'))).toBe(true);
    expect(commands.some((command) => command.includes('comet-enterprise-gateway.mjs'))).toBe(
      false,
    );
    expect(commands.some((command) => command.includes('comet-enterprise-hook.mjs'))).toBe(false);
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
});
