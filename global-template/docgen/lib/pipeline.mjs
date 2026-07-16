import fs from 'node:fs';
import path from 'node:path';
import { compileContext } from './context.mjs';
import { budgetReport, runProvider } from './provider.mjs';
import { buildInventory } from './inventory.mjs';
import { databaseStats, indexRepository, ingestModels } from './indexer.mjs';
import { ensureDir, fileSha256, kitVersion, loadConfig, now, projectPaths, readJson, rel, sha256, slug, sourceSnapshot, stableHash, updateStage, writeJson } from './core.mjs';

const MODEL_FILES = ['system','business','flows','catalogs','security','operations','testing','data-governance','decisions','configuration','change-impact','ownership'];

function prompt(root, name, vars = {}) {
  const file = path.join(projectPaths(root).root, '.docgen', 'prompts', name);
  const fallback = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'prompts', name);
  let text = fs.readFileSync(fs.existsSync(file) ? file : fallback, 'utf8');
  for (const [key, value] of Object.entries(vars)) text = text.replaceAll(`{{${key}}}`, String(value));
  return text;
}
function state(root) { return readJson(projectPaths(root).state, { schemaVersion: '2.0', kitVersion, stages: {}, pages: {} }); }
function writeState(root, next) { writeJson(projectPaths(root).state, { ...next, schemaVersion: '2.0', kitVersion, updatedAt: now() }); }
function stageCurrent(root, stage, inputHash, outputs = []) {
  const s = state(root).stages?.[stage]; return s?.status === 'completed' && s.inputHash === inputHash && outputs.every((file) => fs.existsSync(file));
}
function completeStage(root, stage, inputHash, details = {}) { const s = state(root); s.stages ??= {}; s.stages[stage] = { status: 'completed', completedAt: now(), inputHash, ...details }; writeState(root, s); }
function failStage(root, stage, error) { const s = state(root); s.stages ??= {}; s.stages[stage] = { status: 'failed', failedAt: now(), error: error.message }; writeState(root, s); }
function pageState(root, id) { return state(root).pages?.[id] ?? {}; }
function updatePage(root, id, patch) { const s = state(root); s.pages ??= {}; s.pages[id] = { ...(s.pages[id] ?? {}), ...patch, updatedAt: now() }; writeState(root, s); }
function modelPath(root, name) { return path.join(projectPaths(root).model, `${name}.json`); }
function validateJson(file) { const value = readJson(file); if (!value || typeof value !== 'object') throw new Error(`Invalid JSON object: ${rel(path.dirname(projectPaths(file).root), file)}`); return value; }

export function index(root, options = {}) {
  updateStage(root, 'index', 'running');
  try { const result = indexRepository(root, options); completeStage(root, 'index', result.inventoryFingerprint, result); return result; }
  catch (error) { failStage(root, 'index', error); throw error; }
}

