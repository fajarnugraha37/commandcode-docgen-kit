import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, now, posix, projectPaths, readJson, sha256, stableHash } from './core.mjs';
import { evidenceFromAliases, normalizeSourceModelRefs, semanticMetadata } from './semantic.mjs';

const GENERIC_FILLER = [
  /\bthis (?:page|document|section) (?:provides|describes|covers) (?:an )?overview\b/i,
  /\bin (?:this|the following) (?:page|document|section),? we (?:will|shall)\b/i,
  /\bmore details (?:will|can) be added\b/i
];
const SECTION_STOPWORDS = new Set(['a','an','and','as','at','by','for','from','in','into','of','on','or','the','to','with','all','used','using','explanation','overview','catalog','inventory','model','strategy','requirements']);

function tracePath(root, page) { return path.join(projectPaths(root).traceability, 'pages', `${page.id}.json`); }
function modelPath(root, name) { return path.join(projectPaths(root).model, `${name}.json`); }
function normalizeText(value) { return String(value ?? '').toLowerCase().replace(/[`*_>#\[\](){}:;,.!?"']/g, ' ').replace(/\s+/g, ' ').trim(); }
function token(value) { return String(value).replace(/ies$/i, 'y').replace(/(?:ing|ed)$/i, '').replace(/s$/i, ''); }
function sectionTokens(value) { return normalizeText(value).split(/\s+/).map(token).filter((item) => item.length > 1 && !SECTION_STOPWORDS.has(item) && !/^\d+$/.test(item)); }
function sectionSatisfied(requirement, headings, text) {
  const exact = normalizeText(requirement); if (!exact) return true;
  if (normalizeText(text).includes(exact)) return true;
  const required = [...new Set(sectionTokens(requirement))];
  return headings.some((heading) => {
    const normalized = normalizeText(heading); if (normalized.includes(exact) || exact.includes(normalized)) return true;
    const available = new Set(sectionTokens(heading));
    if (!required.length) return normalized.includes(exact);
    const matched = required.filter((item) => available.has(item)).length;
    return matched >= Math.min(2, required.length) && matched / required.length >= 0.5;
  });
}
function bodyFingerprint(text) { return sha256(String(text).replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').replace(/^#\s+.*$/m, '').replace(/\s+/g, ' ').trim().toLowerCase()); }
function safeRelative(value) {
  const raw = posix(String(value ?? '').trim()).replace(/^\.\//, '');
  if (!raw || path.posix.isAbsolute(raw) || /^[a-z]:\//i.test(raw)) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}
function state(root) { return readJson(projectPaths(root).state, { stages: {}, pages: {} }); }

function inventoryContext(root) {
  const inventory = readJson(projectPaths(root).inventory, { files: [], excluded: [], fingerprint: null });
  return { inventory, files: new Map((inventory.files ?? []).map((item) => [item.path, item])), excluded: new Map((inventory.excluded ?? []).map((item) => [item.path, item])) };
}
function sourceInfo(root, rel, cache) {
  if (cache.has(rel)) return cache.get(rel);
  const file = path.join(root, rel); if (!fs.existsSync(file)) { cache.set(rel, null); return null; }
  const buffer = fs.readFileSync(file); const text = buffer.toString('utf8'); const value = { hash: sha256(buffer), lines: text.split(/\r?\n/), text }; cache.set(rel, value); return value;
}
function validateEvidence(root, evidence, { inventory, sourceCache, requireLine = false, prefix = 'evidence' }) {
  const errors = []; const warnings = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return { errors: [`${prefix}: must be an object`], warnings };
  const rel = safeRelative(evidence.path); if (!rel) return { errors: [`${prefix}: invalid repository-relative path`], warnings };
  const item = inventory.files.get(rel);
  if (!item) { const excluded = inventory.excluded.get(rel); errors.push(`${prefix}: ${rel} is not in the indexed source inventory${excluded ? ` (${excluded.reason})` : ''}`); return { errors, warnings }; }
  const source = sourceInfo(root, rel, sourceCache); if (!source) { errors.push(`${prefix}: indexed source no longer exists: ${rel}`); return { errors, warnings }; }
  if (item.hash && source.hash !== item.hash) errors.push(`${prefix}: source changed after indexing: ${rel}; run docgen index/resume`);
  const hasStart = evidence.startLine !== undefined && evidence.startLine !== null;
  if (requireLine && !hasStart) errors.push(`${prefix}: FACT evidence requires startLine: ${rel}`);
  if (hasStart) {
    const start = Number(evidence.startLine); const end = Number(evidence.endLine ?? start);
    if (!Number.isInteger(start) || start < 1) errors.push(`${prefix}: invalid startLine for ${rel}`);
    else if (!Number.isInteger(end) || end < start) errors.push(`${prefix}: invalid endLine for ${rel}`);
    else if (end > source.lines.length) errors.push(`${prefix}: line range L${start}-L${end} exceeds ${rel} (${source.lines.length} lines)`);
    else if (!source.lines.slice(start - 1, end).some((line) => line.trim())) warnings.push(`${prefix}: line range is blank in ${rel}#L${start}-L${end}`);
  }
  return { errors, warnings };
}
function dedupeEvidence(entries) {
  const seen = new Set(); return entries.filter((entry) => { const key = `${entry.path}\0${entry.startLine ?? ''}\0${entry.endLine ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function walkModelItems(value, model, out, parent = '') {
  if (Array.isArray(value)) { for (const item of value) walkModelItems(item, model, out, parent); return; }
  if (!value || typeof value !== 'object') return;
  if (value.id || value.name || value.statement) { const semanticId = String(value.id ?? sha256(`${model}\0${parent}\0${JSON.stringify(value)}`).slice(0, 24)); out.push({ ref: `${model}:${semanticId}`, semanticId, model, kind: String(value.kind ?? parent ?? 'item'), value }); }
  for (const [key, child] of Object.entries(value)) if (!['evidence','evidenceRefs','sources','sourceRefs','citations','references','sourceModelRefs','modelRefs'].includes(key)) walkModelItems(child, model, out, key);
}
function auditModels(root, inventory, settings) {
  const paths = projectPaths(root); const errors = []; const warnings = []; const sourceCache = new Map(); const refs = new Map(); const aliases = new Map(); const byModel = {}; const all = [];
  const files = fs.existsSync(paths.model) ? fs.readdirSync(paths.model).filter((name) => name.endsWith('.json') && !name.endsWith('-bundle.json')).sort() : [];
  for (const file of files) {
    const model = path.basename(file, '.json'); const items = []; let document;
    try { document = readJson(modelPath(root, model)); } catch (error) { errors.push(`${model}: invalid JSON: ${error.message}`); continue; }
    walkModelItems(document, model, items); byModel[model] = { items: items.length, facts: 0, errors: 0, warnings: 0 }; const local = new Set();
    items.forEach((item, index) => {
      const prefix = `model ${item.ref}`;
      if (local.has(item.semanticId)) { errors.push(`${prefix}: duplicate id within ${model}`); byModel[model].errors++; return; }
      local.add(item.semanticId); if (refs.has(item.ref)) { errors.push(`${prefix}: duplicate qualified model reference`); byModel[model].errors++; return; }
      item.metadata = semanticMetadata(item.value); refs.set(item.ref, item); aliases.set(`${model}:${index + 1}`, item.ref); all.push(item);
    });
  }
  const resolveRef = (ref) => refs.get(ref) ?? refs.get(aliases.get(ref));
  const resolving = new Set();
  function effectiveEvidence(item) {
    if (item.effectiveEvidence) return item.effectiveEvidence;
    if (resolving.has(item.ref)) return item.metadata.evidence;
    resolving.add(item.ref); const inherited = [];
    for (const ref of item.metadata.sourceModelRefs) { const source = resolveRef(ref); if (source) inherited.push(...effectiveEvidence(source)); }
    resolving.delete(item.ref); item.effectiveEvidence = dedupeEvidence([...item.metadata.evidence, ...inherited]); return item.effectiveEvidence;
  }
  for (const item of all) {
    const prefix = `model ${item.ref}`; const value = item.value; const summary = byModel[item.model];
    const statement = String(value.statement ?? value.summary ?? value.description ?? '').trim(); const name = String(value.name ?? value.title ?? '').trim();
    if (!statement && !name) { warnings.push(`${prefix}: missing name and statement`); summary.warnings++; }
    const evidence = effectiveEvidence(item); item.effectiveClassification = item.metadata.requestedClassification === 'FACT' && evidence.length ? 'FACT' : item.metadata.classification;
    item.effectiveConfidence = item.metadata.confidence;
    if (item.metadata.unsupportedFact && !evidence.length) { warnings.push(`${prefix}: provider FACT had no direct or inherited evidence; treated as INFERENCE`); summary.warnings++; }
    if (item.effectiveClassification === 'FACT') summary.facts++;
    for (let index = 0; index < evidence.length; index++) {
      const result = validateEvidence(root, evidence[index], { inventory, sourceCache, requireLine: item.effectiveClassification === 'FACT' && settings.requireLineEvidenceForFacts, prefix: `${prefix} evidence[${index}]` });
      errors.push(...result.errors); warnings.push(...result.warnings); summary.errors += result.errors.length; summary.warnings += result.warnings.length;
    }
  }
  return { files, refs, aliases, errors, warnings, byModel, items: refs.size, inputHash: stableHash(files.map((name) => [name, sha256(fs.readFileSync(path.join(paths.model, name))) ])) };
}

function contextForPage(root, page, trace) {
  if (!trace.contextId) return null;
  const file = path.join(projectPaths(root).context, 'generate', `${page.id.replace(/[^a-z0-9_.-]+/gi, '-')}.json`); if (!fs.existsSync(file)) return { error: `missing declared generation context for ${page.id}` };
  const value = readJson(file, {}); if (value.id !== trace.contextId) return { error: `context identity mismatch for ${page.id}` };
  const refs = new Set(); const aliases = new Map(); const perModel = new Map(); const evidence = [];
  for (const item of value.modelItems ?? []) { refs.add(item.id); const number = (perModel.get(item.model) ?? 0) + 1; perModel.set(item.model, number); aliases.set(`${item.model}:${number}`, item.id); for (const entry of evidenceFromAliases(item)) evidence.push(entry); }
  for (const fact of value.facts ?? []) evidence.push({ path: fact.path, startLine: fact.metadata?.startLine ?? fact.line, endLine: fact.metadata?.endLine ?? fact.line });
  return { value, refs, aliases, evidence };
}
function evidenceWasSupplied(evidence, supplied) {
  const rel = safeRelative(evidence?.path); if (!rel) return false; const line = Number(evidence.startLine ?? 0);
  return supplied.some((entry) => { if (safeRelative(entry?.path) !== rel) return false; if (!line) return true; const start = Number(entry.startLine ?? 0); const end = Number(entry.endLine ?? start); return !start || (line >= start && line <= end); });
}
function markdownLinks(text) { return [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim().replace(/^<|>$/g, '')); }
function validateLink(root, page, target) {
  if (!target || /^(?:[a-z]+:|#)/i.test(target)) return null; const clean = target.split('#')[0].split('?')[0]; if (!clean) return null;
  const candidate = clean.startsWith('/') ? path.join(root, clean.replace(/^\/+/, '')) : path.resolve(path.dirname(path.join(root, page.path)), clean); const relative = posix(path.relative(root, candidate));
  if (relative === '..' || relative.startsWith('../')) return `link escapes repository: ${target}`; if (!fs.existsSync(candidate)) return `broken local link: ${target}`; return null;
}

function auditPage(root, page, inventory, models, manifestIds, settings) {
  const errors = []; const warnings = []; const pageFile = path.join(root, page.path); const traceFile = tracePath(root, page); const pageState = state(root).pages?.[page.id] ?? {};
  if (!fs.existsSync(pageFile)) return { pageId: page.id, path: page.path, errors: [`missing page: ${page.path}`], warnings, riskScore: 100, claims: 0, evidence: 0, modelRefs: 0 };
  const text = fs.readFileSync(pageFile, 'utf8'); const pageHash = sha256(text);
  if (!/^---\s*\n[\s\S]*?\n---\s*\n/.test(text)) errors.push('missing YAML frontmatter'); if (!/^#\s+\S/m.test(text)) errors.push('missing H1'); if (/```(?:plantuml|dot|graphviz|puml)/i.test(text)) errors.push('contains non-Mermaid diagram');
  if (/\b(?:TODO|TBD|FIXME)\b/i.test(text)) warnings.push('contains unresolved placeholder'); if (GENERIC_FILLER.some((pattern) => pattern.test(text))) warnings.push('contains generic filler language');
  const headings = [...text.matchAll(/^#{2,6}\s+(.+)$/gm)].map((match) => match[1]);
  for (const section of page.requiredSections ?? []) if (!sectionSatisfied(section, headings, text)) (settings.requiredSectionsAsWarnings ? warnings : errors).push(`missing required section: ${section}`);
  for (const related of page.relatedPages ?? []) if (!manifestIds.has(String(related)) && !manifestIds.has(String(related).replace(/\.md$/i, ''))) warnings.push(`unknown related page: ${related}`);
  for (const link of markdownLinks(text)) { const problem = validateLink(root, page, link); if (problem) errors.push(problem); }
  if (!fs.existsSync(traceFile)) return { pageId: page.id, path: page.path, pageHash, inputHash: pageState.inputHash, errors: [...errors, 'missing traceability sidecar'], warnings, riskScore: 100, claims: 0, evidence: 0, modelRefs: 0, bodyHash: bodyFingerprint(text) };
  let trace; try { trace = readJson(traceFile); } catch (error) { return { pageId: page.id, path: page.path, pageHash, inputHash: pageState.inputHash, errors: [...errors, `invalid traceability JSON: ${error.message}`], warnings, riskScore: 100, claims: 0, evidence: 0, modelRefs: 0, bodyHash: bodyFingerprint(text) }; }
  if (trace.pageId !== page.id || trace.pagePath !== page.path) errors.push('traceability page identity mismatch'); if (trace.pageHash !== pageHash) errors.push('stale traceability page hash'); if (!pageState.inputHash) errors.push('missing page checkpoint inputHash'); else if (trace.inputHash !== pageState.inputHash) errors.push('stale traceability input hash');
  const context = contextForPage(root, page, trace); if (context?.error) errors.push(context.error); const claims = Array.isArray(trace.claims) ? trace.claims : []; if (!Array.isArray(trace.claims)) errors.push('traceability claims must be an array');
  const ids = new Set(); const sourceCache = new Map(); const referencedModelRefs = []; let evidenceCount = 0; let modelRefCount = 0;
  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index] ?? {}; const id = String(claim.id ?? '').trim(); const prefix = `claim ${id || index + 1}`;
    if (!id) errors.push(`${prefix}: missing id`); else if (ids.has(id)) errors.push(`${prefix}: duplicate id`); else ids.add(id);
    const rawRefs = normalizeSourceModelRefs(claim.sourceModelRefs ?? claim.modelRefs); const resolved = rawRefs.map((ref) => models.refs.has(ref) ? ref : models.aliases.get(ref) ?? ref); modelRefCount += rawRefs.length;
    const modelItems = resolved.map((ref) => models.refs.get(ref)).filter(Boolean); const fallbackStatement = modelItems.map((item) => String(item.value.statement ?? item.value.summary ?? item.value.description ?? item.value.name ?? '')).find(Boolean);
    const statement = String(claim.statement ?? fallbackStatement ?? '').trim(); if (!statement) errors.push(`${prefix}: missing statement`); else if (!normalizeText(text).includes(normalizeText(statement))) warnings.push(`${prefix}: statement is not directly present in page prose`);
    const metadata = semanticMetadata(claim); const inheritedEvidence = modelItems.flatMap((item) => item.effectiveEvidence ?? []); const evidence = dedupeEvidence([...metadata.evidence, ...inheritedEvidence]); const classification = metadata.requestedClassification === 'FACT' && evidence.length ? 'FACT' : metadata.classification;
    if (metadata.unsupportedFact && !evidence.length) warnings.push(`${prefix}: provider FACT had no direct or inherited evidence; treated as INFERENCE`); evidenceCount += evidence.length;
    for (let evidenceIndex = 0; evidenceIndex < evidence.length; evidenceIndex++) {
      const result = validateEvidence(root, evidence[evidenceIndex], { inventory, sourceCache, requireLine: classification === 'FACT' && settings.requireLineEvidenceForFacts, prefix: `${prefix} evidence[${evidenceIndex}]` }); errors.push(...result.errors); warnings.push(...result.warnings);
      if (settings.requireContextBoundEvidence && context && !context.error && !evidenceWasSupplied(evidence[evidenceIndex], context.evidence)) errors.push(`${prefix}: evidence was not supplied in bounded context: ${evidence[evidenceIndex]?.path ?? '<missing>'}`);
    }
    for (let refIndex = 0; refIndex < rawRefs.length; refIndex++) {
      const raw = rawRefs[refIndex]; const canonical = resolved[refIndex]; if (!models.refs.has(canonical)) errors.push(`${prefix}: unknown sourceModelRef ${raw}`); else referencedModelRefs.push(canonical);
      if (settings.requireContextBoundEvidence && context && !context.error && !context.refs.has(canonical) && context.aliases.get(raw) !== canonical) errors.push(`${prefix}: sourceModelRef was not supplied in bounded context: ${raw}`);
    }
  }
  const riskScore = (['business','security','decision-record','runbook','migration-guide'].includes(page.type) ? 30 : 0) + (page.risk === 'high' ? 40 : page.risk === 'critical' ? 70 : 0) + warnings.length * 5;
  return { pageId: page.id, path: page.path, pageHash, inputHash: pageState.inputHash, bodyHash: bodyFingerprint(text), errors, warnings, riskScore, claims: claims.length, evidence: evidenceCount, modelRefs: modelRefCount, referencedModelRefs };
}

export function auditRepository(root, manifest) {
  const config = loadConfig(root); const settings = { requireLineEvidenceForFacts: config.audit?.requireLineEvidenceForFacts !== false, requireContextBoundEvidence: config.audit?.requireContextBoundEvidence !== false, requiredSectionsAsWarnings: config.audit?.requiredSectionsAsWarnings === true };
  const inventory = inventoryContext(root); const models = auditModels(root, inventory, settings); const manifestIds = new Set(manifest.pages.flatMap((page) => [page.id, page.path, page.path.replace(/^docs\//, '').replace(/\.md$/i, '')]));
  const pages = manifest.pages.map((page) => auditPage(root, page, inventory, models, manifestIds, settings)); const errors = [...models.errors]; const warnings = [...models.warnings];
  for (const page of pages) { errors.push(...page.errors.map((message) => `${page.pageId}: ${message}`)); warnings.push(...page.warnings.map((message) => `${page.pageId}: ${message}`)); }
  const bodyOwners = new Map(); const statementOwners = new Map(); const referenced = new Set();
  for (const page of pages) {
    if (page.bodyHash) { const previous = bodyOwners.get(page.bodyHash); if (previous) errors.push(`duplicate page body: ${previous} and ${page.pageId}`); else bodyOwners.set(page.bodyHash, page.pageId); }
    for (const ref of page.referencedModelRefs ?? []) referenced.add(ref); const trace = fs.existsSync(tracePath(root, { id: page.pageId })) ? readJson(tracePath(root, { id: page.pageId }), {}) : {};
    for (const claim of trace.claims ?? []) { const key = normalizeText(claim.statement); if (!key) continue; const previous = statementOwners.get(key); if (previous && previous !== page.pageId) warnings.push(`duplicate material claim across pages: ${previous} and ${page.pageId}`); else statementOwners.set(key, page.pageId); }
  }
  const traceDir = path.join(projectPaths(root).traceability, 'pages'); if (fs.existsSync(traceDir)) for (const file of fs.readdirSync(traceDir).filter((name) => name.endsWith('.json'))) { const id = path.basename(file, '.json'); if (!manifest.pages.some((page) => page.id === id)) warnings.push(`orphan traceability sidecar: ${file}`); }
  const coverageRatio = models.items ? referenced.size / models.items : 1; const minimumCoverage = Math.max(0, Math.min(1, Number(config.audit?.minModelReferenceCoverage ?? 0))); if (coverageRatio < minimumCoverage) errors.push(`model reference coverage ${(coverageRatio * 100).toFixed(1)}% is below configured ${(minimumCoverage * 100).toFixed(1)}%`); if (config.audit?.failOnWarnings === true && warnings.length) errors.push(`audit.failOnWarnings=true and ${warnings.length} warning(s) were found`);
  const metrics = { pages: pages.length, claims: pages.reduce((sum, page) => sum + page.claims, 0), evidenceReferences: pages.reduce((sum, page) => sum + page.evidence, 0), modelItems: models.items, referencedModelItems: referenced.size, modelReferenceCoverage: Number(coverageRatio.toFixed(4)), errors: errors.length, warnings: warnings.length };
  const inventoryFingerprint = inventory.inventory.fingerprint ?? null; const manifestHash = stableHash(manifest.pages); const auditInputHash = stableHash({ inventoryFingerprint, manifestHash, modelInputHash: models.inputHash, pages: pages.map((page) => [page.pageId, page.pageHash, page.inputHash]) });
  return { schemaVersion: '2.0', generatedAt: now(), inventoryFingerprint, manifestHash, modelInputHash: models.inputHash, auditInputHash, pass: errors.length === 0, metrics, models: { files: models.files, byModel: models.byModel, errors: models.errors, warnings: models.warnings }, pages, errors, warnings };
}
