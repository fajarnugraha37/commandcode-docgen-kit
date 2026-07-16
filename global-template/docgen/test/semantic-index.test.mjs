import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../lib/inventory.mjs';
import { compileContext } from '../lib/context.mjs';
import { databaseStats, indexRepository, openDatabase } from '../lib/indexer.mjs';
import { audit, generate, publish } from '../lib/pipeline.mjs';
import { projectPaths, readJson, writeJson } from '../lib/core.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(testDir, '..', 'bin', 'docgen-v2.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-v2-')); const p = projectPaths(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.dirname(p.config), { recursive: true });
  writeJson(p.project, { schemaVersion: '2.0', kitVersion: '2.0.0' });
  writeJson(p.config, { schemaVersion: '2.0', projectName: 'Fixture', ignore: { useGitignore: true, useDocgenignore: true, binary: { enabled: true, maxTextFileBytes: 1024 * 1024 } }, context: { maxTokens: { default: 4000, modelCore: 4000, modelEnterprise: 4000, plan: 4000, generate: 4000, audit: 2000 } }, budget: { maxProviderCalls: 10, maxEstimatedInputTokens: 200000, maxEstimatedOutputTokens: 50000, maxContextTokensPerCall: 10000 }, execution: { generationBatchSize: 2, maxPlannedPages: 30 }, audit: { llmEnabled: false }, retry: { maxAttempts: 1 } });
  writeJson(p.state, { schemaVersion: '2.0', kitVersion: '2.0.0', stages: {}, pages: {} });
  return root;
}

function catalogFixture(root) {
  const p = projectPaths(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @POST void create() {} }\n');
  indexRepository(root, { force: true });
  fs.mkdirSync(p.model, { recursive: true });
  writeJson(path.join(p.model, 'catalogs.json'), { schemaVersion: '2.0', endpoints: [{ id: 'create-quote', name: 'Create quote', statement: 'Creates a quote.', classification: 'FACT', confidence: 1, method: 'POST', path: '/quotes', evidence: [{ path: 'src/Resource.java', startLine: 1 }] }], messageHandlers: [], externalDependencies: [], dataStores: [], scheduledJobs: [] });
  writeJson(p.plan, { schemaVersion: '2.0', pages: [{ id: 'endpoint-catalog', title: 'Endpoint Catalog', summary: 'HTTP API reference.', category: 'api', mode: 'reference', type: 'reference', order: 1, audience: ['engineer'], coverageTags: ['endpoint-catalog'], query: 'endpoints', requiredSections: [], relatedPages: [] }] });
  return p;
}

function installFakeProvider(root) {
  const p = projectPaths(root); const dir = path.join(p.base, 'test-bin'); fs.mkdirSync(dir, { recursive: true });
  const source = path.join(testDir, 'fixtures', 'fake-provider.mjs');
  const file = path.join(dir, 'fake-provider.mjs');
  fs.copyFileSync(source, file); fs.chmodSync(file, 0o755);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  if (process.platform !== 'win32') return file;
  const shim = path.join(dir, 'fake-provider.cmd');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${file}" %*\r\n`);
  return shim;
}

test('inventory excludes binary and docgenignore paths', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @GET void get() {} }\n');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'ignore me');
  fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([0x89,0x50,0x4e,0x47,0,1]));
  fs.writeFileSync(path.join(root, '.docgenignore'), 'secret.txt\n');
  const inv = buildInventory(root);
  assert(inv.files.some((item) => item.path === 'src/Resource.java'));
  assert(!inv.files.some((item) => item.path === 'secret.txt'));
  assert(inv.excluded.some((item) => item.path === 'image.png'));
});

test('non-git inventory respects nested gitignore files', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'src', 'generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'generated', '.gitignore'), '*.txt\n');
  fs.writeFileSync(path.join(root, 'src', 'generated', 'secret.txt'), 'ignored');
  fs.writeFileSync(path.join(root, 'src', 'generated', 'public.java'), 'class Public {}');
  const inv = buildInventory(root);
  assert(!inv.files.some((item) => item.path === 'src/generated/secret.txt'));
  assert(inv.files.some((item) => item.path === 'src/generated/public.java'));
});

