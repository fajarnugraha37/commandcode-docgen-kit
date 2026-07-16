#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const j = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const now = () => new Date().toISOString();
const sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repository';
const posix = (p) => String(p).replaceAll('\\', '/');
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const arr = (v) => Array.isArray(v) ? v : [];
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const md = (s) => String(s ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const quote = (s) => JSON.stringify(String(s ?? ''));

function findWorkspace(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.docgen-workspace', 'workspace.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function safeJson(file, fallback = null) { try { return fs.existsSync(file) ? j(file) : fallback; } catch { return fallback; } }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [], stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) stack.push(f); else out.push(f);
    }
  }
  return out.sort();
}
function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const file of files.sort()) { h.update(posix(file)); h.update('\0'); h.update(fs.readFileSync(file)); h.update('\0'); }
  return h.digest('hex');
}
function readGit(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}
function loadWorkspace(root) { return j(path.join(root, '.docgen-workspace', 'workspace.json')); }
function saveWorkspace(root, ws) { ws.updatedAt = now(); writeJson(path.join(root, '.docgen-workspace', 'workspace.json'), ws); }
function wsPaths(root) {
  const base = path.join(root, '.docgen-workspace');
  return {
    base,
    model: path.join(base, 'model'),
    contracts: path.join(base, 'contracts'),
    trace: path.join(base, 'traceability'),
    audit: path.join(base, 'audit'),
    state: path.join(base, 'state'),
    runs: path.join(base, 'runs'),
    docs: path.join(root, 'docs', 'system'),
    repositories: path.join(base, 'repositories.json'),
    snapshot: path.join(base, 'state', 'snapshot.json'),
    status: path.join(base, 'state', 'status.json'),
    quality: path.join(base, 'audit', 'quality-summary.json')
  };
}
function parseOptions(args) {
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { const key = a.slice(2); const next = args[i + 1]; if (next && !next.startsWith('--')) { options[key] = next; i++; } else options[key] = true; }
    else positional.push(a);
  }
  return { options, positional };
}
function fail(message, code = 1) { const e = new Error(message); e.exitCode = code; throw e; }

export function workspaceInit(target = '.', options = {}, kitVersion = 'unknown') {
  const root = path.resolve(target);
  ensureDir(root);
  const p = wsPaths(root);
  for (const d of [p.base, p.model, p.contracts, p.trace, p.audit, p.state, p.runs, p.docs]) ensureDir(d);
  const file = path.join(p.base, 'workspace.json');
  if (fs.existsSync(file) && !options.force) fail(`Workspace already initialized: ${root}. Use --force only to refresh defaults.`, 2);
  const existing = safeJson(file, {});
  const ws = {
    schemaVersion: '1.0', kitVersion,
    id: existing.id ?? slug(options.id ?? path.basename(root)),
    name: existing.name ?? options.name ?? path.basename(root),
    description: existing.description ?? options.description ?? '',
    initializedAt: existing.initializedAt ?? now(),
    updatedAt: now(), root: posix(root), docsRoot: existing.docsRoot ?? 'docs/system',
    repositories: arr(existing.repositories),
    settings: {
      requireInitializedRepositories: true,
      requireP0Traceability: false,
      includeDisabledRepositories: false,
      generateMermaidOnly: true,
      ...(existing.settings ?? {})
    }
  };
  saveWorkspace(root, ws);
  console.log(`Initialized DocGen system workspace in ${root}`);
  console.log('Next:');
  console.log('  docgen workspace add <repository>');
  console.log('  docgen workspace all');
}

function repoIdentity(repoPath, options = {}) {
  const project = safeJson(path.join(repoPath, '.docgen', 'project.json'), {});
  const marker = safeJson(path.join(repoPath, 'package.json'), {});
  const pom = fs.existsSync(path.join(repoPath, 'pom.xml')) ? fs.readFileSync(path.join(repoPath, 'pom.xml'), 'utf8') : '';
  const pomArtifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
  const name = options.name ?? marker.name ?? pomArtifact ?? path.basename(repoPath);
  return {
    id: slug(options.id ?? name), name,
    path: posix(path.resolve(repoPath)),
    domain: options.domain ?? null,
    owner: options.owner ?? null,
    criticality: options.criticality ?? 'unknown',
    enabled: options.enabled !== false,
    aliases: uniq([name, path.basename(repoPath), options.id, ...(options.aliases ? String(options.aliases).split(',') : [])].map(slug)),
    docgenInitialized: Boolean(project.schemaVersion),
    addedAt: now()
  };
}
function requireWorkspace() { const root = findWorkspace(); if (!root) fail('No DocGen workspace found. Run `docgen workspace init`.', 2); return root; }
function addRepository(root, repoPathArg, options) {
  if (!repoPathArg) fail('workspace add requires <repository-path>', 2);
  const repoPath = path.resolve(root, repoPathArg);
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) fail(`Repository path is not a directory: ${repoPath}`, 2);
  const ws = loadWorkspace(root); const repo = repoIdentity(repoPath, options);
  if (ws.settings?.requireInitializedRepositories !== false && !repo.docgenInitialized) fail(`Repository is not initialized for DocGen: ${repoPath}. Run docgen init there first.`, 2);
  const existing = arr(ws.repositories).find((r) => r.id === repo.id || path.resolve(r.path) === repoPath);
  if (existing && !options.force) fail(`Repository already registered as ${existing.id}. Use --force to update metadata.`, 2);
  ws.repositories = arr(ws.repositories).filter((r) => r.id !== repo.id && path.resolve(r.path) !== repoPath);
  ws.repositories.push({ ...(existing ?? {}), ...repo, addedAt: existing?.addedAt ?? repo.addedAt, updatedAt: now() });
  saveWorkspace(root, ws); console.log(`Added repository ${repo.id}: ${repo.path}`);
}
function removeRepository(root, id) { const ws = loadWorkspace(root); const before = arr(ws.repositories).length; ws.repositories = arr(ws.repositories).filter((r) => r.id !== id); if (ws.repositories.length === before) fail(`Unknown repository: ${id}`, 2); saveWorkspace(root, ws); console.log(`Removed repository ${id}`); }
function listRepositories(root) {
  const ws = loadWorkspace(root);
  console.log(`Workspace ${ws.name} (${ws.id})`);
  for (const r of arr(ws.repositories)) console.log(`${r.enabled === false ? 'DISABLED' : 'ENABLED '} ${r.id.padEnd(24)} ${r.path}${r.domain ? ` | domain=${r.domain}` : ''}${r.owner ? ` | owner=${r.owner}` : ''}`);
}

