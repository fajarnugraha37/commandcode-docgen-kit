const CLASSIFICATIONS = new Set(['FACT', 'INFERENCE', 'ASSUMPTION', 'UNKNOWN']);
const CLASSIFICATION_ALIASES = new Map([
  ['OBSERVED', 'FACT'], ['EVIDENCED', 'FACT'], ['DIRECT', 'FACT'], ['VERIFIED', 'FACT'],
  ['INFERRED', 'INFERENCE'], ['DERIVED', 'INFERENCE'], ['LIKELY', 'INFERENCE'],
  ['ASSUMED', 'ASSUMPTION'], ['HYPOTHESIS', 'ASSUMPTION'], ['HYPOTHETICAL', 'ASSUMPTION'],
  ['UNVERIFIED', 'UNKNOWN'], ['UNCERTAIN', 'UNKNOWN'], ['NOT_KNOWN', 'UNKNOWN']
]);

function firstScalar(value) {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of ['value', 'label', 'type', 'kind', 'classification', 'status']) {
    const candidate = value[key];
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate;
  }
  return null;
}

export function normalizeClassification(value) {
  const scalar = firstScalar(value);
  if (scalar === null) return 'UNKNOWN';
  const normalized = String(scalar).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (CLASSIFICATIONS.has(normalized)) return normalized;
  return CLASSIFICATION_ALIASES.get(normalized) ?? 'UNKNOWN';
}

export function normalizeConfidence(value, classification = 'UNKNOWN') {
  const defaults = { FACT: 1, INFERENCE: 0.7, ASSUMPTION: 0.4, UNKNOWN: 0 };
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    const labels = { certain: 1, very_high: 0.95, 'very high': 0.95, high: 0.85, medium: 0.6, moderate: 0.6, low: 0.3, very_low: 0.15, 'very low': 0.15, unknown: 0 };
    if (Object.hasOwn(labels, text)) return labels[text];
    const percentage = text.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (percentage) return Math.max(0, Math.min(1, Number(percentage[1]) / 100));
  }
  let number = Number(value);
  if (Number.isFinite(number)) {
    if (number > 1 && number <= 100) number /= 100;
    if (number >= 0 && number <= 1) return number;
  }
  return defaults[normalizeClassification(classification)] ?? 0;
}

function normalizeLine(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function evidenceFromString(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/i);
  const path = String(match?.[1] ?? text).trim().replace(/^\.\//, '');
  if (!path) return null;
  const startLine = normalizeLine(match?.[2]);
  const endLine = normalizeLine(match?.[3]) ?? startLine;
  return { path, ...(startLine ? { startLine, endLine } : {}) };
}

function evidenceFromObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nested = value.source ?? value.location ?? value.file;
  if (!value.path && nested && typeof nested === 'object') return evidenceFromObject({ ...nested, ...value, source: undefined, location: undefined, file: undefined });
  const rawPath = value.path ?? value.filePath ?? value.sourcePath ?? value.repositoryPath ?? (typeof value.file === 'string' ? value.file : undefined);
  if (!rawPath) return null;
  const path = String(rawPath).trim().replace(/^\.\//, '');
  if (!path) return null;
  const startLine = normalizeLine(value.startLine ?? value.line ?? value.lineStart ?? value.fromLine ?? value.start);
  const endLine = normalizeLine(value.endLine ?? value.lineEnd ?? value.toLine ?? value.end) ?? startLine;
  return {
    path,
    ...(startLine ? { startLine, endLine } : {}),
    ...(value.symbol ? { symbol: String(value.symbol) } : {}),
    ...(value.note ? { note: String(value.note) } : {})
  };
}

export function normalizeEvidence(value) {
  const input = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out = []; const seen = new Set();
  for (const entry of input.flat(Infinity)) {
    const normalized = typeof entry === 'string' ? evidenceFromString(entry) : evidenceFromObject(entry);
    if (!normalized) continue;
    const key = `${normalized.path}\0${normalized.startLine ?? ''}\0${normalized.endLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(normalized);
  }
  return out;
}

export function evidenceFromAliases(value) {
  if (!value || typeof value !== 'object') return [];
  for (const key of ['evidence', 'evidenceRefs', 'sources', 'sourceRefs', 'citations', 'references']) {
    const normalized = normalizeEvidence(value[key]);
    if (normalized.length) return normalized;
  }
  return [];
}

export function normalizeSourceModelRefs(value) {
  const input = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(input.flat(Infinity).map((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
    if (entry && typeof entry === 'object') return String(entry.id ?? entry.ref ?? entry.modelRef ?? '').trim();
    return '';
  }).filter(Boolean))];
}

export function semanticMetadata(value) {
  const evidence = evidenceFromAliases(value);
  const rawClassification = value?.classification ?? value?.claimClassification ?? value?.certainty;
  const classification = normalizeClassification(rawClassification);
  const sourceModelRefs = normalizeSourceModelRefs(value?.sourceModelRefs ?? value?.modelRefs ?? value?.sourceRefs);
  const confidence = normalizeConfidence(value?.confidence ?? value?.confidenceScore ?? value?.certaintyScore, classification);
  const unsupportedFact = classification === 'FACT' && evidence.length === 0;
  return {
    classification: unsupportedFact ? 'INFERENCE' : classification,
    requestedClassification: classification,
    confidence: unsupportedFact ? Math.min(confidence, 0.7) : confidence,
    evidence,
    sourceModelRefs,
    unsupportedFact
  };
}

export function normalizeSemanticDocument(document) {
  function visit(value) {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    const semantic = value.id || value.name || value.statement;
    if (semantic) {
      const metadata = semanticMetadata(value);
      const rawClassification = value.classification ?? value.claimClassification ?? value.certainty;
      // Arrays/objects named "classification" can be domain catalogs rather than
      // semantic metadata. Do not destroy those structures.
      if (rawClassification === undefined || typeof rawClassification === 'string' || typeof rawClassification === 'number') value.classification = metadata.classification;
      value.confidence = metadata.confidence;
      value.evidence = metadata.evidence;
      value.sourceModelRefs = metadata.sourceModelRefs;
      if (metadata.unsupportedFact) {
        const notes = Array.isArray(value.normalizationNotes) ? value.normalizationNotes : [];
        const note = 'Provider FACT without direct evidence was normalized to INFERENCE.';
        if (!notes.includes(note)) notes.push(note);
        value.normalizationNotes = notes;
      }
    }
    for (const [key, child] of Object.entries(value)) if (!['evidence', 'evidenceRefs', 'sources', 'sourceRefs', 'citations', 'references', 'sourceModelRefs', 'modelRefs', 'normalizationNotes'].includes(key)) visit(child);
  }
  visit(document); return document;
}

export { CLASSIFICATIONS };
