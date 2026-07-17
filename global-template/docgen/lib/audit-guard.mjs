import fs from 'node:fs';
import path from 'node:path';
import { auditRepository } from './quality.mjs';
import {
  ensureDir,
  loadConfig,
  now,
  posix,
  projectPaths,
  readJson,
  sha256,
  updateStage,
  writeJson
} from './core.mjs';
import {
  evidenceFromAliases,
  normalizeClassification,
  normalizeConfidence,
  normalizeEvidence,
  normalizeSourceModelRefs
} from './semantic.mjs';

const EVIDENCE_ALIAS_KEYS = ['evidenceRefs', 'sources', 'sourceRefs', 'citations', 'references'];

function safeRelative(value) {
  const raw = posix(String(value ?? '').trim()).replace(/^\.\//, '');
  if (!raw || path.posix.isAbsolute(raw) || /^[a-z]:\//i.test(raw)) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function inventoryContext(root) {
  const inventory = readJson(projectPaths(root).inventory, { files: [], excluded: [] });
  return {
    inventory,
    files: new Map((inventory.files ?? []).map((item) => [safeRelative(item.path), item]).filter(([name]) => name))
  };
}

function sourceRecord(root, relative, inventory, cache) {
  if (cache.has(relative)) return cache.get(relative);
  const indexed = inventory.files.get(relative);
  if (!indexed) {
    const result = { usable: false, stale: false, reason: 'outside-inventory' };
    cache.set(relative, result);
    return result;
  }
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    const result = { usable: false, stale: true, reason: 'missing-indexed-source' };
    cache.set(relative, result);
    return result;
  }
  const buffer = fs.readFileSync(file);
  const text = buffer.toString('utf8');
  const hash = sha256(buffer);
  const result = {
    usable: !indexed.hash || indexed.hash === hash,
    stale: Boolean(indexed.hash && indexed.hash !== hash),
    reason: indexed.hash && indexed.hash !== hash ? 'source-changed' : null,
    lines: text.split(/\r?\n/).length
  };
  cache.set(relative, result);
  return result;
}

function canonicalEvidence(root, raw, inventory, cache) {
  const normalized = normalizeEvidence(raw)[0];
  const relative = safeRelative(normalized?.path);
  if (!relative) return null;
  const source = sourceRecord(root, relative, inventory, cache);
  if (source.stale) return { ...normalized, path: relative, __stale: true };
  if (!source.usable) return null;
  const startLine = normalized.startLine;
  const endLine = normalized.endLine ?? startLine;
  if (startLine !== undefined) {
    if (!Number.isInteger(startLine) || startLine < 1) return null;
    if (!Number.isInteger(endLine) || endLine < startLine || endLine > source.lines) return null;
  }
  return { path: relative, ...(startLine ? { startLine, endLine } : {}) };
}

function evidenceKey(value) {
  return `${value.path}\0${value.startLine ?? ''}\0${value.endLine ?? ''}`;
}

function dedupeEvidence(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = evidenceKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchingAllowedEvidence(requested, allowed) {
  const relative = safeRelative(requested?.path);
  if (!relative) return null;
  const candidates = allowed.filter((entry) => entry.path === relative && !entry.__stale);
  if (!candidates.length) return null;
  if (!requested.startLine) return candidates[0];
  return candidates.find((entry) => {
    if (!entry.startLine) return true;
    const end = entry.endLine ?? entry.startLine;
    return requested.startLine >= entry.startLine && requested.startLine <= end;
  }) ?? null;
}

function removeEvidenceAliases(value) {
  for (const key of EVIDENCE_ALIAS_KEYS) delete value[key];
}

function sanitizeSemanticObject(root, value, inventory, sourceCache) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let changed = false;
  if (value.id || value.name || value.statement) {
    const before = JSON.stringify({
      classification: value.classification,
      confidence: value.confidence,
      evidence: evidenceFromAliases(value),
      aliases: EVIDENCE_ALIAS_KEYS.map((key) => value[key])
    });
    const evidence = dedupeEvidence(evidenceFromAliases(value)
      .map((entry) => canonicalEvidence(root, entry, inventory, sourceCache))
      .filter(Boolean));
    const requested = normalizeClassification(value.classification ?? value.claimClassification ?? value.certainty);
    const hasLineEvidence = evidence.some((entry) => entry.startLine && !entry.__stale);
    value.classification = requested === 'FACT' && !hasLineEvidence ? 'INFERENCE' : requested;
    value.confidence = normalizeConfidence(value.confidence ?? value.confidenceScore, value.classification);
    if (value.classification !== 'FACT') value.confidence = Math.min(value.confidence, 0.7);
    value.evidence = evidence.map(({ __stale, ...entry }) => entry);
    removeEvidenceAliases(value);
    delete value.claimClassification;
    delete value.certainty;
    if (before !== JSON.stringify({
      classification: value.classification,
      confidence: value.confidence,
      evidence: value.evidence,
      aliases: EVIDENCE_ALIAS_KEYS.map((key) => value[key])
    })) changed = true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['evidence', 'sourceModelRefs', 'modelRefs', ...EVIDENCE_ALIAS_KEYS].includes(key)) continue;
    if (Array.isArray(child)) {
      for (const item of child) changed = sanitizeSemanticObject(root, item, inventory, sourceCache) || changed;
    } else if (child && typeof child === 'object') {
      changed = sanitizeSemanticObject(root, child, inventory, sourceCache) || changed;
    }
  }
  return changed;
}