const MODEL_FILES = ['system.json','business.json','flows.json','catalogs.json','security.json','operations.json','testing.json','data-governance.json','decisions.json','configuration.json','change-impact.json','ownership.json'];
function collectRepository(repo) {
  const repoRoot = path.resolve(repo.path);
  const modelDir = path.join(repoRoot, '.docgen', 'model');
  const models = Object.fromEntries(MODEL_FILES.map((name) => [name.replace('.json',''), safeJson(path.join(modelDir, name), {})]));
  const trace = safeJson(path.join(repoRoot, '.docgen', 'traceability', 'index.json'), {});
  const sourceInventory = safeJson(path.join(repoRoot, '.docgen', 'state', 'source-inventory.json'), {});
  const project = safeJson(path.join(repoRoot, '.docgen', 'project.json'), {});
  const modelFiles = MODEL_FILES.map((n) => path.join(modelDir, n)).filter(fs.existsSync);
  const sourceFingerprint = sourceInventory.sourceFingerprint ?? sourceInventory.fingerprint ?? safeJson(path.join(repoRoot, '.docgen', 'state', 'fingerprints.json'), {})?.sourceFingerprint ?? null;
  const commit = readGit(repoRoot, ['rev-parse', 'HEAD']);
  return {
    ...repo, root: posix(repoRoot), project,
    commit, branch: readGit(repoRoot, ['branch', '--show-current']), dirty: Boolean(readGit(repoRoot, ['status', '--porcelain'])),
    sourceFingerprint, modelHash: modelFiles.length ? hashFiles(modelFiles) : null,
    models, traceability: { claims: arr(trace.claims).length, pages: arr(trace.pages).length },
    missingModels: MODEL_FILES.filter((n) => !fs.existsSync(path.join(modelDir, n))),
    collectedAt: now()
  };
}
function validateWorkspace(root, verbose = true) {
  const ws = loadWorkspace(root); const errors = [], warnings = [], ids = new Set(), paths = new Set();
  if (!arr(ws.repositories).length) errors.push('No repositories registered.');
  for (const r of arr(ws.repositories)) {
    if (ids.has(r.id)) errors.push(`Duplicate repository id: ${r.id}`); ids.add(r.id);
    const rp = path.resolve(r.path); if (paths.has(rp)) errors.push(`Duplicate repository path: ${rp}`); paths.add(rp);
    if (!fs.existsSync(rp)) errors.push(`Repository path missing: ${r.id} -> ${rp}`);
    else if (!fs.existsSync(path.join(rp, '.docgen', 'project.json'))) errors.push(`Repository is not DocGen initialized: ${r.id}`);
    else if (!fs.existsSync(path.join(rp, '.docgen', 'model', 'catalogs.json'))) warnings.push(`Repository has no catalogs.json yet: ${r.id}`);
  }
  const report = { schemaVersion:'1.0', kitVersion:ws.kitVersion, checkedAt:now(), ok:!errors.length, errors, warnings };
  writeJson(path.join(wsPaths(root).audit, 'validation.json'), report);
  if (verbose) { console.log(`Workspace validation: ${report.ok ? 'PASS' : 'FAIL'}`); for (const x of errors) console.error(`ERROR: ${x}`); for (const x of warnings) console.warn(`WARNING: ${x}`); }
  if (errors.length) fail(`Workspace validation failed with ${errors.length} error(s). Report: .docgen-workspace/audit/validation.json`, 2);
  return report;
}
function collect(root) {
  validateWorkspace(root, false); const ws = loadWorkspace(root);
  const repositories = arr(ws.repositories).filter((r) => r.enabled !== false || ws.settings?.includeDisabledRepositories).map(collectRepository);
  const payload = { schemaVersion:'1.0', kitVersion:ws.kitVersion, generatedAt:now(), workspaceId:ws.id, repositories };
  payload.inputHash = sha(repositories.map((r) => ({ id:r.id, commit:r.commit, sourceFingerprint:r.sourceFingerprint, modelHash:r.modelHash })));
  writeJson(wsPaths(root).repositories, payload);
  console.log(`Collected ${repositories.length} repositories. Input hash: ${payload.inputHash.slice(0,12)}`);
  return payload;
}

