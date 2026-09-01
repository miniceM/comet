import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enterpriseGuardHookConfig,
  inspectEnterpriseGuard,
  installEnterpriseGuard,
  removeEnterpriseGuard,
} from '../../../domains/enterprise-guard/hook-lifecycle.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';

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
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('installs, inspects, repairs, and uninstalls only its own Claude Hook', async () => {
    if (!claude) throw new Error('Claude platform fixture is missing');
    const scriptPath = path.join(
      temporaryRoot,
      '.claude',
      'skills',
      ...Object.keys(enterpriseGuardHookConfig)[0].split('/'),
    );
    const settingsPath = path.join(temporaryRoot, '.claude', 'settings.local.json');
    const routerCommand = `node ${JSON.stringify(
      path.join(temporaryRoot, '.claude', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
    )} --platform "claude" --project-root ${JSON.stringify(temporaryRoot)}`;

    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, '#!/usr/bin/env node\n', 'utf8');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
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
          ],
        },
      }),
      'utf8',
    );

    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    await expect(installEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toMatchObject({
      status: 'installed',
    });
    const inspection = await inspectEnterpriseGuard(temporaryRoot, claude, 'project');
    expect(inspection).toMatchObject({ present: true });
    expect(inspection.duplicatePresent).toBeUndefined();

    const afterInstall = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    const commands = afterInstall.hooks.PreToolUse.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(commands).toContain('node user-hook.mjs');
    expect(commands).toContain(routerCommand);
    expect(
      commands.filter((command) => command.includes('comet-enterprise-hook.mjs')),
    ).toHaveLength(1);

    await expect(removeEnterpriseGuard(temporaryRoot, claude, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });
    const afterUninstall = await fs.readFile(settingsPath, 'utf8');
    expect(afterUninstall).toContain('node user-hook.mjs');
    expect(afterUninstall).toContain('comet-hook-router.mjs');
    expect(afterUninstall).not.toContain('comet-enterprise-hook.mjs');
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
