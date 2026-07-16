import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildInventory } from './inventory.mjs';
import { ensureDir, estimateTokens, now, projectPaths, readJson, sha256, stableHash } from './core.mjs';

function lineNumber(text, offset) { return text.slice(0, offset).split('\n').length; }
function snippet(text, start, radius = 4) {
  const lines = text.split(/\r?\n/); const from = Math.max(0, start - radius - 1); const to = Math.min(lines.length, start + radius);
  return lines.slice(from, to).map((line, i) => `${from + i + 1}: ${line}`).join('\n');
}
function addMatch(out, text, rel, kind, regex, nameGroup = 1, metadata = {}) {
  for (const match of text.matchAll(regex)) {
    const line = lineNumber(text, match.index ?? 0); const name = String(match[nameGroup] ?? match[0]).trim();
    out.push({ id: sha256(`${kind}\0${rel}\0${line}\0${name}`).slice(0, 24), kind, name, path: rel, line, statement: match[0].trim(), snippet: snippet(text, line), metadata });
  }
}
function sourceChunks(rel, text, size = 80, overlap = 15) {
  const lines = text.split(/\r?\n/); const chunks = []; const step = Math.max(1, size - overlap);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + size); const body = lines.slice(start, end).join('\n').trim(); if (!body) continue;
    const first = lines.slice(start, end).find((line) => line.trim())?.trim().slice(0, 160) || rel;
    chunks.push({ id: sha256(`source-chunk\0${rel}\0${start + 1}\0${end}`).slice(0, 24), kind: 'source-chunk', name: `${rel}#L${start + 1}-L${end}`, path: rel, line: start + 1, statement: first, snippet: lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join('\n'), metadata: { startLine: start + 1, endLine: end } });
    if (end === lines.length) break;
  }
  return chunks;
}
function extractFacts(rel, text) {
  const facts = sourceChunks(rel, text); const ext = path.extname(rel).toLowerCase();
  addMatch(facts, text, rel, 'url-path', /@Path\s*\(\s*["']([^"']+)["']\s*\)/g);
  addMatch(facts, text, rel, 'http-method', /@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g);
  addMatch(facts, text, rel, 'spring-endpoint', /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(([^)]*)\)/g, 1);
  addMatch(facts, text, rel, 'kafka-channel', /(?:topic|topics)\s*=\s*["']([^"']+)["']/g);
  addMatch(facts, text, rel, 'kafka-listener', /@(KafkaListener)\b/g);
  addMatch(facts, text, rel, 'rabbit-listener', /@(RabbitListener)\b/g);
  addMatch(facts, text, rel, 'message-channel', /(?:queue|exchange|routingKey|channel)\s*=\s*["']([^"']+)["']/g);
  addMatch(facts, text, rel, 'configuration-key', /^\s*([A-Za-z0-9_.-]+)\s*[=:]\s*.+$/gm);
  addMatch(facts, text, rel, 'sql-table', /\b(?:from|join|into|update|table)\s+([A-Za-z_][A-Za-z0-9_.$]*)/gi);
  addMatch(facts, text, rel, 'scheduled-job', /@(Scheduled)\b/g);
  addMatch(facts, text, rel, 'security-boundary', /@(RolesAllowed|PermitAll|DenyAll|PreAuthorize|Secured)\b/g);
  if (['.java','.kt','.kts','.js','.mjs','.cjs','.ts','.tsx','.go','.rs','.cs','.py','.rb','.php'].includes(ext)) {
    addMatch(facts, text, rel, 'symbol', /\b(?:class|interface|enum|record|object|struct|trait|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g);
    addMatch(facts, text, rel, 'function', /\b(?:public|private|protected|static|final|async|export|suspend|override|internal|virtual|abstract|def|func|fn)?\s*(?:[A-Za-z_$][A-Za-z0-9_$<>,.?\[\] ]+\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;{}]*\)\s*(?:throws [^{]+)?\{/g);
  }
  if (/pom\.xml$/i.test(rel)) addMatch(facts, text, rel, 'maven-dependency', /<artifactId>([^<]+)<\/artifactId>/g);
  if (/package\.json$/i.test(rel)) addMatch(facts, text, rel, 'npm-dependency', /["']([^"']+)["']\s*:\s*["'][~^]?\d/g);
  if (/Dockerfile$/i.test(rel)) addMatch(facts, text, rel, 'container-base', /^FROM\s+([^\s]+)/gmi);
  return facts;
}

function openDatabase(file) {
  ensureDir(path.dirname(file)); const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,hash TEXT NOT NULL,size INTEGER NOT NULL,extension TEXT,indexed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,line INTEGER,statement TEXT,snippet TEXT,metadata TEXT,content_hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_facts_kind ON facts(kind);
    CREATE INDEX IF NOT EXISTS idx_facts_path ON facts(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(id UNINDEXED,kind,name,path,statement,snippet,tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS model_items(id TEXT PRIMARY KEY,semantic_id TEXT NOT NULL,model TEXT NOT NULL,kind TEXT,name TEXT,statement TEXT,classification TEXT,confidence REAL,evidence TEXT,payload TEXT,content_hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_model_semantic_id ON model_items(semantic_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS model_fts USING fts5(id UNINDEXED,model,kind,name,statement,tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS contexts(id TEXT PRIMARY KEY,stage TEXT NOT NULL,target TEXT,query TEXT,input_hash TEXT NOT NULL,estimated_tokens INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
  return db;
}

function replaceFacts(db, rel, facts) {
  const ids = db.prepare('SELECT id FROM facts WHERE path=?').all(rel).map((x) => x.id);
  const deleteFact = db.prepare('DELETE FROM facts WHERE id=?'); const deleteFts = db.prepare('DELETE FROM facts_fts WHERE id=?');
  for (const id of ids) { deleteFact.run(id); deleteFts.run(id); }
  const insert = db.prepare('INSERT INTO facts(id,kind,name,path,line,statement,snippet,metadata,content_hash) VALUES(?,?,?,?,?,?,?,?,?)');
  const insertFts = db.prepare('INSERT INTO facts_fts(id,kind,name,path,statement,snippet) VALUES(?,?,?,?,?,?)');
  for (const fact of facts) {
    const hash = stableHash(fact); insert.run(fact.id, fact.kind, fact.name, fact.path, fact.line, fact.statement, fact.snippet, JSON.stringify(fact.metadata ?? {}), hash);
    insertFts.run(fact.id, fact.kind, fact.name, fact.path, fact.statement, fact.snippet);
  }
}

export function indexRepository(root, { force = false } = {}) {
  const paths = projectPaths(root); const inventory = buildInventory(root); const db = openDatabase(paths.database);
  const known = new Map(db.prepare('SELECT path,hash FROM files').all().map((row) => [row.path, row.hash])); const current = new Set(inventory.files.map((x) => x.path));
  const progress = process.env.DOCGEN_PROGRESS !== '0'; const started = Date.now(); let lastReport = started;
  let changed = 0; let unchanged = 0; let factCount = 0;
  if (progress) console.log(`[docgen] index RUNNING | ${inventory.files.length.toLocaleString()} included files | force=${force}`);
  db.exec('BEGIN');
  try {
    for (let index = 0; index < inventory.files.length; index++) {
      const file = inventory.files[index];
      if (!force && known.get(file.path) === file.hash) unchanged++;
      else {
        const text = fs.readFileSync(path.join(root, file.path), 'utf8'); const facts = extractFacts(file.path, text); factCount += facts.length;
        replaceFacts(db, file.path, facts);
        db.prepare('INSERT INTO files(path,hash,size,extension,indexed_at) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash,size=excluded.size,extension=excluded.extension,indexed_at=excluded.indexed_at').run(file.path, file.hash, file.size, file.extension, now());
        changed++;
      }
      const nowMs = Date.now();
      if (progress && nowMs - lastReport >= 5_000) { lastReport = nowMs; console.log(`[docgen] index RUNNING | ${index + 1}/${inventory.files.length} | changed ${changed} | unchanged ${unchanged} | extracted facts ${factCount.toLocaleString()}`); }
    }
    for (const rel of known.keys()) if (!current.has(rel)) { replaceFacts(db, rel, []); db.prepare('DELETE FROM files WHERE path=?').run(rel); changed++; }
    db.prepare("INSERT INTO metadata(key,value) VALUES('inventory_fingerprint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(inventory.fingerprint);
    db.prepare("INSERT INTO metadata(key,value) VALUES('indexed_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const totals = { files: db.prepare('SELECT COUNT(*) n FROM files').get().n, facts: db.prepare('SELECT COUNT(*) n FROM facts').get().n };
  db.close();
  if (progress) console.log(`[docgen] index COMPLETED | changed ${changed} | unchanged ${unchanged} | facts ${totals.facts.toLocaleString()} | elapsed ${Math.max(0, Math.round((Date.now() - started) / 1000))}s`);
  return { schemaVersion: '2.0', indexedAt: now(), inventoryFingerprint: inventory.fingerprint, changedFiles: changed, unchangedFiles: unchanged, extractedFacts: factCount, totals };
}

function walkItems(value, model, out, parent = '') {
  if (Array.isArray(value)) { for (const item of value) walkItems(item, model, out, parent); return; }
  if (!value || typeof value !== 'object') return;
  if (value.id || value.name || value.statement) {
    const semanticId = String(value.id ?? sha256(`${model}\0${parent}\0${JSON.stringify(value)}`).slice(0, 24)); const id = `${model}:${semanticId}`;
    out.push({ id, semanticId, model, kind: String(value.kind ?? parent ?? 'item'), name: String(value.name ?? value.title ?? semanticId), statement: String(value.statement ?? value.summary ?? value.description ?? ''), classification: String(value.classification ?? 'UNKNOWN'), confidence: Number(value.confidence ?? 0), evidence: value.evidence ?? [], payload: value });
  }
  for (const [key, child] of Object.entries(value)) if (!['evidence','sourceModelRefs'].includes(key)) walkItems(child, model, out, key);
}

export function ingestModels(root) {
  const paths = projectPaths(root); const db = openDatabase(paths.database); const files = fs.existsSync(paths.model) ? fs.readdirSync(paths.model).filter((x) => x.endsWith('.json') && !x.endsWith('-bundle.json')) : [];
  const insert = db.prepare('INSERT INTO model_items(id,semantic_id,model,kind,name,statement,classification,confidence,evidence,payload,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET semantic_id=excluded.semantic_id,model=excluded.model,kind=excluded.kind,name=excluded.name,statement=excluded.statement,classification=excluded.classification,confidence=excluded.confidence,evidence=excluded.evidence,payload=excluded.payload,content_hash=excluded.content_hash');
  const insertFts = db.prepare('INSERT INTO model_fts(id,model,kind,name,statement) VALUES(?,?,?,?,?)');
  db.exec('BEGIN'); let count = 0;
  try {
    db.exec('DELETE FROM model_items; DELETE FROM model_fts;');
    for (const name of files) {
      const model = path.basename(name, '.json'); const items = []; walkItems(readJson(path.join(paths.model, name), {}), model, items);
      for (const item of items) { insert.run(item.id, item.semanticId, item.model, item.kind, item.name, item.statement, item.classification, item.confidence, JSON.stringify(item.evidence), JSON.stringify(item.payload), stableHash(item.payload)); insertFts.run(item.id, item.model, item.kind, item.name, item.statement); count++; }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  db.close(); return { models: files.length, items: count };
}

export function databaseStats(root) {
  const db = openDatabase(projectPaths(root).database); const stats = { files: db.prepare('SELECT COUNT(*) n FROM files').get().n, facts: db.prepare('SELECT COUNT(*) n FROM facts').get().n, sourceChunks: db.prepare("SELECT COUNT(*) n FROM facts WHERE kind='source-chunk'").get().n, modelItems: db.prepare('SELECT COUNT(*) n FROM model_items').get().n, estimatedIndexedTokens: 0 };
  const samples = db.prepare('SELECT statement,snippet FROM facts').all(); stats.estimatedIndexedTokens = samples.reduce((n, row) => n + estimateTokens(`${row.statement}\n${row.snippet}`), 0); db.close(); return stats;
}

export { openDatabase };
