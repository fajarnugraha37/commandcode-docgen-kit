import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContext } from './context.mjs';
import { budgetReport, runProvider } from './provider.mjs';
import { databaseStats, indexRepository, ingestModels } from './indexer.mjs';
import { ensureDir, fileSha256, kitVersion, loadConfig, now, projectPaths, readJson, rel, sha256, slug, sourceSnapshot, stableHash, updateStage, writeJson } from './core.mjs';

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
function failStage(root, stage, error) { const next = state(root); next.stages ??= {}; next.stages[stage] = { status: 'failed', failedAt: now(), error: error.message }; writeState(root, next); }
function pageState(root, id) { return state(root).pages?.[id] ?? {}; }
function updatePage(root, id, patch) { const next = state(root); next.pages ??= {}; next.pages[id] = { ...(next.pages[id] ?? {}), ...patch, updatedAt: now() }; writeState(root, next); }
function modelPath(root, name) { return path.join(projectPaths(root).model, `${name}.json`); }
function tracePath(root, page) { return path.join(projectPaths(root).traceability, 'pages', `${page.id}.json`); }
function validateJson(file) { const value = readJson(file); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid JSON object: ${file}`); return value; }

export function index(root, options = {}) {
  updateStage(root, 'index', 'running');
  try { const result = indexRepository(root, options); completeStage(root, 'index', result.inventoryFingerprint, result); return result; }
  catch (error) { failStage(root, 'index', error); throw error; }
}

function splitBundle(root, bundle, names) {
  ensureDir(projectPaths(root).model);
  for (const name of names) {
    const value = bundle[name] ?? bundle[name.replaceAll('-', '')] ?? bundle[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Model bundle is missing object: ${name}`);
    writeJson(modelPath(root, name), { schemaVersion: '2.0', generatedAt: now(), ...value });
  }
}

async function synthesizeBundle(root, stage, names, query) {
  const paths = projectPaths(root); const context = compileContext(root, { stage, query, target: stage, metadata: { expectedModels: names } });
  const output = path.join(paths.model, `${stage}-bundle.json`); const inputHash = context.payload.inputHash;
  if (stageCurrent(root, stage, inputHash, names.map((name) => modelPath(root, name)))) return { skipped: true, inputHash };
  ensureDir(paths.model); updateStage(root, stage, 'running', { inputHash });
  const body = prompt(root, stage === 'modelCore' ? 'model-core.md' : 'model-enterprise.md', { CONTEXT_PATH: rel(root, context.file), OUTPUT_PATH: rel(root, output), MODEL_NAMES: JSON.stringify(names) });
  try {
    await runProvider(root, { stage, target: stage, prompt: body }); const bundle = validateJson(output); splitBundle(root, bundle, names); fs.rmSync(output, { force: true });
    completeStage(root, stage, inputHash, { models: names, contextTokens: context.payload.estimatedTokens }); return { skipped: false, inputHash };
  } catch (error) { failStage(root, stage, error); throw error; }
}

export async function model(root) {
  index(root);
  await synthesizeBundle(root, 'modelCore', ['system','business','flows','catalogs'], 'repository architecture domain business lifecycle interfaces endpoints messages dependencies data');
  ingestModels(root);
  await synthesizeBundle(root, 'modelEnterprise', ['security','operations','testing','data-governance','decisions','configuration','change-impact','ownership'], 'security operations testing governance configuration ownership decisions change impact transactions consistency');
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
  return { id, title: String(page.title ?? id.replaceAll('-', ' ')), summary: String(page.summary ?? page.purpose ?? ''), category, path: canonicalPagePath(page, category, id), mode: String(page.mode ?? 'explanation'), type: String(page.type ?? 'explanation'), order: Number(page.order ?? indexValue + 1), audience: Array.isArray(page.audience) ? page.audience : ['engineer'], coverageTags: Array.isArray(page.coverageTags) ? page.coverageTags : [], query: String(page.query ?? [page.title, page.summary, ...(page.coverageTags ?? [])].join(' ')), requiredSections: Array.isArray(page.requiredSections) ? page.requiredSections : [], risk: String(page.risk ?? 'normal'), relatedPages: Array.isArray(page.relatedPages) ? page.relatedPages : [] };
}
function validateManifest(root) {
  const paths = projectPaths(root); const manifest = readJson(paths.plan); if (!Array.isArray(manifest.pages) || !manifest.pages.length) throw new Error('Manifest must contain non-empty pages[].');
  manifest.pages = manifest.pages.map(normalizePage); const ids = new Set(); const files = new Set(); const max = Number(loadConfig(root).execution?.maxPlannedPages ?? 30);
  if (max > 0 && manifest.pages.length > max) throw new Error(`Manifest contains ${manifest.pages.length} pages, above execution.maxPlannedPages=${max}. Consolidate duplicate user intents or raise the limit explicitly.`);
  for (const page of manifest.pages) { if (ids.has(page.id)) throw new Error(`Duplicate page id: ${page.id}`); if (files.has(page.path)) throw new Error(`Duplicate page path: ${page.path}`); ids.add(page.id); files.add(page.path); }
  manifest.schemaVersion = '2.0'; manifest.generatedAt ??= now(); writeJson(paths.plan, manifest); return manifest;
}

