#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const engineHome = path.resolve(path.dirname(self), '..');
const commandCodeHome = path.resolve(engineHome, '..');
const kitVersion = fs.readFileSync(path.join(engineHome, 'VERSION'), 'utf8').trim();

function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.docgen', 'project.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

let root = findProjectRoot() ?? path.resolve(process.cwd());
function setRoot(nextRoot) { root = path.resolve(nextRoot); }

const statePath = path.join(root, '.docgen', 'state', 'state.json');
const manifestPath = path.join(root, '.docgen', 'plan', 'manifest.json');
const evidenceIndexPath = path.join(root, '.docgen', 'evidence', 'index.json');
const systemPath = path.join(root, '.docgen', 'model', 'system.json');
const businessPath = path.join(root, '.docgen', 'model', 'business.json');
const flowsPath = path.join(root, '.docgen', 'model', 'flows.json');
const catalogsPath = path.join(root, '.docgen', 'model', 'catalogs.json');
const auditIndexPath = path.join(root, '.docgen', 'audit', 'index.json');
const configPath = path.join(root, '.docgen', 'config', 'documentation.json');
const fingerprintsPath = path.join(root, '.docgen', 'state', 'fingerprints.json');
const pageStatePath = path.join(root, '.docgen', 'state', 'pages.json');
const preflightPath = path.join(root, '.docgen', 'plan', 'preflight.json');

function fail(message, code = 1) { console.error(`ERROR: ${message}`); process.exit(code); }
function exists(relOrAbs) { return fs.existsSync(path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function now() { return new Date().toISOString(); }
function rel(file) { return path.relative(root, file).replaceAll('\\', '/'); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function terminateProcessTree(child) { if (!child?.pid) return; try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true }); else child.kill('SIGTERM'); } catch {} }
function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function fileSha256(file) { return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null; }
function loadPageState() { return fs.existsSync(pageStatePath) ? readJson(pageStatePath) : { schemaVersion: '1.0', kitVersion, pages: {} }; }
function updatePageState(pageId, patch) { const s = loadPageState(); s.schemaVersion = '1.0'; s.kitVersion = kitVersion; s.updatedAt = now(); s.pages ??= {}; s.pages[pageId] = { ...(s.pages[pageId] ?? {}), ...patch, updatedAt: now() }; writeJson(pageStatePath, s); }


function loadState() {
  if (!fs.existsSync(statePath)) return { schemaVersion: '1.0', kitVersion, stages: {} };
  return readJson(statePath);
}
function updateStage(stage, status, details = {}) {
  const state = loadState();
  state.schemaVersion = '1.0'; state.kitVersion = kitVersion; state.updatedAt = now();
  state.stages ??= {}; state.stages[stage] = { status, updatedAt: now(), ...details };
  writeJson(statePath, state);
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(checker, [command], { stdio: 'ignore', shell: process.platform === 'win32' });
  return r.status === 0;
}
function loadConfig() {
  if (!fs.existsSync(configPath)) return {};
  return readJson(configPath);
}
function mergeAdditiveDefaults(current, defaults, keyPath = '') {
  if (Array.isArray(defaults)) {
    if (!Array.isArray(current)) return defaults;
    const unionPaths = new Set(['audiences', 'pageTypes', 'sourceExtensions', 'exclude']);
    if (unionPaths.has(keyPath)) return [...new Set([...current, ...defaults])];
    return current;
  }
  if (defaults && typeof defaults === 'object') {
    const out = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
    for (const [k, v] of Object.entries(defaults)) out[k] = mergeAdditiveDefaults(out[k], v, keyPath ? `${keyPath}.${k}` : k);
    return out;
  }
  return current === undefined ? defaults : current;
}
function migrateProjectConfig(silent = false) {
  if (!fs.existsSync(configPath)) return false;
  const defaultsPath = path.join(engineHome, 'project-template', 'config', 'documentation.json');
  if (!fs.existsSync(defaultsPath)) return false;
  const current = readJson(configPath);
  const defaults = readJson(defaultsPath);
  const merged = mergeAdditiveDefaults(current, defaults);
  merged.schemaVersion = defaults.schemaVersion ?? merged.schemaVersion;
  const changed = JSON.stringify(current) !== JSON.stringify(merged);
  if (changed) {
    writeJson(configPath, merged);
    if (!silent) console.log(`[docgen] migrated project configuration additively to DocGen ${kitVersion}. Existing custom values were preserved.`);
  } else if (!silent) {
    console.log(`[docgen] project configuration is already compatible with DocGen ${kitVersion}.`);
  }
  const markerPath = path.join(root, '.docgen', 'project.json');
  if (fs.existsSync(markerPath)) {
    const marker = readJson(markerPath);
    if (marker.kitVersion !== kitVersion) { marker.kitVersion = kitVersion; marker.migratedAt = now(); writeJson(markerPath, marker); }
  }
  return changed;
}
function commandCodeBin() {
  if (process.env.DOCGEN_COMMAND_CODE_BIN) return process.env.DOCGEN_COMMAND_CODE_BIN;
  const configured = loadConfig().commandCode?.executable;
  if (configured) return configured;
  const candidates = process.platform === 'win32' ? ['cmdc', 'command-code'] : ['cmd', 'command-code', 'cmdc'];
  for (const c of candidates) if (commandExists(c)) return c;
  return null;
}
function commandCodeArgs(stage) {
  const cc = loadConfig().commandCode ?? {};
  const args = ['-p'];
  if (cc.trust !== false) args.push('--trust');
  if (cc.skipOnboarding !== false) args.push('--skip-onboarding');
  if (cc.yolo !== false) args.push('--yolo');

  const envTurns = Number.parseInt(process.env.DOCGEN_MAX_TURNS ?? '', 10);
  const configuredTurns = cc.maxTurns?.[stage] ?? cc.maxTurns?.default;
  const maxTurns = Number.isFinite(envTurns) && envTurns > 0 ? envTurns : configuredTurns;
  if (Number.isInteger(maxTurns) && maxTurns > 0) args.push('--max-turns', String(maxTurns));

  const model = process.env.DOCGEN_MODEL || cc.stageModels?.[stage] || cc.model;
  if (model) args.push('--model', String(model));
  const progress = loadConfig().progress ?? {};
  if (progress.verboseCommandCode !== false) args.push('--verbose');
  return args;
}
function assetFile(kind, name) {
  const projectOverride = path.join(root, '.docgen', kind, name);
  if (fs.existsSync(projectOverride)) return projectOverride;
  return path.join(engineHome, kind, name);
}
function renderPrompt(name, vars = {}) {
  const file = assetFile('prompts', name);
  let text = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, String(v));
  return text;
}
const EXIT_CLASSIFICATION = {
  0: ['success', 'Command Code completed successfully.'],
  1: ['general-error', 'Command Code returned a general error.'],
  3: ['not-authenticated', 'Command Code is not authenticated. Run `cmd login` (`cmdc login` on native Windows).'],
  4: ['permission-denied', 'Command Code denied a required permission or a DocGen hook blocked an operation.'],
  5: ['rate-limited', 'The LLM/API provider rate limit was exceeded. DocGen exhausted its configured retry/backoff policy.'],
  6: ['network-failure', 'Command Code could not reach the API/provider. Check network, proxy, DNS, or provider availability.'],
  7: ['api-server-error', 'The LLM/API provider returned a server-side 5xx error.'],
  8: ['max-turns', 'The headless max-turn limit was reached before completion. Increase commandCode.maxTurns for this stage.'],
  124: ['stage-timeout', 'The configured DocGen stage timeout was reached and the Command Code process was terminated.'],
  130: ['interrupted', 'The process was interrupted by SIGINT/SIGTERM.']
};

