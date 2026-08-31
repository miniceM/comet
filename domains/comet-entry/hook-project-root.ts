import { promises as fs, realpathSync } from 'fs';
import path from 'path';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';
import type { CometHookRequest } from './hook-types.js';

function physicalPath(value: string): string {
  const resolved = path.resolve(value);
  const missingSegments: string[] = [];
  let cursor = resolved;

  while (true) {
    try {
      return path.join(realpathSync(cursor), ...missingSegments.reverse());
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return resolved;
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = physicalPath(left);
  const normalizedRight = physicalPath(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(physicalPath(root), physicalPath(candidate));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function logicalRootForTarget(target: string, physicalRoot: string): string | null {
  const physicalTarget = physicalPath(target);
  const relative = path.relative(physicalPath(physicalRoot), physicalTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  let logicalRoot = path.resolve(target);
  for (const segment of relative.split(path.sep)) {
    if (segment) logicalRoot = path.dirname(logicalRoot);
  }
  return logicalRoot;
}

function owningWorktree(candidate: string, roots: readonly string[]): string | null {
  return (
    [...roots]
      .sort((left, right) => right.length - left.length)
      .find((root) => isWithin(root, candidate)) ?? null
  );
}

async function assertRebasedWorktreeReady(projectRoot: string): Promise<void> {
  for (const marker of ['.git', path.join('.comet', 'config.yaml')]) {
    try {
      await fs.lstat(path.join(projectRoot, marker));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new Error(
        `linked worktree ${projectRoot} is not initialized for Comet: missing ${marker.replaceAll('\\', '/')}`,
        { cause: error },
      );
    }
  }
}

export async function resolveCometHookProjectRoot(
  explicitProjectRoot: string,
  request: CometHookRequest,
): Promise<string> {
  const explicitRoot = path.resolve(explicitProjectRoot);
  const roots = listGitWorktreeRoots(explicitRoot);
  if (roots.length < 2 || request.targets.length === 0) return explicitRoot;

  const requestedCwd = request.cwd ? path.resolve(request.cwd) : null;
  const cwdOwner = requestedCwd ? owningWorktree(requestedCwd, roots) : null;
  const relativeTargetBase = cwdOwner && requestedCwd ? requestedCwd : explicitRoot;
  const owners = new Map<string, { physicalRoot: string; logicalRoot: string | null }>();

  for (const target of request.targets) {
    const absoluteTarget = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(relativeTargetBase, target);
    const owner = owningWorktree(absoluteTarget, roots);
    if (!owner) continue;
    const key = process.platform === 'win32' ? owner.toLowerCase() : owner;
    const existing = owners.get(key);
    owners.set(key, {
      physicalRoot: owner,
      logicalRoot: existing?.logicalRoot ?? logicalRootForTarget(absoluteTarget, owner),
    });
  }

  if (owners.size === 0) return explicitRoot;
  if (owners.size > 1) {
    throw new Error('one Hook request cannot write across multiple Git worktrees');
  }

  const [selected] = owners.values();
  if (!samePath(selected.physicalRoot, explicitRoot)) {
    await assertRebasedWorktreeReady(selected.physicalRoot);
  }
  return selected.logicalRoot ?? selected.physicalRoot;
}