function sanitizeModels(root, inventory, sourceCache) {
  const directory = projectPaths(root).model;
  if (!fs.existsSync(directory)) return { files: 0, changed: 0 };
  let files = 0; let changed = 0;
  for (const name of fs.readdirSync(directory).filter((item) => item.endsWith('.json') && !item.endsWith('-bundle.json'))) {
    const file = path.join(directory, name);
    const document = readJson(file, null);
    if (!document || typeof document !== 'object' || Array.isArray(document)) continue;
    files++;
    if (sanitizeSemanticObject(root, document, inventory, sourceCache)) {
      writeJson(file, document);
      changed++;
    }
  }
  return { files, changed };
}

function contextEvidence(root, context, inventory, sourceCache) {
  const values = [];
  for (const item of context.modelItems ?? []) values.push(...evidenceFromAliases(item));
  for (const fact of context.facts ?? []) values.push({
    path: fact.path,
    startLine: fact.metadata?.startLine ?? fact.line,
    endLine: fact.metadata?.endLine ?? fact.line
  });
  return dedupeEvidence(values
    .map((entry) => canonicalEvidence(root, entry, inventory, sourceCache))
    .filter(Boolean));
}

function sanitizeTrace(root, page, inventory, sourceCache) {
  const paths = projectPaths(root);
  const traceFile = path.join(paths.traceability, 'pages', `${page.id}.json`);
  if (!fs.existsSync(traceFile)) return { changed: false, droppedEvidence: 0, droppedRefs: 0, droppedClaims: 0 };
  const contextFile = path.join(paths.context, 'generate', `${page.id.replace(/[^a-z0-9_.-]+/gi, '-')}.json`);
  if (!fs.existsSync(contextFile)) return { changed: false, droppedEvidence: 0, droppedRefs: 0, droppedClaims: 0 };
  const trace = readJson(traceFile, {});
  const context = readJson(contextFile, {});
  if (!Array.isArray(trace.claims)) return { changed: false, droppedEvidence: 0, droppedRefs: 0, droppedClaims: 0 };

  const modelItems = new Map(); const aliases = new Map(); const perModel = new Map();
  for (const item of context.modelItems ?? []) {
    modelItems.set(item.id, item);
    const ordinal = (perModel.get(item.model) ?? 0) + 1;
    perModel.set(item.model, ordinal);
    aliases.set(`${item.model}:${ordinal}`, item.id);
  }
  const allowedEvidence = contextEvidence(root, context, inventory, sourceCache);
  const ids = new Map(); const claims = [];
  let droppedEvidence = 0; let droppedRefs = 0; let droppedClaims = 0;

  for (const rawClaim of trace.claims) {
    const claim = rawClaim && typeof rawClaim === 'object' ? { ...rawClaim } : {};
    const baseId = String(claim.id ?? `${page.id}:claim-${claims.length + 1}`).trim() || `${page.id}:claim-${claims.length + 1}`;
    const occurrence = (ids.get(baseId) ?? 0) + 1; ids.set(baseId, occurrence);
    claim.id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`;

    const requestedRefs = normalizeSourceModelRefs(claim.sourceModelRefs ?? claim.modelRefs).map((ref) => aliases.get(ref) ?? ref);
    const refs = [...new Set(requestedRefs.filter((ref) => modelItems.has(ref)))];
    droppedRefs += requestedRefs.length - refs.length;
    const inherited = refs.flatMap((ref) => evidenceFromAliases(modelItems.get(ref)))
      .map((entry) => canonicalEvidence(root, entry, inventory, sourceCache))
      .filter(Boolean);
    const requestedEvidence = evidenceFromAliases(claim);
    const direct = requestedEvidence.map((entry) => matchingAllowedEvidence(entry, allowedEvidence)).filter(Boolean);
    droppedEvidence += requestedEvidence.length - direct.length;
    const evidence = dedupeEvidence([...direct, ...inherited]).filter((entry) => !entry.__stale);
    const fallbackStatement = refs.map((ref) => {
      const item = modelItems.get(ref);
      return String(item?.statement ?? item?.payload?.statement ?? item?.name ?? '').trim();
    }).find(Boolean);
    claim.statement = String(claim.statement ?? fallbackStatement ?? '').trim();
    if (!claim.statement) { droppedClaims++; continue; }

    const requestedClassification = normalizeClassification(claim.classification ?? claim.claimClassification ?? claim.certainty);
    const hasLineEvidence = evidence.some((entry) => entry.startLine);
    claim.classification = requestedClassification === 'FACT' && !hasLineEvidence ? 'INFERENCE' : requestedClassification;
    claim.confidence = normalizeConfidence(claim.confidence ?? claim.confidenceScore, claim.classification);
    if (claim.classification !== 'FACT') claim.confidence = Math.min(claim.confidence, 0.7);
    claim.evidence = evidence.map(({ __stale, ...entry }) => entry);
    claim.sourceModelRefs = refs;
    delete claim.modelRefs;
    delete claim.claimClassification;
    delete claim.certainty;
    removeEvidenceAliases(claim);
    claims.push(claim);
  }

  const before = JSON.stringify(trace.claims);
  trace.claims = claims;
  const changed = before !== JSON.stringify(claims);
  if (changed) writeJson(traceFile, trace);
  return { changed, droppedEvidence, droppedRefs, droppedClaims };
}

export function sanitizeAuditInputs(root, manifest) {
  const inventory = inventoryContext(root);
  const sourceCache = new Map();
  const models = sanitizeModels(root, inventory, sourceCache);
  const traces = { files: 0, changed: 0, droppedEvidence: 0, droppedRefs: 0, droppedClaims: 0 };
  for (const page of manifest.pages ?? []) {
    const result = sanitizeTrace(root, page, inventory, sourceCache);
    traces.files++;
    if (result.changed) traces.changed++;
    traces.droppedEvidence += result.droppedEvidence;
    traces.droppedRefs += result.droppedRefs;
    traces.droppedClaims += result.droppedClaims;
  }
  return { models, traces };
}

function deterministicSummary(quality, sanitation) {
  return {
    schemaVersion: '2.0',
    generatedAt: now(),
    auditInputHash: quality.auditInputHash,
    inventoryFingerprint: quality.inventoryFingerprint,
    manifestHash: quality.manifestHash,
    pages: quality.metrics.pages,
    claims: quality.metrics.claims,
    evidenceReferences: quality.metrics.evidenceReferences,
    modelItems: quality.metrics.modelItems,
    referencedModelItems: quality.metrics.referencedModelItems,
    modelReferenceCoverage: quality.metrics.modelReferenceCoverage,
    deterministicFailures: quality.errors.length,
    deterministicWarnings: quality.warnings.length,
    llmAuditedPages: 0,
    highRiskFindings: 0,
    llmSkippedReason: 'deterministic-fail-fast',
    sanitation,
    pass: false
  };
}

export async function guardedAudit(root, baseAudit) {
  const paths = projectPaths(root);
  ensureDir(paths.audit);
  const manifest = readJson(paths.plan);
  updateStage(root, 'audit', 'running', { mode: 'deterministic-preflight' });
  try {
    const sanitation = sanitizeAuditInputs(root, manifest);
    const quality = auditRepository(root, manifest);
    writeJson(path.join(paths.audit, 'deterministic.json'), quality);
    if (!quality.pass) {
      const summary = deterministicSummary(quality, sanitation);
      writeJson(path.join(paths.audit, 'quality-summary.json'), summary);
      const error = new Error(`Quality failed before LLM audit: deterministicFailures=${quality.errors.length}, highRiskFindings=0. No audit-provider tokens were spent. See .docgen/audit/deterministic.json.`);
      updateStage(root, 'audit', 'failed', { error: error.message, inputHash: quality.auditInputHash, deterministicFailures: quality.errors.length, llmAuditSkipped: true, sanitation });
      throw error;
    }
    return await baseAudit(root);
  } catch (error) {
    const current = readJson(paths.state, { stages: {} }).stages?.audit;
    if (current?.status !== 'failed') updateStage(root, 'audit', 'failed', { error: error.message });
    throw error;
  }
}
