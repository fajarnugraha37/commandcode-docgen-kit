import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContext } from './context.mjs';
import { budgetReport, runProvider } from './provider.mjs';
import { databaseStats, indexRepository, ingestModels } from './indexer.mjs';
import { auditRepository } from './quality.mjs';
import { ensureDir, fileSha256, kitVersion, loadConfig, now, projectPaths, readJson, rel, sha256, slug, sourceSnapshot, stableHash, updateStage, writeJson } from './core.mjs';
import { evidenceFromAliases, normalizeSemanticDocument, normalizeSourceModelRefs, semanticMetadata } from './semantic.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function prompt(root, name, vars = {}) {
  const override = path.join(root, '.docgen', 'prompts', name); const fallback = path.resolve(moduleDir, '..', 'prompts', name);
  let text = fs.readFileSync(fs.existsSync(override) ? override : fallback, 'utf8');
  for (const [key, value] of Object.entries(vars)) text = text.replaceAll(`{{${key}}}`, String(value));
  return text;
}
function state(root) { return readJson(projectPaths(root).state, { schemaVersion: '2.0', kitVersion, stages: {}, pages: {} }); }
function writeState(root, next) { writeJson(projectPaths(root).state, { ...next, schemaVersion: '2.0', kitVersion, updatedAt: now() }); }
function stageCurrent(root, stage, inputHash, outputs = []) { const current = state(root).stages?.[stage]; return current?.status === 'completed' && current.inputHash === inputHash && outputs.every((file) => fs.existsSync(file)); }
function completeStage(root, stage, inputHash, details = {}) { const next = state(root); next.stages ??= {}; next.stages[stage] = { status: 'completed', completedAt: now(), inputHash, ...details }; writeState(root, next); }
function failStage(root, stage, error, details = {}) { const next = state(root); next.stages ??= {}; next.stages[stage] = { ...(next.stages[stage] ?? {}), status: 'failed', failedAt: now(), error: error.message, ...details }; writeState(root, next); }
function pageState(root, id) { return state(root).pages?.[id] ?? {}; }
function updatePage(root, id, patch) { const next = state(root); next.pages ??= {}; next.pages[id] = { ...(next.pages[id] ?? {}), ...patch, updatedAt: now() }; writeState(root, next); }
function modelPath(root, name) { return path.join(projectPaths(root).model, `${name}.json`); }
function tracePath(root, page) { return path.join(projectPaths(root).traceability, 'pages', `${page.id}.json`); }
function validateJson(file) { const value = readJson(file); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid JSON object: ${file}`); return value; }
function artifactStamp(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file, { bigint: true });
  return { hash: fileSha256(file), mtimeNs: String(stat.mtimeNs) };
}
function artifactChanged(file, before) {
  const after = artifactStamp(file); if (!after) return false; if (!before) return true;
  return after.hash !== before.hash || after.mtimeNs !== before.mtimeNs;
}
function phase(name, position, total) { console.log(`[docgen] phase ${position}/${total} ${name.toUpperCase()}`); }

export function index(root, options = {}) {
  updateStage(root, 'index', 'running');
  try { const result = indexRepository(root, options); completeStage(root, 'index', result.inventoryFingerprint, result); return result; }
  catch (error) { failStage(root, 'index', error); throw error; }
}

function bundleObject(bundle, name) {
  const containers = [bundle, bundle?.models, bundle?.model, bundle?.modules, bundle?.result].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const expected = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      if (key.replace(/[^a-z0-9]/gi, '').toLowerCase() === expected && value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
  }
  return null;
}
function splitBundle(root, bundle, names) {
  ensureDir(projectPaths(root).model); const missing = [];
  for (const name of names) {
    const value = bundleObject(bundle, name);
    if (!value) { missing.push(name); continue; }
    normalizeSemanticDocument(value); writeJson(modelPath(root, name), { schemaVersion: '2.0', generatedAt: now(), ...value });
  }
  return missing;
}

async function synthesizeBundle(root, stage, names, query) {
  const paths = projectPaths(root); const context = compileContext(root, { stage, query, target: stage, metadata: { expectedModels: names } });
  const output = path.join(paths.model, `${stage}-bundle.json`); const inputHash = context.payload.inputHash; const outputs = names.map((name) => modelPath(root, name));
  if (stageCurrent(root, stage, inputHash, outputs)) return { skipped: true, inputHash };
  ensureDir(paths.model); updateStage(root, stage, 'running', { inputHash, contextId: context.payload.id });
  const renderPrompt = (expected, target) => prompt(root, stage === 'modelCore' ? 'model-core.md' : 'model-enterprise.md', { CONTEXT_PATH: rel(root, context.file), OUTPUT_PATH: rel(root, target), MODEL_NAMES: JSON.stringify(expected) });
  async function requestBundle(expected, target, repair = false) {
    const before = artifactStamp(target); let accepted = false; let missing = expected;
    const accept = () => {
      try { if (!artifactChanged(target, before)) return false; const bundle = validateJson(target); missing = splitBundle(root, bundle, expected); accepted = missing.length === 0; return accepted; } catch { return false; }
    };
    const provider = await runProvider(root, { stage, target: repair ? `${stage}:repair:${expected.join(',')}` : stage, prompt: renderPrompt(expected, target), acceptArtifacts: accept });
    if (!accepted) {
      if (!artifactChanged(target, before)) throw new Error(`${stage}: provider completed without writing a fresh bundle artifact`);
      missing = splitBundle(root, validateJson(target), expected);
    }
    return { provider, missing };
  }
  try {
    const first = await requestBundle(names, output); let missing = first.missing; let recovered = first.provider.recovered === true;
    if (missing.length) {
      console.warn(`[docgen] ${stage} REPAIR | bundle omitted ${missing.join(', ')}; requesting only missing model object(s).`);
      const repairOutput = path.join(paths.model, `${stage}-repair-${sha256(missing.join('|')).slice(0, 10)}-bundle.json`);
      const repaired = await requestBundle(missing, repairOutput, true); recovered ||= repaired.provider.recovered === true; missing = repaired.missing; fs.rmSync(repairOutput, { force: true });
    }
    if (missing.length) throw new Error(`Model bundle is missing object(s) after targeted repair: ${missing.join(', ')}`);
    fs.rmSync(output, { force: true }); completeStage(root, stage, inputHash, { models: names, contextId: context.payload.id, contextTokens: context.payload.estimatedTokens, recovered });
    return { skipped: false, recovered, inputHash };
  } catch (error) { failStage(root, stage, error, { inputHash, contextId: context.payload.id }); throw error; }
}

export async function model(root, { skipIndex = false } = {}) {
  if (!skipIndex) index(root);
  await synthesizeBundle(root, 'modelCore', ['system', 'business', 'flows', 'catalogs'], 'repository structure architecture components modules symbols interfaces contracts dependencies behavior domain rules states flows data and automation; detect technologies from evidence and do not assume a language or framework');
  ingestModels(root);
  await synthesizeBundle(root, 'modelEnterprise', ['security', 'operations', 'testing', 'data-governance', 'decisions', 'configuration', 'change-impact', 'ownership'], 'security operations testing governance configuration ownership decisions change impact reliability consistency and compatibility across any language framework runtime or deployment model');
  return ingestModels(root);
}

function canonicalPagePath(page, category, id) {
  let value = String(page.path ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!value) value = `docs/${category}/${slug(page.slug ?? page.title ?? id)}.md`;
  if (!value.startsWith('docs/')) value = `docs/${value}`;
  if (!value.endsWith('.md')) value += '.md';
  return value;
}
function normalizePage(page, indexValue) {
  const id = slug(page.id ?? page.title ?? `page-${indexValue + 1}`); const category = slug(page.category ?? page.type ?? 'overview');
  return { id, title: String(page.title ?? id.replaceAll('-', ' ')), summary: String(page.summary ?? page.purpose ?? ''), category, path: canonicalPagePath(page, category, id), mode: String(page.mode ?? 'explanation'), type: String(page.type ?? 'explanation'), order: Number(page.order ?? indexValue + 1), audience: Array.isArray(page.audience) ? page.audience : ['engineer'], coverageTags: Array.isArray(page.coverageTags) ? page.coverageTags.map(String) : [], query: String(page.query ?? [page.title, page.summary, ...(page.coverageTags ?? [])].join(' ')), requiredSections: Array.isArray(page.requiredSections) ? page.requiredSections.map(String) : [], risk: String(page.risk ?? 'normal'), relatedPages: Array.isArray(page.relatedPages) ? page.relatedPages.map(String) : [] };
}
function validateManifest(root) {
  const paths = projectPaths(root); const manifest = readJson(paths.plan); if (!Array.isArray(manifest.pages) || !manifest.pages.length) throw new Error('Manifest must contain non-empty pages[].');
  manifest.pages = manifest.pages.map(normalizePage); const ids = new Set(); const files = new Set(); const max = Number(loadConfig(root).execution?.maxPlannedPages ?? 30);
  if (max > 0 && manifest.pages.length > max) throw new Error(`Manifest contains ${manifest.pages.length} pages, above execution.maxPlannedPages=${max}. Consolidate duplicate user intents or raise the limit explicitly.`);
  for (const page of manifest.pages) {
    if (ids.has(page.id)) throw new Error(`Duplicate page id: ${page.id}`); if (files.has(page.path)) throw new Error(`Duplicate page path: ${page.path}`);
    if (!page.title.trim() || !page.summary.trim()) throw new Error(`Page ${page.id} requires non-empty title and summary.`);
    ids.add(page.id); files.add(page.path);
  }
  manifest.schemaVersion = '2.0'; manifest.generatedAt ??= now(); writeJson(paths.plan, manifest); return manifest;
}

export async function plan(root) {
  const paths = projectPaths(root); ingestModels(root);
  const context = compileContext(root, { stage: 'plan', query: 'documentation information architecture onboarding reference explanation tutorial operations decisions behavior interfaces dependencies configuration and change; select only concerns evidenced by this repository regardless of technology stack', target: 'manifest', maxTokens: loadConfig(root).context?.maxTokens?.plan ?? 50000 });
  const inputHash = context.payload.inputHash; if (stageCurrent(root, 'plan', inputHash, [paths.plan])) return validateManifest(root);
  updateStage(root, 'plan', 'running', { inputHash, contextId: context.payload.id });
  const planBefore = artifactStamp(paths.plan); let validManifest = null; const acceptManifest = () => { try { if (!artifactChanged(paths.plan, planBefore)) return false; validManifest = validateManifest(root); return true; } catch { return false; } };
  try {
    const provider = await runProvider(root, { stage: 'plan', target: 'manifest', prompt: prompt(root, 'plan-indexed.md', { CONTEXT_PATH: rel(root, context.file), OUTPUT_PATH: rel(root, paths.plan) }), acceptArtifacts: acceptManifest });
    if (!validManifest && !artifactChanged(paths.plan, planBefore)) throw new Error('plan: provider completed without writing a fresh manifest artifact');
    const manifest = validManifest ?? validateManifest(root); completeStage(root, 'plan', inputHash, { pages: manifest.pages.length, contextId: context.payload.id, recovered: provider.recovered === true }); return manifest;
  } catch (error) { failStage(root, 'plan', error, { inputHash, contextId: context.payload.id }); throw error; }
}

function frontmatter(page) { return ['---', `title: ${JSON.stringify(page.title)}`, `description: ${JSON.stringify(page.summary)}`, `pageId: ${JSON.stringify(page.id)}`, `category: ${JSON.stringify(page.category)}`, `mode: ${JSON.stringify(page.mode)}`, `type: ${JSON.stringify(page.type)}`, `order: ${page.order}`, '---', ''].join('\n'); }
function markdownTable(headers, rows) { return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map((value) => String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`).join('\n')}\n`; }
function deterministicKind(page) {
  const tags = new Set(page.coverageTags.map((tag) => tag.toLowerCase()));
  const mapping = [
    ['endpoint-catalog', 'endpoints'], ['message-handler-catalog', 'messages'], ['external-dependency-catalog', 'dependencies'], ['dependency-catalog', 'dependencies'],
    ['data-store-catalog', 'data-assets'], ['data-asset-catalog', 'data-assets'], ['scheduled-job-catalog', 'automations'], ['automation-catalog', 'automations'],
    ['interface-catalog', 'interfaces'], ['component-catalog', 'components'], ['configuration-matrix', 'configuration'], ['ownership-responsibilities', 'ownership'], ['change-impact', 'change-impact']
  ];
  return mapping.find(([tag]) => tags.has(tag))?.[1] ?? null;
}
function evidenceText(item) { return (item.evidence ?? []).map((e) => [e.path, e.startLine ? `L${e.startLine}${e.endLine ? `-L${e.endLine}` : ''}` : ''].filter(Boolean).join('#')).join(', '); }
function arraysFor(document, keys) { const items = []; for (const key of keys) if (Array.isArray(document[key])) items.push(...document[key]); return items; }
function referenceData(root, kind) {
  const catalog = readJson(modelPath(root, 'catalogs'), {}); const system = readJson(modelPath(root, 'system'), {});
  let model = 'catalogs'; let modelFiles = [modelPath(root, 'catalogs')]; let items = []; let headers = ['Name', 'Kind', 'Statement', 'Evidence']; let row;
  if (kind === 'endpoints') { items = arraysFor(catalog, ['endpoints']); headers = ['Endpoint', 'Method', 'Path', 'Statement', 'Evidence']; row = (item) => [item.name ?? item.id, item.method ?? item.httpMethod ?? '', item.path ?? item.route ?? '', item.statement ?? item.summary ?? '', evidenceText(item)]; }
  else if (kind === 'messages') { items = arraysFor(catalog, ['messageHandlers']); headers = ['Handler', 'Direction', 'Channel', 'Statement', 'Evidence']; row = (item) => [item.name ?? item.id, item.direction ?? item.role ?? '', item.topic ?? item.queue ?? item.channel ?? '', item.statement ?? item.summary ?? '', evidenceText(item)]; }
  else if (kind === 'interfaces') items = arraysFor(catalog, ['interfaces', 'endpoints', 'messageHandlers', 'contracts']);
  else if (kind === 'dependencies') items = arraysFor(catalog, ['dependencies', 'externalDependencies']);
  else if (kind === 'data-assets') items = arraysFor(catalog, ['dataAssets', 'dataStores']);
  else if (kind === 'automations') items = arraysFor(catalog, ['automations', 'scheduledJobs']);
  else if (kind === 'components') { model = 'system'; modelFiles = [modelPath(root, 'system')]; items = arraysFor(system, ['components', 'modules', 'services', 'packages']); }
  else {
    model = kind; modelFiles = [modelPath(root, model)]; const document = readJson(modelPath(root, model), {}); items = Object.values(document).filter(Array.isArray).flat();
  }
  const seen = new Set(); items = items.filter((item) => { const id = String(item?.id ?? stableHash(item)); if (seen.has(id)) return false; seen.add(id); return true; });
  row ??= (item) => [item.name ?? item.title ?? item.id, item.kind ?? '', item.statement ?? item.summary ?? item.description ?? '', evidenceText(item)];
  return { model, modelFiles, items, headers, rows: items.map(row) };
}
function writeTrace(root, page, claims, inputHash, contextId = null) {
  const pageFile = path.join(root, page.path); const trace = { schemaVersion: '2.0', pageId: page.id, pagePath: page.path, pageHash: sha256(fs.readFileSync(pageFile)), inputHash, contextId, generatedAt: now(), claims };
  writeJson(tracePath(root, page), trace); return trace;
}
function renderDeterministic(root, page, kind, inputHash) {
  const data = referenceData(root, kind); const text = `${frontmatter(page)}# ${page.title}\n\n${page.summary}\n\n${markdownTable(data.headers, data.rows)}\n`; const file = path.join(root, page.path); ensureDir(path.dirname(file)); fs.writeFileSync(file, text);
  const claims = data.items.map((item, indexValue) => { const metadata = semanticMetadata(item); return { id: `${page.id}:${item.id ?? indexValue + 1}`, section: page.title, statement: item.statement ?? item.summary ?? item.description ?? item.name ?? item.id, classification: metadata.classification, confidence: metadata.confidence, evidence: metadata.evidence, sourceModelRefs: [`${data.model}:${item.id ?? indexValue + 1}`] }; });
  writeTrace(root, page, claims, inputHash); return { items: data.items.length, hash: sha256(text) };
}
function pageInputHash(page, contextHash) { return stableHash({ page, contextHash }); }
function finalizeProviderTrace(root, page, inputHash, contextId) {
  const file = tracePath(root, page); const trace = validateJson(file); if (!Array.isArray(trace.claims)) throw new Error(`${rel(root, file)} must contain claims[].`);
  const contextFile = path.join(projectPaths(root).context, 'generate', `${page.id.replace(/[^a-z0-9_.-]+/gi, '-')}.json`); const context = fs.existsSync(contextFile) ? readJson(contextFile, {}) : {};
  const modelItems = new Map(); const aliases = new Map(); const perModel = new Map();
  for (const item of context.modelItems ?? []) { modelItems.set(item.id, item); const ordinal = (perModel.get(item.model) ?? 0) + 1; perModel.set(item.model, ordinal); aliases.set(`${item.model}:${ordinal}`, item.id); }
  const dedupeEvidence = (entries) => { const seen = new Set(); return entries.filter((entry) => { const key = `${entry.path}\0${entry.startLine ?? ''}\0${entry.endLine ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; }); };
  const ids = new Set(); const normalizedClaims = [];
  for (const claim of trace.claims) {
    claim.id = String(claim.id ?? `${page.id}:claim-${ids.size + 1}`); if (ids.has(claim.id)) throw new Error(`${page.id}: duplicate claim id ${claim.id}`); ids.add(claim.id);
    const requestedRefs = normalizeSourceModelRefs(claim.sourceModelRefs ?? claim.modelRefs).map((ref) => aliases.get(ref) ?? ref); const refs = requestedRefs.filter((ref) => modelItems.has(ref)); const referenced = refs.map((ref) => modelItems.get(ref)); const metadata = semanticMetadata(claim);
    const inherited = referenced.flatMap((item) => evidenceFromAliases(item)); const evidence = dedupeEvidence([...metadata.evidence, ...inherited]); const fallbackStatement = referenced.map((item) => String(item.statement ?? item.payload?.statement ?? item.name ?? '')).find(Boolean);
    claim.statement = String(claim.statement ?? fallbackStatement ?? '').trim(); claim.classification = metadata.requestedClassification === 'FACT' && evidence.length ? 'FACT' : metadata.classification; claim.confidence = claim.classification === 'FACT' ? Math.max(metadata.confidence, 0.8) : metadata.confidence; claim.evidence = evidence; claim.sourceModelRefs = refs;
    if (!claim.statement && !claim.evidence.length && !claim.sourceModelRefs.length) continue;
    normalizedClaims.push(claim);
  }
  trace.claims = normalizedClaims;
  trace.schemaVersion = '2.0'; trace.pageId = page.id; trace.pagePath = page.path; trace.pageHash = sha256(fs.readFileSync(path.join(root, page.path))); trace.inputHash = inputHash; trace.contextId = contextId; trace.generatedAt = now(); writeJson(file, trace); return trace;
}
function validatePage(root, page, inputHash = null) {
  const file = path.join(root, page.path); if (!fs.existsSync(file)) throw new Error(`Missing page: ${page.path}`); const text = fs.readFileSync(file, 'utf8');
  if (!/^---\s*\n[\s\S]*?\n---\s*\n/.test(text)) throw new Error(`${page.path}: missing frontmatter`); if (!/^#\s+\S/m.test(text)) throw new Error(`${page.path}: missing H1`); if (/```(?:plantuml|dot|graphviz|puml)/i.test(text)) throw new Error(`${page.path}: non-Mermaid diagram`);
  const traceFile = tracePath(root, page); if (!fs.existsSync(traceFile)) throw new Error(`${page.path}: missing traceability sidecar`); const trace = validateJson(traceFile); if (!Array.isArray(trace.claims)) throw new Error(`${rel(root, traceFile)}: missing claims[]`); if (trace.pageId !== page.id || trace.pagePath !== page.path) throw new Error(`${rel(root, traceFile)}: page identity mismatch`); if (trace.pageHash && trace.pageHash !== sha256(text)) throw new Error(`${rel(root, traceFile)}: stale page hash`); if (inputHash && trace.inputHash !== inputHash) throw new Error(`${rel(root, traceFile)}: stale input hash`);
  return { file, text, trace, hash: sha256(text) };
}

function checkpointGeneratedItems(root, batch, recovered = false, baseline = new Map()) {
  const completed = []; const missing = [];
  for (const item of batch) {
    try {
      const pageFile = path.join(root, item.page.path); const traceFile = tracePath(root, item.page);
      if (!fs.existsSync(pageFile) || !fs.existsSync(traceFile)) throw new Error('expected output is missing');
      const before = baseline.get(item.page.id) ?? {}; const existingTrace = readJson(traceFile, {});
      const alreadyCurrent = existingTrace.inputHash === item.inputHash && existingTrace.contextId === item.context.payload.id;
      if (!alreadyCurrent && !artifactChanged(pageFile, before.page) && !artifactChanged(traceFile, before.trace)) throw new Error('provider did not write a fresh artifact for the current input');
      finalizeProviderTrace(root, item.page, item.inputHash, item.context.payload.id); const checked = validatePage(root, item.page, item.inputHash);
      updatePage(root, item.page.id, { status: 'completed', renderer: 'provider', recovered, inputHash: item.inputHash, pageHash: checked.hash, contextId: item.context.payload.id, completedAt: now(), error: null }); completed.push(item);
    } catch (error) { missing.push({ ...item, checkpointError: error.message }); }
  }
  return { completed, missing };
}

async function generateBatch(root, batch, config, recoveryRound = 0) {
  if (!batch.length) return { completed: 0, recovered: 0 };
  const maxRecoveryRounds = Math.max(1, Number(config.execution?.generationRecoveryAttempts ?? 3)); const batchId = sha256(batch.map((item) => `${item.page.id}:${item.inputHash}`).join('|')).slice(0, 12);
  const baseline = new Map(batch.map((item) => [item.page.id, { page: artifactStamp(path.join(root, item.page.path)), trace: artifactStamp(tracePath(root, item.page)) }]));
  for (const item of batch) updatePage(root, item.page.id, { status: 'running', renderer: 'provider', inputHash: item.inputHash, contextId: item.context.payload.id, batchId, recoveryRound, startedAt: now(), error: null });
  const contract = batch.map(({ page, context, inputHash }) => ({ page, contextPath: rel(root, context.file), outputPath: page.path, traceabilityPath: rel(root, tracePath(root, page)), inputHash, contextId: context.payload.id }));
  let checkpoint = { completed: [], missing: batch }; let provider;
  try {
    provider = await runProvider(root, {
      stage: 'generate', target: batch.map((item) => item.page.id).join(','), prompt: prompt(root, 'write-pages-indexed.md', { PAGE_CONTRACTS: JSON.stringify(contract, null, 2) }),
      acceptArtifacts: () => { checkpoint = checkpointGeneratedItems(root, batch, true, baseline); return checkpoint.completed.length > 0; }
    });
    checkpoint = checkpointGeneratedItems(root, batch, provider.recovered === true, baseline);
  } catch (error) {
    checkpoint = checkpointGeneratedItems(root, batch, true, baseline);
    for (const item of checkpoint.missing) updatePage(root, item.page.id, { status: 'failed', failedAt: now(), error: item.checkpointError || error.message });
    if (!checkpoint.completed.length) throw error;
  }
  if (checkpoint.missing.length) {
    if (recoveryRound + 1 >= maxRecoveryRounds) {
      const error = new Error(`Generation batch ${batchId} produced ${checkpoint.completed.length}/${batch.length} valid page(s); recovery limit ${maxRecoveryRounds} reached for: ${checkpoint.missing.map((item) => item.page.id).join(', ')}`);
      for (const item of checkpoint.missing) updatePage(root, item.page.id, { status: 'failed', failedAt: now(), error: error.message }); throw error;
    }
    console.warn(`[docgen] generate RECOVERY | checkpointed ${checkpoint.completed.length}/${batch.length}; retrying only ${checkpoint.missing.length} missing/invalid page(s).`);
    const next = await generateBatch(root, checkpoint.missing, config, recoveryRound + 1);
    return { completed: checkpoint.completed.length + next.completed, recovered: checkpoint.completed.length + next.recovered };
  }
  return { completed: checkpoint.completed.length, recovered: provider?.recovered === true ? checkpoint.completed.length : 0 };
}

export async function generate(root) {
  const manifest = validateManifest(root); const config = loadConfig(root); const pending = []; let deterministicPages = 0; let reusedPages = 0;
  updateStage(root, 'generate', 'running', { pages: manifest.pages.length });
  try {
    for (const page of manifest.pages) {
      const deterministic = deterministicKind(page);
      if (deterministic) {
        const data = referenceData(root, deterministic); const inputHash = stableHash({ page, models: data.modelFiles.map(fileSha256) });
        try { validatePage(root, page, inputHash); updatePage(root, page.id, { status: 'completed', renderer: 'deterministic', inputHash, pageHash: fileSha256(path.join(root, page.path)), recovered: pageState(root, page.id).status !== 'completed' }); reusedPages++; }
        catch { const result = renderDeterministic(root, page, deterministic, inputHash); updatePage(root, page.id, { status: 'completed', renderer: 'deterministic', inputHash, pageHash: result.hash, completedAt: now(), error: null }); }
        deterministicPages++; continue;
      }
      const context = compileContext(root, { stage: 'generate', target: page.id, query: page.query, maxTokens: config.context?.maxTokens?.generate ?? 30000, metadata: { page } }); const inputHash = pageInputHash(page, context.payload.inputHash);
      try {
        if (fs.existsSync(tracePath(root, page))) finalizeProviderTrace(root, page, inputHash, context.payload.id);
        const checked = validatePage(root, page, inputHash); updatePage(root, page.id, { status: 'completed', renderer: 'provider', inputHash, pageHash: checked.hash, contextId: context.payload.id, recovered: pageState(root, page.id).status !== 'completed', error: null }); reusedPages++; continue;
      } catch {}
      pending.push({ page, context, inputHash });
    }
    const size = Math.max(1, Number(config.execution?.generationBatchSize ?? 4)); let recoveredPages = 0;
    for (let i = 0; i < pending.length; i += size) { const result = await generateBatch(root, pending.slice(i, i + size), config); recoveredPages += result.recovered; }
    const inputHash = stableHash(manifest.pages.map((page) => [page.id, pageState(root, page.id).inputHash]));
    completeStage(root, 'generate', inputHash, { pages: manifest.pages.length, providerPages: pending.length, deterministicPages, reusedPages, recoveredPages });
    return { pages: manifest.pages.length, providerPages: pending.length, deterministicPages, reusedPages, recoveredPages };
  } catch (error) { failStage(root, 'generate', error, { pages: manifest.pages.length }); throw error; }
}

export async function audit(root) {
  const paths = projectPaths(root); const manifest = validateManifest(root); ensureDir(paths.audit); updateStage(root, 'audit', 'running');
  try {
    const quality = auditRepository(root, manifest); writeJson(path.join(paths.audit, 'deterministic.json'), quality);
    const config = loadConfig(root); const threshold = Number(config.audit?.llmRiskThreshold ?? 50); const risky = quality.pages.filter((report) => report.riskScore >= threshold && !report.errors.length); const llmOutput = path.join(paths.audit, 'llm-risk.json'); let highRiskFindings = 0;
    if (risky.length && config.audit?.llmEnabled !== false) {
      const contexts = risky.map((report) => { const page = manifest.pages.find((item) => item.id === report.pageId); const context = compileContext(root, { stage: 'audit', target: page.id, query: page.query, maxTokens: config.context?.maxTokens?.audit ?? 18000, metadata: { page, deterministicReport: report } }); return { page, contextPath: rel(root, context.file), contextId: context.payload.id, pagePath: page.path, report }; });
      const riskInputHash = stableHash(contexts.map((item) => ({ pageId: item.page.id, pageHash: item.report.pageHash, inputHash: item.report.inputHash, contextId: item.contextId })));
      if (!stageCurrent(root, 'auditRisk', riskInputHash, [llmOutput])) {
        const llmBefore = artifactStamp(llmOutput); let valid = null; const accept = () => { try { if (!artifactChanged(llmOutput, llmBefore)) return false; const result = validateJson(llmOutput); if (!Array.isArray(result.pages)) return false; valid = result; return true; } catch { return false; } };
        const provider = await runProvider(root, { stage: 'audit', target: risky.map((report) => report.pageId).join(','), prompt: prompt(root, 'audit-risk-indexed.md', { AUDIT_CONTRACTS: JSON.stringify(contexts, null, 2), OUTPUT_PATH: rel(root, llmOutput) }), acceptArtifacts: accept });
        if (!valid && !artifactChanged(llmOutput, llmBefore)) throw new Error('audit: provider completed without writing a fresh risk report artifact');
        const result = valid ?? validateJson(llmOutput); if (!Array.isArray(result.pages)) throw new Error('Risk audit report must contain pages[].'); completeStage(root, 'auditRisk', riskInputHash, { pages: risky.length, recovered: provider.recovered === true });
      }
      const llm = readJson(llmOutput, { pages: [] }); highRiskFindings = (llm.pages ?? []).flatMap((page) => page.findings ?? []).filter((finding) => ['critical', 'high'].includes(String(finding.severity).toLowerCase())).length;
    }
    const pass = quality.pass && highRiskFindings === 0;
    const summary = { schemaVersion: '2.0', generatedAt: now(), auditInputHash: quality.auditInputHash, inventoryFingerprint: quality.inventoryFingerprint, manifestHash: quality.manifestHash, pages: quality.metrics.pages, claims: quality.metrics.claims, evidenceReferences: quality.metrics.evidenceReferences, modelItems: quality.metrics.modelItems, referencedModelItems: quality.metrics.referencedModelItems, modelReferenceCoverage: quality.metrics.modelReferenceCoverage, deterministicFailures: quality.errors.length, deterministicWarnings: quality.warnings.length, llmAuditedPages: risky.length, highRiskFindings, pass };
    writeJson(path.join(paths.audit, 'quality-summary.json'), summary);
    if (!pass) throw new Error(`Quality failed: deterministicFailures=${quality.errors.length}, highRiskFindings=${highRiskFindings}. See .docgen/audit/deterministic.json.`);
    completeStage(root, 'audit', quality.auditInputHash, summary); return summary;
  } catch (error) { failStage(root, 'audit', error); throw error; }
}

export function publish(root) {
  const paths = projectPaths(root); const manifest = validateManifest(root); const summary = readJson(path.join(paths.audit, 'quality-summary.json'), null); const auditState = state(root).stages?.audit;
  if (!summary?.pass || auditState?.status !== 'completed' || auditState.inputHash !== summary.auditInputHash) throw new Error('Publish requires a current passing audit. Run `docgen audit` or `docgen resume`.');
  const inventory = readJson(paths.inventory, {}); if (summary.inventoryFingerprint !== inventory.fingerprint || summary.manifestHash !== stableHash(manifest.pages)) throw new Error('Audit is stale relative to the current inventory or manifest. Run `docgen audit`.');
  const currentQuality = auditRepository(root, manifest);
  if (!currentQuality.pass || currentQuality.auditInputHash !== summary.auditInputHash) throw new Error('Audit is stale relative to current source, model, page, or traceability artifacts. Run `docgen resume`.');
  ensureDir(paths.publish); const navigation = {}; const search = []; const traces = [];
  for (const page of manifest.pages) {
    const checked = validatePage(root, page, pageState(root, page.id).inputHash); (navigation[page.category] ??= []).push({ id: page.id, title: page.title, path: page.path, order: page.order, summary: page.summary });
    search.push({ id: page.id, title: page.title, path: page.path, category: page.category, summary: page.summary, keywords: page.coverageTags, excerpt: checked.text.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) });
    traces.push({ pageId: page.id, pagePath: page.path, pageHash: checked.trace.pageHash, inputHash: checked.trace.inputHash, claims: checked.trace.claims.length });
  }
  for (const pages of Object.values(navigation)) pages.sort((a, b) => a.order - b.order);
  writeJson(path.join(paths.publish, 'navigation.json'), { schemaVersion: '2.0', generatedAt: now(), navigation }); writeJson(path.join(paths.publish, 'search-index.json'), { schemaVersion: '2.0', generatedAt: now(), pages: search }); writeJson(path.join(paths.traceability, 'index.json'), { schemaVersion: '2.0', generatedAt: now(), pages: traces });
  const lines = [`# ${loadConfig(root).projectName || path.basename(root)}`, '']; for (const [category, pages] of Object.entries(navigation)) { lines.push(`## ${category}`, ''); for (const page of pages) lines.push(`- [${page.title}](${page.path.replace(/^docs\//, '')}) — ${page.summary}`); lines.push(''); }
  ensureDir(paths.docs); fs.writeFileSync(path.join(paths.docs, 'llms.txt'), lines.join('\n').trimEnd() + '\n'); const full = manifest.pages.map((page) => fs.readFileSync(path.join(root, page.path), 'utf8')).join('\n\n---\n\n'); fs.writeFileSync(path.join(paths.docs, 'llms-full.txt'), full);
  completeStage(root, 'publish', stableHash({ audit: summary.auditInputHash, pages: traces.map((trace) => trace.pageHash) }), { pages: search.length, categories: Object.keys(navigation).length });
  return { pages: search.length, categories: Object.keys(navigation).length, traceabilityPages: traces.length };
}

export function status(root) {
  const current = state(root); const pages = Object.values(current.pages ?? {}); const stageOrder = ['index', 'modelCore', 'modelEnterprise', 'plan', 'generate', 'audit', 'publish']; const nextStage = stageOrder.find((name) => current.stages?.[name]?.status !== 'completed') ?? null;
  return { state: current, summary: { nextStage, completedPages: pages.filter((page) => page.status === 'completed').length, failedPages: pages.filter((page) => page.status === 'failed').length, runningPages: pages.filter((page) => page.status === 'running').length }, budget: budgetReport(root), index: fs.existsSync(projectPaths(root).database) ? databaseStats(root) : null };
}

export async function all(root) {
  phase('index', 1, 6); index(root);
  phase('model', 2, 6); await model(root, { skipIndex: true });
  phase('plan', 3, 6); await plan(root);
  phase('generate', 4, 6); await generate(root);
  phase('audit', 5, 6); await audit(root);
  phase('publish', 6, 6); const publishing = publish(root);
  return { publishing, budget: budgetReport(root), snapshot: sourceSnapshot(root) };
}