export async function plan(root) {
  const paths = projectPaths(root); ingestModels(root); const context = compileContext(root, { stage: 'plan', query: 'documentation information architecture user journey pages reference tutorial explanation runbook', target: 'manifest', maxTokens: loadConfig(root).context?.maxTokens?.plan ?? 50000 });
  const inputHash = context.payload.inputHash; if (stageCurrent(root, 'plan', inputHash, [paths.plan])) return validateManifest(root);
  updateStage(root, 'plan', 'running', { inputHash });
  try { await runProvider(root, { stage: 'plan', target: 'manifest', prompt: prompt(root, 'plan-indexed.md', { CONTEXT_PATH: rel(root, context.file), OUTPUT_PATH: rel(root, paths.plan) }) }); const manifest = validateManifest(root); completeStage(root, 'plan', inputHash, { pages: manifest.pages.length }); return manifest; }
  catch (error) { failStage(root, 'plan', error); throw error; }
}

function frontmatter(page) { return ['---',`title: ${JSON.stringify(page.title)}`,`description: ${JSON.stringify(page.summary)}`,`pageId: ${JSON.stringify(page.id)}`,`category: ${JSON.stringify(page.category)}`,`mode: ${JSON.stringify(page.mode)}`,`type: ${JSON.stringify(page.type)}`,`order: ${page.order}`,'---',''].join('\n'); }
function markdownTable(headers, rows) { return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map((value) => String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`).join('\n')}\n`; }
function deterministicKind(page) {
  const tags = new Set(page.coverageTags);
  if (tags.has('endpoint-catalog')) return 'endpoints'; if (tags.has('message-handler-catalog')) return 'messages'; if (tags.has('external-dependency-catalog')) return 'dependencies'; if (tags.has('data-store-catalog')) return 'data-stores'; if (tags.has('scheduled-job-catalog')) return 'scheduled-jobs'; if (tags.has('configuration-matrix')) return 'configuration'; if (tags.has('ownership-responsibilities')) return 'ownership'; if (tags.has('change-impact')) return 'change-impact'; return null;
}
function evidenceText(item) { return (item.evidence ?? []).map((e) => [e.path, e.startLine ? `L${e.startLine}${e.endLine ? `-L${e.endLine}` : ''}` : ''].filter(Boolean).join('#')).join(', '); }
function referenceData(root, kind) {
  if (['endpoints','messages','dependencies','data-stores','scheduled-jobs'].includes(kind)) {
    const catalogs = readJson(modelPath(root, 'catalogs'), {}); const key = { endpoints:'endpoints', messages:'messageHandlers', dependencies:'externalDependencies', 'data-stores':'dataStores', 'scheduled-jobs':'scheduledJobs' }[kind]; const items = catalogs[key] ?? [];
    const headers = kind === 'endpoints' ? ['Endpoint','Method','Path','Evidence'] : kind === 'messages' ? ['Handler','Direction','Channel','Evidence'] : ['Name','Kind','Statement','Evidence'];
    const rows = items.map((item) => kind === 'endpoints' ? [item.name ?? item.id, item.method ?? item.httpMethod ?? '', item.path ?? item.route ?? '', evidenceText(item)] : kind === 'messages' ? [item.name ?? item.id, item.direction ?? item.role ?? '', item.topic ?? item.queue ?? item.channel ?? '', evidenceText(item)] : [item.name ?? item.id, item.kind ?? '', item.statement ?? item.summary ?? '', evidenceText(item)]);
    return { model: 'catalogs', items, headers, rows };
  }
  const model = kind; const items = Object.values(readJson(modelPath(root, model), {})).filter(Array.isArray).flat();
  return { model, items, headers: ['Name','Kind','Statement','Evidence'], rows: items.map((item) => [item.name ?? item.id, item.kind ?? '', item.statement ?? item.summary ?? '', evidenceText(item)]) };
}
function writeTrace(root, page, claims, inputHash, contextId = null) {
  const pageFile = path.join(root, page.path); const trace = { schemaVersion: '2.0', pageId: page.id, pagePath: page.path, pageHash: sha256(fs.readFileSync(pageFile)), inputHash, contextId, generatedAt: now(), claims };
  writeJson(tracePath(root, page), trace); return trace;
}
function renderDeterministic(root, page, kind, inputHash) {
  const data = referenceData(root, kind); const text = `${frontmatter(page)}# ${page.title}\n\n${page.summary}\n\n${markdownTable(data.headers, data.rows)}\n`; const file = path.join(root, page.path); ensureDir(path.dirname(file)); fs.writeFileSync(file, text);
  const claims = data.items.map((item, indexValue) => ({ id: `${page.id}:${item.id ?? indexValue + 1}`, section: page.title, statement: item.statement ?? item.summary ?? item.name ?? item.id, classification: item.classification ?? (item.evidence?.length ? 'FACT' : 'UNKNOWN'), confidence: Number(item.confidence ?? (item.evidence?.length ? 1 : 0)), evidence: item.evidence ?? [], sourceModelRefs: [`${data.model}:${item.id ?? indexValue + 1}`] }));
  writeTrace(root, page, claims, inputHash); return { items: data.items.length, hash: sha256(text) };
}
function pageInputHash(page, contextHash) { return stableHash({ page, contextHash }); }
function finalizeProviderTrace(root, page, inputHash, contextId) {
  const file = tracePath(root, page); const trace = validateJson(file); if (!Array.isArray(trace.claims)) throw new Error(`${rel(root, file)} must contain claims[].`);
  const ids = new Set(); for (const claim of trace.claims) { claim.id = String(claim.id ?? `${page.id}:claim-${ids.size + 1}`); if (ids.has(claim.id)) throw new Error(`${page.id}: duplicate claim id ${claim.id}`); ids.add(claim.id); claim.classification = String(claim.classification ?? 'UNKNOWN').toUpperCase(); claim.evidence = Array.isArray(claim.evidence) ? claim.evidence : []; claim.sourceModelRefs = Array.isArray(claim.sourceModelRefs) ? claim.sourceModelRefs : []; }
  trace.schemaVersion = '2.0'; trace.pageId = page.id; trace.pagePath = page.path; trace.pageHash = sha256(fs.readFileSync(path.join(root, page.path))); trace.inputHash = inputHash; trace.contextId = contextId; trace.generatedAt = now(); writeJson(file, trace); return trace;
}
function validatePage(root, page, inputHash = null) {
  const file = path.join(root, page.path); if (!fs.existsSync(file)) throw new Error(`Missing page: ${page.path}`); const text = fs.readFileSync(file, 'utf8');
  if (!/^---\s*\n[\s\S]*?\n---\s*\n/.test(text)) throw new Error(`${page.path}: missing frontmatter`); if (!/^#\s+\S/m.test(text)) throw new Error(`${page.path}: missing H1`); if (/```(?:plantuml|dot|graphviz|puml)/i.test(text)) throw new Error(`${page.path}: non-Mermaid diagram`);
  const traceFile = tracePath(root, page); if (!fs.existsSync(traceFile)) throw new Error(`${page.path}: missing traceability sidecar`); const trace = validateJson(traceFile); if (!Array.isArray(trace.claims)) throw new Error(`${rel(root, traceFile)}: missing claims[]`); if (trace.pageId !== page.id || trace.pagePath !== page.path) throw new Error(`${rel(root, traceFile)}: page identity mismatch`); if (trace.pageHash && trace.pageHash !== sha256(text)) throw new Error(`${rel(root, traceFile)}: stale page hash`); if (inputHash && trace.inputHash !== inputHash) throw new Error(`${rel(root, traceFile)}: stale input hash`);
  return { file, text, trace, hash: sha256(text) };
}

export async function generate(root) {
  const manifest = validateManifest(root); const config = loadConfig(root); const pending = [];
  for (const page of manifest.pages) {
    const deterministic = deterministicKind(page);
    if (deterministic) { const data = referenceData(root, deterministic); const inputHash = stableHash({ page, model: fileSha256(modelPath(root, data.model)) }); const previous = pageState(root, page.id); if (previous.inputHash !== inputHash || !fs.existsSync(path.join(root, page.path)) || !fs.existsSync(tracePath(root, page))) { const result = renderDeterministic(root, page, deterministic, inputHash); updatePage(root, page.id, { status: 'completed', renderer: 'deterministic', inputHash, pageHash: result.hash }); } continue; }
    const context = compileContext(root, { stage: 'generate', target: page.id, query: page.query, maxTokens: config.context?.maxTokens?.generate ?? 30000, metadata: { page } }); const inputHash = pageInputHash(page, context.payload.inputHash); const previous = pageState(root, page.id);
    if (previous.status === 'completed' && previous.inputHash === inputHash) { try { validatePage(root, page, inputHash); continue; } catch {} }
    pending.push({ page, context, inputHash });
  }
  const size = Math.max(1, Number(config.execution?.generationBatchSize ?? 4));
  for (let i = 0; i < pending.length; i += size) {
    const batch = pending.slice(i, i + size); const contract = batch.map(({ page, context, inputHash }) => ({ page, contextPath: rel(root, context.file), outputPath: page.path, traceabilityPath: rel(root, tracePath(root, page)), inputHash, contextId: context.payload.id }));
    await runProvider(root, { stage: 'generate', target: batch.map((item) => item.page.id).join(','), prompt: prompt(root, 'write-pages-indexed.md', { PAGE_CONTRACTS: JSON.stringify(contract, null, 2) }) });
    for (const item of batch) { finalizeProviderTrace(root, item.page, item.inputHash, item.context.payload.id); const checked = validatePage(root, item.page, item.inputHash); updatePage(root, item.page.id, { status: 'completed', renderer: 'provider', inputHash: item.inputHash, pageHash: checked.hash, contextId: item.context.payload.id }); }
  }
  completeStage(root, 'generate', stableHash(manifest.pages.map((page) => pageState(root, page.id).inputHash)), { pages: manifest.pages.length, providerPages: pending.length, deterministicPages: manifest.pages.length - pending.length });
  return { pages: manifest.pages.length, providerPages: pending.length };
}

function deterministicAudit(root, page) {
  const errors = []; const warnings = []; let result;
  try { result = validatePage(root, page, pageState(root, page.id).inputHash); } catch (error) { errors.push(error.message); return { pageId: page.id, errors, warnings, riskScore: 100 }; }
  const inventory = new Set((readJson(projectPaths(root).inventory, {}).files ?? []).map((item) => item.path)); const ids = new Set();
  for (const claim of result.trace.claims) {
    if (ids.has(claim.id)) errors.push(`duplicate claim id: ${claim.id}`); ids.add(claim.id);
    if (claim.classification === 'FACT' && !(claim.evidence ?? []).length) errors.push(`FACT claim without evidence: ${claim.id}`);
    for (const evidence of claim.evidence ?? []) if (evidence.path && !inventory.has(evidence.path)) errors.push(`claim ${claim.id} references non-inventory evidence: ${evidence.path}`);
  }
  if (/\b(?:TODO|TBD|FIXME)\b/i.test(result.text)) warnings.push('Contains unresolved placeholder.');
  if (/\b(?:always|never|guaranteed|must)\b/i.test(result.text) && page.risk !== 'low') warnings.push('Contains normative/absolute wording; verify traceability.');
  const riskScore = (['business','security','decision-record','runbook','migration-guide'].includes(page.type) ? 30 : 0) + (page.risk === 'high' ? 40 : page.risk === 'critical' ? 70 : 0) + warnings.length * 5;
  return { pageId: page.id, path: page.path, pageHash: result.hash, inputHash: pageState(root, page.id).inputHash, errors, warnings, riskScore };
}

export async function audit(root) {
  const paths = projectPaths(root); const manifest = validateManifest(root); const reports = manifest.pages.map((page) => deterministicAudit(root, page)); ensureDir(paths.audit); writeJson(path.join(paths.audit, 'deterministic.json'), { schemaVersion: '2.0', generatedAt: now(), pages: reports });
  const config = loadConfig(root); const threshold = Number(config.audit?.llmRiskThreshold ?? 50); const risky = reports.filter((report) => report.riskScore >= threshold && !report.errors.length); const llmOutput = path.join(paths.audit, 'llm-risk.json');
  let highRiskFindings = 0;
  if (risky.length && config.audit?.llmEnabled !== false) {
    const contexts = risky.map((report) => { const page = manifest.pages.find((item) => item.id === report.pageId); const context = compileContext(root, { stage: 'audit', target: page.id, query: page.query, maxTokens: config.context?.maxTokens?.audit ?? 18000, metadata: { page, report } }); return { page, contextPath: rel(root, context.file), contextId: context.payload.id, pagePath: page.path, report }; });
    const auditInputHash = stableHash(contexts.map((item) => ({ pageId: item.page.id, pageHash: item.report.pageHash, inputHash: item.report.inputHash, contextId: item.contextId })));
    if (!stageCurrent(root, 'auditRisk', auditInputHash, [llmOutput])) {
      await runProvider(root, { stage: 'audit', target: risky.map((report) => report.pageId).join(','), prompt: prompt(root, 'audit-risk-indexed.md', { AUDIT_CONTRACTS: JSON.stringify(contexts, null, 2), OUTPUT_PATH: rel(root, llmOutput) }) });
      const result = validateJson(llmOutput); if (!Array.isArray(result.pages)) throw new Error('Risk audit report must contain pages[].'); completeStage(root, 'auditRisk', auditInputHash, { pages: risky.length });
    }
    const llm = readJson(llmOutput, { pages: [] }); highRiskFindings = (llm.pages ?? []).flatMap((page) => page.findings ?? []).filter((finding) => ['critical','high'].includes(String(finding.severity).toLowerCase())).length;
  }
  const failed = reports.filter((report) => report.errors.length); const pass = failed.length === 0 && highRiskFindings === 0; const summary = { schemaVersion: '2.0', generatedAt: now(), pages: reports.length, deterministicFailures: failed.length, llmAuditedPages: risky.length, highRiskFindings, pass };
  writeJson(path.join(paths.audit, 'quality-summary.json'), summary); if (!pass) throw new Error(`Quality failed: deterministicFailures=${failed.length}, highRiskFindings=${highRiskFindings}.`); completeStage(root, 'audit', stableHash(reports.map((report) => report.pageHash)), summary); return summary;
}

export function publish(root) {
  const paths = projectPaths(root); const manifest = validateManifest(root); ensureDir(paths.publish); const navigation = {}; const search = []; const traces = [];
  for (const page of manifest.pages) { (navigation[page.category] ??= []).push({ id: page.id, title: page.title, path: page.path, order: page.order, summary: page.summary }); const file = path.join(root, page.path); if (fs.existsSync(file)) { const text = fs.readFileSync(file, 'utf8'); search.push({ id: page.id, title: page.title, path: page.path, category: page.category, summary: page.summary, keywords: page.coverageTags, excerpt: text.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) }); } if (fs.existsSync(tracePath(root, page))) { const trace = readJson(tracePath(root, page)); traces.push({ pageId: page.id, pagePath: page.path, pageHash: trace.pageHash, inputHash: trace.inputHash, claims: trace.claims?.length ?? 0 }); } }
  for (const pages of Object.values(navigation)) pages.sort((a, b) => a.order - b.order);
  writeJson(path.join(paths.publish, 'navigation.json'), { schemaVersion: '2.0', generatedAt: now(), navigation }); writeJson(path.join(paths.publish, 'search-index.json'), { schemaVersion: '2.0', generatedAt: now(), pages: search }); writeJson(path.join(paths.traceability, 'index.json'), { schemaVersion: '2.0', generatedAt: now(), pages: traces });
  const lines = [`# ${loadConfig(root).projectName || path.basename(root)}`, '']; for (const [category, pages] of Object.entries(navigation)) { lines.push(`## ${category}`, ''); for (const page of pages) lines.push(`- [${page.title}](${page.path.replace(/^docs\//, '')}) — ${page.summary}`); lines.push(''); }
  ensureDir(paths.docs); fs.writeFileSync(path.join(paths.docs, 'llms.txt'), lines.join('\n').trimEnd() + '\n'); const full = manifest.pages.filter((page) => fs.existsSync(path.join(root, page.path))).map((page) => fs.readFileSync(path.join(root, page.path), 'utf8')).join('\n\n---\n\n'); fs.writeFileSync(path.join(paths.docs, 'llms-full.txt'), full);
  return { pages: search.length, categories: Object.keys(navigation).length, traceabilityPages: traces.length };
}

export function status(root) { return { state: state(root), budget: budgetReport(root), index: fs.existsSync(projectPaths(root).database) ? databaseStats(root) : null }; }
export async function all(root) { index(root); await model(root); await plan(root); await generate(root); await audit(root); const publishing = publish(root); return { publishing, budget: budgetReport(root), snapshot: sourceSnapshot(root) }; }
