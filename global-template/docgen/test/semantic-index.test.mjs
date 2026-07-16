import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInventory } from '../lib/inventory.mjs';
import { compileContext } from '../lib/context.mjs';
import { databaseStats, indexRepository } from '../lib/indexer.mjs';
import { generate } from '../lib/pipeline.mjs';
import { projectPaths, readJson, writeJson } from '../lib/core.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-v2-')); const p = projectPaths(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.dirname(p.config), { recursive: true });
  writeJson(p.project, { schemaVersion: '2.0', kitVersion: '2.0.0' });
  writeJson(p.config, { schemaVersion: '2.0', ignore: { binary: { enabled: true, maxTextFileBytes: 1024 * 1024 } }, context: { maxTokens: { default: 4000, generate: 4000 } }, execution: { generationBatchSize: 2 }, audit: { llmEnabled: false } });
  writeJson(p.state, { schemaVersion: '2.0', kitVersion: '2.0.0', stages: {}, pages: {} });
  return root;
}

test('inventory excludes binary and docgenignore paths', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @GET void get() {} }\n');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'ignore me');
  fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([0x89,0x50,0x4e,0x47,0,1]));
  fs.writeFileSync(path.join(root, '.docgenignore'), 'secret.txt\n');
  const inv = buildInventory(root, { force: true });
  assert(inv.files.some((x) => x.path === 'src/Resource.java'));
  assert(!inv.files.some((x) => x.path === 'secret.txt'));
  assert(inv.excluded.some((x) => x.path === 'image.png'));
});

test('index is incremental and extracts repository facts', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @POST void create() {} }\n');
  const first = indexRepository(root, { force: true });
  const second = indexRepository(root);
  const stats = databaseStats(root);
  assert.equal(first.changedFiles > 0, true);
  assert.equal(second.changedFiles, 0);
  assert.equal(second.unchangedFiles > 0, true);
  assert.equal(stats.facts > 0, true);
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

test('reference catalog page is rendered without a provider call', async () => {
  const root = fixture(); const p = projectPaths(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @POST void create() {} }\n');
  indexRepository(root, { force: true });
  fs.mkdirSync(p.model, { recursive: true });
  writeJson(path.join(p.model, 'catalogs.json'), { schemaVersion: '2.0', endpoints: [{ id: 'create-quote', name: 'Create quote', method: 'POST', path: '/quotes', evidence: [{ path: 'src/Resource.java', startLine: 1 }] }], messageHandlers: [], externalDependencies: [], dataStores: [], scheduledJobs: [] });
  writeJson(p.plan, { schemaVersion: '2.0', pages: [{ id: 'endpoint-catalog', title: 'Endpoint Catalog', summary: 'HTTP API reference.', category: 'api', mode: 'reference', type: 'reference', order: 1, audience: ['engineer'], coverageTags: ['endpoint-catalog'], query: 'endpoints', requiredSections: [], relatedPages: [] }] });
  const result = await generate(root);
  assert.equal(result.providerPages, 0);
  const output = fs.readFileSync(path.join(root, 'docs', 'api', 'endpoint-catalog.md'), 'utf8');
  assert.match(output, /POST/);
  assert.match(output, /\/quotes/);
  assert.equal(fs.existsSync(path.join(p.telemetry, 'provider-runs.jsonl')), false);
});
