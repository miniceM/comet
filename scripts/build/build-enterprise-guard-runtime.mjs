#!/usr/bin/env node

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { readRepositoryLayout, resolveRepositoryPath } from '../lib/repository-layout.mjs';

const layout = readRepositoryLayout();
const repoRoot = resolveRepositoryPath('.');
const entry = layout.enterpriseGuardRuntime?.entry;
const output = layout.enterpriseGuardRuntime?.output;

if (!entry || !output) {
  throw new Error('Enterprise Guard runtime requires entry and output in repository layout');
}

async function bundledRuntime() {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    packages: 'bundle',
    preserveSymlinks: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    treeShaking: true,
    minify: true,
    banner: {
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __cometCreateRequire } from 'module';",
        'const require = __cometCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });
  if (result.outputFiles.length !== 1) {
    throw new Error(
      `Expected one Enterprise Guard runtime output, got ${result.outputFiles.length}`,
    );
  }
  return Buffer.from(result.outputFiles[0].contents);
}

const outputFile = resolveRepositoryPath(output);
const expected = await bundledRuntime();

if (process.argv.includes('--check')) {
  let actual;
  try {
    actual = await fs.readFile(outputFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Enterprise Guard runtime script is missing: ${output}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
  if (actual && !actual.equals(expected)) {
    console.error(
      `Enterprise Guard runtime script is stale: ${output}; run node scripts/build/build-enterprise-guard-runtime.mjs`,
    );
    process.exitCode = 1;
  }
} else {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, expected);
}