test('index is incremental and extracts source chunks and facts', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @POST void create() {} }\n');
  const first = indexRepository(root, { force: true });
  const second = indexRepository(root);
  const stats = databaseStats(root);
  assert.equal(first.changedFiles > 0, true);
  assert.equal(second.changedFiles, 0);
  assert.equal(second.unchangedFiles > 0, true);
  assert.equal(stats.facts > 0, true);
  assert.equal(stats.sourceChunks > 0, true);
});

test('context compiler stays within configured budget', () => {
  const root = fixture();
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(root, 'src', `Resource${i}.java`), `@Path("/items/${i}")\nclass Resource${i} { @GET void get${i}() {} }\n`);
  indexRepository(root, { force: true });
  const { payload } = compileContext(root, { stage: 'generate', target: 'api', query: 'endpoint path resource', maxTokens: 1200 });
  assert(payload.estimatedTokens <= 1200);
  assert(payload.facts.length > 0);
  assert(payload.omissions.facts > 0);
});

test('reference catalog page is deterministic, traced, auditable, and reusable', async () => {
  const root = fixture(); const p = catalogFixture(root);
  const first = await generate(root); const second = await generate(root);
  assert.equal(first.providerPages, 0); assert.equal(second.providerPages, 0);
  const output = fs.readFileSync(path.join(root, 'docs', 'api', 'endpoint-catalog.md'), 'utf8');
  assert.match(output, /POST/); assert.match(output, /\/quotes/);
  const trace = readJson(path.join(p.traceability, 'pages', 'endpoint-catalog.json'));
  assert.equal(trace.claims.length, 1); assert.equal(trace.claims[0].classification, 'FACT'); assert.equal(trace.claims[0].evidence[0].path, 'src/Resource.java');
  const quality = await audit(root); assert.equal(quality.pass, true);
  assert.equal(fs.existsSync(path.join(p.telemetry, 'provider-runs.jsonl')), false);
});

test('deterministic audit rejects FACT evidence outside inventory', async () => {
  const root = fixture(); const p = catalogFixture(root); await generate(root);
  const file = path.join(p.traceability, 'pages', 'endpoint-catalog.json'); const trace = readJson(file); trace.claims[0].evidence = [{ path: 'ignored/secret.java' }]; writeJson(file, trace);
  await assert.rejects(() => audit(root), /Quality failed/);
});

test('full indexed pipeline uses four provider calls, one index pass, minimum 30 turns, then zero calls on resume', () => {
  const root = fixture(); const p = projectPaths(root); const provider = installFakeProvider(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @GET void get() {} }\n');
  const config = readJson(p.config); config.commandCode = { executable: provider, trust: false, skipOnboarding: false, yolo: false, verbose: false, maxTurns: { default: 4, generate: 12 } }; writeJson(p.config, config);
  const env = { ...process.env, DOCGEN_PROGRESS: '1', DOCGEN_MAX_TURNS: '12' };
  const first = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8', env }); assert.equal(first.status, 0, `FIRST STDERR:\n${first.stderr}\nFIRST STDOUT:\n${first.stdout}`);
  assert.equal((first.stdout.match(/\[docgen\] index RUNNING/g) ?? []).length, 1, first.stdout);
  assert.match(first.stdout, /maxTurns 30/);
  const healed = readJson(p.config).commandCode.maxTurns; for (const value of Object.values(healed)) assert.equal(value, 30);
  const firstBudget = readJson(p.budget); assert.equal(firstBudget.usage.providerCalls, 4); assert.equal(firstBudget.usage.failedCalls, 0);
  const second = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8', env }); assert.equal(second.status, 0, `SECOND STDERR:\n${second.stderr}\nSECOND STDOUT:\n${second.stdout}`);
  const secondBudget = readJson(p.budget); assert.equal(secondBudget.usage.providerCalls, 4);
  const summary = readJson(path.join(p.audit, 'quality-summary.json')); assert.equal(summary.pass, true); assert.equal(summary.claims, 1); assert.equal(summary.evidenceReferences, 1);
});


