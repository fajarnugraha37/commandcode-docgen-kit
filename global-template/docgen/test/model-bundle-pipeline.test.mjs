import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { model, status } from '../lib/pipeline.mjs';
import { projectPaths, readJson, writeJson } from '../lib/core.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));

function providerExecutable(paths) {
  const source = path.join(testDir, 'fixtures', 'model-bundle-provider.mjs');
  if (process.platform !== 'win32') return source;
  const dir = path.join(paths.base, 'test-bin'); fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'model-bundle-provider.mjs'); fs.copyFileSync(source, script);
  const shim = path.join(dir, 'model-bundle-provider.cmd');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return shim;
}

function fixture({ missingPolicy = 'placeholder' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-bundle-')); const paths = projectPaths(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.writeFileSync(path.join(root, 'src', 'Resource.java'), 'class Resource {}\n');
  fs.mkdirSync(path.dirname(paths.config), { recursive: true });
  const provider = providerExecutable(paths);
  writeJson(paths.project, { schemaVersion: '2.0', kitVersion: '2.0.0' });
  writeJson(paths.config, {
    schemaVersion: '2.0', projectName: 'Bundle Fixture',
    ignore: { useGitignore: true, useDocgenignore: true, binary: { enabled: true, maxTextFileBytes: 1024 * 1024 } },
    context: { maxTokens: { default: 4000, modelCore: 4000, modelEnterprise: 4000 } },
    budget: { maxProviderCalls: 20, maxEstimatedInputTokens: 200000, maxEstimatedOutputTokens: 50000, maxContextTokensPerCall: 10000 },
    execution: { missingModelPolicy: missingPolicy }, retry: { maxAttempts: 1 },
    commandCode: { executable: provider, trust: false, skipOnboarding: false, yolo: false, maxTurns: { default: 30 } }
  });
  writeJson(paths.state, { schemaVersion: '2.0', kitVersion: '2.0.0', stages: {}, pages: {} });
  return { root, paths };
}

test('pipeline recovers a repeatedly omitted model through independent direct-object repair', async () => {
  const { root, paths } = fixture();
  await model(root);
  const decisions = readJson(path.join(paths.model, 'decisions.json'));
  assert.equal(decisions.items[0].id, 'decision-1');
  const state = readJson(paths.state).stages.modelEnterprise;
  assert.deepEqual(state.degradedModels, []);
  assert.equal(state.providerCalls, 3);
  for (const name of ['security', 'operations', 'testing', 'data-governance', 'decisions', 'configuration', 'change-impact', 'ownership']) {
    assert.equal(fs.existsSync(path.join(paths.model, `${name}.json`)), true, name);
  }
  assert.equal(fs.readdirSync(paths.model).some((name) => /bundle|staging|backup/.test(name)), false);
});

test('pipeline emits an explicit UNKNOWN placeholder instead of failing forever', async () => {
  const { root, paths } = fixture();
  const previous = process.env.DOCGEN_TEST_NEVER_RETURN_MODEL; process.env.DOCGEN_TEST_NEVER_RETURN_MODEL = '1';
  try { await model(root); } finally {
    if (previous === undefined) delete process.env.DOCGEN_TEST_NEVER_RETURN_MODEL; else process.env.DOCGEN_TEST_NEVER_RETURN_MODEL = previous;
  }
  const decisions = readJson(path.join(paths.model, 'decisions.json'));
  assert.equal(decisions.providerOutputStatus, 'missing');
  assert.equal(decisions.classification, 'UNKNOWN');
  assert.deepEqual(decisions.evidence, []);
  assert.deepEqual(readJson(paths.state).stages.modelEnterprise.degradedModels, ['decisions']);
  assert.deepEqual(status(root).summary.degradedModels, ['modelEnterprise:decisions']);
});


test('pipeline recovers when the initial bundle contains zero recognizable objects', async () => {
  const { root, paths } = fixture();
  const previousEmpty = process.env.DOCGEN_TEST_EMPTY_INITIAL;
  const previousNever = process.env.DOCGEN_TEST_NEVER_RETURN_MODEL;
  process.env.DOCGEN_TEST_EMPTY_INITIAL = '1';
  process.env.DOCGEN_TEST_NEVER_RETURN_MODEL = '1';
  try { await model(root); } finally {
    if (previousEmpty === undefined) delete process.env.DOCGEN_TEST_EMPTY_INITIAL; else process.env.DOCGEN_TEST_EMPTY_INITIAL = previousEmpty;
    if (previousNever === undefined) delete process.env.DOCGEN_TEST_NEVER_RETURN_MODEL; else process.env.DOCGEN_TEST_NEVER_RETURN_MODEL = previousNever;
  }
  const enterprise = readJson(path.join(paths.model, 'decisions.json'));
  assert.equal(enterprise.providerOutputStatus, 'missing');
  assert.equal(enterprise.classification, 'UNKNOWN');
  const core = readJson(path.join(paths.model, 'system.json'));
  assert.equal(core.components[0].id, 'resource');
  assert.ok(readJson(paths.state).stages.modelEnterprise.recoveryErrors.some((entry) => entry.startsWith('initial:')));
});

test('strict policy can still turn exhausted recovery into a hard failure', async () => {
  const { root } = fixture({ missingPolicy: 'fail' });
  const previous = process.env.DOCGEN_TEST_NEVER_RETURN_MODEL; process.env.DOCGEN_TEST_NEVER_RETURN_MODEL = '1';
  try { await assert.rejects(() => model(root), /Model recovery exhausted for: decisions/); }
  finally { if (previous === undefined) delete process.env.DOCGEN_TEST_NEVER_RETURN_MODEL; else process.env.DOCGEN_TEST_NEVER_RETURN_MODEL = previous; }
});
