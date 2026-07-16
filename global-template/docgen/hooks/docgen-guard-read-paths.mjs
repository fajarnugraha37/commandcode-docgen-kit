import fs from 'node:fs';
import path from 'node:path';
import { active, readStdinJson, resolveWorkspacePath, isWithin, deny } from './docgen-common.mjs';

const payload = await readStdinJson();
if (!active()) process.exit(0);

const cwd = path.resolve(payload.cwd ?? process.env.COMMANDCODE_PROJECT_DIR ?? process.cwd());
const input = payload.tool_input ?? {};
const toolName = String(payload.tool_name ?? payload.tool ?? '').toLowerCase();
const stage = String(process.env.DOCGEN_STAGE ?? '');
const contextOnly = ['1', 'true', 'yes', 'on'].includes(String(process.env.DOCGEN_CONTEXT_ONLY ?? '').toLowerCase());
const norm = (value) => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');

function inventoryFiles() {
  const file = path.join(cwd, '.docgen', 'index', 'inventory.json');
  try { return new Set((JSON.parse(fs.readFileSync(file, 'utf8')).files ?? []).map((item) => norm(item.path))); }
  catch { return null; }
}

function contextAllowed(rel) {
  if (rel === '.docgen/context' || rel.startsWith('.docgen/context/')) return true;
  if (stage === 'modelCore' || stage === 'modelEnterprise') return rel === '.docgen/model' || rel.startsWith('.docgen/model/');
  if (stage === 'plan') return rel === '.docgen/plan' || rel.startsWith('.docgen/plan/');
  if (stage === 'generate') return rel === 'docs' || rel.startsWith('docs/') || rel === '.docgen/traceability' || rel.startsWith('.docgen/traceability/');
  if (stage === 'audit') return rel === 'docs' || rel.startsWith('docs/') || rel === '.docgen/audit' || rel.startsWith('.docgen/audit/');
  return false;
}

if (['grep', 'glob', 'read_multiple_files', 'read_directory'].some((name) => toolName.includes(name))) {
  const explicit = input.path ?? input.directory ?? input.file_path;
  const pattern = input.pattern ?? input.glob ?? input.query;
  if (!explicit || typeof pattern === 'string' && /[?*\[]/.test(pattern)) {
    deny(`DocGen blocks broad ${toolName || 'read/search'} operations. Read one explicit bounded context or inventory-approved source path.`);
    process.exit(0);
  }
}

const rawPaths = [];
for (const key of ['file_path', 'path', 'directory']) if (typeof input[key] === 'string') rawPaths.push(input[key]);
for (const key of ['paths', 'files']) if (Array.isArray(input[key])) rawPaths.push(...input[key].filter((value) => typeof value === 'string'));
for (const key of ['pattern', 'glob']) if (typeof input[key] === 'string') rawPaths.push(input[key]);

const included = inventoryFiles();
for (const raw of rawPaths) {
  if (/[?*\[]/.test(raw)) { deny(`DocGen blocks wildcard reads: ${raw}`); process.exit(0); }
  const target = resolveWorkspacePath(raw, cwd); if (!target) continue;
  if (!isWithin(target, cwd)) { deny(`DocGen blocks reads outside the repository: ${raw}`); process.exit(0); }
  const rel = norm(path.relative(cwd, target));
  if (contextOnly) {
    if (!contextAllowed(rel)) { deny(`Context-only ${stage || 'provider'} run cannot read ${raw}. Allowed inputs are precompiled .docgen/context packs and stage outputs only.`); process.exit(0); }
    continue;
  }
  if (rel === '.docgen' || rel.startsWith('.docgen/') || rel === 'docs' || rel.startsWith('docs/')) continue;
  if (!included) { deny('Source inventory is missing. Run `docgen index` before reading repository source.'); process.exit(0); }
  if (!included.has(rel)) { deny(`DocGen will not read a path outside the canonical source inventory: ${raw}. Inventory: .docgen/index/source-files.txt`); process.exit(0); }
}
