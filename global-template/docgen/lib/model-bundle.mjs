const WRAPPER_KEYS = new Set([
  'artifacts', 'bundle', 'data', 'documents', 'items', 'model', 'models', 'modules',
  'objects', 'output', 'outputs', 'payload', 'result', 'results', 'response'
]);
const STRONG_SINGLETON_WRAPPERS = new Set(['artifacts', 'bundle', 'documents', 'model', 'models', 'modules', 'output', 'outputs', 'payload', 'response', 'result', 'results']);
const DESCRIPTOR_KEYS = ['modelName', 'model', 'filename', 'fileName', 'path', 'name', 'key', 'type', 'kind', 'id'];
const PAYLOAD_KEYS = ['value', 'content', 'payload', 'data', 'document', 'object', 'result', 'body', 'model'];
const GENERIC_NAME_TOKENS = new Set(['artifact', 'document', 'model', 'object', 'output', 'result']);
const NON_MODEL_SINGLETON_KEYS = new Set(['code', 'error', 'errors', 'message', 'messages', 'note', 'status', 'success', 'warning', 'warnings']);
const MODEL_SIGNAL_KEYS = new Set(['id', 'name', 'title', 'kind', 'statement', 'summary', 'description', 'classification', 'confidence', 'evidence', 'unknowns', 'items']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !['{', '['].includes(text[0])) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function words(value) {
  return String(value ?? '')
    .replace(/\.json$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function singular(word) {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function canonicalModelName(value) {
  const parts = words(value);
  while (parts.length && GENERIC_NAME_TOKENS.has(parts[0])) parts.shift();
  while (parts.length && GENERIC_NAME_TOKENS.has(parts.at(-1))) parts.pop();
  if (parts.length) parts[parts.length - 1] = singular(parts.at(-1));
  return parts.join('');
}

function wrapperKey(value) {
  return words(value).join('');
}

function matchesExpected(value, expected) {
  const candidate = canonicalModelName(value);
  return Boolean(candidate) && candidate === canonicalModelName(expected);
}

function asModelObject(value) {
  const parsed = parseJsonValue(value);
  if (isPlainObject(parsed)) return parsed;
  if (Array.isArray(parsed)) return { items: parsed };
  return null;
}

function descriptorIdentity(value) {
  for (const key of DESCRIPTOR_KEYS) {
    const candidate = value?.[key];
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  }
  return null;
}

function descriptorPayload(value) {
  for (const key of PAYLOAD_KEYS) {
    if (!(key in value)) continue;
    const candidate = asModelObject(value[key]);
    if (candidate) return candidate;
  }
  const ignored = new Set([...DESCRIPTOR_KEYS, ...PAYLOAD_KEYS]);
  const remainder = Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
  return Object.keys(remainder).length ? remainder : null;
}

function directSingletonCandidate(value, expectedNames) {
  if (expectedNames.length !== 1) return null;
  const root = asModelObject(value);
  if (!root) return null;
  const keys = Object.keys(root);
  if (!keys.length) return root;
  if (keys.length === 1 && keys.some((key) => STRONG_SINGLETON_WRAPPERS.has(wrapperKey(key)))) return null;
  if (keys.every((key) => NON_MODEL_SINGLETON_KEYS.has(wrapperKey(key)))) return null;
  if (keys.some((key) => expectedNames.some((name) => matchesExpected(key, name)))) return null;
  const structured = Object.values(root).some((entry) => entry && typeof entry === 'object');
  const semantic = keys.some((key) => MODEL_SIGNAL_KEYS.has(wrapperKey(key)));
  return structured || semantic ? root : null;
}

export function extractModelObjects(bundle, expectedNames, { maxDepth = 8, maxNodes = 10000 } = {}) {
  const expected = [...new Set(expectedNames.map(String))];
  const candidates = new Map();
  const diagnostics = [];
  const seen = new WeakSet();
  let nodes = 0;

  function offer(name, rawValue, score, origin) {
    const value = asModelObject(rawValue);
    if (!value) return;
    const current = candidates.get(name);
    if (!current || score > current.score) {
      candidates.set(name, { value, score, origin });
      diagnostics.push({ type: 'accepted', model: name, origin, score });
    }
  }

  function visit(rawValue, depth = 0, origin = '$') {
    if (depth > maxDepth || nodes >= maxNodes) return;
    const value = parseJsonValue(rawValue);
    if (Array.isArray(value)) {
      nodes++;
      for (let index = 0; index < value.length; index++) visit(value[index], depth + 1, `${origin}[${index}]`);
      return;
    }
    if (!isPlainObject(value) || seen.has(value)) return;
    seen.add(value); nodes++;

    const matchedModelKeys = new Set();
    for (const [key, child] of Object.entries(value)) {
      for (const name of expected) {
        if (matchesExpected(key, name)) { offer(name, child, 1000 - (depth * 10), `${origin}.${key}`); matchedModelKeys.add(key); }
      }
    }

    const identity = descriptorIdentity(value);
    if (identity) {
      for (const name of expected) {
        if (matchesExpected(identity, name)) offer(name, descriptorPayload(value), 800 - (depth * 10), `${origin}<${identity}>`);
      }
    }

    const entries = Object.entries(value).sort(([left], [right]) => {
      const leftWrapper = WRAPPER_KEYS.has(wrapperKey(left)) ? 0 : 1;
      const rightWrapper = WRAPPER_KEYS.has(wrapperKey(right)) ? 0 : 1;
      return leftWrapper - rightWrapper;
    });
    for (const [key, child] of entries) if (!matchedModelKeys.has(key)) visit(child, depth + 1, `${origin}.${key}`);
  }

  visit(bundle);
  if (!candidates.size) {
    const singleton = directSingletonCandidate(bundle, expected);
    if (singleton) offer(expected[0], singleton, 100, '$<direct-singleton>');
  }

  const objects = Object.fromEntries(expected.filter((name) => candidates.has(name)).map((name) => [name, candidates.get(name).value]));
  const missing = expected.filter((name) => !Object.hasOwn(objects, name));
  if (nodes >= maxNodes) diagnostics.push({ type: 'limit', reason: 'maxNodes', maxNodes });
  return { objects, missing, diagnostics, visitedNodes: nodes };
}

export function mergeModelObjects(target, extraction) {
  for (const [name, value] of Object.entries(extraction.objects ?? {})) if (!Object.hasOwn(target, name)) target[name] = value;
  return target;
}

export function safeModelPlaceholder(name, reason = 'Provider omitted the requested model object after bounded recovery.') {
  return {
    status: 'degraded',
    providerOutputStatus: 'missing',
    classification: 'UNKNOWN',
    confidence: 0,
    evidence: [],
    unknowns: [{
      id: `${canonicalModelName(name) || 'model'}-provider-output-missing`,
      kind: 'provider-output-gap',
      name: `${name} model unavailable`,
      statement: reason,
      classification: 'UNKNOWN',
      confidence: 0,
      evidence: []
    }],
    normalizationNotes: [`A deterministic UNKNOWN placeholder was created for ${name}; no repository fact was invented.`]
  };
}

export function resolveModelObjects(expectedNames, bundles, { missingPolicy = 'placeholder', placeholderReason } = {}) {
  const expected = [...new Set(expectedNames.map(String))];
  const objects = {};
  const diagnostics = [];
  for (const [index, bundle] of bundles.entries()) {
    const extraction = extractModelObjects(bundle, expected.filter((name) => !Object.hasOwn(objects, name)));
    mergeModelObjects(objects, extraction);
    diagnostics.push(...extraction.diagnostics.map((entry) => ({ ...entry, attempt: index + 1 })));
  }
  const unresolved = expected.filter((name) => !Object.hasOwn(objects, name));
  const degraded = [];
  if (unresolved.length && missingPolicy !== 'fail') {
    for (const name of unresolved) { objects[name] = safeModelPlaceholder(name, placeholderReason); degraded.push(name); }
  }
  return { objects, missing: expected.filter((name) => !Object.hasOwn(objects, name)), degraded, diagnostics };
}