function duration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;
}
function bar(current, total, width = 24) {
  if (!total || total < 1) return '[????????????????????????]';
  const ratio = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(ratio * width);
  return `[${'='.repeat(filled)}${'.'.repeat(width - filled)}] ${(ratio * 100).toFixed(0).padStart(3)}%`;
}
function pageWordCount(text) {
  return (text.replace(/```[\s\S]*?```/g, ' ').match(/\b[\p{L}\p{N}_'-]+\b/gu) ?? []).length;
}
function headingNames(text) {
  return [...text.matchAll(/^#{2,6}\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
}
function normalizeHeading(s) { return String(s).toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function qualityConfig() { return loadConfig().quality ?? {}; }
function progressConfig() { return loadConfig().progress ?? {}; }
function qualityProfile() { return process.env.DOCGEN_QUALITY_PROFILE || qualityConfig().profile || 'balanced'; }
function isComprehensive() { return qualityProfile() === 'comprehensive'; }
function printItemProgress(action, current, total, id = '') {
  console.log(`\n${bar(current, total)} ${action} ${current}/${total}${id ? ` — ${id}` : ''}`);
}
function recentArtifactActivity(sinceMs) {
  let count = 0;
  for (const relDir of ['.docgen', 'docs']) {
    const base = path.join(root, relDir);
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else {
          try { if (fs.statSync(full).mtimeMs >= sinceMs) count++; } catch {}
        }
      }
    }
  }
  return count;
}

function retryConfig() {
  const cfg = loadConfig().retry ?? {};
  return {
    enabled: cfg.enabled !== false,
    maxAttempts: Math.max(1, Number(cfg.maxAttempts ?? 5)),
    retryableExitCodes: Array.isArray(cfg.retryableExitCodes) ? cfg.retryableExitCodes.map(Number) : [5, 6, 7],
    initialDelaySeconds: Math.max(1, Number(cfg.initialDelaySeconds ?? 30)),
    rateLimitDelaySeconds: Math.max(1, Number(cfg.rateLimitDelaySeconds ?? 60)),
    maxDelaySeconds: Math.max(1, Number(cfg.maxDelaySeconds ?? 300)),
    multiplier: Math.max(1, Number(cfg.multiplier ?? 2)),
    jitterRatio: Math.min(1, Math.max(0, Number(cfg.jitterRatio ?? 0.2))),
    countdownSeconds: Math.max(1, Number(cfg.countdownSeconds ?? 10)),
    interRequestDelaySeconds: Math.max(0, Number(cfg.interRequestDelaySeconds ?? 2))
  };
}
function classifyCommandFailure(exitCode, stderrText = '', stdoutText = '') {
  const combined = `${stderrText}\n${stdoutText}`;
  if (exitCode === 5 || /(?:rate[ -]?limit|too many requests|\b429\b|quota exceeded|usage exceeded)/i.test(combined)) {
    return ['rate-limited', EXIT_CLASSIFICATION[5][1]];
  }
  if (exitCode === 6 || /(?:connection error|network failure|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up)/i.test(combined)) {
    return ['network-failure', EXIT_CLASSIFICATION[6][1]];
  }
  if (exitCode === 7 || /(?:\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout)/i.test(combined)) {
    return ['api-server-error', EXIT_CLASSIFICATION[7][1]];
  }
  return EXIT_CLASSIFICATION[exitCode] ?? ['unknown-error', `Command Code exited with code ${exitCode}.`];
}
async function cooldown(seconds, reason) {
  let remaining = Math.ceil(seconds);
  const step = retryConfig().countdownSeconds;
  while (remaining > 0) {
    console.log(`[docgen] retry cooldown (${reason}): ${remaining}s remaining`);
    const wait = Math.min(step, remaining);
    await sleep(wait * 1000);
    remaining -= wait;
  }
}
async function runCommandCodeOnce(stage, prompt, target = '', progressLabel = '', attempt = 1, maxAttempts = 1) {
  const bin = commandCodeBin();
  if (!bin) throw Object.assign(new Error('Command Code executable not found. Install it or set DOCGEN_COMMAND_CODE_BIN.'), { exitCode: 1 });
  const args = commandCodeArgs(stage);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${stage}-attempt-${String(attempt).padStart(2, '0')}`;
  const startedMs = Date.now();
  const meta = {
    schemaVersion: '1.2', runId, stage, target, progressLabel, attempt, maxAttempts, startedAt: now(),
    commandCodeBin: bin, commandCodeArgs: args, status: 'running'
  };
  const runDir = path.join(root, '.docgen', 'runs');
  fs.mkdirSync(runDir, { recursive: true });
  const metaPath = path.join(runDir, `${runId}.json`);
  const stdoutLogPath = path.join(runDir, `${runId}.stdout.log`);
  const stderrLogPath = path.join(runDir, `${runId}.stderr.log`);
  writeJson(metaPath, meta);
  fs.writeFileSync(stdoutLogPath, ''); fs.writeFileSync(stderrLogPath, '');

  const env = { ...process.env, DOCGEN_MODE: '1', DOCGEN_STAGE: stage, DOCGEN_TARGET: target };
  console.log(`\n==> ${stage}${target ? `: ${target}` : ''}${progressLabel ? ` | ${progressLabel}` : ''} | attempt ${attempt}/${maxAttempts}`);
  console.log(`    ${bin} ${args.join(' ')}`);
  console.log(`    logs: ${rel(stdoutLogPath)} | ${rel(stderrLogPath)}`);

  const pc = progressConfig();
  const heartbeatMs = Math.max(2, Number(pc.heartbeatSeconds ?? 10)) * 1000;
  const noOutputWarnMs = Math.max(5, Number(pc.noOutputWarningSeconds ?? 45)) * 1000;
  let lastOutputMs = Date.now();
  let warnedNoOutput = false;
  let stderrTail = '';
  let stdoutTail = '';

  return await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(bin, args, {
      cwd: root, env, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    meta.pid = child.pid ?? null; writeJson(metaPath, meta);

    const onChunk = (stream, chunk, logPath) => {
      lastOutputMs = Date.now(); warnedNoOutput = false;
      const chunkText = chunk.toString();
      fs.appendFileSync(logPath, chunkText);
      if (stream === 'stderr') stderrTail = (stderrTail + chunkText).slice(-16000);
      else stdoutTail = (stdoutTail + chunkText).slice(-16000);
      if (pc.showCommandOutput !== false) (stream === 'stdout' ? process.stdout : process.stderr).write(chunkText);
    };
    child.stdout.on('data', (c) => onChunk('stdout', c, stdoutLogPath));
    child.stderr.on('data', (c) => onChunk('stderr', c, stderrLogPath));

    const timeoutMs = stageTimeoutMs(stage);
    const stageTimer = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      console.error(`[docgen] ${stage}${target ? `:${target}` : ''} exceeded stage timeout ${duration(timeoutMs)}; terminating process ${child.pid ?? '?'}.`);
      terminateProcessTree(child);
      setTimeout(() => { try { if (!settled && process.platform !== 'win32') child.kill('SIGKILL'); } catch {} }, 5000).unref?.();
    }, timeoutMs) : null;
    stageTimer?.unref?.();

    const heartbeat = setInterval(() => {
      const nowMs = Date.now();
      const quiet = nowMs - lastOutputMs;
      const artifacts = recentArtifactActivity(startedMs);
      const quietMsg = quiet >= noOutputWarnMs ? ` | no CLI output for ${duration(quiet)}` : '';
      console.log(`[docgen] ${stage}${target ? `:${target}` : ''} RUNNING | attempt ${attempt}/${maxAttempts} | elapsed ${duration(nowMs - startedMs)} | pid ${child.pid ?? '?'} | changed artifacts ${artifacts}${quietMsg}`);
      if (quiet >= noOutputWarnMs && !warnedNoOutput) {
        warnedNoOutput = true;
        console.log('[docgen] Process is alive. Provider/API failures will trigger retry/backoff when the process exits.');
      }
    }, heartbeatMs);

    child.on('error', (err) => {
      if (settled) return; settled = true;
      clearInterval(heartbeat); if (stageTimer) clearTimeout(stageTimer);
      meta.finishedAt = now(); meta.status = 'failed-to-launch'; meta.error = err.message;
      writeJson(metaPath, meta);
      reject(Object.assign(new Error(`${stage} failed to launch: ${err.message}`), { exitCode: 1, classification: 'launch-error' }));
    });
    child.on('close', (code, signal) => {
      if (settled) return; settled = true;
      clearInterval(heartbeat); if (stageTimer) clearTimeout(stageTimer);
      const elapsed = Date.now() - startedMs;
      const timedOut = stageTimeoutMs(stage) > 0 && elapsed >= stageTimeoutMs(stage) - 1000 && signal;
      const exitCode = timedOut ? 124 : (code ?? (signal ? 130 : 1));
      const [classification, explanation] = classifyCommandFailure(exitCode, stderrTail, stdoutTail);
      meta.finishedAt = now(); meta.durationMs = Date.now() - startedMs; meta.exitCode = exitCode;
      meta.signal = signal ?? null; meta.status = exitCode === 0 ? 'completed' : 'failed';
      meta.errorClassification = classification; meta.stdoutLog = rel(stdoutLogPath); meta.stderrLog = rel(stderrLogPath);
      writeJson(metaPath, meta);
      console.log(`[docgen] ${stage}${target ? `:${target}` : ''} ${exitCode === 0 ? 'COMPLETED' : 'FAILED'} | attempt ${attempt}/${maxAttempts} | ${duration(meta.durationMs)} | exit ${exitCode} (${classification})`);
      if (exitCode !== 0) {
        const tail = (stderrTail || stdoutTail).trim();
        const detail = tail ? `\n\nLast provider/CLI output:\n${tail}` : '';
        reject(Object.assign(new Error(`${stage} failed: ${explanation}${detail}`), { exitCode, classification, stderrTail, stdoutTail }));
      } else resolve(meta);
    });

    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}
async function runCommandCode(stage, prompt, target = '', progressLabel = '') {
  const cfg = retryConfig();
  const maxAttempts = cfg.enabled ? cfg.maxAttempts : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await runCommandCodeOnce(stage, prompt, target, progressLabel, attempt, maxAttempts);
      if (cfg.interRequestDelaySeconds > 0) await sleep(cfg.interRequestDelaySeconds * 1000);
      return result;
    } catch (err) {
      lastError = err;
      const retryable = cfg.enabled && attempt < maxAttempts && (cfg.retryableExitCodes.includes(Number(err.exitCode)) || ['rate-limited', 'network-failure', 'api-server-error'].includes(err.classification));
      if (!retryable) throw err;
      const base = err.classification === 'rate-limited' ? cfg.rateLimitDelaySeconds : cfg.initialDelaySeconds;
      const exponential = Math.min(cfg.maxDelaySeconds, base * (cfg.multiplier ** (attempt - 1)));
      const jitter = exponential * cfg.jitterRatio * ((Math.random() * 2) - 1);
      const delay = Math.max(1, Math.round(exponential + jitter));
      console.warn(`[docgen] retryable ${err.classification ?? 'provider error'} on ${stage}${target ? `:${target}` : ''}; retry ${attempt + 1}/${maxAttempts} after ~${delay}s.`);
      await cooldown(delay, err.classification ?? 'provider-error');
    }
  }
  throw lastError;
}

function canonicalPagePath(rawPath) {
  let p = String(rawPath ?? '').trim().replaceAll('\\', '/');
  p = p.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p) throw new Error('Manifest page has an empty path.');
  if (!p.startsWith('docs/')) p = `docs/${p}`;
  if (!/\.md$/i.test(p)) p += '.md';
  p = path.posix.normalize(p);
  if (p === 'docs.md' || !p.startsWith('docs/') || p.includes('/../') || p.startsWith('../')) throw new Error(`Unsafe page path: ${rawPath}`);
  return p;
}
function normalizeReference(ref, aliases) {
  if (typeof ref !== 'string') return ref;
  const value = ref.trim().replaceAll('\\', '/');
  if (!value) return value;
  if (exists(value)) return path.isAbsolute(value) ? rel(value) : value;
  const keys = [value, value.replace(/^\.\//, ''), path.basename(value), path.basename(value, path.extname(value)), slug(value)];
  for (const key of keys) if (aliases.has(key)) return aliases.get(key);
  return value;
}
function buildReferenceAliases() {
  const aliases = new Map();
  const add = (key, value) => { if (key && !aliases.has(String(key))) aliases.set(String(key), value); };
  if (fs.existsSync(evidenceIndexPath)) {
    const idx = normalizeEvidenceIndex();
    for (const a of idx.artifacts ?? []) {
      add(a.id, a.path); add(a.path, a.path); add(path.basename(a.path), a.path); add(path.basename(a.path, path.extname(a.path)), a.path); add(slug(a.id), a.path);
    }
  }
  for (const p of [systemPath, businessPath, flowsPath, catalogsPath]) if (fs.existsSync(p)) {
    const rp = rel(p); add(rp, rp); add(path.basename(rp), rp); add(path.basename(rp, path.extname(rp)), rp); add(slug(path.basename(rp, path.extname(rp))), rp);
  }
  for (const dir of [path.join(root, '.docgen', 'model'), path.join(root, '.docgen', 'evidence')]) for (const f of listFilesRecursive(dir)) {
    if (f.endsWith('.gitkeep')) continue; const rp = rel(f); add(rp, rp); add(path.basename(rp), rp); add(path.basename(rp, path.extname(rp)), rp);
  }
  return aliases;
}
function normalizeManifest(write = true) {
  if (!fs.existsSync(manifestPath)) throw new Error('Missing .docgen/plan/manifest.json. Run plan first.');
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.pages)) throw new Error('Manifest pages must be an array.');
  const aliases = buildReferenceAliases();
  manifest.schemaVersion = '1.0';
  manifest.generatedAt ??= now();
  manifest.navigation = Array.isArray(manifest.navigation) ? manifest.navigation : [];
  manifest.pages = manifest.pages.map((page) => ({
    ...page,
    id: slug(page.id || page.title || page.path),
    path: canonicalPagePath(page.path || page.id || page.title),
    evidence: Array.isArray(page.evidence) ? page.evidence.map((x) => normalizeReference(x, aliases)) : [],
    models: Array.isArray(page.models) ? page.models.map((x) => normalizeReference(x, aliases)) : [],
    audience: Array.isArray(page.audience) && page.audience.length ? page.audience : ['engineer'],
    requiredSections: Array.isArray(page.requiredSections) && page.requiredSections.length ? page.requiredSections : ['Overview'],
    diagramIntents: Array.isArray(page.diagramIntents) ? page.diagramIntents : [],
    coverageTags: Array.isArray(page.coverageTags) ? page.coverageTags : [],
    relatedPages: Array.isArray(page.relatedPages) ? page.relatedPages.map(slug) : []
  }));
  if (write) writeJson(manifestPath, manifest);
  return manifest;
}
function manifestPreflight(manifest = normalizeManifest()) {
  const errors = []; const warnings = []; const ids = new Set(); const paths = new Set();
  for (const page of manifest.pages) {
    if (ids.has(page.id)) errors.push(`duplicate page id: ${page.id}`); ids.add(page.id);
    if (paths.has(page.path)) errors.push(`duplicate page path: ${page.path}`); paths.add(page.path);
    for (const ref of [...(page.evidence ?? []), ...(page.models ?? [])]) if (typeof ref === 'string' && !exists(ref)) errors.push(`${page.id}: unresolved input reference: ${ref}`);
  }
  for (const group of manifest.navigation ?? []) for (const id of group.pages ?? []) {
    const pageId = typeof id === 'string' ? id : id?.id;
    if (pageId && !ids.has(pageId)) errors.push(`navigation ${group.id ?? group.title}: unknown page id ${pageId}`);
  }
  for (const page of manifest.pages) for (const related of page.relatedPages ?? []) if (!ids.has(related)) warnings.push(`${page.id}: related page does not exist: ${related}`);
  const coverageGaps = manifestCoverageGaps(manifest);
  if (coverageGaps.length) errors.push(`manifest coverage gaps: ${coverageGaps.join(', ')}`);
  const result = { schemaVersion: '1.0', checkedAt: now(), valid: errors.length === 0, pageCount: manifest.pages.length, errors, warnings };
  writeJson(preflightPath, result);
  return result;
}
function requireManifestPreflight() {
  const manifest = normalizeManifest();
  const result = manifestPreflight(manifest);
  if (!result.valid) throw new Error(`Manifest preflight failed before generation:\n- ${result.errors.join('\n- ')}\nReport: ${rel(preflightPath)}`);
  if (result.warnings.length) for (const w of result.warnings) console.warn(`WARNING: ${w}`);
  return manifest;
}
function loadManifest() {
  try { return normalizeManifest(); } catch (e) { fail(e.message); }
}
function findPage(id) {
  const manifest = loadManifest();
  const page = manifest.pages.find((p) => p.id === id);
  if (!page) fail(`Unknown page id: ${id}`);
  return page;
}

function validateJsonFile(file, required = []) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${rel(file)}`);
  const obj = readJson(file);
  for (const key of required) if (!(key in obj)) throw new Error(`${rel(file)} missing required key: ${key}`);
  return obj;
}
function slug(value) {
  return String(value || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}
function listFilesRecursive(base) {
  if (!fs.existsSync(base)) return [];
  const out = []; const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full); else out.push(full);
    }
  }
  return out;
}
function normalizeEvidenceIndex() {
  const evidenceDir = path.dirname(evidenceIndexPath);
  let obj = {};
  if (fs.existsSync(evidenceIndexPath)) {
    try { obj = readJson(evidenceIndexPath); } catch (e) { throw new Error(`Invalid ${rel(evidenceIndexPath)}: ${e.message}`); }
  }
  const candidates = [obj.artifacts, obj.files, obj.evidenceFiles, obj.entries, obj.documents, obj.items].find(Array.isArray) ?? [];
  const normalizeEntry = (item, i) => {
    if (typeof item === 'string') {
      const p = item.replaceAll('\\', '/');
      return { id: slug(path.basename(p, path.extname(p))), path: p, kind: 'evidence', scope: '.' };
    }
    const x = item && typeof item === 'object' ? item : {};
    let p = String(x.path ?? x.file ?? x.filePath ?? x.relativePath ?? x.artifactPath ?? '').replaceAll('\\', '/');
    if (p && path.isAbsolute(p)) p = rel(p);
    if (p && !p.startsWith('.docgen/') && !fs.existsSync(path.join(root, p)) && fs.existsSync(path.join(evidenceDir, p))) p = rel(path.join(evidenceDir, p));
    return {
      ...x,
      id: String(x.id ?? x.name ?? x.key ?? slug(p || `artifact-${i + 1}`)),
      path: p,
      kind: String(x.kind ?? x.type ?? x.category ?? 'evidence'),
      scope: String(x.scope ?? x.module ?? x.area ?? x.boundedContext ?? '.')
    };
  };
  let artifacts = candidates.map(normalizeEntry).filter((x) => x.path);
  if (!artifacts.length) {
    artifacts = listFilesRecursive(evidenceDir)
      .filter((p) => p !== evidenceIndexPath && !p.endsWith('.gitkeep'))
      .map((p, i) => normalizeEntry(rel(p), i));
  }
  const seen = new Set();
  artifacts = artifacts.filter((a) => { const key = a.path; if (!key || seen.has(key)) return false; seen.add(key); return true; });
  const canonical = {
    ...obj,
    schemaVersion: '1.0',
    generatedAt: obj.generatedAt ?? now(),
    repository: obj.repository ?? {},
    artifacts
  };
  const changed = !Array.isArray(obj.artifacts) || JSON.stringify(obj.artifacts) !== JSON.stringify(artifacts);
  writeJson(evidenceIndexPath, canonical);
  if (changed) console.log(`[docgen] normalized evidence index to canonical artifacts[] (${artifacts.length} artifacts).`);
  if (!artifacts.length) throw new Error(`${rel(evidenceIndexPath)} contains no artifacts and no evidence files were found.`);
  return canonical;
}
function validateMermaidOnly(text, pagePath) {
  const forbidden = [...text.matchAll(/```\s*(plantuml|puml|dot|graphviz)\b/gi)].map((m) => m[1]);
  if (forbidden.length) throw new Error(`${pagePath} contains non-Mermaid diagram fences: ${[...new Set(forbidden)].join(', ')}`);
}
function loadOptionalJson(file, fallback) { return fs.existsSync(file) ? readJson(file) : fallback; }
function manifestCoverageGaps(manifest) {
  const tags = new Set((manifest.pages ?? []).flatMap((p) => p.coverageTags ?? []));
  const business = loadOptionalJson(businessPath, { businessRules: [], branchConditions: [], lifecycles: [], capabilities: [] });
  const flows = loadOptionalJson(flowsPath, { businessFlows: [], controlFlows: [], requestFlows: [], trafficFlows: [], dataFlows: [], eventFlows: [] });
  const catalogs = loadOptionalJson(catalogsPath, { endpoints: [], messageHandlers: [], externalDependencies: [] });
  const required = [['system-overview', true], ['architecture', true]];
  if ((business.capabilities ?? []).length) required.push(['business-domain', true]);
  if ((business.businessRules ?? []).length) required.push(['business-rules', true]);
  if ((business.branchConditions ?? []).length) required.push(['branch-conditions', true]);
  if ((business.lifecycles ?? []).length) required.push(['state-lifecycle', true]);
  for (const [key, tag] of [['businessFlows','business-flow'],['controlFlows','control-flow'],['requestFlows','request-flow'],['trafficFlows','traffic-flow'],['dataFlows','data-flow'],['eventFlows','event-flow']]) if ((flows[key] ?? []).length) required.push([tag, true]);
  if ((catalogs.endpoints ?? []).length) required.push(['endpoint-catalog', true]);
  if ((catalogs.messageHandlers ?? []).length) required.push(['message-handler-catalog', true]);
  if ((catalogs.externalDependencies ?? []).length) required.push(['external-dependency-catalog', true]);
  return required.filter(([tag]) => !tags.has(tag)).map(([tag]) => tag);
}
function writeNavigationSummary(manifest) {
  const lines = ['# Documentation Map', '', 'Generated from `.docgen/plan/manifest.json`.', ''];
  const byId = new Map((manifest.pages ?? []).map((p) => [p.id, p]));
  const navigation = Array.isArray(manifest.navigation) && manifest.navigation.length ? manifest.navigation : [];
  const groups = navigation.length ? navigation : Object.entries(Object.groupBy ? Object.groupBy(manifest.pages ?? [], (p) => p.category ?? 'Documentation') : (manifest.pages ?? []).reduce((a,p)=>{(a[p.category??'Documentation']??=[]).push(p);return a;},{})).map(([title,pages])=>({id:slug(title),title,pages:pages.map(p=>p.id)}));
  for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    if (group.description) lines.push(group.description, '');
    for (const id of group.pages ?? []) {
      const p = byId.get(typeof id === 'string' ? id : id.id);
      if (!p) continue;
      const target = path.relative(path.join(root, 'docs'), path.join(root, p.path)).replaceAll('\\', '/').replace(/\.md$/, '');
      lines.push(`- [${p.title}](${target}.md) — ${p.summary ?? p.purpose ?? ''}`);
    }
    lines.push('');
  }
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'SUMMARY.md'), lines.join('\n').trimEnd() + '\n');
}

function validatePageFile(page) {
  const file = path.join(root, page.path);
  if (!fs.existsSync(file)) throw new Error(`Missing generated page: ${page.path}`);
  const text = fs.readFileSync(file, 'utf8');
  if (!/^#\s+\S/m.test(text)) throw new Error(`${page.path} has no H1 heading`);
  if ((text.match(/```/g) ?? []).length % 2 !== 0) throw new Error(`${page.path} has an unclosed fenced code block`);
  if (/[A-Za-z]:\\Users\\|\/home\/[^/]+\//.test(text)) throw new Error(`${page.path} appears to contain an absolute local user path`);
  if (qualityConfig().requireMermaidOnly !== false) validateMermaidOnly(text, page.path);
}

function validateSkills(errors) {
  const skillRoot = path.join(commandCodeHome, 'skills');
  if (!fs.existsSync(skillRoot)) { errors.push(`Missing global skills directory: ${skillRoot}`); return; }
  for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('doc-') && !entry.name.startsWith('tech-') && !entry.name.startsWith('domain-')) continue;
    const file = path.join(skillRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) { errors.push(`Missing global skill file: ${file}`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) { errors.push(`${file} missing YAML frontmatter`); continue; }
    const nameLine = m[1].split(/\r?\n/).find((x) => x.startsWith('name:'));
    const name = nameLine?.slice(5).trim().replace(/^[\'"]|[\'"]$/g, '');
    if (name !== entry.name) errors.push(`${file} name must equal directory: ${entry.name}`);
  }
}
function validateStatic() {
  const errors = [];
  const projectMarker = path.join(root, '.docgen', 'project.json');
  if (!fs.existsSync(projectMarker)) errors.push(`Current repository is not initialized: missing ${rel(projectMarker)}. Run \`docgen init\`.`);
  for (const f of [configPath, statePath]) {
    try { validateJsonFile(f); } catch (e) { errors.push(e.message); }
  }
  validateSkills(errors);
  const requiredAgents = ['doc-discoverer', 'doc-architect', 'doc-domain-analyst', 'doc-planner', 'doc-writer', 'doc-auditor'];
  for (const a of requiredAgents) if (!fs.existsSync(path.join(commandCodeHome, 'agents', `${a}.md`))) errors.push(`Missing global agent: ${a}`);
  const requiredCommands = ['docgen-init', 'docgen-doctor', 'docgen-discover', 'docgen-analyze', 'docgen-plan', 'docgen-generate', 'docgen-audit', 'docgen-fix', 'docgen-update', 'docgen-status', 'docgen-enrich', 'docgen-quality', 'docgen-semantics', 'docgen-preflight', 'docgen-resume'];
  for (const c of requiredCommands) if (!fs.existsSync(path.join(commandCodeHome, 'commands', `${c}.md`))) errors.push(`Missing global command: ${c}`);
  for (const prompt of ['discover.md', 'analyze.md', 'semantics.md', 'plan.md', 'generate.md', 'enrich.md', 'audit.md', 'fix.md', 'update-impact.md', 'generate-batch.md', 'enrich-batch.md', 'audit-batch.md']) if (!fs.existsSync(assetFile('prompts', prompt))) errors.push(`Missing prompt: ${prompt}`);
  for (const schema of ['evidence-artifact.schema.json', 'evidence-index.schema.json', 'component.schema.json', 'workflow.schema.json', 'system.schema.json', 'business.schema.json', 'flows.schema.json', 'catalogs.schema.json', 'manifest.schema.json', 'audit-page.schema.json', 'audit-index.schema.json', 'update-plan.schema.json']) {
    try { validateJsonFile(assetFile('schemas', schema)); } catch (e) { errors.push(e.message); }
  }
  if (errors.length) {
    console.error('Static validation failed:');
    for (const e of errors) console.error(`- ${e}`);
    return false;
  }
  console.log('Static validation passed.');
  return true;
}
function validateGenerated() {
  const errors = [];
  try { if (fs.existsSync(evidenceIndexPath)) validateJsonFile(evidenceIndexPath, ['schemaVersion', 'artifacts']); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(systemPath)) validateJsonFile(systemPath, ['schemaVersion', 'components', 'relationships', 'workflows', 'unknowns']); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(businessPath)) validateJsonFile(businessPath, ['schemaVersion', 'actors', 'capabilities', 'concepts', 'businessRules', 'decisions', 'branchConditions', 'lifecycles', 'invariants', 'useCases', 'unknowns']); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(flowsPath)) validateJsonFile(flowsPath, ['schemaVersion', 'businessFlows', 'controlFlows', 'requestFlows', 'trafficFlows', 'dataFlows', 'eventFlows']); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(catalogsPath)) validateJsonFile(catalogsPath, ['schemaVersion', 'endpoints', 'messageHandlers', 'externalDependencies', 'dataStores', 'scheduledJobs']); } catch (e) { errors.push(e.message); }
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = normalizeManifest();
      const ids = new Set(); const paths = new Set();
      const coverageGaps = manifestCoverageGaps(manifest);
      if (coverageGaps.length) errors.push(`Manifest coverage gaps: ${coverageGaps.join(', ')}`);
      for (const page of manifest.pages) {
        if (!page.id || !page.path) errors.push('Manifest page missing id/path');
        if (ids.has(page.id)) errors.push(`Duplicate page id: ${page.id}`); ids.add(page.id);
        if (paths.has(page.path)) errors.push(`Duplicate page path: ${page.path}`); paths.add(page.path);
        if (!page.path.startsWith('docs/') || !page.path.endsWith('.md')) errors.push(`Invalid page path: ${page.path}`);
        if (fs.existsSync(path.join(root, page.path))) { try { validatePageFile(page); } catch (e) { errors.push(e.message); } }
      }
    } catch (e) { errors.push(e.message); }
  }
  if (errors.length) {
    console.error('Generated artifact validation failed:');
    for (const e of errors) console.error(`- ${e}`);
    return false;
  }
  console.log('Generated artifact validation passed.');
  return true;
}