test('generic semantic index extracts cross-language artifacts without requiring a specific stack', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'src', 'worker.py'), 'import asyncio\nclass Worker:\n    def run(self):\n        return True\n');
  fs.writeFileSync(path.join(root, 'src', 'lib.rs'), 'use std::collections::HashMap;\npub struct Cache {}\npub fn build() {}\n');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module example.test/tool\n\nrequire github.com/acme/lib v1.2.3\n');
  fs.writeFileSync(path.join(root, 'main.tf'), 'resource "example_service" "main" {}\n');
  indexRepository(root, { force: true });
  const db = openDatabase(projectPaths(root).database);
  const facts = db.prepare('SELECT kind,path,name FROM facts').all(); db.close();
  assert(facts.some((fact) => fact.kind === 'file-artifact' && fact.path === 'src/worker.py'));
  assert(facts.some((fact) => fact.kind === 'module-reference' && fact.path === 'src/worker.py'));
  assert(facts.some((fact) => fact.kind === 'symbol' && fact.name === 'Worker'));
  assert(facts.some((fact) => fact.kind === 'function' && fact.name === 'build'));
  assert(facts.some((fact) => fact.kind === 'dependency' && fact.path === 'go.mod'));
  assert(facts.some((fact) => fact.kind === 'infrastructure-resource' && fact.path === 'main.tf'));
});

test('audit rejects out-of-range line evidence and source changes after indexing', async () => {
  const root = fixture(); const p = catalogFixture(root); await generate(root); await audit(root);
  const traceFile = path.join(p.traceability, 'pages', 'endpoint-catalog.json'); const trace = readJson(traceFile);
  trace.claims[0].evidence = [{ path: 'src/Resource.java', startLine: 999, endLine: 999 }]; writeJson(traceFile, trace);
  await assert.rejects(() => audit(root), /Quality failed/);
  let report = readJson(path.join(p.audit, 'deterministic.json')); assert(report.errors.some((error) => /line range/.test(error)));
  trace.claims[0].evidence = [{ path: 'src/Resource.java', startLine: 1 }]; writeJson(traceFile, trace);
  fs.appendFileSync(path.join(root, 'src', 'Resource.java'), '// changed after index\n');
  await assert.rejects(() => audit(root), /Quality failed/);
  report = readJson(path.join(p.audit, 'deterministic.json')); assert(report.errors.some((error) => /source changed after indexing/.test(error)));
});

test('provider exit after valid artifacts is recovered without repeating completed work', () => {
  const root = fixture(); const p = projectPaths(root); const provider = installFakeProvider(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), 'class Resource {}\n');
  const config = readJson(p.config); config.commandCode = { executable: provider, trust: false, skipOnboarding: false, yolo: false, maxTurns: { default: 12 } }; writeJson(p.config, config);
  const run = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8', env: { ...process.env, DOCGEN_PROGRESS: '0', DOCGEN_TEST_EXIT_AFTER_WRITE_STAGE: 'generate' } });
  assert.equal(run.status, 0, `STDERR:\n${run.stderr}\nSTDOUT:\n${run.stdout}`); assert.match(run.stderr, /RECOVERED/);
  const state = readJson(p.state); assert.equal(state.pages.overview.status, 'completed'); assert.equal(state.pages.overview.recovered, true);
  const budget = readJson(p.budget); assert.equal(budget.usage.providerCalls, 4); assert.equal(budget.usage.failedCalls, 1);
});

test('partial batch generation checkpoints valid pages and retries only missing pages', () => {
  const root = fixture(); const p = projectPaths(root); const provider = installFakeProvider(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), 'class Resource {}\n');
  const config = readJson(p.config); config.commandCode = { executable: provider, trust: false, skipOnboarding: false, yolo: false, maxTurns: { default: 30 } }; config.execution.generationBatchSize = 2; config.execution.generationRecoveryAttempts = 3; writeJson(p.config, config);
  const run = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8', env: { ...process.env, DOCGEN_PROGRESS: '0', DOCGEN_TEST_PAGE_COUNT: '2', DOCGEN_TEST_PARTIAL_GENERATE: '1' } });
  assert.equal(run.status, 0, `STDERR:\n${run.stderr}\nSTDOUT:\n${run.stdout}`); assert.match(run.stderr, /RECOVERY/);
  const state = readJson(p.state); assert.equal(state.pages.overview.status, 'completed'); assert.equal(state.pages['detail-2'].status, 'completed');
  const budget = readJson(p.budget); assert.equal(budget.usage.providerCalls, 5); assert.equal(budget.usage.failedCalls, 1);
});