function splitBundle(root, bundle, names) {
  ensureDir(projectPaths(root).model);
  for (const name of names) {
    const value = bundle[name] ?? bundle[name.replaceAll('-', '')] ?? bundle[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    if (!value || typeof value !== 'object') throw new Error(`Model bundle is missing object: ${name}`);
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
  index(root); await synthesizeBundle(root, 'modelCore', ['system','business','flows','catalogs'], 'repository architecture domain business lifecycle interfaces endpoints messages dependencies data');
  await synthesizeBundle(root, 'modelEnterprise', ['security','operations','testing','data-governance','decisions','configuration','change-impact','ownership'], 'security operations testing governance configuration ownership decisions change impact transactions consistency');
  return ingestModels(root);
}

function normalizePage(page, index) {
  const id = slug(page.id ?? page.title ?? `page-${index + 1}`); const category = slug(page.category ?? page.type ?? 'overview');
  return { id, title: String(page.title ?? id.replaceAll('-', ' ')), summary: String(page.summary ?? page.purpose ?? ''), category, path: `docs/${category}/${slug(page.slug ?? page.title ?? id)}.md`, mode: String(page.mode ?? 'explanation'), type: String(page.type ?? 'explanation'), order: Number(page.order ?? index + 1), audience: Array.isArray(page.audience) ? page.audience : ['engineer'], coverageTags: Array.isArray(page.coverageTags) ? page.coverageTags : [], query: String(page.query ?? [page.title, page.summary, ...(page.coverageTags ?? [])].join(' ')), requiredSections: Array.isArray(page.requiredSections) ? page.requiredSections : [], risk: String(page.risk ?? 'normal'), relatedPages: Array.isArray(page.relatedPages) ? page.relatedPages : [] };
}
function validateManifest(root) {
  const paths = projectPaths(root); const manifest = readJson(paths.plan); if (!Array.isArray(manifest.pages) || !manifest.pages.length) throw new Error('Manifest must contain non-empty pages[].');
  manifest.pages = manifest.pages.map(normalizePage); const ids = new Set(); const files = new Set();
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

function frontmatter(page) {
  return ['---',`title: ${JSON.stringify(page.title)}`,`description: ${JSON.stringify(page.summary)}`,`pageId: ${JSON.stringify(page.id)}`,`category: ${JSON.stringify(page.category)}`,`mode: ${JSON.stringify(page.mode)}`,`type: ${JSON.stringify(page.type)}`,`order: ${page.order}`,'---',''].join('\n');
}
function markdownTable(headers, rows) { return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map((x) => String(x ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`).join('\n')}\n`; }
function deterministicKind(page) {
  const tags = new Set(page.coverageTags);
  if (tags.has('endpoint-catalog')) return 'endpoints'; if (tags.has('message-handler-catalog')) return 'messages'; if (tags.has('configuration-matrix')) return 'configuration'; if (tags.has('ownership-responsibilities')) return 'ownership'; if (tags.has('change-impact')) return 'change-impact'; return null;
}
function renderDeterministic(root, page, kind) {
  let items = []; let headers = []; let rows = [];
  if (kind === 'endpoints') { items = readJson(modelPath(root, 'catalogs'), {}).endpoints ?? []; headers = ['Endpoint','Method','Path','Evidence']; rows = items.map((x) => [x.name ?? x.id, x.method ?? x.httpMethod ?? '', x.path ?? x.route ?? '', (x.evidence ?? []).map((e) => e.path).join(', ')]); }
  if (kind === 'messages') { items = readJson(modelPath(root, 'catalogs'), {}).messageHandlers ?? []; headers = ['Handler','Direction','Channel','Evidence']; rows = items.map((x) => [x.name ?? x.id, x.direction ?? x.role ?? '', x.topic ?? x.queue ?? x.channel ?? '', (x.evidence ?? []).map((e) => e.path).join(', ')]); }
  if (kind === 'configuration') { items = Object.values(readJson(modelPath(root, 'configuration'), {})).filter(Array.isArray).flat(); headers = ['Setting','Kind','Statement','Evidence']; rows = items.map((x) => [x.name ?? x.id, x.kind ?? '', x.statement ?? '', (x.evidence ?? []).map((e) => e.path).join(', ')]); }
  if (kind === 'ownership') { items = Object.values(readJson(modelPath(root, 'ownership'), {})).filter(Array.isArray).flat(); headers = ['Owner / Scope','Kind','Responsibility','Evidence']; rows = items.map((x) => [x.name ?? x.id, x.kind ?? '', x.statement ?? '', (x.evidence ?? []).map((e) => e.path).join(', ')]); }
  if (kind === 'change-impact') { items = Object.values(readJson(modelPath(root, 'change-impact'), {})).filter(Array.isArray).flat(); headers = ['Surface','Kind','Impact','Evidence']; rows = items.map((x) => [x.name ?? x.id, x.kind ?? '', x.statement ?? '', (x.evidence ?? []).map((e) => e.path).join(', ')]); }
  const text = `${frontmatter(page)}# ${page.title}\n\n${page.summary}\n\n${markdownTable(headers, rows)}\n`; const file = path.join(root, page.path); ensureDir(path.dirname(file)); fs.writeFileSync(file, text); return { items: items.length, hash: sha256(text) };
}
function pageInputHash(page, contextHash) { return stableHash({ page, contextHash }); }
function validatePage(root, page) { const file = path.join(root, page.path); if (!fs.existsSync(file)) throw new Error(`Missing page: ${page.path}`); const text = fs.readFileSync(file, 'utf8'); if (!/^---\s*\n[\s\S]*?\n---\s*\n/.test(text)) throw new Error(`${page.path}: missing frontmatter`); if (!/^#\s+\S/m.test(text)) throw new Error(`${page.path}: missing H1`); if (/```(?:plantuml|dot|graphviz|puml)/i.test(text)) throw new Error(`${page.path}: non-Mermaid diagram`); return { file, text, hash: sha256(text) }; }

export async function generate(root) {
  const manifest = validateManifest(root); const config = loadConfig(root); const pending = [];
  for (const page of manifest.pages) {
    const deterministic = deterministicKind(page);
    if (deterministic) { const inputHash = stableHash({ page, model: fileSha256(modelPath(root, deterministic === 'endpoints' || deterministic === 'messages' ? 'catalogs' : deterministic)) }); if (pageState(root, page.id).inputHash !== inputHash || !fs.existsSync(path.join(root, page.path))) { const result = renderDeterministic(root, page, deterministic); updatePage(root, page.id, { status: 'completed', renderer: 'deterministic', inputHash, pageHash: result.hash }); } continue; }
    const context = compileContext(root, { stage: 'generate', target: page.id, query: page.query, maxTokens: config.context?.maxTokens?.generate ?? 30000, metadata: { page } }); const inputHash = pageInputHash(page, context.payload.inputHash); const previous = pageState(root, page.id);
    if (previous.status === 'completed' && previous.inputHash === inputHash && fs.existsSync(path.join(root, page.path))) continue;
    pending.push({ page, context, inputHash });
  }
  const size = Math.max(1, Number(config.execution?.generationBatchSize ?? 4));
  for (let i = 0; i < pending.length; i += size) {
    const batch = pending.slice(i, i + size); const contract = batch.map(({ page, context }) => ({ page, contextPath: rel(root, context.file), outputPath: page.path }));
    await runProvider(root, { stage: 'generate', target: batch.map((x) => x.page.id).join(','), prompt: prompt(root, 'write-pages-indexed.md', { PAGE_CONTRACTS: JSON.stringify(contract, null, 2) }) });
    for (const item of batch) { const checked = validatePage(root, item.page); updatePage(root, item.page.id, { status: 'completed', renderer: 'provider', inputHash: item.inputHash, pageHash: checked.hash }); }
  }
  completeStage(root, 'generate', stableHash(manifest.pages.map((p) => pageState(root, p.id).inputHash)), { pages: manifest.pages.length, providerPages: pending.length, deterministicPages: manifest.pages.length - pending.length });
  return { pages: manifest.pages.length, providerPages: pending.length };
}

function deterministicAudit(root, page) {
  const errors = []; const warnings = []; let result;
  try { result = validatePage(root, page); } catch (error) { errors.push(error.message); return { pageId: page.id, errors, warnings, riskScore: 100 }; }
  const text = result.text; if (/\b(?:TODO|TBD|FIXME)\b/i.test(text)) warnings.push('Contains unresolved placeholder.');
  if (/\b(?:always|never|guaranteed|must)\b/i.test(text) && page.risk !== 'low') warnings.push('Contains normative/absolute wording; verify traceability.');
  const riskScore = (['business','security','decision-record','runbook','migration-guide'].includes(page.type) ? 30 : 0) + (page.risk === 'high' ? 40 : page.risk === 'critical' ? 70 : 0) + warnings.length * 5;
  return { pageId: page.id, path: page.path, pageHash: result.hash, errors, warnings, riskScore };
}

export async function audit(root) {
  const paths = projectPaths(root); const manifest = validateManifest(root); const reports = manifest.pages.map((page) => deterministicAudit(root, page)); ensureDir(paths.audit); writeJson(path.join(paths.audit, 'deterministic.json'), { schemaVersion: '2.0', generatedAt: now(), pages: reports });
  const threshold = Number(loadConfig(root).audit?.llmRiskThreshold ?? 50); const risky = reports.filter((x) => x.riskScore >= threshold && !x.errors.length);
  if (risky.length && loadConfig(root).audit?.llmEnabled !== false) {
    const contexts = risky.map((report) => { const page = manifest.pages.find((x) => x.id === report.pageId); const context = compileContext(root, { stage: 'audit', target: page.id, query: page.query, maxTokens: loadConfig(root).context?.maxTokens?.audit ?? 18000, metadata: { page, report } }); return { page, contextPath: rel(root, context.file), pagePath: page.path, report }; });
    await runProvider(root, { stage: 'audit', target: risky.map((x) => x.pageId).join(','), prompt: prompt(root, 'audit-risk-indexed.md', { AUDIT_CONTRACTS: JSON.stringify(contexts, null, 2), OUTPUT_PATH: '.docgen/audit/llm-risk.json' }) });
  }
  const failed = reports.filter((x) => x.errors.length); const summary = { schemaVersion: '2.0', generatedAt: now(), pages: reports.length, deterministicFailures: failed.length, llmAuditedPages: risky.length, pass: failed.length === 0 };
  writeJson(path.join(paths.audit, 'quality-summary.json'), summary); if (failed.length) throw new Error(`Quality failed for ${failed.length} page(s).`); completeStage(root, 'audit', stableHash(reports.map((x) => x.pageHash)), summary); return summary;
}

export function publish(root) {
  const paths = projectPaths(root); const manifest = validateManifest(root); ensureDir(paths.publish); const navigation = {}; const search = [];
  for (const page of manifest.pages) { (navigation[page.category] ??= []).push({ id: page.id, title: page.title, path: page.path, order: page.order, summary: page.summary }); const file = path.join(root, page.path); if (fs.existsSync(file)) { const text = fs.readFileSync(file, 'utf8'); search.push({ id: page.id, title: page.title, path: page.path, category: page.category, summary: page.summary, keywords: page.coverageTags, excerpt: text.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) }); } }
  for (const pages of Object.values(navigation)) pages.sort((a, b) => a.order - b.order);
  writeJson(path.join(paths.publish, 'navigation.json'), { schemaVersion: '2.0', generatedAt: now(), navigation }); writeJson(path.join(paths.publish, 'search-index.json'), { schemaVersion: '2.0', generatedAt: now(), pages: search });
  const lines = [`# ${loadConfig(root).projectName || path.basename(root)}`, '']; for (const [category, pages] of Object.entries(navigation)) { lines.push(`## ${category}`, ''); for (const page of pages) lines.push(`- [${page.title}](${page.path.replace(/^docs\//, '')}) — ${page.summary}`); lines.push(''); }
  ensureDir(paths.docs); fs.writeFileSync(path.join(paths.docs, 'llms.txt'), lines.join('\n').trimEnd() + '\n'); const full = manifest.pages.filter((p) => fs.existsSync(path.join(root, p.path))).map((p) => fs.readFileSync(path.join(root, p.path), 'utf8')).join('\n\n---\n\n'); fs.writeFileSync(path.join(paths.docs, 'llms-full.txt'), full);
  return { pages: search.length, categories: Object.keys(navigation).length };
}

export function status(root) { return { state: state(root), budget: budgetReport(root), index: fs.existsSync(projectPaths(root).database) ? databaseStats(root) : null }; }
export async function all(root) { index(root); await model(root); await plan(root); await generate(root); await audit(root); const publishing = publish(root); return { publishing, budget: budgetReport(root), snapshot: sourceSnapshot(root) }; }
