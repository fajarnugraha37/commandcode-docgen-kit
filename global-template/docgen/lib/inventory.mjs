import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, git, loadConfig, now, posix, projectPaths, sha256, writeJson } from './core.mjs';

const HARD_DIRS = new Set(['.git', '.docgen', '.commandcode', 'docs', 'node_modules', 'target', 'build', 'dist', 'coverage', 'vendor']);
const BINARY_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.ico','.tif','.tiff','.avif','.heic','.psd','.mp3','.wav','.flac','.aac','.ogg','.mp4','.mov','.avi','.mkv','.webm','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.zip','.gz','.tgz','.bz2','.xz','.7z','.rar','.tar','.jar','.war','.ear','.class','.dll','.exe','.so','.dylib','.o','.a','.lib','.woff','.woff2','.ttf','.otf','.eot','.bin','.dat','.db','.sqlite','.sqlite3','.p12','.pfx','.jks','.keystore','.apk','.ipa','.iso','.dmg','.img','.wasm','.pyc','.pyo']);
const ruleCache = new Map();

function globRegex(pattern) {
  let source = posix(pattern.trim()).replace(/^\.\//, '');
  const anchored = source.startsWith('/'); if (anchored) source = source.slice(1);
  const directory = source.endsWith('/'); if (directory) source += '**';
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '*' && source[i + 1] === '*') { out += '.*'; i++; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(anchored ? `^${out}(?:/.*)?$` : `(?:^|/)${out}(?:/.*)?$`);
}

function loadRules(file) {
  if (ruleCache.has(file)) return ruleCache.get(file);
  const result = !fs.existsSync(file) ? [] : fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => ({ negate: line.startsWith('!'), regex: globRegex(line.replace(/^!/, '')), raw: line }));
  ruleCache.set(file, result); return result;
}

function ignoredByRules(rel, rules) {
  let ignored = false;
  for (const rule of rules) if (rule.regex.test(rel)) ignored = !rule.negate;
  return ignored;
}

function ignoredByFallbackGitignore(root, rel) {
  const parts = rel.split('/'); let ignored = false;
  for (let depth = 0; depth < parts.length; depth++) {
    const base = parts.slice(0, depth).join('/'); const local = parts.slice(depth).join('/');
    for (const rule of loadRules(path.join(root, base, '.gitignore'))) if (rule.regex.test(local)) ignored = !rule.negate;
  }
  return ignored;
}

function walk(root) {
  const out = []; const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name); const rel = posix(path.relative(root, full));
      if (entry.isDirectory()) { if (!HARD_DIRS.has(entry.name)) stack.push(full); }
      else out.push(rel);
    }
  }
  return out.sort();
}

function candidatePaths(root) {
  const insideGit = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!insideGit) return { paths: walk(root), insideGit: false };
  const result = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return { paths: walk(root), insideGit: false };
  return { paths: result.stdout.toString('utf8').split('\0').filter(Bolean.bind(Boolean)).map(posix).sort(), insideGit: true };
}

function binaryMagic(buffer) {
  const sig = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  return sig(0x89,0x50,0x4e,0x47) || sig(0xff,0xd8,0xff) || sig(0x47,0x49,0x46,0x38) || sig(0x25,0x50,0x44,0x46) || sig(0x50,0x4b,0x03,0x04) || sig(0x1f,0x8b) || sig(0x7f,0x45,0x4c,0x46) || sig(0x4d,0x5a) || sig(0x00,0x61,0x73,0x6d) || sig(0xca,0xfe,0xba,0xbe);
}

