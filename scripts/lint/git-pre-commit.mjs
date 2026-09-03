#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

async function loadGitBoundary() {
  try {
    const { build } = await import('esbuild');
    const result = await build({
      entryPoints: [resolve('domains/enterprise-guard/git-boundary.ts')],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
    });
    const code = result.outputFiles[0].text;
    const dataUri = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    return await import(dataUri);
  } catch (err) {
    console.error('Enterprise Guard git-boundary loader failed:', err);
    process.exit(1);
  }
}

const projectRoot = resolve('.');

function getStagedFiles() {
  try {
    const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getStagedDiffs(files) {
  const diffs = [];
  for (const file of files) {
    try {
      const patch = execFileSync('git', ['diff', '--cached', '-U0', '--', file], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      diffs.push({ file, patch });
    } catch {
      // Ignore files that cannot produce diff
    }
  }
  return diffs;
}

const stagedFiles = getStagedFiles();
if (stagedFiles.length === 0) {
  process.exit(0);
}

const stagedDiffs = getStagedDiffs(stagedFiles);
const { evaluatePreCommit } = await loadGitBoundary();
const evaluation = await evaluatePreCommit(projectRoot, stagedFiles, stagedDiffs);

if (!evaluation.allowed) {
  console.error('\n❌ Enterprise Guard pre-commit blocked:');
  for (const v of evaluation.violations) {
    console.error(`- [${v.ruleId}] ${v.target}: ${v.detail}`);
  }
  console.error('\nPlease resolve the violations above before committing.\n');
  process.exit(1);
}

process.exit(0);
