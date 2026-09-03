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
const ZERO_OID = '0000000000000000000000000000000000000000';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((res) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => res(data));
    process.stdin.on('error', () => res(''));
  });
}

function isNonFastForward(localOid, remoteOid) {
  if (!remoteOid || remoteOid === ZERO_OID) return false;
  if (!localOid || localOid === ZERO_OID) return false;
  try {
    // If remoteOid is an ancestor of localOid, it's a fast-forward
    execFileSync('git', ['merge-base', '--is-ancestor', remoteOid, localOid], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return false;
  } catch {
    // Not an ancestor -> non-fast-forward (force push)
    return true;
  }
}

const stdin = await readStdin();
if (!stdin.trim()) {
  process.exit(0);
}

const pushRefs = [];
let hasForcePush = false;

for (const line of stdin.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const parts = trimmed.split(/\s+/u);
  if (parts.length >= 4) {
    const [localRef, localOid, remoteRef, remoteOid] = parts;
    pushRefs.push({ localRef, localOid, remoteRef, remoteOid });
    if (isNonFastForward(localOid, remoteOid)) {
      hasForcePush = true;
    }
  }
}

if (pushRefs.length === 0) {
  process.exit(0);
}

const { evaluatePrePush } = await loadGitBoundary();
const evaluation = await evaluatePrePush(projectRoot, pushRefs, {
  isForcePush: hasForcePush,
});

if (!evaluation.allowed) {
  console.error('\n❌ Enterprise Guard pre-push blocked:');
  for (const v of evaluation.violations) {
    console.error(`- [${v.ruleId}] ${v.target}: ${v.detail}`);
  }
  console.error('\nPlease resolve the violations above before pushing.\n');
  process.exit(1);
}

process.exit(0);