test('recovery never accepts stale pre-existing plan artifacts when provider writes nothing', () => {
  const root = fixture(); const p = projectPaths(root); const provider = installFakeProvider(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), 'class Resource {}\n');
  const config = readJson(p.config); config.commandCode = { executable: provider, trust: false, skipOnboarding: false, yolo: false, maxTurns: { default: 30 } }; writeJson(p.config, config);
  const first = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8', env: { ...process.env, DOCGEN_PROGRESS: '0' } }); assert.equal(first.status, 0, first.stderr || first.stdout);
  const currentState = readJson(p.state); currentState.stages.plan.status = 'failed'; writeJson(p.state, currentState);
  const staleManifestHash = fs.readFileSync(p.plan, 'utf8');
  const second = spawnSync(process.execPath, [cli, 'plan'], { cwd: root, encoding: 'utf8', env: { ...process.env, DOCGEN_PROGRESS: '0', DOCGEN_TEST_FAIL_BEFORE_WRITE_STAGE: 'plan' } });
  assert.notEqual(second.status, 0, second.stdout); assert.match(second.stderr, /failed: exit 8/i); assert.equal(fs.readFileSync(p.plan, 'utf8'), staleManifestHash);
  assert.equal(readJson(p.state).stages.plan.status, 'failed');
});

test('audit rejects unknown model references and publish rejects stale source artifacts', async () => {
  const root = fixture(); const p = projectPaths(root); const provider = installFakeProvider(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), 'class Resource {}\n');
  const config = readJson(p.config); config.commandCode = { executable: provider, trust: false, skipOnboarding: false, yolo: false, maxTurns: { default: 30 } }; writeJson(p.config, config);
  const run = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8', env: { ...process.env, DOCGEN_PROGRESS: '0' } }); assert.equal(run.status, 0, run.stderr || run.stdout);
  const traceFile = path.join(p.traceability, 'pages', 'overview.json'); const trace = readJson(traceFile); trace.claims[0].sourceModelRefs = ['system:does-not-exist']; writeJson(traceFile, trace);
  await assert.rejects(() => audit(root), /Quality failed/); const report = readJson(path.join(p.audit, 'deterministic.json')); assert(report.errors.some((error) => /unknown sourceModelRef/.test(error)));
  trace.claims[0].sourceModelRefs = ['system:resource']; writeJson(traceFile, trace); await audit(root);
  fs.appendFileSync(path.join(root, 'src', 'Resource.java'), '// stale\n');
  assert.throws(() => publish(root), /stale relative to current source/);
});

test('v1 migration preserves docs and ignore policy while archiving workflow state', () => {
  const root = fixture(); const p = projectPaths(root);
  writeJson(p.config, { schemaVersion: '1.6', projectName: 'Migrated', commandCode: { executable: 'custom-cmdc', model: 'cheap-model' }, ignore: { useGitignore: true, binary: { maxTextFileBytes: 123456 } } });
  writeJson(p.project, { schemaVersion: '1.0', kitVersion: '1.0.0' });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs', 'keep.md'), '# Keep\n'); fs.writeFileSync(path.join(root, '.docgenignore'), 'private/**\n');
  fs.mkdirSync(path.join(p.base, 'evidence'), { recursive: true }); fs.writeFileSync(path.join(p.base, 'evidence', 'legacy.json'), '{}');
  const run = spawnSync(process.execPath, [cli, 'migrate'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'docs', 'keep.md'), 'utf8'), '# Keep\n');
  assert.equal(fs.readFileSync(path.join(root, '.docgenignore'), 'utf8'), 'private/**\n');
  const next = readJson(p.config); assert.equal(next.schemaVersion, '2.0'); assert.equal(next.projectName, 'Migrated'); assert.equal(next.commandCode.executable, 'custom-cmdc'); assert.equal(next.ignore.binary.maxTextFileBytes, 123456);
  const marker = readJson(p.project); assert.match(marker.migrationBackup, /^\.docgen\/migration-backup\//); assert(fs.existsSync(path.join(root, marker.migrationBackup, 'evidence', 'legacy.json')));
});
