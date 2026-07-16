import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens, loadConfig, now, projectPaths, sha256, stableHash, writeJson } from './core.mjs';
import { openDatabase } from './indexer.mjs';

const STAGE_QUERIES = {
  modelCore: 'repository structure architecture component module package symbol interface contract dependency behavior domain rule state lifecycle control flow data flow event automation runtime build deployment',
  modelEnterprise: 'security trust identity permission secret operation observability failure recovery testing configuration ownership decision governance consistency concurrency idempotency compatibility change impact',
  plan: 'architecture behavior domain interface dependency data security operation testing configuration ownership decision onboarding reference tutorial runbook change impact',
  audit: 'fact evidence inference assumption unknown claim contradiction branch failure security consistency compatibility contract'
};
const CORE_MODELS = ['system', 'business', 'flows', 'catalogs'];

function ftsQuery(value) {
  const tokens = String(value ?? '').toLowerCase().match(/[a-z0-9_.$/@:-]{2,}/g) ?? [];
  return [...new Set(tokens)].slice(0, 40).map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

function rowsForFacts(db, query, limit) {
  const match = ftsQuery(query);
  if (!match) return db.prepare('SELECT id,kind,name,path,line,statement,snippet,metadata,content_hash FROM facts ORDER BY path,line LIMIT ?').all(limit);
  try { return db.prepare(`SELECT f.id,f.kind,f.name,f.path,f.line,f.statement,f.snippet,f.metadata,f.content_hash,bm25(facts_fts) score FROM facts_fts JOIN facts f ON f.id=facts_fts.id WHERE facts_fts MATCH ? ORDER BY score LIMIT ?`).all(match, limit); }
  catch { return db.prepare('SELECT id,kind,name,path,line,statement,snippet,metadata,content_hash FROM facts WHERE lower(name||\' \'||statement||\' \'||path) LIKE ? LIMIT ?').all(`%${String(query).toLowerCase().split(/\s+/)[0] ?? ''}%`, limit); }
}

function rowsForModels(db, query, limit, allowedModels) {
  if (allowedModels === false) return [];
  const allowed = Array.isArray(allowedModels) ? new Set(allowedModels) : null; const fetchLimit = allowed ? Math.max(limit * 4, 1000) : limit;
  const match = ftsQuery(query); let rows = [];
  if (!match) rows = db.prepare('SELECT id,model,kind,name,statement,classification,confidence,evidence,payload,content_hash FROM model_items LIMIT ?').all(fetchLimit);
  else {
    try { rows = db.prepare(`SELECT m.id,m.model,m.kind,m.name,m.statement,m.classification,m.confidence,m.evidence,m.payload,m.content_hash,bm25(model_fts) score FROM model_fts JOIN model_items m ON m.id=model_fts.id WHERE model_fts MATCH ? ORDER BY score LIMIT ?`).all(match, fetchLimit); }
    catch { rows = []; }
  }
  if (allowed) rows = rows.filter((row) => allowed.has(row.model));
  return rows.slice(0, limit);
}

function compactFact(row) { return { id: row.id, kind: row.kind, name: row.name, path: row.path, line: row.line, statement: row.statement, snippet: row.snippet, metadata: JSON.parse(row.metadata || '{}'), hash: row.content_hash }; }
function compactModel(row) { return { id: row.id, model: row.model, kind: row.kind, name: row.name, statement: row.statement, classification: row.classification, confidence: row.confidence, evidence: JSON.parse(row.evidence || '[]'), payload: JSON.parse(row.payload || '{}'), hash: row.content_hash }; }

function fitBudget(base, facts, models, maxTokens) {
  const selectedFacts = []; const selectedModels = []; let used = estimateTokens(JSON.stringify(base));
  const candidates = [...models.map((item) => ({ type: 'model', item, tokens: estimateTokens(JSON.stringify(item)) })), ...facts.map((item) => ({ type: 'fact', item, tokens: estimateTokens(JSON.stringify(item)) }))];
  for (const candidate of candidates) {
    if (used + candidate.tokens > maxTokens) continue;
    used += candidate.tokens;
    if (candidate.type === 'model') selectedModels.push(candidate.item); else selectedFacts.push(candidate.item);
  }
  return { selectedFacts, selectedModels, estimatedTokens: used };
}

export function compileContext(root, { stage, target = '', query = '', maxTokens, factLimit = 800, modelLimit = 500, allowedModels = undefined, metadata = {} }) {
  const paths = projectPaths(root); const config = loadConfig(root); const configured = config.context?.maxTokens?.[stage] ?? config.context?.maxTokens?.default ?? 60000;
  const modelScope = allowedModels !== undefined ? allowedModels : stage === 'modelCore' ? false : stage === 'modelEnterprise' ? CORE_MODELS : null;
  const budget = Math.max(256, Number(maxTokens ?? configured)); const db = openDatabase(paths.database);
  const effectiveQuery = [STAGE_QUERIES[stage] ?? '', query, target].filter(Boolean).join(' ');
  const facts = rowsForFacts(db, effectiveQuery, factLimit).map(compactFact); const models = rowsForModels(db, effectiveQuery, modelLimit, modelScope).map(compactModel);
  const base = { schemaVersion: '2.0', stage, target: target || null, query: effectiveQuery, modelScope: modelScope === false ? [] : modelScope, metadata };
  const fitted = fitBudget(base, facts, models, budget);
  const payload = { ...base, generatedAt: now(), tokenBudget: budget, estimatedTokens: fitted.estimatedTokens, facts: fitted.selectedFacts, modelItems: fitted.selectedModels, omissions: { facts: Math.max(0, facts.length - fitted.selectedFacts.length), modelItems: Math.max(0, models.length - fitted.selectedModels.length) } };
  payload.inputHash = stableHash({ stage, target, query: effectiveQuery, modelScope, facts: payload.facts.map((item) => item.hash), models: payload.modelItems.map((item) => item.hash), metadata });
  const id = sha256(`${stage}\0${target}\0${payload.inputHash}`).slice(0, 24); payload.id = id;
  const file = path.join(paths.context, stage, `${target ? target.replace(/[^a-z0-9_.-]+/gi, '-') : 'global'}.json`); writeJson(file, payload);
  db.prepare('INSERT INTO contexts(id,stage,target,query,input_hash,estimated_tokens,payload,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET input_hash=excluded.input_hash,estimated_tokens=excluded.estimated_tokens,payload=excluded.payload,created_at=excluded.created_at').run(id, stage, target || null, effectiveQuery, payload.inputHash, payload.estimatedTokens, JSON.stringify(payload), now());
  db.close(); return { file, payload };
}

export function loadContext(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
