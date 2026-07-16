import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectPaths, spawnCommand, writeJson } from '../lib/core.mjs';
import { runProvider } from '../lib/provider.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.resolve(testDir, '..', 'bin', 'docgen-launcher.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-runtime-'));
  const paths = projectPaths(root);
  fs.mkdirSync(path.dirname(paths.config), { recursive: true });
  writeJson(paths.project, { schemaVersion: '2.0', kitVersion: '2.0.0' });
  writeJson(paths.state, { schemaVersion: '2.0', kitVersion: '2.0.0', stages: {}, pages: {} });
  return { root, paths };
}

function providerShim(root) {
  const script = path.join(root, 'silent-provider.mjs');
  fs.writeFileSync(script, '#!/usr/bin/env node\nawait new Promise((resolve) => setTimeout(resolve, Number(process.env.DOCGEN_TEST_DELAY_MS || 0)));\n');
  fs.chmodSync(script, 0o755);
  if (process.platform !== 'win32') return script;
  const shim = path.join(root, 'silent-provider.cmd');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return shim;
}

test('launcher suppresses node:sqlite ExperimentalWarning for user CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-launcher-'));
  const run = spawnSync(process.execPath, [launcher, 'init', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.doesNotMatch(run.stderr, /ExperimentalWarning|SQLite is an experimental feature/);
});

test('safe command launcher preserves Windows shim execution without shell:true', async () => {
  if (process.platform !== 'win32') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-cmd-'));
  const script = path.join(root, 'args.mjs');
  fs.writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const shim = path.join(root, 'args.cmd');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  const child = spawnCommand(shim, ['alpha', 'space value'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = ''; child.stdout.on('data', (chunk) => { stdout += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.trim()), ['alpha', 'space value']);
});

test('provider timeout terminates silent process and records exit 124', async () => {
  const { root, paths } = fixture();
  const executable = providerShim(root);
  writeJson(paths.config, {
    schemaVersion: '2.0',
    commandCode: { executable, trust: false, skipOnboarding: false, yolo: false, verbose: false, maxTurns: { default: 1 } },
    budget: { maxProviderCalls: 5, maxEstimatedInputTokens: 10000, maxEstimatedOutputTokens: 10000, maxContextTokensPerCall: 5000 },
    execution: { heartbeatSeconds: 0.05, silenceNoticeSeconds: 0.05, streamProviderOutput: false },
    retry: { maxAttempts: 1 }
  });
  const previousDelay = process.env.DOCGEN_TEST_DELAY_MS;
  const previousTimeout = process.env.DOCGEN_STAGE_TIMEOUT_MS;
  process.env.DOCGEN_TEST_DELAY_MS = '5000';
  process.env.DOCGEN_STAGE_TIMEOUT_MS = '250';
  try {
    await assert.rejects(
      () => runProvider(root, { stage: 'plan', target: 'timeout-fixture', prompt: 'timeout test' }),
      (error) => error.exitCode === 124 && error.timedOut === true
    );
  } finally {
    if (previousDelay === undefined) delete process.env.DOCGEN_TEST_DELAY_MS; else process.env.DOCGEN_TEST_DELAY_MS = previousDelay;
    if (previousTimeout === undefined) delete process.env.DOCGEN_STAGE_TIMEOUT_MS; else process.env.DOCGEN_STAGE_TIMEOUT_MS = previousTimeout;
  }
  const records = fs.readFileSync(path.join(paths.telemetry, 'provider-runs.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(records.at(-1).timedOut, true);
  assert.equal(records.at(-1).exitCode, 124);
});