function typedItems(model, keys) { return keys.flatMap((k) => arr(model?.[k])); }
function itemName(x) { return x.name ?? x.title ?? x.statement ?? x.id ?? 'unnamed'; }
function evidenceFor(repoId, item) { return arr(item.evidence).map((e) => ({ repositoryId:repoId, ...e })); }
function canonicalContract(repo, kind, item, direction = null) {
  return {
    id: `${repo.id}:${kind}:${slug(item.id ?? itemName(item))}`,
    kind, repositoryId:repo.id, repositoryName:repo.name, direction,
    name:itemName(item), statement:item.statement ?? null,
    protocol:item.protocol ?? item.mechanism ?? null,
    method:item.method ?? null, path:item.path ?? item.route ?? null,
    channel:item.topic ?? item.queue ?? item.exchange ?? item.channel ?? null,
    schema:item.schema ?? item.payloadType ?? item.contract ?? null,
    version:item.version ?? item.schemaVersion ?? null,
    ownership:item.owner ?? repo.owner ?? null,
    classification:item.classification ?? 'FACT', confidence:item.confidence ?? null,
    evidence:evidenceFor(repo.id,item), rawId:item.id ?? null
  };
}
function repositoryAliases(repo) { return new Set(uniq([repo.id, repo.name, path.basename(repo.root), ...(repo.aliases ?? [])].map(slug))); }
function matchRepository(text, repositories, excludeId = null) {
  const token = slug(text); if (!token) return null;
  const exact = repositories.find((r) => r.id !== excludeId && repositoryAliases(r).has(token));
  if (exact) return exact;
  return repositories.find((r) => r.id !== excludeId && [...repositoryAliases(r)].some((a) => token.includes(a) || a.includes(token))) ?? null;
}
function edgeKey(e) { return [e.from,e.to,e.kind,e.contractId ?? e.channel ?? e.name ?? ''].join('|'); }
function analyze(root, force = false) {
  const p = wsPaths(root); const collected = fs.existsSync(p.repositories) ? j(p.repositories) : collect(root); const repositories = collected.repositories;
  const prev = safeJson(path.join(p.state,'analysis.json'),{});
  if (!force && prev.inputHash === collected.inputHash && prev.status === 'completed') { console.log('[docgen] SKIP workspace analysis — repository model hash unchanged.'); return loadWorkspaceModels(root); }

  const nodes = repositories.map((r) => ({ id:r.id, name:r.name, domain:r.domain, owner:r.owner, criticality:r.criticality, path:r.path, commit:r.commit, sourceFingerprint:r.sourceFingerprint, missingModels:r.missingModels }));
  const endpoints = [], messages = [], dependencies = [], dataStores = [], capabilities = [], businessRules = [], journeys = [], ownership = [], infrastructure = [], contracts = [];
  for (const r of repositories) {
    const c = r.models.catalogs, b = r.models.business, f = r.models.flows, o = r.models.ownership, ci = r.models['change-impact'];
    for (const x of arr(c.endpoints)) { const z=canonicalContract(r,'endpoint',x,'inbound'); endpoints.push(z); contracts.push(z); }
    for (const x of arr(c.messageHandlers)) { const dir = /producer|publish|send|emit/i.test(String(x.kind ?? x.direction ?? '')) ? 'outbound' : 'inbound'; const z=canonicalContract(r,'message',x,dir); messages.push(z); contracts.push(z); }
    for (const x of arr(c.externalDependencies)) dependencies.push({ repositoryId:r.id, ...x });
    for (const x of arr(c.dataStores)) dataStores.push({ repositoryId:r.id, ...x });
    for (const x of arr(b.capabilities)) capabilities.push({ repositoryId:r.id, domain:r.domain, ...x });
    for (const x of arr(b.businessRules)) businessRules.push({ repositoryId:r.id, ...x });
    for (const x of [...arr(f.businessFlows), ...arr(b.useCases), ...arr(b.lifecycles)]) journeys.push({ repositoryId:r.id, ...x });
    for (const x of [...arr(o.teams),...arr(o.responsibilities),...arr(o.approvalAuthorities),...arr(o.escalationPaths)]) ownership.push({ repositoryId:r.id, ...x });
    for (const x of [...arr(r.models.operations.runtimeComponents),...arr(r.models.operations.dependencies),...arr(c.externalDependencies)]) if (/aws|azure|gcp|kubernetes|kafka|rabbit|postgres|redis|s3|blob|cloud|database|queue|topic|bucket|cluster/i.test(JSON.stringify(x))) infrastructure.push({ repositoryId:r.id, ...x });
    for (const x of [...arr(ci.changeSurfaces),...arr(ci.blastRadii),...arr(ci.compatibilityBoundaries)]) { /* retained in change-impact below */ }
  }

  const edges = [];
  for (const r of repositories) {
    for (const d of dependencies.filter((x)=>x.repositoryId===r.id)) {
      const targetText = d.target ?? d.service ?? d.system ?? d.name ?? d.statement;
      const target = matchRepository(targetText, repositories, r.id);
      edges.push({ id:`dep:${r.id}:${target?.id ?? slug(targetText)}`, from:r.id, to:target?.id ?? null, externalTarget:target ? null : targetText ?? 'unknown', kind:'dependency', mechanism:d.protocol ?? d.mechanism ?? d.kind ?? null, classification:d.classification ?? 'FACT', evidence:evidenceFor(r.id,d), resolved:Boolean(target) });
    }
  }
  const groupedMessages = new Map();
  for (const m of messages) { const key=slug(m.channel ?? m.name); if(!groupedMessages.has(key)) groupedMessages.set(key,[]); groupedMessages.get(key).push(m); }
  for (const [channel, ms] of groupedMessages) {
    const producers=ms.filter((m)=>m.direction==='outbound'), consumers=ms.filter((m)=>m.direction!=='outbound');
    for(const a of producers) for(const b of consumers) if(a.repositoryId!==b.repositoryId) edges.push({id:`event:${a.repositoryId}:${b.repositoryId}:${channel}`,from:a.repositoryId,to:b.repositoryId,kind:'event',channel:a.channel??b.channel??channel,contractId:a.id,evidence:[...a.evidence,...b.evidence],resolved:true});
  }
  for (const r of repositories) {
    for (const flow of arr(r.models.flows.requestFlows)) {
      const targets = uniq([flow.target, flow.destination, flow.downstream, ...arr(flow.steps).map((s)=>s.target ?? s.service ?? s.component)]);
      for(const t of targets){const target=matchRepository(t,repositories,r.id);if(target)edges.push({id:`request:${r.id}:${target.id}:${slug(itemName(flow))}`,from:r.id,to:target.id,kind:'request',name:itemName(flow),evidence:evidenceFor(r.id,flow),resolved:true});}
    }
  }
  const dedupEdges=[...new Map(edges.map((e)=>[edgeKey(e),e])).values()];

  const requestFlows=dedupEdges.filter((e)=>['dependency','request'].includes(e.kind) && e.to).map((e)=>({id:e.id,name:e.name??`${e.from} to ${e.to}`,sourceRepository:e.from,targetRepository:e.to,protocol:e.mechanism??null,contractId:e.contractId??null,evidence:e.evidence}));
  const eventFlows=dedupEdges.filter((e)=>e.kind==='event').map((e)=>({id:e.id,name:e.channel,producerRepository:e.from,consumerRepository:e.to,channel:e.channel,contractId:e.contractId,evidence:e.evidence}));
  const dataLineage=[];
  for(const r of repositories) for(const flow of arr(r.models.flows.dataFlows)) {
    const targets=uniq([flow.target,flow.destination,...arr(flow.steps).map((s)=>s.target??s.store??s.service)]);
    const matched=targets.map((t)=>matchRepository(t,repositories,r.id)).filter(Boolean);
    dataLineage.push({id:`data:${r.id}:${slug(itemName(flow))}`,name:itemName(flow),sourceRepository:r.id,targetRepositories:uniq(matched.map((x)=>x.id)),steps:arr(flow.steps),data:flow.data??flow.payload??null,evidence:evidenceFor(r.id,flow)});
  }
  const capabilityGroups={}; for(const c of capabilities){const key=c.domain??repositories.find((r)=>r.id===c.repositoryId)?.domain??'Unclassified';(capabilityGroups[key]??=[]).push(c);}
  const journeyGroups=journeys.map((x)=>({id:`${x.repositoryId}:${slug(x.id??itemName(x))}`,name:itemName(x),repositories:uniq([x.repositoryId,...arr(x.repositories)]),actors:arr(x.actors),steps:arr(x.steps),outcomes:arr(x.outcomes),evidence:evidenceFor(x.repositoryId,x)}));
  // Link journeys transitively through graph neighbors when the journey mentions a target service/channel.
  for(const jr of journeyGroups){const text=JSON.stringify(jr);for(const r of repositories)if(r.id!==jr.repositories[0]&&[...repositoryAliases(r)].some((a)=>text.toLowerCase().includes(a)))jr.repositories.push(r.id);jr.repositories=uniq(jr.repositories);}

  const reverse = new Map(nodes.map((n)=>[n.id,[]])); for(const e of dedupEdges)if(e.to)reverse.get(e.to)?.push(e.from);
  const impacts=[];
  for(const n of nodes){const direct=uniq((reverse.get(n.id)??[]).filter((x)=>x!==n.id));const all=new Set(direct),queue=[...direct];while(queue.length){const x=queue.shift();for(const y of reverse.get(x)??[])if(y!==n.id&&!all.has(y)){all.add(y);queue.push(y);}}impacts.push({repositoryId:n.id,directDependents:direct,transitiveDependents:[...all],contracts:contracts.filter((c)=>c.repositoryId===n.id).map((c)=>c.id)});}

  const models = {
    'system-map': {schemaVersion:'1.0',generatedAt:now(),workspaceId:collected.workspaceId,repositories:nodes,edges:dedupEdges},
    'dependency-graph': {schemaVersion:'1.0',generatedAt:now(),nodes,edges:dedupEdges},
    'contract-registry': {schemaVersion:'1.0',generatedAt:now(),endpoints,messages,contracts},
    'capability-map': {schemaVersion:'1.0',generatedAt:now(),capabilities,domains:Object.entries(capabilityGroups).map(([name,items])=>({name,repositoryIds:uniq(items.map((x)=>x.repositoryId)),capabilityIds:items.map((x)=>x.id)}))},
    'business-journeys': {schemaVersion:'1.0',generatedAt:now(),journeys:journeyGroups,businessRules},
    'request-flows': {schemaVersion:'1.0',generatedAt:now(),flows:requestFlows},
    'event-flows': {schemaVersion:'1.0',generatedAt:now(),flows:eventFlows},
    'data-lineage': {schemaVersion:'1.0',generatedAt:now(),flows:dataLineage,dataStores},
    'ownership': {schemaVersion:'1.0',generatedAt:now(),items:ownership,repositories:nodes.map((n)=>({repositoryId:n.id,owner:n.owner,domain:n.domain,criticality:n.criticality}))},
    'shared-infrastructure': {schemaVersion:'1.0',generatedAt:now(),items:infrastructure},
    'change-impact': {schemaVersion:'1.0',generatedAt:now(),impacts},
  };
  for(const [name,value] of Object.entries(models)) writeJson(path.join(p.model,`${name}.json`),value);
  writeJson(path.join(p.contracts,'registry.json'),models['contract-registry']);
  const trace={schemaVersion:'1.0',generatedAt:now(),repositories:repositories.map((r)=>({id:r.id,path:r.path,commit:r.commit,sourceFingerprint:r.sourceFingerprint,modelHash:r.modelHash})),edges:dedupEdges.map((e)=>({id:e.id,evidence:e.evidence??[]}))};
  writeJson(path.join(p.trace,'index.json'),trace);
  writeJson(path.join(p.state,'analysis.json'),{schemaVersion:'1.0',status:'completed',updatedAt:now(),inputHash:collected.inputHash,modelHash:sha(models)});
  console.log(`Workspace analysis complete: ${nodes.length} repositories, ${dedupEdges.length} edges, ${contracts.length} contracts, ${journeyGroups.length} journeys.`);
  return models;
}
function loadWorkspaceModels(root){const p=wsPaths(root),out={};for(const file of walkFiles(p.model).filter((f)=>f.endsWith('.json')))out[path.basename(file,'.json')]=j(file);return out;}