async function doDiscover(scope = '.', progressLabel = '') {
  updateStage('discover', 'running', { scope });
  await runCommandCode('discover', renderPrompt('discover.md', { SCOPE: scope }), scope, progressLabel);
  const evidenceIndex = normalizeEvidenceIndex();
  updateStage('discover', 'completed', { scope, artifactCount: evidenceIndex.artifacts.length });
}
async function doAnalyze(scope = 'all current evidence', progressLabel = '') {
  if (!fs.existsSync(evidenceIndexPath)) fail('Run discover first.');
  updateStage('analyze', 'running', { scope });
  await runCommandCode('analyze', renderPrompt('analyze.md', { SCOPE: scope }), scope, progressLabel);
  validateJsonFile(systemPath, ['schemaVersion', 'components', 'relationships', 'workflows', 'unknowns']);
  updateStage('analyze', 'completed', { scope });
}
async function doSemantics(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  updateStage('semantics', 'running');
  await runCommandCode('semantics', renderPrompt('semantics.md'), '', progressLabel);
  validateJsonFile(businessPath, ['schemaVersion', 'actors', 'capabilities', 'concepts', 'businessRules', 'decisions', 'branchConditions', 'lifecycles', 'invariants', 'useCases', 'unknowns']);
  validateJsonFile(flowsPath, ['schemaVersion', 'businessFlows', 'controlFlows', 'requestFlows', 'trafficFlows', 'dataFlows', 'eventFlows']);
  validateJsonFile(catalogsPath, ['schemaVersion', 'endpoints', 'messageHandlers', 'externalDependencies', 'dataStores', 'scheduledJobs']);
  updateStage('semantics', 'completed', {
    endpoints: readJson(catalogsPath).endpoints.length,
    messageHandlers: readJson(catalogsPath).messageHandlers.length,
    externalDependencies: readJson(catalogsPath).externalDependencies.length
  });
}
async function doPlan(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  updateStage('plan', 'running');
  await runCommandCode('plan', renderPrompt('plan.md', { MISSING_COVERAGE: '' }), '', progressLabel);
  let manifest = validateJsonFile(manifestPath, ['schemaVersion', 'navigation', 'pages']);
  let gaps = manifestCoverageGaps(manifest);
  if (gaps.length && isComprehensive()) {
    console.log(`[docgen] manifest coverage gaps detected: ${gaps.join(', ')}. Running one bounded coverage-repair planning pass.`);
    await runCommandCode('plan', renderPrompt('plan.md', { MISSING_COVERAGE: `The current manifest is missing these required evidence-backed coverage tags: ${gaps.join(', ')}. Reconcile the manifest so each is owned by an appropriate page; do not add unsupported content.` }), 'coverage-repair', progressLabel);
    manifest = validateJsonFile(manifestPath, ['schemaVersion', 'navigation', 'pages']);
    gaps = manifestCoverageGaps(manifest);
  }
  if (gaps.length) throw new Error(`Manifest coverage gaps remain: ${gaps.join(', ')}`);
  manifest = normalizeManifest();
  const preflight = manifestPreflight(manifest);
  if (!preflight.valid) throw new Error(`Manifest preflight failed immediately after planning:
- ${preflight.errors.join('\n- ')}
Report: ${rel(preflightPath)}`);
  writeNavigationSummary(manifest);
  updateStage('plan', 'completed', { pageCount: manifest.pages.length, navigationGroups: manifest.navigation.length, preflight: 'passed' });
}
function pageFile(page) { return path.join(root, canonicalPagePath(page.path)); }
function pageIsValid(page) { try { validatePageFile(page); return true; } catch { return false; } }
function pageCurrentHash(page) { return fileSha256(pageFile(page)); }
function pageNeedsEnrichment(page) { try { return pageQualityReport(page).errors.length > 0; } catch { return true; } }
function executionConfig() {
  const e = loadConfig().execution ?? {};
  return {
    generateBatchSize: Math.max(1, Number(e.generateBatchSize ?? 4)),
    auditBatchSize: Math.max(1, Number(e.auditBatchSize ?? 6)),
    enrichBatchSize: Math.max(1, Number(e.enrichBatchSize ?? 4)),
    resumeByDefault: e.resumeByDefault !== false,
    skipValidPages: e.skipValidPages !== false,
    stageTimeoutMinutes: e.stageTimeoutMinutes ?? {}
  };
}
function stageTimeoutMs(stage) {
  const configured = executionConfig().stageTimeoutMinutes;
  const minutes = Number(configured?.[stage] ?? configured?.default ?? 20);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 0;
}
async function doGenerate(id, progressLabel = '', allowEnrich = true, force = false) {
  const page = findPage(id);
  if (!force && executionConfig().skipValidPages && pageIsValid(page)) {
    console.log(`[docgen] SKIP generate:${id} — valid page already exists at ${page.path}`);
  } else {
    updatePageState(id, { generateStatus: 'running', targetPath: page.path });
    await runCommandCode('generate', renderPrompt('generate.md', { PAGE_JSON: JSON.stringify(page, null, 2) }), id, progressLabel);
    validatePageFile(page);
    updatePageState(id, { generateStatus: 'completed', generatedAt: now(), pageHash: pageCurrentHash(page), targetPath: page.path });
  }
  if (allowEnrich && qualityConfig().autoEnrich !== false && isComprehensive() && pageNeedsEnrichment(page)) await doEnrich(id, progressLabel, force);
}
async function doGenerateBatch(pages, progressLabel = '') {
  const pending = pages.filter((p) => !(executionConfig().skipValidPages && pageIsValid(p)));
  for (const p of pages.filter((p) => !pending.includes(p))) console.log(`[docgen] SKIP generate:${p.id} — valid page already exists.`);
  if (!pending.length) return;
  for (const p of pending) updatePageState(p.id, { generateStatus: 'running', targetPath: p.path });
  await runCommandCode('generate', renderPrompt('generate-batch.md', { PAGES_JSON: JSON.stringify(pending, null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  const failures = [];
  for (const page of pending) {
    try { validatePageFile(page); updatePageState(page.id, { generateStatus: 'completed', generatedAt: now(), pageHash: pageCurrentHash(page), targetPath: page.path }); }
    catch (e) { failures.push({ page, error: e.message }); updatePageState(page.id, { generateStatus: 'failed', error: e.message }); }
  }
  if (failures.length) {
    console.warn(`[docgen] batch generated ${pending.length - failures.length}/${pending.length} valid pages; retrying ${failures.length} failed page(s) individually.`);
    for (const f of failures) await doGenerate(f.page.id, `individual fallback after batch`, false, true);
  }
  if (qualityConfig().autoEnrich !== false && isComprehensive()) {
    const thin = pending.filter(pageNeedsEnrichment);
    if (thin.length) await doEnrichBatch(thin, `${progressLabel} | quality-repair`);
  }
}
function pageQualityReport(page) {
  const file = path.join(root, page.path);
  const text = fs.readFileSync(file, 'utf8');
  const q = qualityConfig();
  const words = pageWordCount(text);
  const headings = headingNames(text);
  const normalized = headings.map(normalizeHeading);
  const requiredSections = page.requiredSections ?? [];
  const missingSections = requiredSections.filter((s) => !normalized.some((h) => h.includes(normalizeHeading(s)) || normalizeHeading(s).includes(h)));
  const diagramIntents = page.diagramIntents ?? [];
  const mermaidCount = (text.match(/```mermaid\b/g) ?? []).length;
  const minWords = q.minWordsByType?.[page.type] ?? 0;
  const errors = [];
  if (minWords && words < minWords) errors.push(`word count ${words} is below ${minWords} for ${page.type}`);
  if ((q.minHeadings ?? 0) && headings.length < q.minHeadings) errors.push(`heading count ${headings.length} is below ${q.minHeadings}`);
  if (q.requireDeclaredSections !== false && missingSections.length) errors.push(`missing required sections: ${missingSections.join(', ')}`);
  if (q.requirePlannedDiagrams !== false && diagramIntents.length && mermaidCount < 1) errors.push(`manifest declares diagram intents but no Mermaid diagram exists`);
  return { pageId: page.id, pagePath: page.path, type: page.type, words, headings: headings.length, minWords, requiredSections, missingSections, diagramIntents, mermaidCount, errors };
}
function validatePageQuality(page, hard = true) {
  const report = pageQualityReport(page);
  if (report.errors.length) {
    const message = `${page.path} quality gate failed:\n- ${report.errors.join('\n- ')}`;
    if (hard) throw new Error(message); else console.warn(`WARNING: ${message}`);
  }
  return report;
}
async function doEnrich(id, progressLabel = '', force = false) {
  const page = findPage(id);
  if (!fs.existsSync(pageFile(page))) fail(`Generate page first: ${page.path}`);
  const state = loadPageState().pages?.[id];
  if (!force && state?.enrichedHash && state.enrichedHash === pageCurrentHash(page) && !pageNeedsEnrichment(page)) {
    console.log(`[docgen] SKIP enrich:${id} — current page already satisfies quality gates.`); return;
  }
  await runCommandCode('enrich', renderPrompt('enrich.md', { PAGE_JSON: JSON.stringify(page, null, 2) }), id, progressLabel);
  validatePageFile(page); validatePageQuality(page, false);
  updatePageState(id, { enrichStatus: 'completed', enrichedAt: now(), enrichedHash: pageCurrentHash(page) });
}
async function doEnrichBatch(pages, progressLabel = '') {
  const pending = pages.filter(pageNeedsEnrichment);
  if (!pending.length) return;
  await runCommandCode('enrich', renderPrompt('enrich-batch.md', { PAGES_JSON: JSON.stringify(pending, null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  const failures = [];
  for (const page of pending) {
    try { validatePageFile(page); validatePageQuality(page, false); updatePageState(page.id, { enrichStatus: 'completed', enrichedAt: now(), enrichedHash: pageCurrentHash(page) }); }
    catch (e) { failures.push(page); }
  }
  for (const page of failures) await doEnrich(page.id, 'individual fallback after enrich batch', true);
}
async function doEnrichAll() {
  const manifest = requireManifestPreflight();
  const pages = manifest.pages.filter(pageNeedsEnrichment);
  const size = executionConfig().enrichBatchSize;
  for (let i = 0; i < pages.length; i += size) {
    const batch = pages.slice(i, i + size); printItemProgress('enrich batch', Math.floor(i / size) + 1, Math.ceil(pages.length / size), batch.map((p) => p.id).join(', '));
    await doEnrichBatch(batch, `batch ${Math.floor(i / size) + 1}/${Math.ceil(pages.length / size)}`);
  }
}
function writeQualitySummary() {
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = loadManifest();
  const pages = [];
  for (const page of manifest.pages) if (fs.existsSync(path.join(root, page.path))) pages.push(pageQualityReport(page));
  const audit = fs.existsSync(auditIndexPath) ? readJson(auditIndexPath) : { summary: {} };
  const summary = {
    schemaVersion: '1.0', generatedAt: now(), qualityProfile: qualityProfile(),
    pages, localGateFailures: pages.filter((p) => p.errors.length).length,
    auditSummary: audit.summary ?? {}
  };
  writeJson(path.join(root, '.docgen', 'audit', 'quality-summary.json'), summary);
  return summary;
}
function doQuality() {
  const summary = writeQualitySummary();
  if (!summary) fail('Missing manifest. Run plan first.');
  for (const p of summary.pages) {
    const mark = p.errors.length ? 'FAIL' : 'PASS';
    console.log(`${mark.padEnd(4)} ${p.pageId.padEnd(32)} ${String(p.words).padStart(5)} words | ${p.headings} headings | ${p.mermaidCount} mermaid`);
    for (const e of p.errors) console.log(`     - ${e}`);
  }
  const q = qualityConfig(); const a = summary.auditSummary;
  const failed = summary.localGateFailures > 0 || (a.critical ?? 0) > (q.maxCriticalFindings ?? 0) || (a.high ?? 0) > (q.maxHighFindings ?? 0);
  console.log(`Quality profile: ${summary.qualityProfile}`);
  console.log(`Local gate failures: ${summary.localGateFailures}`);
  console.log(`Audit findings: ${JSON.stringify(a)}`);
  console.log(`Quality gate: ${failed ? 'FAIL' : 'PASS'}`);
  if (failed) process.exitCode = 1;
}

async function doGenerateAll(force = false) {
  const manifest = requireManifestPreflight();
  const cfg = executionConfig();
  const batches = [];
  for (let i = 0; i < manifest.pages.length; i += cfg.generateBatchSize) batches.push(manifest.pages.slice(i, i + cfg.generateBatchSize));
  const alreadyValid = manifest.pages.filter(pageIsValid).length;
  console.log(`[docgen] execution plan: ${manifest.pages.length} pages, ${alreadyValid} already valid, up to ${batches.length} generation batch run(s); enrichment only for pages failing local quality gates.`);
  updateStage('generate', 'running', { pageCount: manifest.pages.length, batchCount: batches.length, alreadyValid });
  try {
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      printItemProgress('generate batch', i + 1, batches.length, batch.map((p) => p.id).join(', '));
      if (force) for (const p of batch) { try { fs.rmSync(pageFile(p)); } catch {} }
      await doGenerateBatch(batch, `batch ${i + 1}/${batches.length}`);
      updateStage('generate', 'running', { pageCount: manifest.pages.length, batchCount: batches.length, completedBatches: i + 1, currentPages: batch.map((p) => p.id) });
    }
    updateStage('generate', 'completed', { pageCount: manifest.pages.length, generated: manifest.pages.filter(pageIsValid).length, batchCount: batches.length });
  } catch (e) {
    updateStage('generate', 'failed', { pageCount: manifest.pages.length, generated: manifest.pages.filter(pageIsValid).length, error: e.message });
    throw e;
  }
}
function auditIsCurrent(page) {
  const audit = path.join(root, '.docgen', 'audit', 'pages', `${page.id}.json`);
  if (!fs.existsSync(audit) || !pageIsValid(page)) return false;
  try { const report = readJson(audit); return report.pageHash === pageCurrentHash(page); } catch { return false; }
}
async function doAudit(id, progressLabel = '', force = false) {
  const page = findPage(id);
  if (!fs.existsSync(pageFile(page))) fail(`Generate page first: ${page.path}`);
  if (!force && auditIsCurrent(page)) { console.log(`[docgen] SKIP audit:${id} — current audit already matches page hash.`); return; }
  await runCommandCode('audit', renderPrompt('audit.md', { PAGE_JSON: JSON.stringify(page, null, 2), PAGE_ID: page.id, PAGE_HASH: pageCurrentHash(page) }), id, progressLabel);
  const reportPath = path.join(root, '.docgen', 'audit', 'pages', `${id}.json`);
  const report = validateJsonFile(reportPath, ['schemaVersion', 'pageId', 'pagePath', 'findings']);
  if (!report.pageHash) { report.pageHash = pageCurrentHash(page); writeJson(reportPath, report); }
  updatePageState(id, { auditStatus: 'completed', auditedAt: now(), auditHash: report.pageHash });
}
async function doAuditBatch(pages, progressLabel = '') {
  const pending = pages.filter((p) => !auditIsCurrent(p));
  for (const p of pages.filter((p) => !pending.includes(p))) console.log(`[docgen] SKIP audit:${p.id} — current audit exists.`);
  if (!pending.length) return;
  await runCommandCode('audit', renderPrompt('audit-batch.md', { PAGES_JSON: JSON.stringify(pending.map((p) => ({ ...p, pageHash: pageCurrentHash(p) })), null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  for (const page of pending) {
    const reportPath = path.join(root, '.docgen', 'audit', 'pages', `${page.id}.json`);
    try { const report = validateJsonFile(reportPath, ['schemaVersion', 'pageId', 'pagePath', 'findings']); if (!report.pageHash) { report.pageHash = pageCurrentHash(page); writeJson(reportPath, report); } updatePageState(page.id, { auditStatus: 'completed', auditedAt: now(), auditHash: report.pageHash }); }
    catch { await doAudit(page.id, 'individual fallback after audit batch', true); }
  }
}
function rebuildAuditIndex() {
  const dir = path.join(root, '.docgen', 'audit', 'pages');
  const pages = [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = readJson(path.join(dir, name));
      pages.push({ pageId: report.pageId, pagePath: report.pagePath, findingCount: report.findings?.length ?? 0 });
      for (const f of report.findings ?? []) if (f.severity in counts) counts[f.severity]++;
    } catch {}
  }
  writeJson(auditIndexPath, { schemaVersion: '1.0', generatedAt: now(), pages, summary: counts });
  return counts;
}
async function doAuditAll() {
  const manifest = requireManifestPreflight();
  const size = executionConfig().auditBatchSize;
  const batches = []; for (let i = 0; i < manifest.pages.length; i += size) batches.push(manifest.pages.slice(i, i + size));
  updateStage('audit', 'running', { pageCount: manifest.pages.length, batchCount: batches.length });
  try {
    for (let i = 0; i < batches.length; i++) { const batch = batches[i]; printItemProgress('audit batch', i + 1, batches.length, batch.map((p) => p.id).join(', ')); await doAuditBatch(batch, `batch ${i + 1}/${batches.length}`); }
    const summary = rebuildAuditIndex(); updateStage('audit', 'completed', { pageCount: manifest.pages.length, findings: summary, batchCount: batches.length });
  } catch (e) { updateStage('audit', 'failed', { pageCount: manifest.pages.length, error: e.message }); throw e; }
}
async function doFix(id, progressLabel = '') {
  const page = findPage(id);
  const audit = path.join(root, '.docgen', 'audit', 'pages', `${id}.json`);
  if (!fs.existsSync(audit)) fail(`Missing audit for ${id}. Run audit first.`);
  await runCommandCode('fix', renderPrompt('fix.md', { PAGE_JSON: JSON.stringify(page, null, 2), PAGE_ID: id }), id, progressLabel);
  validatePageFile(page);
  if (isComprehensive()) validatePageQuality(page, false);
}
async function doFixAll() {
  const manifest = loadManifest();
  const fixed = [];
  for (const page of manifest.pages) {
    const audit = path.join(root, '.docgen', 'audit', 'pages', `${page.id}.json`);
    if (!fs.existsSync(audit)) continue;
    const report = readJson(audit);
    if ((report.findings ?? []).length) { printItemProgress('fix', manifest.pages.indexOf(page) + 1, manifest.pages.length, page.id); await doFix(page.id, `page ${manifest.pages.indexOf(page) + 1}/${manifest.pages.length}`); fixed.push(page.id); }
  }
  return fixed;
}

function ignored(relPath, config) {
  const s = relPath.replaceAll('\\', '/');
  const prefixes = ['.git/', '.commandcode/', '.docgen/', 'docs/', 'node_modules/', 'target/', 'build/', 'dist/', 'coverage/', 'vendor/'];
  if (prefixes.some((p) => s === p.slice(0, -1) || s.startsWith(p))) return true;
  return false;
}
function walkFiles(dir, config, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name); const r = rel(full);
    if (ignored(r, config)) continue;
    if (entry.isDirectory()) walkFiles(full, config, out);
    else out.push(full);
  }
  return out;
}
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function makeSnapshot() {
  const config = readJson(configPath);
  const files = walkFiles(root, config);
  const entries = {};
  for (const file of files) {
    const stat = fs.statSync(file);
    if (stat.size > 5 * 1024 * 1024) continue;
    entries[rel(file)] = { sha256: hashFile(file), size: stat.size };
  }
  return { schemaVersion: '1.0', generatedAt: now(), files: entries };
}
function doSnapshot() {
  const snap = makeSnapshot(); writeJson(fingerprintsPath, snap); console.log(`Snapshot saved: ${Object.keys(snap.files).length} files.`);
}
function changedPaths() {
  const current = makeSnapshot();
  if (!fs.existsSync(fingerprintsPath)) return Object.keys(current.files).sort();
  const previous = readJson(fingerprintsPath);
  const all = new Set([...Object.keys(previous.files ?? {}), ...Object.keys(current.files)]);
  return [...all].filter((p) => previous.files?.[p]?.sha256 !== current.files?.[p]?.sha256).sort();
}
async function doUpdate(explicitPaths) {
  const changed = explicitPaths.length ? explicitPaths : changedPaths();
  if (!changed.length) { console.log('No source changes detected since the last snapshot.'); return; }
  await runCommandCode('update-impact', renderPrompt('update-impact.md', { CHANGED_PATHS_JSON: JSON.stringify(changed, null, 2) }), changed.join(', '));
  const plan = validateJsonFile(path.join(root, '.docgen', 'plan', 'update-plan.json'), ['changedPaths', 'affectedEvidenceScopes', 'affectedModels', 'affectedPageIds']);
  const scopes = plan.affectedEvidenceScopes?.length ? plan.affectedEvidenceScopes : changed;
  for (const scope of scopes) await doDiscover(scope);
  await doAnalyze(`incremental changes: ${changed.join(', ')}`);
  await doSemantics();
  await doPlan();
  for (const id of plan.affectedPageIds ?? []) {
    const currentManifest = loadManifest();
    if (currentManifest.pages.some((p) => p.id === id)) { await doGenerate(id); await doAudit(id); }
  }
  rebuildAuditIndex();
  doSnapshot();
}

function status() {
  const state = loadState();
  console.log(`DocGen Kit ${kitVersion}`);
  for (const stage of ['discover', 'analyze', 'semantics', 'plan', 'generate', 'audit']) console.log(`${stage.padEnd(10)} ${state.stages?.[stage]?.status ?? 'pending'}`);
  if (fs.existsSync(manifestPath)) {
    const m = normalizeManifest(); const generated = (m.pages ?? []).filter(pageIsValid).length;
    console.log(`pages      ${generated}/${m.pages?.length ?? 0} generated`);
  }
  if (fs.existsSync(auditIndexPath)) {
    const a = readJson(auditIndexPath); console.log(`audit      ${JSON.stringify(a.summary ?? {})}`);
  }
}
function runCaptured(bin, args) {
  return spawnSync(bin, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
}
function compatibilityReport() {
  const report = {
    schemaVersion: '1.0',
    kitVersion,
    checkedAt: now(),
    compatible: true,
    authenticated: null,
    warnings: [],
    checks: {}
  };

  report.checks.staticStructure = { ok: validateStatic() };
  if (!report.checks.staticStructure.ok) report.compatible = false;

  const bin = commandCodeBin();
  report.commandCodeBin = bin;
  if (!bin) {
    report.compatible = false;
    report.checks.executable = { ok: false, detail: 'Command Code executable not found.' };
    writeJson(path.join(root, '.docgen', 'state', 'compatibility.json'), report);
    return report;
  }
  report.checks.executable = { ok: true, detail: bin };

  const version = runCaptured(bin, ['--version']);
  const versionText = `${version.stdout ?? ''}${version.stderr ?? ''}`.trim();
  report.commandCodeVersion = versionText || null;
  report.checks.version = { ok: version.status === 0, detail: versionText };
  if (version.status !== 0) report.compatible = false;

  const help = runCaptured(bin, ['--help']);
  const helpText = `${help.stdout ?? ''}${help.stderr ?? ''}`;
  const requiredFlags = ['--trust', '--print', '--max-turns', '--yolo', '--skip-onboarding', '--verbose'];
  const missingFlags = requiredFlags.filter((flag) => !helpText.includes(flag));
  report.checks.requiredFlags = { ok: help.status === 0 && missingFlags.length === 0, requiredFlags, missingFlags };
  if (!report.checks.requiredFlags.ok) report.compatible = false;

  const skills = runCaptured(bin, ['skills', 'list', '--debug']);
  const skillOutput = `${skills.stdout ?? ''}${skills.stderr ?? ''}`.trim();
  const expectedSkills = fs.readdirSync(path.join(commandCodeHome, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (entry.name.startsWith('doc-') || entry.name.startsWith('tech-') || entry.name.startsWith('domain-')))
    .map((entry) => entry.name)
    .sort();
  const missingSkills = expectedSkills.filter((name) => !skillOutput.includes(name));
  const reportsSkippedSkills = /(^|\n)\s*Skipped(?:\s*\(|:)/i.test(skillOutput);
  const skillsOk = skills.status === 0 && missingSkills.length === 0 && !reportsSkippedSkills;
  report.checks.skills = {
    ok: skillsOk, exitCode: skills.status, expectedCount: expectedSkills.length,
    missingSkills, reportsSkippedSkills, output: skillOutput.slice(0, 12000)
  };
  if (!skillsOk) report.compatible = false;

  const auth = runCaptured(bin, ['status', '--json']);
  const authText = `${auth.stdout ?? ''}${auth.stderr ?? ''}`.trim();
  let authenticated = auth.status === 0;
  if (auth.status === 0 && authText) {
    try {
      const parsed = JSON.parse(authText.split(/\r?\n/).find((line) => line.trim().startsWith('{')) ?? authText);
      if (typeof parsed.authenticated === 'boolean') authenticated = parsed.authenticated;
      else if (typeof parsed.loggedIn === 'boolean') authenticated = parsed.loggedIn;
    } catch {}
  }
  report.authenticated = authenticated;
  report.checks.authentication = { ok: authenticated, exitCode: auth.status, detail: authText.slice(0, 4000) };
  if (!authenticated) report.warnings.push('Command Code is not authenticated or status could not confirm authentication. Run `cmd login` before generation.');

  report.effectiveHeadlessArgs = Object.fromEntries(
    ['discover', 'analyze', 'semantics', 'plan', 'generate', 'enrich', 'audit', 'fix', 'update-impact'].map((stage) => [stage, commandCodeArgs(stage)])
  );
  writeJson(path.join(root, '.docgen', 'state', 'compatibility.json'), report);
  return report;
}
function printCompatibility(report) {
  console.log(`DocGen Kit: ${kitVersion}`);
  console.log(`Command Code executable: ${report.commandCodeBin ?? 'NOT FOUND'}`);
  console.log(`Command Code version: ${report.commandCodeVersion ?? 'UNKNOWN'}`);
  console.log(`Static structure: ${report.checks.staticStructure?.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Required CLI flags: ${report.checks.requiredFlags?.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Global DocGen skills load: ${report.checks.skills?.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Authentication: ${report.authenticated ? 'PASS' : 'NOT READY'}`);
  console.log(`Compatibility: ${report.compatible ? 'PASS' : 'FAIL'}`);
  if (report.checks.requiredFlags?.missingFlags?.length) console.log(`Missing flags: ${report.checks.requiredFlags.missingFlags.join(', ')}`);
  for (const warning of report.warnings ?? []) console.warn(`WARNING: ${warning}`);
  console.log('Report: .docgen/state/compatibility.json');
}
function doctor() {
  console.log(`Node.js: ${process.version}`);
  const report = compatibilityReport();
  printCompatibility(report);
  if (!report.compatible) process.exit(1);
}
function copyTreeMissing(src, dest, force = false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTreeMissing(from, to, force);
    else if (!fs.existsSync(to) || force) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}
function initProject(targetArg = '.', force = false) {
  const target = path.resolve(targetArg);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) fail(`Init target is not a directory: ${target}`, 2);
  const projectTemplate = path.join(engineHome, 'project-template');
  if (!fs.existsSync(projectTemplate)) fail(`Global project template missing: ${projectTemplate}`);
  copyTreeMissing(projectTemplate, path.join(target, '.docgen'), force);
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true });
  const marker = {
    schemaVersion: '1.0',
    kitVersion,
    initializedAt: now(),
    engineScope: 'global',
    engineHome: engineHome.replaceAll('\\\\', '/'),
    projectRoot: target.replaceAll('\\\\', '/')
  };
  writeJson(path.join(target, '.docgen', 'project.json'), marker);
  setRoot(target);
  const initStatePath = path.join(target, '.docgen', 'state', 'state.json');
  const initState = fs.existsSync(initStatePath) ? readJson(initStatePath) : { schemaVersion: '1.0', kitVersion, stages: {} };
  initState.kitVersion = kitVersion;
  initState.updatedAt = now();
  initState.stages ??= {};
  initState.stages.init = { status: 'completed', updatedAt: now(), engineScope: 'global' };
  writeJson(initStatePath, initState);
  console.log(`Initialized DocGen project workspace in ${target}`);
  console.log('Next:');
  console.log('  docgen doctor');
  console.log('  docgen all');
}
function globalDoctor() {
  const errors = [];
  for (const dir of ['agents', 'skills', 'commands']) if (!fs.existsSync(path.join(commandCodeHome, dir))) errors.push(`Missing ${path.join(commandCodeHome, dir)}`);
  for (const dir of ['hooks', 'prompts', 'schemas', 'project-template', 'bin']) if (!fs.existsSync(path.join(engineHome, dir))) errors.push(`Missing ${path.join(engineHome, dir)}`);
  const bin = commandCodeBin();
  console.log(`DocGen Kit: ${kitVersion}`);
  console.log(`Engine home: ${engineHome}`);
  console.log(`Command Code home: ${commandCodeHome}`);
  console.log(`Command Code executable: ${bin ?? 'NOT FOUND'}`);
  console.log(`Global structure: ${errors.length ? 'FAIL' : 'PASS'}`);
  for (const e of errors) console.error(`- ${e}`);
  if (errors.length || !bin) process.exit(1);
}
function ensureInitialized() {
  const found = findProjectRoot(process.cwd());
  if (!found) fail('This repository is not initialized for DocGen. Run `docgen init` from the repository root.', 2);
  setRoot(found);
  migrateProjectConfig(true);
}
function usage() {
  console.log(`Command Code DocGen Kit ${kitVersion}

Global-first usage:
  docgen init [repository]       initialize repository-local .docgen state
  docgen doctor [--global]       check global engine and current project
  docgen version                 print version
  docgen where                   print engine/project locations

Project commands:
  docgen status
  docgen migrate                add new defaults without overwriting custom config
  docgen validate
  docgen discover [scope]
  docgen analyze [scope]
  docgen semantics              extract business/flow/catalog models
  docgen plan
  docgen preflight             normalize/validate the entire manifest before any page LLM call
  docgen generate <id|--all>    generate pages; comprehensive profile auto-enriches
  docgen enrich <id|--all>      run explicit depth/completeness pass
  docgen audit <id|--all>
  docgen fix <id|--all>
  docgen quality                run local + audit quality gates
  docgen snapshot
  docgen changed
  docgen update [path ...]
  docgen resume                continue from existing artifacts/checkpoints
  docgen all [--fresh]         resumable by default; --fresh reruns all stages/pages

Project-local overrides are optional under .commandcode/** and .docgen/prompts|schemas/**.`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'init') {
  const force = args.includes('--force');
  const target = args.find((x) => !x.startsWith('--')) ?? '.';
  initProject(target, force);
  process.exit(0);
}
if (command === 'version' || command === '--version' || command === '-v') { console.log(kitVersion); process.exit(0); }
if (command === 'where') {
  console.log(`engineHome=${engineHome}`);
  console.log(`commandCodeHome=${commandCodeHome}`);
  console.log(`projectRoot=${findProjectRoot(process.cwd()) ?? 'NOT_INITIALIZED'}`);
  process.exit(0);
}
if ((command === 'doctor' || command === 'compat') && args.includes('--global')) { globalDoctor(); process.exit(0); }
if (!command) { usage(); process.exit(0); }
ensureInitialized();
try {
switch (command) {
  case 'doctor': doctor(); break;
  case 'compat': doctor(); break;
  case 'status': status(); break;
  case 'migrate': migrateProjectConfig(false); break;
  case 'validate': if (!validateStatic() || !validateGenerated()) process.exit(1); break;
  case 'discover': await doDiscover(args.join(' ') || '.'); break;
  case 'analyze': await doAnalyze(args.join(' ') || 'all current evidence'); break;
  case 'semantics': await doSemantics(); break;
  case 'plan': await doPlan(); break;
  case 'preflight': { const m = requireManifestPreflight(); console.log(`Manifest preflight PASS: ${m.pages.length} pages. Report: ${rel(preflightPath)}`); break; }
  case 'generate': if (args[0] === '--all') await doGenerateAll(args.includes('--force')); else if (args[0]) await doGenerate(args[0], '', true, args.includes('--force')); else fail('generate requires <page-id|--all>'); break;
  case 'enrich': if (args[0] === '--all') await doEnrichAll(); else if (args[0]) await doEnrich(args[0]); else fail('enrich requires <page-id|--all>'); break;
  case 'audit': if (args[0] === '--all') await doAuditAll(); else if (args[0]) { await doAudit(args[0]); rebuildAuditIndex(); writeQualitySummary(); } else fail('audit requires <page-id|--all>'); break;
  case 'fix': if (args[0] === '--all') await doFixAll(); else if (args[0]) await doFix(args[0]); else fail('fix requires <page-id|--all>'); break;
  case 'quality': doQuality(); break;
  case 'snapshot': doSnapshot(); break;
  case 'changed': console.log(changedPaths().join('\n')); break;
  case 'update': await doUpdate(args); break;
  case 'resume':
  case 'all': {
    const fresh = args.includes('--fresh');
    console.log(`DocGen full pipeline | quality profile: ${qualityProfile()} | mode: ${fresh ? 'fresh' : 'resume'}`);
    const state = loadState();
    const stageComplete = (name, artifact) => !fresh && state.stages?.[name]?.status === 'completed' && (!artifact || fs.existsSync(artifact));
    if (stageComplete('discover', evidenceIndexPath)) console.log('[docgen] SKIP phase 1/7 discovery — completed evidence checkpoint exists.');
    else { printItemProgress('phase', 1, 7, 'evidence discovery'); await doDiscover('.', 'phase 1/7'); }
    if (stageComplete('analyze', systemPath)) console.log('[docgen] SKIP phase 2/7 analysis — completed system model exists.');
    else { printItemProgress('phase', 2, 7, 'technical architecture analysis'); await doAnalyze('all current evidence', 'phase 2/7'); }
    if (stageComplete('semantics', catalogsPath) && fs.existsSync(businessPath) && fs.existsSync(flowsPath)) console.log('[docgen] SKIP phase 3/7 semantics — completed semantic models exist.');
    else { printItemProgress('phase', 3, 7, 'business, flow, and catalog semantics'); await doSemantics('phase 3/7'); }
    if (stageComplete('plan', manifestPath)) { const m = requireManifestPreflight(); console.log(`[docgen] SKIP phase 4/7 planning — valid preflighted manifest exists (${m.pages.length} pages).`); }
    else { printItemProgress('phase', 4, 7, 'multi-page documentation planning'); await doPlan('phase 4/7'); }
    const manifest = requireManifestPreflight(); console.log(`Plan contains ${manifest.pages.length} pages across ${manifest.navigation?.length ?? 0} navigation categories.`);
    printItemProgress('phase', 5, 7, 'batched page generation + targeted enrichment'); await doGenerateAll(fresh);
    printItemProgress('phase', 6, 7, 'batched independent audit'); await doAuditAll();
    if (isComprehensive() && qualityConfig().autoFix !== false) {
      console.log('Phase 6b/7 — automatic repair only for pages with audit findings');
      const fixed = await doFixAll();
      if (fixed.length && qualityConfig().reAuditAfterFix !== false) {
        console.log(`Re-auditing ${fixed.length} repaired page(s)...`);
        for (let i = 0; i < fixed.length; i++) { printItemProgress('re-audit', i + 1, fixed.length, fixed[i]); await doAudit(fixed[i], `re-audit ${i + 1}/${fixed.length}`, true); }
        rebuildAuditIndex();
      }
    }
    printItemProgress('phase', 7, 7, 'quality summary + source snapshot');
    writeQualitySummary(); doSnapshot(); doQuality();
    break;
  }
  default: usage(); process.exit(2);
}
} catch (err) {
  const message = err?.message ?? String(err);
  console.error(`ERROR: ${message}`);
  if (err?.classification) console.error(`Classification: ${err.classification}`);
  process.exitCode = Number(err?.exitCode) || 1;
}