export function classifyFile(root, rel, config = loadConfig(root)) {
  const full = path.join(root, rel); let stat;
  try { stat = fs.statSync(full); } catch { return { included: false, reason: 'unreadable' }; }
  if (!stat.isFile()) return { included: false, reason: 'not-file' };
  const binary = config.ignore?.binary ?? {}; const maxBytes = Number(binary.maxTextFileBytes ?? 4 * 1024 * 1024);
  const ext = path.extname(rel).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext) || (binary.denyExtensions ?? []).map((x) => String(x).toLowerCase()).includes(ext)) return { included: false, reason: `binary-extension:${ext}`, size: stat.size };
  if (stat.size > maxBytes) return { included: false, reason: 'oversized-text', size: stat.size };
  const probeBytes = Math.max(512, Number(binary.probeBytes ?? 16384)); const fd = fs.openSync(full, 'r'); const buffer = Buffer.alloc(Math.min(stat.size, probeBytes));
  try { fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
  if (binaryMagic(buffer)) return { included: false, reason: 'binary-magic', size: stat.size };
  if (buffer.includes(0)) return { included: false, reason: 'null-byte', size: stat.size };
  const text = buffer.toString('utf8'); if (text.includes('\uFFFD')) return { included: false, reason: 'invalid-utf8', size: stat.size };
  const controls = [...buffer].filter((b) => b < 32 && ![9,10,13].includes(b)).length;
  if (buffer.length && controls / buffer.length > Number(binary.controlCharacterRatio ?? 0.08)) return { included: false, reason: 'control-characters', size: stat.size };
  return { included: true, reason: null, size: stat.size, extension: ext || '<none>' };
}

export function buildInventory(root) {
  ruleCache.clear();
  const paths = projectPaths(root); const config = loadConfig(root); const candidates = candidatePaths(root); const docgenRules = loadRules(path.join(root, '.docgenignore')); const included = []; const excluded = [];
  const progress = config.execution?.progress !== false && process.env.DOCGEN_PROGRESS !== '0'; const started = Date.now(); let lastReport = started;
  if (progress) console.log(`[docgen] inventory RUNNING | ${candidates.paths.length.toLocaleString()} candidate files | ${candidates.insideGit ? 'git-aware' : 'filesystem fallback'}`);
  for (let index = 0; index < candidates.paths.length; index++) {
    const rel = candidates.paths[index]; const top = rel.split('/')[0];
    if (HARD_DIRS.has(top)) excluded.push({ path: rel, reason: 'hard-exclusion' });
    else if (!candidates.insideGit && config.ignore?.useGitignore !== false && ignoredByFallbackGitignore(root, rel)) excluded.push({ path: rel, reason: '.gitignore' });
    else if (config.ignore?.useDocgenignore !== false && ignoredByRules(rel, docgenRules)) excluded.push({ path: rel, reason: '.docgenignore' });
    else {
      const result = classifyFile(root, rel, config);
      if (!result.included) excluded.push({ path: rel, reason: result.reason, size: result.size ?? 0 });
      else { const content = fs.readFileSync(path.join(root, rel)); included.push({ path: rel, size: result.size, extension: result.extension, hash: sha256(content) }); }
    }
    const nowMs = Date.now();
    if (progress && nowMs - lastReport >= 5_000) { lastReport = nowMs; console.log(`[docgen] inventory RUNNING | ${index + 1}/${candidates.paths.length} | included ${included.length} | excluded ${excluded.length}`); }
  }
  const inventory = { schemaVersion: '2.0', generatedAt: now(), files: included, excluded, metrics: { includedFiles: included.length, includedBytes: included.reduce((n, x) => n + x.size, 0), excludedFiles: excluded.length }, fingerprint: sha256(included.map((x) => `${x.path}\0${x.hash}`).join('\n')) };
  ensureDir(path.dirname(paths.inventory)); writeJson(paths.inventory, inventory);
  fs.writeFileSync(path.join(path.dirname(paths.inventory), 'source-files.txt'), included.map((x) => x.path).join('\n') + (included.length ? '\n' : ''));
  if (progress) console.log(`[docgen] inventory COMPLETED | included ${included.length.toLocaleString()} | excluded ${excluded.length.toLocaleString()} | elapsed ${Math.max(0, Math.round((Date.now() - started) / 1000))}s`);
  return inventory;
}