function mermaidId(id){return `n_${slug(id).replaceAll('-','_')}`;}
function mermaidGraph(nodes,edges,title='System dependency graph'){
  const lines=['```mermaid','flowchart LR'];
  for(const n of nodes)lines.push(`  ${mermaidId(n.id)}[${quote(n.name??n.id)}]`);
  for(const e of edges.filter((x)=>x.to))lines.push(`  ${mermaidId(e.from)} -->|${String(e.kind).replace(/[^a-zA-Z0-9 _.-]/g,'')}| ${mermaidId(e.to)}`);
  lines.push('```');return lines.join('\n');
}
function table(headers,rows){return `| ${headers.join(' | ')} |\n| ${headers.map(()=> '---').join(' | ')} |\n${rows.map((r)=>`| ${r.map(md).join(' | ')} |`).join('\n')}`;}
function front(title,description){return `---\ntitle: ${quote(title)}\ndescription: ${quote(description)}\nmode: explanation\nstatus: active\ngeneratedBy: commandcode-docgen\nlastVerified: ${quote(now())}\n---\n`;}
function writeDoc(file,title,description,body){ensureDir(path.dirname(file));fs.writeFileSync(file,`${front(title,description)}\n# ${title}\n\n${body.trim()}\n`);}
function generate(root, force=false){
  const p=wsPaths(root),ws=loadWorkspace(root),models=Object.keys(loadWorkspaceModels(root)).length?loadWorkspaceModels(root):analyze(root);
  const analysis=safeJson(path.join(p.state,'analysis.json'),{}),prev=safeJson(path.join(p.state,'generation.json'),{});
  if(!force&&prev.modelHash===analysis.modelHash&&prev.status==='completed'){console.log('[docgen] SKIP workspace generation — workspace model hash unchanged.');return;}
  const system=models['system-map'],deps=models['dependency-graph'],contracts=models['contract-registry'],caps=models['capability-map'],journeys=models['business-journeys'],requests=models['request-flows'],events=models['event-flows'],data=models['data-lineage'],owners=models.ownership,infra=models['shared-infrastructure'],impact=models['change-impact'];
  const docs=p.docs; ensureDir(docs);
  writeDoc(path.join(docs,'index.md'),`${ws.name} System Knowledge Base`,'Cross-repository architecture, contracts, journeys, lineage, ownership, and change impact.',`
This workspace aggregates ${system.repositories.length} repositories into one system-of-systems view.

## System at a glance

${mermaidGraph(system.repositories,system.edges)}

## Documentation map

- [Repository map](repository-map.md)
- [Service catalog](service-catalog.md)
- [Dependency graph](dependency-graph.md)
- [Capability map](capability-map.md)
- [Contract catalog](contract-catalog.md)
- [Business journeys](business-journeys/index.md)
- [Cross-service request flows](request-flows/index.md)
- [Cross-service event flows](event-flows/index.md)
- [Cross-service data lineage](data-lineage/index.md)
- [Shared infrastructure](shared-infrastructure.md)
- [Ownership](ownership.md)
- [Change impact](change-impact.md)
`);
  writeDoc(path.join(docs,'repository-map.md'),'Repository Map','Registered repositories, domains, ownership, criticality, and source state.',table(['Repository','Domain','Owner','Criticality','Commit','Missing models'],system.repositories.map((r)=>[r.name,r.domain??'Unknown',r.owner??'Unknown',r.criticality??'Unknown',(r.commit??'Unknown').slice(0,12),arr(r.missingModels).join(', ')||'None'])));
  writeDoc(path.join(docs,'service-catalog.md'),'Service and Repository Catalog','System repository catalog and their exposed contracts.',table(['Repository','Inbound endpoints','Message contracts','Dependencies'],system.repositories.map((r)=>[r.name,contracts.endpoints.filter((x)=>x.repositoryId===r.id).length,contracts.messages.filter((x)=>x.repositoryId===r.id).length,system.edges.filter((x)=>x.from===r.id).length])));
  writeDoc(path.join(docs,'dependency-graph.md'),'Global Dependency Graph','Resolved and unresolved cross-repository dependencies.',`${mermaidGraph(deps.nodes,deps.edges)}\n\n## Dependency catalog\n\n${table(['From','To','Kind','Mechanism','Resolved'],deps.edges.map((e)=>[e.from,e.to??e.externalTarget??'Unknown',e.kind,e.mechanism??e.channel??'',String(e.resolved!==false)]))}`);
  writeDoc(path.join(docs,'capability-map.md'),'Domain Capability Map','Business capabilities mapped to repositories and domains.',table(['Domain','Capability','Repository','Classification'],caps.capabilities.map((c)=>[c.domain??'Unclassified',itemName(c),c.repositoryId,c.classification??'UNKNOWN'])));
  writeDoc(path.join(docs,'contract-catalog.md'),'Shared Contract Catalog','HTTP, event, and message contracts exposed or consumed across repositories.',`${table(['Kind','Name','Repository','Direction','Protocol / Channel','Version'],contracts.contracts.map((c)=>[c.kind,c.name,c.repositoryId,c.direction??'',c.path??c.channel??c.protocol??'',c.version??'Unknown']))}`);
  ensureDir(path.join(docs,'business-journeys')); writeDoc(path.join(docs,'business-journeys','index.md'),'End-to-End Business Journeys','Business journeys spanning one or more repositories.',`${table(['Journey','Repositories','Actors','Outcomes'],journeys.journeys.map((x)=>[x.name,x.repositories.join(' → '),x.actors.map(itemName).join(', '),x.outcomes.map(itemName).join(', ')]))}\n\n${journeys.journeys.map((x)=>`## ${x.name}\n\n${x.steps.length?table(['Step','Detail'],x.steps.map((s,i)=>[i+1,itemName(s)])):'No structured steps were evidenced.'}`).join('\n\n')}`);
  ensureDir(path.join(docs,'request-flows')); writeDoc(path.join(docs,'request-flows','index.md'),'Cross-Service Request Flows','Synchronous request paths between repositories.',`${mermaidGraph(system.repositories,system.edges.filter((e)=>['request','dependency'].includes(e.kind)))}\n\n${table(['Flow','Source','Target','Protocol','Contract'],requests.flows.map((x)=>[x.name,x.sourceRepository,x.targetRepository,x.protocol??'Unknown',x.contractId??'Unknown']))}`);
  ensureDir(path.join(docs,'event-flows')); writeDoc(path.join(docs,'event-flows','index.md'),'Cross-Service Event Flows','Asynchronous producer, channel, and consumer paths.',`${mermaidGraph(system.repositories,system.edges.filter((e)=>e.kind==='event'))}\n\n${table(['Channel','Producer','Consumer','Contract'],events.flows.map((x)=>[x.channel,x.producerRepository,x.consumerRepository,x.contractId??'Unknown']))}`);
  ensureDir(path.join(docs,'data-lineage')); writeDoc(path.join(docs,'data-lineage','index.md'),'Cross-Service Data Lineage','Data movement, stores, and downstream repository propagation.',`${table(['Flow','Source repository','Target repositories','Data'],data.flows.map((x)=>[x.name,x.sourceRepository,x.targetRepositories.join(', ')||'None resolved',typeof x.data==='string'?x.data:JSON.stringify(x.data??'Unknown')]))}\n\n## Data stores\n\n${table(['Store','Repository','Type'],data.dataStores.map((x)=>[itemName(x),x.repositoryId,x.kind??x.type??'Unknown']))}`);
  writeDoc(path.join(docs,'shared-infrastructure.md'),'Shared Infrastructure','Cloud, platform, data, messaging, and runtime infrastructure referenced across repositories.',table(['Infrastructure','Repository','Kind / Protocol'],infra.items.map((x)=>[itemName(x),x.repositoryId,x.kind??x.protocol??x.type??'Unknown'])));
  writeDoc(path.join(docs,'ownership.md'),'System Ownership','Repository ownership, approval authority, responsibilities, and escalation.',`${table(['Repository','Owner','Domain','Criticality'],owners.repositories.map((x)=>[x.repositoryId,x.owner??'Unknown',x.domain??'Unknown',x.criticality??'Unknown']))}\n\n## Ownership evidence\n\n${table(['Repository','Item','Kind'],owners.items.map((x)=>[x.repositoryId,itemName(x),x.kind??'ownership']))}`);
  writeDoc(path.join(docs,'change-impact.md'),'Cross-Repository Change Impact','Direct and transitive downstream blast radius.',table(['Repository','Direct dependents','Transitive dependents','Owned contracts'],impact.impacts.map((x)=>[x.repositoryId,x.directDependents.join(', ')||'None',x.transitiveDependents.join(', ')||'None',x.contracts.length])));
  const nav=['index.md','repository-map.md','service-catalog.md','dependency-graph.md','capability-map.md','contract-catalog.md','business-journeys/index.md','request-flows/index.md','event-flows/index.md','data-lineage/index.md','shared-infrastructure.md','ownership.md','change-impact.md'];
  fs.writeFileSync(path.join(docs,'SUMMARY.md'),`# ${ws.name}\n\n${nav.map((x)=>`- [${path.basename(x,'.md').replaceAll('-',' ')}](${x})`).join('\n')}\n`);
  fs.writeFileSync(path.join(docs,'llms.txt'),`${ws.name} system documentation\n\n${nav.map((x)=>`- ${posix(path.join('docs/system',x))}`).join('\n')}\n`);
  const allDocs=nav.map((x)=>fs.readFileSync(path.join(docs,x),'utf8')).join('\n\n---\n\n');fs.writeFileSync(path.join(docs,'llms-full.txt'),allDocs);
  writeJson(path.join(p.state,'generation.json'),{schemaVersion:'1.0',status:'completed',generatedAt:now(),modelHash:analysis.modelHash,documents:nav.map((x)=>posix(path.join('docs/system',x)))});
  console.log(`Generated ${nav.length} workspace documentation pages under ${posix(path.relative(root,docs))}.`);
}
function quality(root){
  const p=wsPaths(root),m=loadWorkspaceModels(root),errors=[],warnings=[];
  const repos=arr(m['system-map']?.repositories),edges=arr(m['system-map']?.edges),contracts=arr(m['contract-registry']?.contracts);
  if(repos.length<2)warnings.push('Workspace contains fewer than two repositories; cross-repository views are limited.');
  for(const r of repos)if(arr(r.missingModels).length)warnings.push(`${r.id} is missing ${r.missingModels.length} model file(s).`);
  const unresolved=edges.filter((e)=>!e.to);if(unresolved.length)warnings.push(`${unresolved.length} dependency edge(s) could not be resolved to registered repositories.`);
  const duplicateContracts=[];const byContract=new Map();for(const c of contracts){const key=[c.kind,slug(c.name),c.version??''].join('|');if(byContract.has(key))duplicateContracts.push([byContract.get(key),c]);else byContract.set(key,c);}
  const docs=walkFiles(p.docs).filter((f)=>f.endsWith('.md'));if(!docs.length)errors.push('No workspace documentation generated.');
  for(const f of docs){const t=fs.readFileSync(f,'utf8');if(/```(?:plantuml|dot|graphviz|puml)/i.test(t))errors.push(`Non-Mermaid diagram fence: ${posix(path.relative(root,f))}`);}
  const report={schemaVersion:'1.0',generatedAt:now(),pass:!errors.length,metrics:{repositories:repos.length,edges:edges.length,resolvedEdges:edges.filter((e)=>e.to).length,unresolvedEdges:unresolved.length,contracts:contracts.length,documents:docs.length,duplicateContractGroups:duplicateContracts.length},errors,warnings};
  writeJson(p.quality,report);console.log(`Workspace quality: ${report.pass?'PASS':'FAIL'} | repos=${repos.length} edges=${edges.length} contracts=${contracts.length} docs=${docs.length}`);for(const x of warnings)console.warn(`WARNING: ${x}`);for(const x of errors)console.error(`ERROR: ${x}`);if(errors.length)fail(`Workspace quality failed. Report: .docgen-workspace/audit/quality-summary.json`);return report;
}
function snapshot(root){const p=wsPaths(root),collected=fs.existsSync(p.repositories)?j(p.repositories):collect(root);const snap={schemaVersion:'1.0',createdAt:now(),inputHash:collected.inputHash,repositories:Object.fromEntries(collected.repositories.map((r)=>[r.id,{commit:r.commit,sourceFingerprint:r.sourceFingerprint,modelHash:r.modelHash}]))};writeJson(p.snapshot,snap);console.log(`Workspace snapshot created for ${collected.repositories.length} repositories.`);}
function changed(root){const p=wsPaths(root),before=safeJson(p.snapshot,{repositories:{}}),current=collect(root),changes=[];for(const r of current.repositories){const prev=before.repositories?.[r.id];const fields=['commit','sourceFingerprint','modelHash'].filter((k)=>prev?.[k]!==r[k]);if(!prev)changes.push({repositoryId:r.id,kind:'added',fields:['repository']});else if(fields.length)changes.push({repositoryId:r.id,kind:'changed',fields});}for(const id of Object.keys(before.repositories??{}))if(!current.repositories.some((r)=>r.id===id))changes.push({repositoryId:id,kind:'removed',fields:['repository']});writeJson(path.join(p.state,'changes.json'),{schemaVersion:'1.0',generatedAt:now(),changes});for(const x of changes)console.log(`${x.kind.toUpperCase()} ${x.repositoryId}: ${x.fields.join(', ')}`);if(!changes.length)console.log('No workspace repository changes.');return changes;}
function impact(root,target){const m=loadWorkspaceModels(root),impacts=arr(m['change-impact']?.impacts),contracts=arr(m['contract-registry']?.contracts);let hit=impacts.find((x)=>x.repositoryId===target);if(!hit){const c=contracts.find((x)=>x.id===target||slug(x.name)===slug(target));if(c)hit=impacts.find((x)=>x.repositoryId===c.repositoryId);}if(!hit)fail(`No repository or contract matched: ${target}`,2);console.log(`Change impact for ${hit.repositoryId}`);console.log(`Direct dependents: ${hit.directDependents.join(', ')||'None'}`);console.log(`Transitive dependents: ${hit.transitiveDependents.join(', ')||'None'}`);console.log(`Owned contracts: ${hit.contracts.length}`);writeJson(path.join(wsPaths(root).audit,`impact-${slug(target)}.json`),hit);}
function status(root){const ws=loadWorkspace(root),p=wsPaths(root),analysis=safeJson(path.join(p.state,'analysis.json'),{}),generation=safeJson(path.join(p.state,'generation.json'),{}),qualityReport=safeJson(p.quality,{});console.log(`Workspace: ${ws.name} (${ws.id})`);console.log(`Repositories: ${arr(ws.repositories).length}`);console.log(`Analysis: ${analysis.status??'pending'}`);console.log(`Generation: ${generation.status??'pending'}`);console.log(`Quality: ${qualityReport.pass===true?'PASS':qualityReport.pass===false?'FAIL':'pending'}`);}
function all(root,force=false){validateWorkspace(root);collect(root);analyze(root,force);generate(root,force);quality(root);snapshot(root);console.log('Workspace P3 pipeline completed.');}
function usage(kitVersion){console.log(`Command Code DocGen Kit ${kitVersion} — P3 system workspace\n\n  docgen workspace init [directory] [--name NAME] [--id ID]\n  docgen workspace add <repo> [--id ID] [--domain DOMAIN] [--owner OWNER] [--criticality LEVEL]\n  docgen workspace remove <repo-id>\n  docgen workspace list\n  docgen workspace validate\n  docgen workspace collect\n  docgen workspace analyze [--force]\n  docgen workspace generate [--force]\n  docgen workspace impact <repo-id|contract-id>\n  docgen workspace changed\n  docgen workspace snapshot\n  docgen workspace quality\n  docgen workspace status\n  docgen workspace resume\n  docgen workspace all [--force]\n`);}
export async function runWorkspace(args, context={}){
  const kitVersion=context.kitVersion??'unknown';const [sub,...rest]=args;const {options,positional}=parseOptions(rest);
  if(!sub||sub==='help'||sub==='--help'){usage(kitVersion);return;}
  if(sub==='init'){workspaceInit(positional[0]??'.',options,kitVersion);return;}
  const root=requireWorkspace();
  switch(sub){
    case 'add': addRepository(root,positional[0],options); break;
    case 'remove': removeRepository(root,positional[0]); break;
    case 'list': listRepositories(root); break;
    case 'validate': validateWorkspace(root); break;
    case 'collect': collect(root); break;
    case 'analyze': analyze(root,Boolean(options.force)); break;
    case 'generate': generate(root,Boolean(options.force)); break;
    case 'quality': quality(root); break;
    case 'snapshot': snapshot(root); break;
    case 'changed': changed(root); break;
    case 'impact': impact(root,positional[0]); break;
    case 'status': status(root); break;
    case 'resume':
    case 'all': all(root,Boolean(options.force)); break;
    default: usage(kitVersion); fail(`Unknown workspace command: ${sub}`,2);
  }
}
