import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function now() { return new Date().toISOString(); }
export function slash(value) { return String(value).replaceAll('\\', '/'); }
export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export function fileHash(file) { return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null; }
export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
export function exists(file) { return fs.existsSync(file); }
export function readText(file, fallback = null) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}
export function writeJson(file, value) { atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
export function writeText(file, value) { atomicWrite(file, value.endsWith('\n') ? value : `${value}\n`); }
export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}
export function stableHash(value) { return sha256(JSON.stringify(stableJson(value))); }
export function slug(value, fallback = 'item') {
  const result = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return result || fallback;
}
export function unique(values) { return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))]; }
export function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full); else out.push(full);
    }
  }
  return out.sort();
}
export function relativePortable(from, target) {
  const rel = path.relative(from, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? slash(rel) : slash(path.resolve(target));
}
export function resolvePortable(base, stored) {
  return path.isAbsolute(stored) ? path.normalize(stored) : path.resolve(base, stored);
}
export function copyFileSafe(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}
export function directoryFingerprint(files) {
  const parts = [];
  for (const file of files.filter((item) => fs.existsSync(item)).sort()) {
    const stat = fs.statSync(file);
    parts.push(`${slash(file)}:${stat.size}:${fileHash(file)}`);
  }
  return sha256(parts.join('\n'));
}
export function quarantine(workspaceDir, stage, files, reason) {
  const dir = path.join(workspaceDir, 'quarantine', `${now().replace(/[:.]/g, '-')}-${slug(stage)}`);
  ensureDir(dir);
  for (const file of files.filter((item) => fs.existsSync(item))) copyFileSafe(file, path.join(dir, path.basename(file)));
  writeJson(path.join(dir, 'reason.json'), { stage, reason, quarantinedAt: now(), files: files.map(slash) });
  return dir;
}
