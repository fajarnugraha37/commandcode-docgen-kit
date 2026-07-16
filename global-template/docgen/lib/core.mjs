import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const engineHome = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const kitVersion = fs.readFileSync(path.join(engineHome, 'VERSION'), 'utf8').trim();

export function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.docgen', 'project.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function requireProjectRoot(start = process.cwd()) {
  const root = findProjectRoot(start);
  if (!root) throw new Error('No DocGen project found. Run `docgen init` from the repository root.');
  return root;
}

export function projectPaths(root) {
  const base = path.join(root, '.docgen');
  return {
    root,
    base,
    config: path.join(base, 'config', 'documentation.json'),
    project: path.join(base, 'project.json'),
    state: path.join(base, 'state', 'state.json'),
    inventory: path.join(base, 'index', 'inventory.json'),
    database: path.join(base, 'index', 'semantic.db'),
    context: path.join(base, 'context'),
    telemetry: path.join(base, 'telemetry'),
    budget: path.join(base, 'budget', 'report.json'),
    model: path.join(base, 'model'),
    plan: path.join(base, 'plan', 'manifest.json'),
    docs: path.join(root, 'docs'),
    audit: path.join(base, 'audit'),
    publish: path.join(base, 'publish'),
    traceability: path.join(base, 'traceability'),
    runs: path.join(base, 'runs')
  };
}

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
export function now() { return new Date().toISOString(); }
export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
export function posix(value) { return String(value).replaceAll('\\', '/'); }
export function rel(root, file) { return posix(path.relative(root, file)); }
export function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (fallback !== undefined) return fallback; throw error; }
}
export function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
export function sha256(value) { return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex'); }
export function fileSha256(file) { return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null; }
export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  return value;
}
export function stableHash(value) { return sha256(JSON.stringify(stableJson(value))); }
export function estimateTokens(value) { return Math.ceil(Buffer.byteLength(String(value), 'utf8') / 3.6); }
export function slug(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'; }

function directCommand(command) {
  if (!command) return null;
  const value = String(command);
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    const full = path.resolve(value);
    return fs.existsSync(full) ? full : null;
  }
  return null;
}

export function resolveCommand(command) {
  const direct = directCommand(command);
  if (direct) return direct;
  const locator = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe')
    : 'which';
  const result = spawnSync(locator, [String(command)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: false,
    windowsHide: true
  });
  if (result.status !== 0) return null;
  const candidates = String(result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!candidates.length) return null;
  if (process.platform !== 'win32') return candidates[0];
  return candidates.find((item) => /\.(?:exe|com)$/i.test(item))
    ?? candidates.find((item) => /\.(?:cmd|bat)$/i.test(item))
    ?? candidates.find((item) => fs.existsSync(item))
    ?? null;
}

export function commandExists(command) { return Boolean(resolveCommand(command)); }

function powershellHost() {
  return resolveCommand('pwsh.exe') ?? resolveCommand('powershell.exe');
}

export function spawnCommand(command, args = [], options = {}) {
  const resolved = resolveCommand(command) ?? String(command);
  const baseOptions = { ...options, shell: false };
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(resolved)) {
    return spawn(resolved, args.map(String), baseOptions);
  }
  const host = powershellHost();
  if (!host) throw new Error(`Cannot safely launch Windows command shim: ${resolved}. PowerShell was not found.`);
  const encodedArgs = Buffer.from(JSON.stringify(args.map(String)), 'utf8').toString('base64');
  const env = {
    ...(options.env ?? process.env),
    DOCGEN_CHILD_EXECUTABLE: resolved,
    DOCGEN_CHILD_ARGS_B64: encodedArgs
  };
  const script = [
    "$ErrorActionPreference='Stop'",
    '$exe=$env:DOCGEN_CHILD_EXECUTABLE',
    '$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:DOCGEN_CHILD_ARGS_B64))',
    '$childArgs=@(ConvertFrom-Json -InputObject $json)',
    '& $exe @childArgs',
    'if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }'
  ].join('; ');
  return spawn(host, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    ...baseOptions,
    env
  });
}

export function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const taskkill = resolveCommand('taskkill.exe') ?? 'taskkill.exe';
    spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    });
    return;
  }
  try { child.kill('SIGTERM'); } catch {}
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5_000);
  timer.unref?.();
}

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remaining).padStart(2, '0')}s`
    : `${minutes}m ${String(remaining).padStart(2, '0')}s`;
}

export function git(root, args, fallback = null) {
  const executable = resolveCommand('git') ?? 'git';
  const result = spawnSync(executable, ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false });
  return result.status === 0 ? result.stdout.trim() : fallback;
}
export function sourceSnapshot(root) {
  return {
    commit: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['branch', '--show-current']),
    dirty: Boolean(git(root, ['status', '--porcelain'], '')),
    capturedAt: now()
  };
}
export function loadConfig(root) { return readJson(projectPaths(root).config, {}); }
export function updateStage(root, stage, status, details = {}) {
  const paths = projectPaths(root);
  const state = readJson(paths.state, { schemaVersion: '2.0', kitVersion, stages: {} });
  state.schemaVersion = '2.0'; state.kitVersion = kitVersion; state.updatedAt = now(); state.stages ??= {};
  state.stages[stage] = { status, updatedAt: now(), ...details };
  writeJson(paths.state, state);
}
export function appendJsonl(file, value) { ensureDir(path.dirname(file)); fs.appendFileSync(file, JSON.stringify(value) + '\n'); }
export function parseArgs(argv) {
  const positional = []; const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [rawKey, inline] = arg.slice(2).split('=', 2); const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) options[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else options[key] = true;
  }
  return { positional, options };
}
