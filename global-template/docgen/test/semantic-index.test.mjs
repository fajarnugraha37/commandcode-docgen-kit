import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../lib/inventory.mjs';
import { compileContext } from '../lib/context.mjs';
import { databaseStats, indexRepository } from '../lib/indexer.mjs';
import { audit, generate } from '../lib/pipeline.mjs';
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
  const file = path.join(root, 'fake-provider.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const prompt=fs.readFileSync(0,'utf8');
const stage=process.env.DOCGEN_STAGE;
const cwd=process.cwd();
const target=(prompt.match(/Write exactly one JSON file: \\`([^\\`]+)\\`/i)||[])[1];
const write=(rel,value)=>{const file=path.join(cwd,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\\n');};
if(stage==='modelCore'){
  write(target,{system:{components:[{id:'resource',kind:'component',name:'Resource',statement:'HTTP resource',classification:'FACT',confidence:1,evidence:[{path:'src/Resource.java',startLine:1}]}],relationships:[],workflows:[],unknowns:[]},business:{actors:[],capabilities:[],concepts:[],businessRules:[],decisions:[],branchConditions:[],lifecycles:[],invariants:[],useCases:[],unknowns:[]},flows:{businessFlows:[],controlFlows:[],requestFlows:[],trafficFlows:[],dataFlows:[],eventFlows:[]},catalogs:{endpoints:[],messageHandlers:[],externalDependencies:[],dataStores:[],scheduledJobs:[]}});
}else if(stage==='modelEnterprise'){
  write(target,{security:{unknowns:[]},operations:{unknowns:[]},testing:{unknowns:[]},'data-governance':{unknowns:[]},decisions:{unknowns:[]},configuration:{unknowns:[]},'change-impact':{unknowns:[]},ownership:{unknowns:[]}});
}else if(stage==='plan'){
  write(target,{schemaVersion:'2.0',metadata:{description:'Fixture docs'},pages:[{id:'overview',title:'System Overview',summary:'Fixture overview.',category:'orientation',mode:'explanation',type:'overview',order:1,audience:['engineer'],coverageTags:['architecture'],query:'resource architecture',requiredSections:[],risk:'low',relatedPages:[]}]});
}else if(stage==='generate'){
  const json=(prompt.match(/Page contracts:\\n([\\s\\S]*?)\\n\\nFor every contract:/)||[])[1];
  const contracts=JSON.parse(json);
  for(const contract of contracts){
    const page=contract.page;
    const md='---\\ntitle: '+JSON.stringify(page.title)+'\\ndescription: '+JSON.stringify(page.summary)+'\\npageId: '+JSON.stringify(page.id)+'\\ncategory: '+JSON.stringify(page.category)+'\\nmode: '+JSON.stringify(page.mode)+'\\ntype: '+JSON.stringify(page.type)+'\\norder: '+page.order+'\\n---\\n# '+page.title+'\\n\\n'+page.summary+'\\n\\nThe repository exposes an HTTP resource.\\n';
    const output=path.join(cwd,contract.outputPath);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,md);
    write(contract.traceabilityPath,{schemaVersion:'2.0',pageId:page.id,pagePath:contract.outputPath,claims:[{id:page.id+':resource',section:page.title,statement:'The repository exposes an HTTP resource.',classification:'FACT',confidence:1,evidence:[{path:'src/Resource.java',startLine:1}],sourceModelRefs:['system:resource']}]});
  }
}else if(stage==='audit'){
  const output=(prompt.match(/report: \\`([^\\`]+)\\`/i)||[])[1]||'.docgen/audit/llm-risk.json';write(output,{schemaVersion:'2.0',pages:[]});
}else{process.exitCode=2;console.error('unexpected stage '+stage);}
`);
  fs.chmodSync(file, 0o755);
  return file;
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

test('full indexed pipeline uses four provider calls then zero on resume', () => {
  const root = fixture(); const p = projectPaths(root); const provider = installFakeProvider(root);
  fs.writeFileSync(path.join(root, 'src', 'Resource.java'), '@Path("/quotes")\nclass Resource { @GET void get() {} }\n');
  const config = readJson(p.config); config.commandCode = { executable: provider, trust: false, skipOnboarding: false, yolo: false, verbose: false, maxTurns: { default: 4 } }; writeJson(p.config, config);
  const first = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8' }); assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstBudget = readJson(p.budget); assert.equal(firstBudget.usage.providerCalls, 4);
  const second = spawnSync(process.execPath, [cli, 'all'], { cwd: root, encoding: 'utf8' }); assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondBudget = readJson(p.budget); assert.equal(secondBudget.usage.providerCalls, 4);
  assert.equal(readJson(path.join(p.audit, 'quality-summary.json')).pass, true);
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
