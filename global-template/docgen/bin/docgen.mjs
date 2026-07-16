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
function setRoot(nextRoot) { root = path.resolve(nextRoot); sourceSnapshotCache=null; sourceInventoryCache=null; gitRepositoryAvailabilityCache=null; gitIgnoreSingleCache.clear(); ignoreRulesCache.clear(); }

const statePath = path.join(root, '.docgen', 'state', 'state.json');
const manifestPath = path.join(root, '.docgen', 'plan', 'manifest.json');
const evidenceIndexPath = path.join(root, '.docgen', 'evidence', 'index.json');
const systemPath = path.join(root, '.docgen', 'model', 'system.json');
const businessPath = path.join(root, '.docgen', 'model', 'business.json');
const flowsPath = path.join(root, '.docgen', 'model', 'flows.json');
const catalogsPath = path.join(root, '.docgen', 'model', 'catalogs.json');
const securityPath = path.join(root, '.docgen', 'model', 'security.json');
const operationsPath = path.join(root, '.docgen', 'model', 'operations.json');
const testingPath = path.join(root, '.docgen', 'model', 'testing.json');
const dataGovernancePath = path.join(root, '.docgen', 'model', 'data-governance.json');
const decisionsPath = path.join(root, '.docgen', 'model', 'decisions.json');
const configurationPath = path.join(root, '.docgen', 'model', 'configuration.json');
const changeImpactPath = path.join(root, '.docgen', 'model', 'change-impact.json');
const ownershipPath = path.join(root, '.docgen', 'model', 'ownership.json');
const auditIndexPath = path.join(root, '.docgen', 'audit', 'index.json');
const configPath = path.join(root, '.docgen', 'config', 'documentation.json');
const fingerprintsPath = path.join(root, '.docgen', 'state', 'fingerprints.json');
const pageStatePath = path.join(root, '.docgen', 'state', 'pages.json');
const preflightPath = path.join(root, '.docgen', 'plan', 'preflight.json');
const traceabilityRoot = path.join(root, '.docgen', 'traceability');
const traceabilityPagesRoot = path.join(traceabilityRoot, 'pages');
const traceabilityIndexPath = path.join(traceabilityRoot, 'index.json');
const contradictionsPath = path.join(traceabilityRoot, 'contradictions.json');
const duplicatesPath = path.join(traceabilityRoot, 'duplicates.json');
const freshnessPath = path.join(traceabilityRoot, 'freshness.json');
const sourceInventoryPath = path.join(root, '.docgen', 'state', 'source-inventory.json');
const sourceFilesPath = path.join(root, '.docgen', 'state', 'source-files.txt');
const ignoreReportPath = path.join(root, '.docgen', 'state', 'ignore-report.json');
const publishRoot = path.join(root, '.docgen', 'publish');
const navigationIndexPath = path.join(publishRoot, 'navigation.json');
const searchIndexPath = path.join(publishRoot, 'search-index.json');
const backlinksPath = path.join(publishRoot, 'backlinks.json');
const redirectsPath = path.join(publishRoot, 'redirects.json');
const orphansPath = path.join(publishRoot, 'orphans.json');
const examplesIndexPath = path.join(publishRoot, 'examples.json');
const publishingReportPath = path.join(publishRoot, 'report.json');
let sourceSnapshotCache = null;
let sourceInventoryCache = null;
let gitRepositoryAvailabilityCache = null;
const gitIgnoreSingleCache = new Map();
const ignoreRulesCache = new Map();

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
  if (status === 'completed') {
    const downstream = { discover:['analyze','semantics','enterprise','plan','generate','audit'], analyze:['semantics','enterprise','plan','generate','audit'], semantics:['enterprise','plan','generate','audit'], enterprise:['plan','generate','audit'], plan:['generate','audit'] }[stage] ?? [];
    for (const next of downstream) state.stages[next] = { ...(state.stages[next] ?? {}), status:'pending', invalidatedBy:stage, updatedAt:now() };
  }
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
    const unionPaths = new Set(['audiences', 'pageTypes', 'sourceExtensions', 'exclude', 'quality.requiredCoverageTagsWhenEvidenceExists', 'enterpriseDepth.requiredCoverageTagsWhenEvidenceExists', 'enterpriseDepth.passes', 'enterpriseDepth.models']);
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
async function runCommandCode(stage, prompt, target = '', progressLabel = '', lifecycle = {}) {
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
      try { await lifecycle.beforeRetry?.(err, attempt); } catch (resetError) { throw Object.assign(new Error(`Failed to reset stage outputs before retry: ${resetError.message}`), { exitCode: 1, classification: 'contract-reset-error' }); }
      await cooldown(delay, err.classification ?? 'provider-error');
    }
  }
  throw lastError;
}


function arrayValue(obj, keys, fallback = []) {
  for (const key of keys) {
    const value = obj?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    if (value !== undefined && value !== null && value !== '') return [value];
  }
  return fallback;
}
function scalarValue(obj, keys, fallback = undefined) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}
function itemIdentity(value) {
  if (value && typeof value === 'object') {
    const identity = value.id ?? value.key ?? value.name ?? value.path ?? value.operationId ?? value.handler ?? value.topic ?? value.queue;
    if (identity !== undefined) return `id:${String(identity)}`;
    const ordered = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return `json:${JSON.stringify(ordered)}`;
  }
  return `scalar:${String(value)}`;
}
function uniqueArray(values) {
  const seen = new Set(); const out = [];
  for (const value of values) { const key = itemIdentity(value); if (seen.has(key)) continue; seen.add(key); out.push(value); }
  return out;
}
function canonicalArray(obj, canonicalKey, aliases = []) {
  const values = [];
  for (const key of [canonicalKey, ...aliases]) {
    const value = obj?.[key];
    if (Array.isArray(value)) values.push(...value);
    else if (value && typeof value === 'object') values.push(...Object.values(value));
    else if (value !== undefined && value !== null && value !== '') values.push(value);
  }
  return uniqueArray(values);
}
function canonicalModelBase(obj = {}) {
  return {
    ...obj,
    schemaVersion: '1.0',
    generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now()
  };
}
function normalizeClassification(value, evidence = []) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (['FACT', 'INFERENCE', 'UNKNOWN'].includes(raw)) return raw;
  return evidence.length ? 'FACT' : 'UNKNOWN';
}
function normalizeConfidence(value, classification = 'UNKNOWN') {
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  return classification === 'FACT' ? 1 : classification === 'INFERENCE' ? 0.65 : 0;
}
function parseEvidenceLocation(raw) {
  let value = String(raw ?? '').replaceAll('\\', '/'); let startLine = null, endLine = null;
  let m = value.match(/^(.*)#L(\d+)(?:-L?(\d+))?$/i);
  if (!m) m = value.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (m && m[1] && !/^[A-Za-z]$/.test(m[1])) { value = m[1]; startLine = Number(m[2]); endLine = Number(m[3] ?? m[2]); }
  return { path: value, startLine, endLine };
}
function normalizeEvidenceRef(value, index = 0) {
  if (typeof value === 'string') { const loc=parseEvidenceLocation(value); return { id:`evidence-${index+1}`, path:loc.path, symbol:null, startLine:loc.startLine, endLine:loc.endLine, note:null }; }
  const obj = value && typeof value === 'object' ? value : {};
  const loc = parseEvidenceLocation(scalarValue(obj, ['path','file','sourcePath','source','location'], ''));
  const line = scalarValue(obj, ['line','lineNumber'], null);
  return {
    id: slug(scalarValue(obj, ['id','key','name'], `evidence-${index+1}`)), path: loc.path,
    symbol: scalarValue(obj, ['symbol','method','class','function','member'], null),
    startLine: Number(scalarValue(obj, ['startLine','lineStart'], loc.startLine ?? line)) || null,
    endLine: Number(scalarValue(obj, ['endLine','lineEnd'], loc.endLine ?? line)) || null,
    note: scalarValue(obj, ['note','reason','description'], null)
  };
}
function normalizeEvidenceRefs(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return uniqueArray(arr.map(normalizeEvidenceRef).filter((x) => x.path || x.symbol));
}
function normalizeStringRefs(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(arr.map((x) => typeof x === 'string' ? x : x?.id ?? x?.path ?? x?.name).filter(Boolean).map(String))];
}
function typedBase(value, kind, index, options = {}) {
  const obj = typeof value === 'string' ? { statement: value, name: value } : value && typeof value === 'object' ? { ...value } : { statement: String(value ?? '') };
  const evidence = normalizeEvidenceRefs(canonicalArray(obj, 'evidence', ['sources', 'sourceRefs', 'references', 'proof']));
  const name = String(scalarValue(obj, ['name', 'title', 'label', 'operationId', 'handler', 'statement', 'description'], `${kind}-${index + 1}`));
  const statement = String(scalarValue(obj, ['statement', 'rule', 'summary', 'description', 'name', 'title'], name));
  const classification = normalizeClassification(scalarValue(obj, ['classification', 'epistemicStatus', 'status'], null), evidence);
  const out = {
    id: slug(scalarValue(obj, ['id', 'key', 'code', 'operationId', 'name', 'title'], `${kind}-${index + 1}`)),
    kind,
    name,
    statement,
    description: scalarValue(obj, ['description', 'details', 'explanation'], null),
    classification,
    confidence: normalizeConfidence(scalarValue(obj, ['confidence', 'score'], null), classification),
    evidence,
    sourceModelRefs: normalizeStringRefs(canonicalArray(obj, 'sourceModelRefs', ['modelRefs', 'relatedModelItems', 'semanticRefs'])),
    unknowns: canonicalArray(obj, 'unknowns', ['openQuestions', 'gaps']).map(String),
    tags: normalizeStringRefs(canonicalArray(obj, 'tags', ['labels', 'categories']))
  };
  for (const [key, aliases, fallback] of options.fields ?? []) out[key] = scalarValue(obj, [key, ...aliases], fallback);
  for (const [key, aliases] of options.arrays ?? []) out[key] = canonicalArray(obj, key, aliases);
  return out;
}
function normalizeStep(value, index = 0) {
  const x = typedBase(value, 'flow-step', index, { fields: [
    ['actor', ['role', 'principal'], null], ['component', ['service', 'module', 'system'], null],
    ['action', ['operation', 'activity', 'statement'], null], ['input', ['request', 'sourceData'], null],
    ['output', ['response', 'result', 'targetData'], null], ['condition', ['guard', 'when'], null]
  ]});
  const obj = value && typeof value === 'object' ? value : {};
  x.order = Number(scalarValue(obj, ['order', 'sequence', 'index'], index + 1)) || index + 1;
  return x;
}

function normalizeBranch(value, index = 0) {
  return typedBase(value, 'branch', index, { fields: [
    ['condition', ['guard', 'when', 'expression'], null], ['outcome', ['result', 'then'], null],
    ['elseOutcome', ['otherwise', 'else'], null]
  ], arrays: [['nextSteps', ['targets', 'transitions']]] });
}
function collectArrayValues(obj, canonicalKey, aliases = []) {
  const values=[]; for(const key of [canonicalKey,...aliases]){ const value=obj?.[key]; if(Array.isArray(value)) values.push(...value); else if(value&&typeof value==='object') values.push(...Object.values(value)); else if(value!==undefined&&value!==null&&value!=='') values.push(value); } return values;
}
function normalizeTypedArray(obj, canonicalKey, aliases, kind, options = {}) {
  return collectArrayValues(obj, canonicalKey, aliases).map((x, i) => {
    const item = typedBase(x, kind, i, options);
    if (options.steps) item.steps = canonicalArray(x && typeof x === 'object' ? x : {}, 'steps', ['activities', 'sequence']).map(normalizeStep);
    if (options.branches) item.branches = canonicalArray(x && typeof x === 'object' ? x : {}, 'branches', ['conditions', 'decisionBranches']).map(normalizeBranch);
    return item;
  });
}
function normalizeSystemObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    components: normalizeTypedArray(obj, 'components', ['services', 'modules', 'subsystems', 'applications', 'nodes'], 'component', { arrays: [['responsibilities', ['capabilities', 'functions']], ['interfaces', ['ports', 'endpoints']], ['dependencies', ['dependsOn']]] }),
    relationships: normalizeTypedArray(obj, 'relationships', ['dependencies', 'links', 'interactions', 'connections', 'edges'], 'relationship', { fields: [['from', ['source', 'origin'], null], ['to', ['target', 'destination'], null], ['mechanism', ['protocol', 'channel', 'type'], null]] }),
    workflows: normalizeTypedArray(obj, 'workflows', ['processes', 'executionFlows', 'systemFlows', 'scenarios'], 'workflow', { fields: [['trigger', ['start', 'initiator'], null], ['outcome', ['result', 'end'], null]], arrays: [['failurePaths', ['errors', 'exceptions']]], steps: true, branches: true }),
    unknowns: normalizeTypedArray(obj, 'unknowns', ['openQuestions', 'unresolved', 'gaps', 'uncertainties'], 'unknown'),
    metadata: obj.metadata ?? {}
  };
}
function normalizeBusinessObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    actors: normalizeTypedArray(obj, 'actors', ['roles', 'personas', 'participants', 'users'], 'actor', { arrays: [['responsibilities', ['duties']], ['goals', ['outcomes']]] }),
    capabilities: normalizeTypedArray(obj, 'capabilities', ['businessCapabilities', 'functions', 'features'], 'capability', { arrays: [['owners', ['actors']], ['outcomes', ['results']]] }),
    concepts: normalizeTypedArray(obj, 'concepts', ['domainConcepts', 'entities', 'terms', 'vocabulary'], 'concept', { fields: [['definition', ['meaning', 'description'], null]], arrays: [['aliases', ['synonyms']], ['relationships', ['relatedConcepts']]] }),
    businessRules: normalizeTypedArray(obj, 'businessRules', ['rules', 'policies', 'businessLogic'], 'business-rule', { fields: [['trigger', ['when'], null], ['outcome', ['result', 'then'], null], ['failureOutcome', ['otherwise', 'error'], null]], arrays: [['conditions', ['guards', 'preconditions']], ['exceptions', ['overrides']]] }),
    decisions: normalizeTypedArray(obj, 'decisions', ['decisionPoints', 'decisionRules'], 'decision', { fields: [['question', ['decision', 'statement'], null]], branches: true }),
    branchConditions: normalizeTypedArray(obj, 'branchConditions', ['branches', 'conditions', 'guards'], 'branch-condition', { fields: [['expression', ['condition', 'guard', 'when'], null], ['outcome', ['result', 'then'], null], ['elseOutcome', ['otherwise', 'else'], null]] }),
    lifecycles: normalizeTypedArray(obj, 'lifecycles', ['lifeCycles', 'stateMachines', 'stateLifecycles'], 'lifecycle', { arrays: [['states', ['statuses']], ['transitions', ['stateTransitions']]], branches: true }),
    invariants: normalizeTypedArray(obj, 'invariants', ['domainInvariants', 'constraints'], 'invariant', { fields: [['scope', ['appliesTo'], null], ['violationOutcome', ['failureOutcome'], null]] }),
    useCases: normalizeTypedArray(obj, 'useCases', ['usecases', 'scenarios', 'businessScenarios'], 'use-case', { fields: [['actor', ['primaryActor'], null], ['trigger', ['precondition'], null], ['outcome', ['postcondition'], null]], steps: true, branches: true }),
    unknowns: normalizeTypedArray(obj, 'unknowns', ['openQuestions', 'unresolved', 'gaps', 'uncertainties'], 'unknown'),
    metadata: obj.metadata ?? {}
  };
}
function normalizeFlowsObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const make = (key, aliases, kind) => normalizeTypedArray(obj, key, aliases, kind, { fields: [['trigger', ['start', 'initiator'], null], ['outcome', ['result', 'end'], null]], arrays: [['failurePaths', ['errors', 'exceptions']], ['trustBoundaries', ['boundaries']], ['protocols', ['protocol']]], steps: true, branches: true });
  const result = {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    businessFlows: make('businessFlows', ['businessProcesses', 'businessWorkflows'], 'business-flow'),
    controlFlows: make('controlFlows', ['executionFlows', 'codeFlows', 'callFlows'], 'control-flow'),
    requestFlows: make('requestFlows', ['httpFlows', 'apiFlows', 'inboundFlows'], 'request-flow'),
    trafficFlows: make('trafficFlows', ['networkFlows', 'runtimeTrafficFlows'], 'traffic-flow'),
    dataFlows: make('dataFlows', ['dataPipelines', 'informationFlows'], 'data-flow'),
    eventFlows: make('eventFlows', ['messageFlows', 'messagingFlows', 'asyncFlows'], 'event-flow'),
    metadata: obj.metadata ?? {}
  };
  const generic = arrayValue(obj, ['flows'], []);
  for (const flow of generic) {
    const type = String(flow?.type ?? flow?.kind ?? flow?.category ?? '').toLowerCase();
    let key = null, kind = null;
    if (/business/.test(type)) [key, kind] = ['businessFlows', 'business-flow'];
    else if (/control|execution|call/.test(type)) [key, kind] = ['controlFlows', 'control-flow'];
    else if (/request|http|api/.test(type)) [key, kind] = ['requestFlows', 'request-flow'];
    else if (/traffic|network|runtime/.test(type)) [key, kind] = ['trafficFlows', 'traffic-flow'];
    else if (/data|information/.test(type)) [key, kind] = ['dataFlows', 'data-flow'];
    else if (/event|message|async|kafka|rabbit/.test(type)) [key, kind] = ['eventFlows', 'event-flow'];
    if (key) result[key].push(normalizeTypedArray({ x: [flow] }, 'x', [], kind, { fields: [['trigger', ['start', 'initiator'], null], ['outcome', ['result', 'end'], null]], arrays: [['failurePaths', ['errors', 'exceptions']], ['trustBoundaries', ['boundaries']], ['protocols', ['protocol']]], steps: true, branches: true })[0]);
  }
  return result;
}
function normalizeCatalogsObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    endpoints: normalizeTypedArray(obj, 'endpoints', ['apis', 'routes', 'httpEndpoints', 'apiEndpoints', 'restEndpoints', 'grpcEndpoints', 'websocketEndpoints', 'sseEndpoints'], 'endpoint', { fields: [['protocol', ['transport'], 'HTTP'], ['method', ['httpMethod', 'verb'], null], ['path', ['route', 'uri'], null], ['handler', ['operation', 'symbol'], null], ['authentication', ['authn'], null], ['authorization', ['authz'], null]], arrays: [['statusCodes', ['responses']], ['validations', ['validation']], ['sideEffects', ['effects']], ['emittedEvents', ['events']]] }),
    messageHandlers: normalizeTypedArray(obj, 'messageHandlers', ['handlers', 'consumers', 'listeners', 'producers', 'messageConsumers', 'messageProducers', 'publishers', 'kafkaHandlers', 'rabbitHandlers', 'queueHandlers', 'streamHandlers'], 'message-handler', { fields: [['role', ['direction', 'type'], null], ['technology', ['broker'], null], ['channel', ['topic', 'queue', 'exchange', 'stream'], null], ['handler', ['symbol', 'method'], null], ['deliverySemantics', ['delivery'], null]], arrays: [['retry', ['retries']], ['deadLetter', ['dlq', 'deadLetterQueue']], ['sideEffects', ['effects']]] }),
    externalDependencies: normalizeTypedArray(obj, 'externalDependencies', ['dependencies', 'integrations', 'externalServices', 'cloudServices', 'services', 'internalServices', 'upstreamServices', 'downstreamServices', 'thirdPartyServices', 'cloudResources'], 'external-dependency', { fields: [['direction', ['relationship'], null], ['protocol', ['mechanism', 'transport'], null], ['authentication', ['auth'], null], ['criticality', ['importance'], null]], arrays: [['dataExchanged', ['data']], ['failureBehavior', ['failures']], ['callSites', ['sources']]] }),
    dataStores: normalizeTypedArray(obj, 'dataStores', ['datastores', 'databases', 'storage', 'stores', 'caches'], 'data-store', { fields: [['technology', ['engine', 'type'], null], ['ownership', ['owner'], null], ['consistency', ['consistencyModel'], null]], arrays: [['entities', ['tables', 'collections']], ['accessPaths', ['clients', 'repositories']]] }),
    scheduledJobs: normalizeTypedArray(obj, 'scheduledJobs', ['jobs', 'schedulers', 'cronJobs', 'scheduledTasks'], 'scheduled-job', { fields: [['schedule', ['cron', 'interval'], null], ['handler', ['symbol', 'method'], null], ['purpose', ['description'], null]], arrays: [['sideEffects', ['effects']], ['failureBehavior', ['failures']]] }),
    metadata: obj.metadata ?? {}
  };
}

const ENTERPRISE_MODEL_SPECS = {
  security: {
    arrays: {
      trustBoundaries: ['boundaries', 'securityBoundaries'], principals: ['actors', 'identities', 'subjects'],
      authenticationFlows: ['authnFlows', 'loginFlows'], authorizationRules: ['authzRules', 'accessRules', 'permissionsRules'],
      permissions: ['rolesPermissions', 'accessMatrix'], serviceIdentities: ['serviceAccounts', 'machineIdentities'],
      secrets: ['credentials', 'keys', 'certificates'], sensitiveData: ['pii', 'protectedData', 'classifiedData'],
      threats: ['risks', 'abuseCases'], controls: ['securityControls', 'mitigations'], unknowns: ['gaps', 'openQuestions']
    },
    kinds: { trustBoundaries:'trust-boundary', principals:'principal', authenticationFlows:'authentication-flow', authorizationRules:'authorization-rule', permissions:'permission', serviceIdentities:'service-identity', secrets:'secret', sensitiveData:'sensitive-data', threats:'threat', controls:'security-control', unknowns:'unknown' },
    flowKeys: new Set(['authenticationFlows'])
  },
  operations: {
    arrays: {
      runtimeComponents:['runtimes','runtimeServices','runtimeNodes'], healthChecks:['health','readiness','liveness'], observabilitySignals:['signals','logsMetricsTraces'],
      slis:['serviceLevelIndicators'], slos:['serviceLevelObjectives'], alerts:['alarms'], capacityLimits:['limits','quotas'], scalingSignals:['autoscalingSignals'],
      failureModes:['failures'], recoveryProcedures:['recovery','remediation'], backups:['backupRestore'], deployments:['deploymentStrategies','rollouts'],
      runbooks:['operationalRunbooks'], unknowns:['gaps','openQuestions']
    },
    kinds: { runtimeComponents:'runtime-component', healthChecks:'health-check', observabilitySignals:'observability-signal', slis:'sli', slos:'slo', alerts:'alert', capacityLimits:'capacity-limit', scalingSignals:'scaling-signal', failureModes:'failure-mode', recoveryProcedures:'recovery-procedure', backups:'backup', deployments:'deployment', runbooks:'runbook', unknowns:'unknown' },
    flowKeys: new Set(['recoveryProcedures','deployments','runbooks'])
  },
  testing: {
    arrays: {
      testSuites:['suites'], testTypes:['testingTypes','levels'], fixtures:['testFixtures'], testData:['testDatasets'], environments:['testEnvironments'],
      commands:['testCommands'], coverageGaps:['gaps','untestedAreas'], contractTests:['contracts'], failureInjection:['chaosTests','faultInjection'],
      qualityGates:['ciGates','testGates'], unknowns:['openQuestions']
    },
    kinds: { testSuites:'test-suite', testTypes:'test-type', fixtures:'test-fixture', testData:'test-data', environments:'test-environment', commands:'test-command', coverageGaps:'coverage-gap', contractTests:'contract-test', failureInjection:'failure-injection', qualityGates:'test-quality-gate', unknowns:'unknown' },
    flowKeys: new Set()
  },
  dataGovernance: {
    arrays: {
      dataEntities:['entities','records'], ownership:['dataOwners'], sourcesOfTruth:['authoritativeSources'], classifications:['dataClassifications'],
      retentionPolicies:['retention','deletionPolicies'], transactionBoundaries:['transactions'], consistencyModels:['consistency'], concurrencyControls:['locking','concurrency'],
      idempotencyRules:['idempotency'], reconciliationProcesses:['reconciliation'], lineageFlows:['lineage','dataLineage'], migrationPolicies:['schemaEvolution','migrations'],
      auditRequirements:['auditability'], unknowns:['gaps','openQuestions']
    },
    kinds: { dataEntities:'data-entity', ownership:'data-ownership', sourcesOfTruth:'source-of-truth', classifications:'data-classification', retentionPolicies:'retention-policy', transactionBoundaries:'transaction-boundary', consistencyModels:'consistency-model', concurrencyControls:'concurrency-control', idempotencyRules:'idempotency-rule', reconciliationProcesses:'reconciliation-process', lineageFlows:'data-lineage-flow', migrationPolicies:'migration-policy', auditRequirements:'data-audit-requirement', unknowns:'unknown' },
    flowKeys: new Set(['reconciliationProcesses','lineageFlows','migrationPolicies'])
  },
  decisions: {
    arrays: {
      recordedDecisions:['adrs','architectureDecisions'], inferredDecisions:['inferences'], alternatives:['options'], tradeoffs:['tradeOffs'], constraints:['decisionConstraints'],
      consequences:['implications'], supersededDecisions:['deprecatedDecisions'], unknowns:['unknownRationale','gaps','openQuestions']
    },
    kinds: { recordedDecisions:'recorded-decision', inferredDecisions:'inferred-decision', alternatives:'decision-alternative', tradeoffs:'tradeoff', constraints:'decision-constraint', consequences:'decision-consequence', supersededDecisions:'superseded-decision', unknowns:'unknown' },
    flowKeys: new Set()
  },
  configuration: {
    arrays: {
      settings:['properties','configurations'], environments:['environmentMatrix'], featureFlags:['flags'], secrets:['secretSettings'], runtimeTuning:['tuning'],
      validationRules:['configValidation'], reloadBehavior:['reload','restartRequirements'], deprecations:['deprecatedSettings'], unknowns:['gaps','openQuestions']
    },
    kinds: { settings:'configuration-setting', environments:'environment-configuration', featureFlags:'feature-flag', secrets:'configuration-secret', runtimeTuning:'runtime-tuning', validationRules:'configuration-validation', reloadBehavior:'reload-behavior', deprecations:'configuration-deprecation', unknowns:'unknown' },
    flowKeys: new Set()
  },
  changeImpact: {
    arrays: {
      changeSurfaces:['changePoints','symbols'], impactEdges:['dependencies','blastRadius'], compatibilityBoundaries:['compatibility'], extensionPoints:['safeExtensionPoints'],
      migrationRisks:['risks'], affectedTests:['tests'], affectedOperations:['operationalImpact'], affectedContracts:['contracts'], unknowns:['gaps','openQuestions']
    },
    kinds: { changeSurfaces:'change-surface', impactEdges:'impact-edge', compatibilityBoundaries:'compatibility-boundary', extensionPoints:'extension-point', migrationRisks:'migration-risk', affectedTests:'affected-test', affectedOperations:'operational-impact', affectedContracts:'affected-contract', unknowns:'unknown' },
    flowKeys: new Set()
  },
  ownership: {
    arrays: {
      teams:['owners','groups'], responsibilities:['duties'], raciAssignments:['raci'], componentOwners:['serviceOwners','moduleOwners'], dataOwners:['informationOwners'],
      operationalOwners:['onCallOwners','runbookOwners'], approvalAuthorities:['approvers'], escalationPaths:['escalations'], unknowns:['gaps','openQuestions']
    },
    kinds: { teams:'team', responsibilities:'responsibility', raciAssignments:'raci-assignment', componentOwners:'component-owner', dataOwners:'data-owner', operationalOwners:'operational-owner', approvalAuthorities:'approval-authority', escalationPaths:'escalation-path', unknowns:'unknown' },
    flowKeys: new Set(['escalationPaths'])
  }
};
function normalizeEnterpriseObject(input = {}, specName) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const spec = ENTERPRISE_MODEL_SPECS[specName];
  if (!spec) throw new Error(`Unknown enterprise model spec: ${specName}`);
  const out = { schemaVersion:'1.0', generatedAt:obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now() };
  for (const [key, aliases] of Object.entries(spec.arrays)) {
    out[key] = normalizeTypedArray(obj, key, aliases, spec.kinds[key], spec.flowKeys.has(key) ? { steps:true, branches:true } : {});
  }
  out.metadata = obj.metadata ?? {};
  return out;
}
function assertEnterpriseModel(fileName, obj, specName) {
  const spec = ENTERPRISE_MODEL_SPECS[specName];
  const keys = Object.keys(spec.arrays);
  assertCanonicalModel(fileName, obj, keys);
  const groups = {};
  for (const key of keys) { assertTypedItems(`${fileName}.${key}`, obj[key], spec.kinds[key]); groups[key] = obj[key]; }
  assertGlobalUniqueIds(fileName, groups);
  return obj;
}
function normalizeSecurityObject(x={}) { return normalizeEnterpriseObject(x,'security'); }
function normalizeOperationsObject(x={}) { return normalizeEnterpriseObject(x,'operations'); }
function normalizeTestingObject(x={}) { return normalizeEnterpriseObject(x,'testing'); }
function normalizeDataGovernanceObject(x={}) { return normalizeEnterpriseObject(x,'dataGovernance'); }
function normalizeDecisionsObject(x={}) { return normalizeEnterpriseObject(x,'decisions'); }
function normalizeConfigurationObject(x={}) { return normalizeEnterpriseObject(x,'configuration'); }
function normalizeChangeImpactObject(x={}) { return normalizeEnterpriseObject(x,'changeImpact'); }
function normalizeOwnershipObject(x={}) { return normalizeEnterpriseObject(x,'ownership'); }
function normalizeUpdatePlanObject(input = {}, changedPaths = []) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const normalizedChanges = canonicalArray(obj, 'changedPaths', ['changedFiles', 'paths', 'changes']);
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    changedPaths: normalizedChanges.length ? normalizedChanges.map(String) : changedPaths.map(String),
    affectedEvidenceScopes: canonicalArray(obj, 'affectedEvidenceScopes', ['evidenceScopes', 'affectedScopes', 'scopes']).map(String),
    affectedModels: canonicalArray(obj, 'affectedModels', ['models', 'modelArtifacts', 'affectedModelArtifacts']).map((x) => typeof x === 'string' ? x : x?.path ?? x?.id ?? x?.name).filter(Boolean),
    affectedPageIds: canonicalArray(obj, 'affectedPageIds', ['pageIds', 'pages', 'affectedPages']).map((x) => typeof x === 'string' ? slug(x) : slug(x?.id ?? x?.pageId ?? x?.name)),
    rationale: canonicalArray(obj, 'rationale', ['reasons', 'reasoning', 'explanations']).map((x) => typeof x === 'string' ? x : x?.summary ?? x?.reason ?? JSON.stringify(x)),
    metadata: obj.metadata ?? {}
  };
}
function normalizeAuditReportObject(input = {}, page, options = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const findings = canonicalArray(obj, 'findings', ['issues', 'problems', 'results', 'violations']).map((f, i) => {
    if (typeof f === 'string') return { id: `finding-${i + 1}`, kind: 'audit-finding', severity: 'medium', summary: f, evidence: [] };
    const item = f && typeof f === 'object' ? { ...f } : { summary: String(f) };
    item.id = slug(item.id ?? item.code ?? `finding-${i + 1}`);
    item.kind = 'audit-finding';
    item.severity = String(item.severity ?? item.level ?? item.priority ?? 'medium').toLowerCase();
    if (!['critical', 'high', 'medium', 'low'].includes(item.severity)) item.severity = 'medium';
    item.summary ??= item.message ?? item.description ?? item.title ?? 'Unspecified finding';
    item.evidence = normalizeEvidenceRefs(canonicalArray(item, 'evidence', ['sources', 'references']));
    item.claimIds = normalizeStringRefs(canonicalArray(item, 'claimIds', ['claims']));
    delete item.level; delete item.priority; delete item.message;
    return item;
  });
  return {
    schemaVersion: '1.0', auditedAt: scalarValue(obj, ['auditedAt', 'generatedAt', 'createdAt', 'timestamp'], now()),
    pageId: slug(scalarValue(obj, ['pageId', 'pageID', 'id', 'page'], page.id)),
    pagePath: canonicalPagePath(scalarValue(obj, ['pagePath', 'path', 'file', 'documentPath'], page.path)),
    pageHash: scalarValue(obj, ['pageHash', 'hash', 'contentHash'], options.defaultHashes ? pageCurrentHash(page) : null),
    inputHash: scalarValue(obj, ['inputHash', 'pageInputHash', 'evidenceHash', 'contractHash'], options.defaultHashes ? pageInputHash(page) : null),
    findings,
    metadata: obj.metadata ?? {}
  };
}
function assertCanonicalModel(name, obj, arrayKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${name} must be a JSON object.`);
  if (obj.schemaVersion !== '1.0') throw new Error(`${name} schemaVersion must normalize to 1.0.`);
  for (const key of arrayKeys) if (!Array.isArray(obj[key])) throw new Error(`${name}.${key} must be an array after normalization.`);
  return obj;
}
function assertTypedItems(name, items, expectedKind) {
  const ids = new Set();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]; const p = `${name}[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${p} must be an object.`);
    if (!item.id || typeof item.id !== 'string') throw new Error(`${p}.id must be a non-empty string.`);
    if (ids.has(item.id)) throw new Error(`${name} contains duplicate id: ${item.id}`); ids.add(item.id);
    if (item.kind !== expectedKind) throw new Error(`${p}.kind must be ${expectedKind}.`);
    if (!['FACT', 'INFERENCE', 'UNKNOWN'].includes(item.classification)) throw new Error(`${p}.classification must be FACT, INFERENCE, or UNKNOWN.`);
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error(`${p}.confidence must be between 0 and 1.`);
    if (!Array.isArray(item.evidence) || !Array.isArray(item.sourceModelRefs) || !Array.isArray(item.unknowns)) throw new Error(`${p} evidence/sourceModelRefs/unknowns must be arrays.`);
    if (item.classification === 'FACT' && item.evidence.length === 0) throw new Error(`${p} is FACT but has no direct evidence.`);
    const aliases = buildReferenceAliases();
    for (const [j, ev] of item.evidence.entries()) {
      if (!ev || typeof ev !== 'object' || (!ev.path && !ev.symbol)) throw new Error(`${p}.evidence[${j}] requires path or symbol.`);
      if (ev.path && path.isAbsolute(ev.path)) throw new Error(`${p}.evidence[${j}].path must be repository-relative.`);
      if (ev.path) { const resolved = normalizeReference(ev.path, aliases); if (!exists(resolved)) throw new Error(`${p}.evidence[${j}] cannot resolve: ${ev.path}`); const ignored = ignoreDecision(resolved, false); if (loadConfig().ignore?.rejectIgnoredEvidence !== false && ignored.ignored) throw new Error(`${p}.evidence[${j}] references ignored source ${ev.path} (${ignored.reason}).`); }
    }
  }
}
function assertGlobalUniqueIds(name, groups) {
  const seen=new Map(); for(const [group,items] of Object.entries(groups)) for(const item of items){ if(seen.has(item.id)) throw new Error(`${name} duplicate semantic id ${item.id} in ${seen.get(item.id)} and ${group}`); seen.set(item.id,group); }
}
function assertSystemModel(obj) {
  assertCanonicalModel('system.json', obj, ['components', 'relationships', 'workflows', 'unknowns']);
  assertTypedItems('system.components', obj.components, 'component'); assertTypedItems('system.relationships', obj.relationships, 'relationship'); assertTypedItems('system.workflows', obj.workflows, 'workflow'); assertTypedItems('system.unknowns', obj.unknowns, 'unknown'); assertGlobalUniqueIds('system.json',{components:obj.components,relationships:obj.relationships,workflows:obj.workflows,unknowns:obj.unknowns}); return obj;
}
function assertBusinessModel(obj) {
  assertCanonicalModel('business.json', obj, ['actors','capabilities','concepts','businessRules','decisions','branchConditions','lifecycles','invariants','useCases','unknowns']);
  for (const [key, kind] of Object.entries({actors:'actor',capabilities:'capability',concepts:'concept',businessRules:'business-rule',decisions:'decision',branchConditions:'branch-condition',lifecycles:'lifecycle',invariants:'invariant',useCases:'use-case',unknowns:'unknown'})) assertTypedItems(`business.${key}`, obj[key], kind); assertGlobalUniqueIds('business.json',{actors:obj.actors,capabilities:obj.capabilities,concepts:obj.concepts,businessRules:obj.businessRules,decisions:obj.decisions,branchConditions:obj.branchConditions,lifecycles:obj.lifecycles,invariants:obj.invariants,useCases:obj.useCases,unknowns:obj.unknowns}); return obj;
}
function assertFlowsModel(obj) {
  assertCanonicalModel('flows.json', obj, ['businessFlows','controlFlows','requestFlows','trafficFlows','dataFlows','eventFlows']);
  for (const [key, kind] of Object.entries({businessFlows:'business-flow',controlFlows:'control-flow',requestFlows:'request-flow',trafficFlows:'traffic-flow',dataFlows:'data-flow',eventFlows:'event-flow'})) assertTypedItems(`flows.${key}`, obj[key], kind); assertGlobalUniqueIds('flows.json',{businessFlows:obj.businessFlows,controlFlows:obj.controlFlows,requestFlows:obj.requestFlows,trafficFlows:obj.trafficFlows,dataFlows:obj.dataFlows,eventFlows:obj.eventFlows}); return obj;
}
function assertCatalogsModel(obj) {
  assertCanonicalModel('catalogs.json', obj, ['endpoints','messageHandlers','externalDependencies','dataStores','scheduledJobs']);
  for (const [key, kind] of Object.entries({endpoints:'endpoint',messageHandlers:'message-handler',externalDependencies:'external-dependency',dataStores:'data-store',scheduledJobs:'scheduled-job'})) assertTypedItems(`catalogs.${key}`, obj[key], kind); assertGlobalUniqueIds('catalogs.json',{endpoints:obj.endpoints,messageHandlers:obj.messageHandlers,externalDependencies:obj.externalDependencies,dataStores:obj.dataStores,scheduledJobs:obj.scheduledJobs}); return obj;
}
function gitValue(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0 ? String(r.stdout ?? '').trim() : null;
}
function currentSourceSnapshot(force = false) {
  if (!force && sourceSnapshotCache) return { ...sourceSnapshotCache };
  const commit = gitValue(['rev-parse', 'HEAD']);
  const branch = gitValue(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirtyOutput = gitValue(['status', '--porcelain']);
  let sourceFingerprint = null;
  try { const snapshot=makeSnapshot(); sourceFingerprint = sha256Text(JSON.stringify({files:snapshot.files,ignorePolicyHash:snapshot.ignorePolicyHash})); } catch {}
  sourceSnapshotCache = { capturedAt: now(), commit, branch, dirty: dirtyOutput === null ? null : dirtyOutput.length > 0, sourceFingerprint };
  return { ...sourceSnapshotCache };
}
function traceabilityPath(page) { return path.join(traceabilityPagesRoot, `${page.id}.json`); }
function traceabilityRelPath(page) { return rel(traceabilityPath(page)); }
function normalizeClaim(value, page, index = 0) {
  const obj = typeof value === 'string' ? { statement: value } : value && typeof value === 'object' ? value : { statement: String(value ?? '') };
  const evidence = normalizeEvidenceRefs(canonicalArray(obj, 'evidence', ['sources', 'references', 'sourceRefs']));
  const modelRefs = normalizeStringRefs(canonicalArray(obj, 'sourceModelRefs', ['modelRefs', 'semanticRefs', 'catalogRefs']));
  const classification = normalizeClassification(scalarValue(obj, ['classification', 'epistemicStatus', 'status'], null), evidence);
  return {
    id: slug(scalarValue(obj, ['id', 'claimId', 'key'], `${page.id}-claim-${index + 1}`)),
    kind: 'claim',
    pageId: page.id,
    section: String(scalarValue(obj, ['section', 'heading'], 'Unmapped')),
    statement: String(scalarValue(obj, ['statement', 'claim', 'text', 'summary'], 'Unspecified claim')),
    classification,
    confidence: normalizeConfidence(scalarValue(obj, ['confidence', 'score'], null), classification),
    subject: scalarValue(obj, ['subject', 'entity'], null),
    predicate: scalarValue(obj, ['predicate', 'property', 'relation'], null),
    object: scalarValue(obj, ['object', 'value', 'target'], null),
    polarity: String(scalarValue(obj, ['polarity'], 'positive')).toLowerCase() === 'negative' ? 'negative' : 'positive',
    evidence,
    sourceModelRefs: modelRefs,
    intentionalDuplicate: Boolean(scalarValue(obj, ['intentionalDuplicate', 'repeatedForOrientation'], false)),
    exclusivePredicate: Boolean(scalarValue(obj, ['exclusivePredicate', 'singleValued', 'exclusive'], false)) || String(scalarValue(obj, ['cardinality'], '')).toLowerCase() === 'one',
    notes: scalarValue(obj, ['notes', 'note'], null),
    unknowns: canonicalArray(obj, 'unknowns', ['gaps']).map(String),
    tags: normalizeStringRefs(canonicalArray(obj, 'tags', ['labels']))
  };
}
function normalizeTraceabilityObject(input = {}, page, options = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const coverageObj = obj.coverage && typeof obj.coverage === 'object' ? obj.coverage : {};
  return {
    schemaVersion: '1.0', generatedAt: scalarValue(obj, ['generatedAt', 'createdAt', 'updatedAt'], now()),
    pageId: page.id, pagePath: page.path,
    pageHash: scalarValue(obj, ['pageHash', 'hash'], options.defaultHashes ? pageCurrentHash(page) : null),
    inputHash: scalarValue(obj, ['inputHash', 'pageInputHash'], options.defaultHashes ? pageInputHash(page) : null),
    sourceSnapshot: obj.sourceSnapshot && typeof obj.sourceSnapshot === 'object' ? { ...currentSourceSnapshot(), ...obj.sourceSnapshot } : currentSourceSnapshot(),
    claims: canonicalArray(obj, 'claims', ['statements', 'assertions', 'facts']).map((x, i) => normalizeClaim(x, page, i)),
    coverage: {
      evidenceRefsUsed: normalizeStringRefs(canonicalArray(coverageObj, 'evidenceRefsUsed', ['evidence', 'sources'])),
      modelItemRefs: normalizeStringRefs(canonicalArray(coverageObj, 'modelItemRefs', ['modelRefs', 'semanticRefs'])),
      catalogItemRefs: normalizeStringRefs(canonicalArray(coverageObj, 'catalogItemRefs', ['catalogRefs'])),
      branchItemRefs: normalizeStringRefs(canonicalArray(coverageObj, 'branchItemRefs', ['branchRefs']))
    },
    unknowns: canonicalArray(obj, 'unknowns', ['openQuestions', 'gaps']).map(String),
    legacyUnmapped: Boolean(obj.legacyUnmapped)
  };
}
function assertTraceabilityObject(obj, page) {
  if (obj.schemaVersion !== '1.0' || obj.pageId !== page.id || obj.pagePath !== page.path) throw new Error(`Traceability identity mismatch for ${page.id}.`);
  if (!Array.isArray(obj.claims) || !obj.coverage || typeof obj.coverage !== 'object') throw new Error(`Traceability for ${page.id} requires claims[] and coverage.`);
  assertTypedItems(`traceability.${page.id}.claims`, obj.claims, 'claim');
  for (const claim of obj.claims) if (claim.pageId !== page.id) throw new Error(`Traceability claim ${claim.id} pageId mismatch.`);
  return obj;
}
function ensurePageTraceability(page, options = {}) {
  const file = traceabilityPath(page);
  if (!fs.existsSync(file)) writeJson(file, normalizeTraceabilityObject({ legacyUnmapped: true, claims: [], coverage: {} }, page, { defaultHashes: true }));
  return normalizeJsonFile(file, (obj) => normalizeTraceabilityObject(obj, page, { defaultHashes: true }), (obj) => assertTraceabilityObject(obj, page));
}
function refreshPageTraceabilityHashes(page) {
  const trace=ensurePageTraceability(page); trace.pageHash=pageCurrentHash(page); trace.inputHash=pageInputHash(page); trace.sourceSnapshot=currentSourceSnapshot(); trace.generatedAt=now(); writeJson(traceabilityPath(page),trace); return trace;
}
function pageRuntimeContract(page) {
  return { ...page, traceabilityPath: traceabilityRelPath(page), traceabilityContract: { required: true, claimClassifications: ['FACT','INFERENCE','UNKNOWN'], evidenceRequiredForFacts: true }, sourceSnapshot: currentSourceSnapshot() };
}
function snapshotOutputs(paths) {
  const files = new Map();
  const directories = [];
  for (const target of paths) {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      directories.push(target);
      for (const file of listFilesRecursive(target)) files.set(file, fs.readFileSync(file));
    } else files.set(target, fs.existsSync(target) ? fs.readFileSync(target) : null);
  }
  return { files, directories };
}
function restoreOutputs(snapshot) {
  for (const dir of snapshot.directories) if (fs.existsSync(dir)) {
    for (const file of listFilesRecursive(dir)) if (!snapshot.files.has(file)) { try { fs.rmSync(file, { force: true }); } catch {} }
  }
  for (const [file, content] of snapshot.files.entries()) {
    if (content === null) { try { fs.rmSync(file, { force: true }); } catch {} }
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  }
}
function copyPathToQuarantine(source, dir) {
  if (!fs.existsSync(source)) return;
  if (fs.statSync(source).isDirectory()) {
    for (const file of listFilesRecursive(source)) {
      const target = path.join(dir, rel(file).replaceAll('/', '__'));
      try { fs.copyFileSync(file, target); } catch {}
    }
  } else {
    const target = path.join(dir, rel(source).replaceAll('/', '__'));
    try { fs.copyFileSync(source, target); } catch {}
  }
}
function quarantineOutputs(stage, paths, error) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, '.docgen', 'quarantine', `${stamp}-${stage}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const target of paths) copyPathToQuarantine(target, dir);
  writeJson(path.join(dir, 'error.json'), { schemaVersion: '1.0', stage, capturedAt: now(), error: error?.message ?? String(error), paths: paths.map(rel) });
  return rel(dir);
}
async function runContractStage(stage, paths, operation, normalizeAndValidate) {
  const snapshot = snapshotOutputs(paths);
  try {
    await operation(() => restoreOutputs(snapshot));
    return normalizeAndValidate();
  } catch (error) {
    const quarantine = quarantineOutputs(stage, paths, error);
    restoreOutputs(snapshot);
    const wrapped = new Error(`${stage} did not commit canonical output. Previous valid artifacts were restored. Raw/partial output: ${quarantine}. Cause: ${error.message}`);
    wrapped.exitCode = error?.exitCode;
    wrapped.classification = error?.classification ?? 'contract-failure';
    throw wrapped;
  }
}
function normalizeJsonFile(file, normalizer, validator) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${rel(file)}`);
  let raw;
  try { raw = readJson(file); } catch (e) { throw new Error(`Invalid JSON in ${rel(file)}: ${e.message}`); }
  const canonical = normalizer(raw);
  validator(canonical);
  writeJson(file, canonical);
  return canonical;
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
  let raw;
  try { raw = readJson(manifestPath); } catch (e) { throw new Error(`Invalid ${rel(manifestPath)}: ${e.message}`); }
  const sourcePages = arrayValue(raw, ['pages', 'documents', 'entries', 'articles'], []);
  if (!sourcePages.length) throw new Error('Manifest contains no pages/documents/entries array.');
  const aliases = buildReferenceAliases();
  const pages = sourcePages.map((value, index) => {
    const page = value && typeof value === 'object' ? value : { path: String(value) };
    const title = String(scalarValue(page, ['title', 'name', 'label'], `Page ${index + 1}`));
    const id = slug(scalarValue(page, ['id', 'pageId', 'key', 'slug'], title || page.path));
    return {
      id,
      path: canonicalPagePath(scalarValue(page, ['path', 'file', 'outputPath', 'targetPath', 'documentPath'], id)),
      title,
      type: String(scalarValue(page, ['type', 'pageType', 'kind'], 'concept')).toLowerCase(),
      category: String(scalarValue(page, ['category', 'group', 'sectionGroup'], 'Documentation')),
      section: scalarValue(page, ['section', 'subsection'], page.section),
      purpose: String(scalarValue(page, ['purpose', 'objective', 'goal'], title)),
      summary: String(scalarValue(page, ['summary', 'description', 'overview'], scalarValue(page, ['purpose', 'objective'], title))),
      evidence: arrayValue(page, ['evidence', 'sources', 'evidenceIds', 'sourceArtifacts'], []).map((x) => normalizeReference(typeof x === 'string' ? x : x?.path ?? x?.id ?? x?.name, aliases)).filter(Boolean),
      models: arrayValue(page, ['models', 'modelInputs', 'modelArtifacts'], []).map((x) => normalizeReference(typeof x === 'string' ? x : x?.path ?? x?.id ?? x?.name, aliases)).filter(Boolean),
      audience: arrayValue(page, ['audience', 'audiences', 'readers'], ['engineer']).map(String),
      requiredSections: arrayValue(page, ['requiredSections', 'sections', 'headings'], ['Overview']).map((x) => typeof x === 'string' ? x : x?.title ?? x?.name).filter(Boolean),
      diagramIntents: arrayValue(page, ['diagramIntents', 'diagrams', 'diagramRequirements'], []).map((x) => typeof x === 'string' ? x : x?.intent ?? x?.title ?? x?.type).filter(Boolean),
      coverageTags: arrayValue(page, ['coverageTags', 'coverage', 'tags'], []).map(String),
      requiredTables: arrayValue(page, ['requiredTables', 'tables', 'tableRequirements'], []).map((x) => typeof x === 'string' ? x : x?.title ?? x?.name).filter(Boolean),
      relatedPages: arrayValue(page, ['relatedPages', 'related', 'links'], []).map((x) => slug(typeof x === 'string' ? x : x?.id ?? x?.pageId ?? x?.title)).filter(Boolean),
      qualityHints: arrayValue(page, ['qualityHints', 'hints', 'qualityRequirements'], []).map(String),
      mode: String(scalarValue(page, ['mode','documentMode','intent'], page.type === 'reference' ? 'reference' : page.type === 'troubleshooting' ? 'troubleshooting' : page.type === 'guide' ? 'how-to' : 'explanation')).toLowerCase(),
      aliases: arrayValue(page, ['aliases','redirectFrom','legacyPaths'], []).map((x)=>canonicalPagePath(x)).filter((x)=>x!==canonicalPagePath(scalarValue(page, ['path','file','outputPath','targetPath','documentPath'], id))),
      status: String(scalarValue(page, ['status','lifecycleStatus','publicationStatus'], 'active')).toLowerCase(),
      version: scalarValue(page, ['version','docVersion','since'], null),
      deprecatedSince: scalarValue(page, ['deprecatedSince','deprecated','sunsetVersion'], null),
      replacementPage: scalarValue(page, ['replacementPage','replacement','supersededBy'], null) ? slug(scalarValue(page, ['replacementPage','replacement','supersededBy'], null)) : null,
      migrationFrom: arrayValue(page, ['migrationFrom','fromVersions','sourceVersions'], []).map(String),
      migrationTo: scalarValue(page, ['migrationTo','targetVersion'], null),
      exampleIntents: arrayValue(page, ['exampleIntents','examples','scenarios'], []).map((x)=>typeof x==='string'?x:x?.title??x?.name??x?.intent).filter(Boolean),
      searchKeywords: arrayValue(page, ['searchKeywords','keywords','searchTerms'], []).map(String),
      frontmatter: page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : {}
    };
  });
  const pageIdByAlias = new Map();
  for (const p of pages) {
    for (const alias of [p.id, p.title, p.path, p.path.replace(/^docs\//, '').replace(/\.md$/i, ''), path.posix.basename(p.path, '.md')]) pageIdByAlias.set(slug(alias), p.id);
  }
  for (const p of pages) {
    p.replacementPage = p.replacementPage ? (pageIdByAlias.get(slug(p.replacementPage)) ?? slug(p.replacementPage)) : null;
    p.aliases = [...new Set((p.aliases ?? []).filter((x)=>x!==p.path))];
  }
  const rawNavigation = arrayValue(raw, ['navigation', 'categories', 'groups', 'sections'], []);
  const navigation = rawNavigation.map((value, index) => {
    const group = value && typeof value === 'object' ? value : { title: String(value) };
    const title = String(scalarValue(group, ['title', 'name', 'label'], `Section ${index + 1}`));
    const groupPages = arrayValue(group, ['pages', 'pageIds', 'items', 'documents'], []).map((x) => {
      const rawId = typeof x === 'string' ? x : x?.id ?? x?.pageId ?? x?.path ?? x?.title;
      return pageIdByAlias.get(slug(rawId)) ?? slug(rawId);
    }).filter(Boolean);
    return { id: slug(scalarValue(group, ['id', 'key', 'slug'], title)), title, description: group.description ?? group.summary, pages: groupPages };
  });
  const manifest = {
    schemaVersion: '1.0',
    generatedAt: raw.generatedAt ?? raw.createdAt ?? raw.updatedAt ?? now(),
    navigation,
    pages,
    metadata: raw.metadata ?? {}
  };
  if (write) writeJson(manifestPath, manifest);
  return manifest;
}
function manifestPreflight(manifest = normalizeManifest(), options = {}) {
  const errors = []; const warnings = []; const ids = new Set(); const paths = new Set();
  const cfg=loadConfig();
  const allowedTypes = new Set(cfg.pageTypes ?? ['overview','architecture','business','concept','flow','guide','reference','data','integration','operations','troubleshooting']);
  const allowedModes = new Set(cfg.documentationExperience?.modes ?? ['tutorial','how-to','explanation','reference','runbook','decision-record','migration-guide','troubleshooting']);
  const aliasOwners=new Map();
  for (const page of manifest.pages) {
    if (ids.has(page.id)) errors.push(`duplicate page id: ${page.id}`); ids.add(page.id);
    if (paths.has(page.path)) errors.push(`duplicate page path: ${page.path}`);
    if (aliasOwners.has(page.path)) errors.push(`${page.id}: canonical path collides with alias owned by ${aliasOwners.get(page.path)}: ${page.path}`);
    paths.add(page.path);
    if (!page.title?.trim()) errors.push(`${page.id}: title is required`);
    if (!page.category?.trim()) errors.push(`${page.id}: category is required`);
    if (!allowedTypes.has(page.type)) errors.push(`${page.id}: unsupported page type ${page.type}`);
    if (!allowedModes.has(page.mode)) errors.push(`${page.id}: unsupported document mode ${page.mode}`);
    if (!Array.isArray(page.requiredSections) || !page.requiredSections.length) errors.push(`${page.id}: requiredSections must not be empty`);
    for (const alias of page.aliases ?? []) { if(aliasOwners.has(alias)) errors.push(`${page.id}: duplicate alias ${alias} also owned by ${aliasOwners.get(alias)}`); else aliasOwners.set(alias,page.id); if(paths.has(alias)) errors.push(`${page.id}: alias collides with canonical page path ${alias}`); }
    if(page.replacementPage && !manifest.pages.some((p)=>p.id===page.replacementPage)) warnings.push(`${page.id}: replacementPage does not exist: ${page.replacementPage}`);
    if(page.status==='deprecated' && !page.deprecatedSince) warnings.push(`${page.id}: deprecated page should declare deprecatedSince`);
    for (const ref of [...(page.evidence ?? []), ...(page.models ?? [])]) if (typeof ref === 'string' && !exists(ref)) errors.push(`${page.id}: unresolved input reference: ${ref}`);
  }
  const navigationCounts = new Map();
  for (const group of manifest.navigation ?? []) for (const id of group.pages ?? []) {
    const pageId = typeof id === 'string' ? id : id?.id;
    if (pageId && !ids.has(pageId)) errors.push(`navigation ${group.id ?? group.title}: unknown page id ${pageId}`);
    else if (pageId) navigationCounts.set(pageId, (navigationCounts.get(pageId) ?? 0) + 1);
  }
  if ((manifest.navigation ?? []).length) for (const id of ids) {
    const count = navigationCounts.get(id) ?? 0;
    if (count === 0) errors.push(`page is missing from navigation: ${id}`);
    if (count > 1) errors.push(`page appears in multiple navigation groups: ${id}`);
  }
  for (const page of manifest.pages) for (const related of page.relatedPages ?? []) if (!ids.has(related)) warnings.push(`${page.id}: related page does not exist: ${related}`);
  const coverageGaps = options.includeCoverage === false ? [] : manifestCoverageGaps(manifest);
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
function canonicalEvidencePath(rawPath, evidenceDir) {
  let value = String(rawPath ?? '').trim().replaceAll('\\', '/');
  if (!value) return '';
  if (path.isAbsolute(value)) value = rel(value);
  value = value.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!value.startsWith('.docgen/evidence/')) {
    const direct = path.join(root, value);
    const underEvidence = path.join(evidenceDir, value.replace(/^evidence\//, ''));
    if (fs.existsSync(underEvidence) || !fs.existsSync(direct)) value = rel(underEvidence);
  }
  value = path.posix.normalize(value);
  if (!value.startsWith('.docgen/evidence/') || value.includes('/../')) throw new Error(`Unsafe evidence artifact path: ${rawPath}`);
  return value;
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
      const p = canonicalEvidencePath(item, evidenceDir);
      return { id: slug(path.basename(p, path.extname(p))), path: p, kind: 'evidence', scope: '.' };
    }
    const x = item && typeof item === 'object' ? item : {};
    let p = canonicalEvidencePath(x.path ?? x.file ?? x.filePath ?? x.relativePath ?? x.artifactPath ?? '', evidenceDir);
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
  const ids = new Set();
  for (const artifact of artifacts) {
    artifact.id = slug(artifact.id);
    if (ids.has(artifact.id)) throw new Error(`Duplicate evidence artifact id: ${artifact.id}`);
    ids.add(artifact.id);
    const artifactFile = path.join(root, artifact.path);
    if (!fs.existsSync(artifactFile) || !fs.statSync(artifactFile).isFile()) throw new Error(`Evidence artifact does not exist: ${artifact.path}`);
    if (artifactFile.endsWith('.json')) { try { readJson(artifactFile); } catch (e) { throw new Error(`Invalid evidence JSON ${artifact.path}: ${e.message}`); } }
  }
  const canonical = {
    schemaVersion: '1.0',
    generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? now(),
    repository: obj.repository ?? {},
    artifacts: artifacts.map((a) => ({ id: a.id, path: a.path, kind: a.kind, scope: a.scope, summary: a.summary, factCount: a.factCount })).map((a) => Object.fromEntries(Object.entries(a).filter(([,v]) => v !== undefined))),
    metadata: obj.metadata ?? {}
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
  // Normalize in memory as well as at stage commit boundaries. This keeps manual
  // preflight/validate resilient when a repository still contains pre-v0.6 aliases.
  const system = normalizeSystemObject(loadOptionalJson(systemPath, {}));
  const business = normalizeBusinessObject(loadOptionalJson(businessPath, {}));
  const flows = normalizeFlowsObject(loadOptionalJson(flowsPath, {}));
  const catalogs = normalizeCatalogsObject(loadOptionalJson(catalogsPath, {}));
  const security = normalizeSecurityObject(loadOptionalJson(securityPath, {}));
  const operations = normalizeOperationsObject(loadOptionalJson(operationsPath, {}));
  const testing = normalizeTestingObject(loadOptionalJson(testingPath, {}));
  const dataGovernance = normalizeDataGovernanceObject(loadOptionalJson(dataGovernancePath, {}));
  const decisions = normalizeDecisionsObject(loadOptionalJson(decisionsPath, {}));
  const configuration = normalizeConfigurationObject(loadOptionalJson(configurationPath, {}));
  const changeImpact = normalizeChangeImpactObject(loadOptionalJson(changeImpactPath, {}));
  const ownership = normalizeOwnershipObject(loadOptionalJson(ownershipPath, {}));
  const required = [['system-overview', true], ['architecture', true]];
  if ((business.capabilities ?? []).length) required.push(['business-domain', true]);
  if ((business.businessRules ?? []).length) required.push(['business-rules', true]);
  if ((business.branchConditions ?? []).length) required.push(['branch-conditions', true]);
  if ((business.lifecycles ?? []).length) required.push(['state-lifecycle', true]);
  for (const [key, tag] of [['businessFlows','business-flow'],['controlFlows','control-flow'],['requestFlows','request-flow'],['trafficFlows','traffic-flow'],['dataFlows','data-flow'],['eventFlows','event-flow']]) if ((flows[key] ?? []).length) required.push([tag, true]);
  if ((catalogs.endpoints ?? []).length) required.push(['endpoint-catalog', true]);
  if ((catalogs.messageHandlers ?? []).length) required.push(['message-handler-catalog', true]);
  if ((catalogs.externalDependencies ?? []).length) required.push(['external-dependency-catalog', true]);
  if (security.trustBoundaries.length || security.authenticationFlows.length) required.push(['security-trust-boundaries', true]);
  if (security.authorizationRules.length || security.permissions.length) required.push(['authorization-model', true]);
  if (Object.values(dataGovernance).some((v)=>Array.isArray(v)&&v.length)) required.push(['data-governance', true]);
  if (dataGovernance.transactionBoundaries.length || dataGovernance.consistencyModels.length || dataGovernance.concurrencyControls.length || dataGovernance.idempotencyRules.length) required.push(['consistency-transactions', true]);
  if (operations.observabilitySignals.length || operations.healthChecks.length || operations.alerts.length || operations.slis.length || operations.slos.length) required.push(['operations-observability', true]);
  if (operations.failureModes.length || operations.recoveryProcedures.length || operations.backups.length) required.push(['failure-recovery', true]);
  if (Object.values(testing).some((v)=>Array.isArray(v)&&v.length)) required.push(['testing-strategy', true]);
  if (configuration.settings.length || configuration.environments.length || configuration.featureFlags.length) required.push(['configuration-matrix', true]);
  if (decisions.recordedDecisions.length || decisions.inferredDecisions.length) required.push(['architecture-decisions', true]);
  if (changeImpact.changeSurfaces.length || changeImpact.impactEdges.length || changeImpact.compatibilityBoundaries.length) required.push(['change-impact', true]);
  if (ownership.teams.length || ownership.responsibilities.length || ownership.componentOwners.length || ownership.dataOwners.length || ownership.operationalOwners.length) required.push(['ownership-responsibilities', true]);
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

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}
function pageFrontmatter(page) {
  let trace=null; try{if(fs.existsSync(traceabilityPath(page)))trace=readJson(traceabilityPath(page));}catch{}
  const snapshot=trace?.sourceSnapshot??currentSourceSnapshot();
  const verifiedAt=snapshot?.capturedAt??loadPageState().pages?.[page.id]?.generatedAt??now();
  return {
    title:page.title, description:page.summary||page.purpose, pageId:page.id, category:page.category, mode:page.mode,
    type:page.type, order:Number(page.order??0), audience:page.audience??[], status:page.status??'active',
    version:page.version??null, deprecatedSince:page.deprecatedSince??null, replacementPage:page.replacementPage??null,
    aliases:page.aliases??[], sourceCommit:snapshot?.commit??null, lastVerified:String(verifiedAt).slice(0,10),
    coverage:page.coverageTags??[], ...(page.frontmatter??{})
  };
}
function renderYamlFrontmatter(obj) {
  const lines=['---'];
  for(const [key,value] of Object.entries(obj)){
    if(value===null||value===undefined||value==='')continue;
    if(Array.isArray(value)){lines.push(`${key}:`);for(const x of value)lines.push(`  - ${yamlScalar(x)}`);} else lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---',''); return lines.join('\n');
}
function ensurePageFrontmatter(page) {
  const file=pageFile(page); if(!fs.existsSync(file))return;
  let body=fs.readFileSync(file,'utf8');
  if(/^---\s*\n[\s\S]*?\n---\s*\n/.test(body)) body=body.replace(/^---\s*\n[\s\S]*?\n---\s*\n/,'');
  const next=renderYamlFrontmatter(pageFrontmatter(page))+body.replace(/^\s+/,'');
  if(fs.readFileSync(file,'utf8')!==next)fs.writeFileSync(file,next);
}
function stripFrontmatter(text){return String(text).replace(/^---\s*\n[\s\S]*?\n---\s*\n/,'');}
function markdownExcerpt(text,max=320){return stripFrontmatter(text).replace(/```[\s\S]*?```/g,' ').replace(/[#>*_`\[\]()]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function extractHeadings(text){return [...stripFrontmatter(text).matchAll(/^(#{2,6})\s+(.+)$/gm)].map((m)=>({level:m[1].length,title:m[2].trim(),anchor:slug(m[2])}));}
function extractExamples(page,text){
  const lines=stripFrontmatter(text).split(/\r?\n/);const out=[];let trace={claims:[]};try{if(fs.existsSync(traceabilityPath(page)))trace=readJson(traceabilityPath(page));}catch{}
  for(let i=0;i<lines.length;i++)if(/^#{2,6}\s+.*(?:example|scenario|contoh|sample|walkthrough)/i.test(lines[i])){const title=lines[i].replace(/^#+\s+/,'').trim();const buf=[];for(let j=i+1;j<lines.length&&!/^#{2,6}\s+/.test(lines[j]);j++)buf.push(lines[j]);const matching=(trace.claims??[]).filter((c)=>normalizeHeading(c.section).includes(normalizeHeading(title))||normalizeHeading(title).includes(normalizeHeading(c.section)));const evidenceRefs=[...new Set(matching.flatMap((c)=>(c.evidence??[]).map((e)=>e.path)).filter(Boolean))];const modelRefs=[...new Set(matching.flatMap((c)=>c.sourceModelRefs??[]).filter(Boolean))];out.push({id:`${page.id}-${slug(title)}`,pageId:page.id,title,summary:markdownExcerpt(buf.join('\n'),500),evidenceDerived:evidenceRefs.length+modelRefs.length>0,evidenceRefs,modelRefs});}
  return out;
}
function doPublish() {
  const manifest=requireManifestPreflight(); const cfg=loadConfig().documentationExperience??{}; fs.mkdirSync(publishRoot,{recursive:true});
  const byId=new Map(manifest.pages.map((p)=>[p.id,p])); const navigation=[]; const search=[]; const backlinks={}; const redirects=[]; const examples=[];
  for(const group of manifest.navigation??[]) navigation.push({...group,pages:(group.pages??[]).map((id)=>{const p=byId.get(typeof id==='string'?id:id.id);return p?{id:p.id,title:p.title,path:p.path,mode:p.mode,status:p.status,summary:p.summary}:null;}).filter(Boolean)});
  for(const page of manifest.pages){
    const file=pageFile(page); if(!fs.existsSync(file))continue; ensurePageFrontmatter(page); const md=fs.readFileSync(file,'utf8');
    search.push({id:page.id,title:page.title,path:page.path,category:page.category,mode:page.mode,type:page.type,status:page.status,summary:page.summary,keywords:[...(page.searchKeywords??[]),...(page.coverageTags??[])],headings:extractHeadings(md),excerpt:markdownExcerpt(md),updatedAt:fs.statSync(file).mtime.toISOString()});
    backlinks[page.id]??=[]; for(const target of page.relatedPages??[]){backlinks[target]??=[];backlinks[target].push({pageId:page.id,path:page.path,title:page.title,relation:'related'});}
    for(const alias of page.aliases??[])redirects.push({from:alias,to:page.path,pageId:page.id,status:page.status});
    examples.push(...extractExamples(page,md));
  }
  const linked=new Set((manifest.navigation??[]).flatMap((g)=>g.pages??[]).map((x)=>typeof x==='string'?x:x.id)); const orphans=manifest.pages.filter((p)=>!linked.has(p.id)).map((p)=>({id:p.id,path:p.path,title:p.title}));
  writeJson(navigationIndexPath,{schemaVersion:'1.0',generatedAt:now(),navigation}); writeJson(searchIndexPath,{schemaVersion:'1.0',generatedAt:now(),pages:search}); writeJson(backlinksPath,{schemaVersion:'1.0',generatedAt:now(),backlinks}); writeJson(redirectsPath,{schemaVersion:'1.0',generatedAt:now(),redirects}); writeJson(orphansPath,{schemaVersion:'1.0',generatedAt:now(),orphans}); writeJson(examplesIndexPath,{schemaVersion:'1.0',generatedAt:now(),examples});
  const llms=['# '+(loadConfig().projectName||path.basename(root)),'','> '+(manifest.metadata?.description||'Generated system knowledge base.'),''];
  for(const group of navigation){llms.push(`## ${group.title}`,'');for(const p of group.pages)llms.push(`- [${p.title}](${p.path.replace(/^docs\//,'')}) — ${p.summary??''}`);llms.push('');}
  fs.writeFileSync(path.join(root,'docs','llms.txt'),llms.join('\n').trimEnd()+'\n');
  if(cfg.generateLlmsFull!==false){const max=Number(cfg.llmsFullMaxBytes??5*1024*1024);let full=llms.join('\n')+'\n';for(const p of manifest.pages){const f=pageFile(p);if(!fs.existsSync(f))continue;const chunk=`\n\n# ${p.title}\n\nSource: ${p.path}\n\n${stripFrontmatter(fs.readFileSync(f,'utf8'))}`;if(Buffer.byteLength(full+chunk)>max)break;full+=chunk;}fs.writeFileSync(path.join(root,'docs','llms-full.txt'),full.trimEnd()+'\n');}
  const report={schemaVersion:'1.0',generatedAt:now(),pages:search.length,navigationGroups:navigation.length,redirects:redirects.length,backlinkTargets:Object.keys(backlinks).length,orphans:orphans.length,examples:examples.length,artifacts:[rel(navigationIndexPath),rel(searchIndexPath),rel(backlinksPath),rel(redirectsPath),rel(orphansPath),rel(examplesIndexPath),'docs/llms.txt',...(cfg.generateLlmsFull===false?[]:['docs/llms-full.txt'])]};writeJson(publishingReportPath,report);
  console.log(`Publishing metadata generated: ${search.length} pages, ${navigation.length} groups, ${redirects.length} redirects, ${examples.length} examples, ${orphans.length} orphans.`); return report;
}

function reconcileGeneratedPage(page) {
  const expected = pageFile(page);
  if (fs.existsSync(expected)) return expected;
  const docsRoot = path.join(root, 'docs');
  if (!fs.existsSync(docsRoot)) return expected;
  const expectedKey = canonicalPagePath(page.path).replace(/^docs\//, '').replace(/\.md$/i, '').toLowerCase();
  const candidates = listFilesRecursive(docsRoot).filter((f) => /(?:\.md|\.markdown)?$/i.test(f)).filter((f) => {
    const rp = rel(f).replace(/^docs\//, '').replace(/(?:\.md|\.markdown)$/i, '').toLowerCase();
    const base = slug(path.basename(rp));
    return rp === expectedKey || base === slug(page.id) || base === slug(page.title);
  });
  const manifest = fs.existsSync(manifestPath) ? normalizeManifest(false) : { pages: [] };
  const owned = new Set((manifest.pages ?? []).filter((p) => p.id !== page.id).map((p) => canonicalPagePath(p.path)));
  const unique = candidates.filter((f) => !owned.has(rel(f)));
  if (unique.length === 1) {
    fs.mkdirSync(path.dirname(expected), { recursive: true });
    fs.renameSync(unique[0], expected);
    console.log(`[docgen] reconciled generated page path: ${rel(unique[0])} -> ${page.path}`);
  }
  return expected;
}

function validatePageFile(page) {
  const file = reconcileGeneratedPage(page);
  if (!fs.existsSync(file)) throw new Error(`Missing generated page: ${page.path}`);
  ensurePageFrontmatter(page);
  const text = fs.readFileSync(file, 'utf8');
  if (!/^---\s*\n[\s\S]*?\n---\s*\n/.test(text)) throw new Error(`${page.path} has no publishing frontmatter`);
  if (!/^#\s+\S/m.test(stripFrontmatter(text))) throw new Error(`${page.path} has no H1 heading`);
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
  const requiredAgents = ['doc-discoverer', 'doc-architect', 'doc-domain-analyst', 'doc-enterprise-analyst', 'doc-planner', 'doc-writer', 'doc-auditor'];
  for (const a of requiredAgents) if (!fs.existsSync(path.join(commandCodeHome, 'agents', `${a}.md`))) errors.push(`Missing global agent: ${a}`);
  const requiredCommands = ['docgen-init', 'docgen-doctor', 'docgen-discover', 'docgen-analyze', 'docgen-plan', 'docgen-generate', 'docgen-audit', 'docgen-fix', 'docgen-update', 'docgen-status', 'docgen-enrich', 'docgen-quality', 'docgen-semantics', 'docgen-preflight', 'docgen-resume', 'docgen-contract-test', 'docgen-traceability', 'docgen-enterprise', 'docgen-ignore', 'docgen-publish'];
  for (const c of requiredCommands) if (!fs.existsSync(path.join(commandCodeHome, 'commands', `${c}.md`))) errors.push(`Missing global command: ${c}`);
  for (const prompt of ['discover.md', 'analyze.md', 'semantics.md', 'enterprise.md', 'plan.md', 'generate.md', 'enrich.md', 'audit.md', 'fix.md', 'update-impact.md', 'generate-batch.md', 'enrich-batch.md', 'audit-batch.md']) if (!fs.existsSync(assetFile('prompts', prompt))) errors.push(`Missing prompt: ${prompt}`);
  for (const schema of ['evidence-artifact.schema.json', 'evidence-index.schema.json', 'component.schema.json', 'workflow.schema.json', 'system.schema.json', 'business.schema.json', 'flows.schema.json', 'catalogs.schema.json', 'manifest.schema.json', 'audit-page.schema.json', 'audit-index.schema.json', 'update-plan.schema.json', 'semantic-item.schema.json', 'traceability.schema.json', 'quality-summary.schema.json', 'security.schema.json', 'operations.schema.json', 'testing.schema.json', 'data-governance.schema.json', 'decisions.schema.json', 'configuration.schema.json', 'change-impact.schema.json', 'ownership.schema.json', 'publishing-index.schema.json']) {
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
  try { if (fs.existsSync(evidenceIndexPath)) normalizeEvidenceIndex(); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(systemPath)) normalizeJsonFile(systemPath, normalizeSystemObject, assertSystemModel); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(businessPath)) normalizeJsonFile(businessPath, normalizeBusinessObject, assertBusinessModel); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(flowsPath)) normalizeJsonFile(flowsPath, normalizeFlowsObject, assertFlowsModel); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(catalogsPath)) normalizeJsonFile(catalogsPath, normalizeCatalogsObject, assertCatalogsModel); } catch (e) { errors.push(e.message); }
  for (const file of ENTERPRISE_PASSES.flatMap((p)=>p.outputs)) { try { if (fs.existsSync(file)) normalizeEnterpriseFile(file); } catch (e) { errors.push(e.message); } }
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
        if (fs.existsSync(path.join(root, page.path))) { try { validatePageFile(page); ensurePageTraceability(page); pageQualityReport(page); } catch (e) { errors.push(e.message); } }
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
  const normalizedScope = normalizeRepoPath(scope);
  if (normalizedScope && normalizedScope !== '.' && fs.existsSync(path.join(root, normalizedScope))) { const d=ignoreDecision(normalizedScope, fs.statSync(path.join(root, normalizedScope)).isDirectory()); if (d.ignored) fail(`Discovery scope is ignored: ${scope} (${d.reason}).`); }
  const inventory = writeSourceInventory();
  updateStage('discover', 'running', { scope, includedFiles: inventory.includedCount });
  try {
    const evidenceIndex = await runContractStage('discover', [path.dirname(evidenceIndexPath)],
      (reset) => runCommandCode('discover', renderPrompt('discover.md', { SCOPE: scope, SOURCE_INVENTORY: rel(sourceFilesPath), IGNORE_REPORT: rel(ignoreReportPath) }), scope, progressLabel, { beforeRetry: reset }),
      () => normalizeEvidenceIndex());
    updateStage('discover', 'completed', { scope, artifactCount: evidenceIndex.artifacts.length, includedFiles: inventory.includedCount });
  } catch (e) { updateStage('discover', 'failed', { scope, error: e.message }); throw e; }
}
async function doAnalyze(scope = 'all current evidence', progressLabel = '') {
  if (!fs.existsSync(evidenceIndexPath)) fail('Run discover first.');
  normalizeEvidenceIndex();
  updateStage('analyze', 'running', { scope });
  try {
    const system = await runContractStage('analyze', [systemPath],
      (reset) => runCommandCode('analyze', renderPrompt('analyze.md', { SCOPE: scope }), scope, progressLabel, { beforeRetry: reset }),
      () => normalizeJsonFile(systemPath, normalizeSystemObject, assertSystemModel));
    updateStage('analyze', 'completed', { scope, components: system.components.length, relationships: system.relationships.length, workflows: system.workflows.length });
  } catch (e) { updateStage('analyze', 'failed', { scope, error: e.message }); throw e; }
}
async function doSemantics(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  normalizeJsonFile(systemPath, normalizeSystemObject, assertSystemModel);
  updateStage('semantics', 'running');
  try {
    const [business, flows, catalogs] = await runContractStage('semantics', [businessPath, flowsPath, catalogsPath],
      (reset) => runCommandCode('semantics', renderPrompt('semantics.md'), '', progressLabel, { beforeRetry: reset }),
      () => [
        normalizeJsonFile(businessPath, normalizeBusinessObject, assertBusinessModel),
        normalizeJsonFile(flowsPath, normalizeFlowsObject, assertFlowsModel),
        normalizeJsonFile(catalogsPath, normalizeCatalogsObject, assertCatalogsModel)
      ]);
    updateStage('semantics', 'completed', { endpoints: catalogs.endpoints.length, messageHandlers: catalogs.messageHandlers.length, externalDependencies: catalogs.externalDependencies.length, businessRules: business.businessRules.length, flows: Object.values(flows).filter(Array.isArray).reduce((n, x) => n + x.length, 0) });
  } catch (e) { updateStage('semantics', 'failed', { error: e.message }); throw e; }
}

const ENTERPRISE_PASSES = [
  { id:'governance', outputs:[securityPath, ownershipPath], prompt:'enterprise.md' },
  { id:'operability', outputs:[operationsPath, testingPath], prompt:'enterprise.md' },
  { id:'data-and-configuration', outputs:[dataGovernancePath, configurationPath], prompt:'enterprise.md' },
  { id:'evolution', outputs:[decisionsPath, changeImpactPath], prompt:'enterprise.md' }
];
function normalizeEnterpriseFile(file) {
  const base = path.basename(file, '.json');
  const map = {
    security:[normalizeSecurityObject, (x)=>assertEnterpriseModel('security.json',x,'security')],
    operations:[normalizeOperationsObject, (x)=>assertEnterpriseModel('operations.json',x,'operations')],
    testing:[normalizeTestingObject, (x)=>assertEnterpriseModel('testing.json',x,'testing')],
    'data-governance':[normalizeDataGovernanceObject, (x)=>assertEnterpriseModel('data-governance.json',x,'dataGovernance')],
    decisions:[normalizeDecisionsObject, (x)=>assertEnterpriseModel('decisions.json',x,'decisions')],
    configuration:[normalizeConfigurationObject, (x)=>assertEnterpriseModel('configuration.json',x,'configuration')],
    'change-impact':[normalizeChangeImpactObject, (x)=>assertEnterpriseModel('change-impact.json',x,'changeImpact')],
    ownership:[normalizeOwnershipObject, (x)=>assertEnterpriseModel('ownership.json',x,'ownership')]
  };
  if (!map[base]) throw new Error(`Unknown enterprise artifact: ${file}`);
  return normalizeJsonFile(file, map[base][0], map[base][1]);
}
async function doEnterprise(progressLabel = '') {
  if (!fs.existsSync(systemPath) || !fs.existsSync(businessPath) || !fs.existsSync(catalogsPath)) fail('Run analyze and semantics first.');
  updateStage('enterprise', 'running', { passCount: ENTERPRISE_PASSES.length });
  try {
    for (let i=0;i<ENTERPRISE_PASSES.length;i++) {
      const pass=ENTERPRISE_PASSES[i];
      printItemProgress('enterprise pass', i+1, ENTERPRISE_PASSES.length, pass.id);
      const outputContracts=pass.outputs.map((f)=>rel(f));
      await runContractStage(`enterprise-${pass.id}`, pass.outputs,
        (reset)=>runCommandCode('enterprise', renderPrompt(pass.prompt, { ENTERPRISE_PASS:pass.id, OUTPUT_PATHS_JSON:JSON.stringify(outputContracts,null,2) }), pass.id, progressLabel || `enterprise ${i+1}/${ENTERPRISE_PASSES.length}`, { beforeRetry:reset }),
        ()=>pass.outputs.map(normalizeEnterpriseFile));
    }
    const counts={};
    for (const file of ENTERPRISE_PASSES.flatMap((p)=>p.outputs)) { const obj=normalizeEnterpriseFile(file); counts[path.basename(file,'.json')]=Object.values(obj).filter(Array.isArray).reduce((n,a)=>n+a.length,0); }
    updateStage('enterprise','completed',{passCount:ENTERPRISE_PASSES.length,models:counts});
  } catch(e) { updateStage('enterprise','failed',{error:e.message}); throw e; }
}
async function doPlan(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  normalizeJsonFile(systemPath, normalizeSystemObject, assertSystemModel);
  if (fs.existsSync(businessPath)) normalizeJsonFile(businessPath, normalizeBusinessObject, assertBusinessModel);
  if (fs.existsSync(flowsPath)) normalizeJsonFile(flowsPath, normalizeFlowsObject, assertFlowsModel);
  if (fs.existsSync(catalogsPath)) normalizeJsonFile(catalogsPath, normalizeCatalogsObject, assertCatalogsModel);
  if (loadConfig().enterpriseDepth?.enabled !== false) {
    for (const file of ENTERPRISE_PASSES.flatMap((p)=>p.outputs)) { if (!fs.existsSync(file)) fail(`Missing ${rel(file)}. Run enterprise first.`); normalizeEnterpriseFile(file); }
  }
  updateStage('plan', 'running');
  try {
    await runContractStage('plan', [manifestPath],
      (reset) => runCommandCode('plan', renderPrompt('plan.md', { MISSING_COVERAGE: '' }), '', progressLabel, { beforeRetry: reset }),
      () => { const manifest = normalizeManifest(); const preflight = manifestPreflight(manifest, { includeCoverage: false }); if (!preflight.valid) throw new Error(`Manifest preflight failed:\n- ${preflight.errors.join('\n- ')}`); return manifest; });
    let manifest = normalizeManifest();
    let gaps = manifestCoverageGaps(manifest);
    if (gaps.length && isComprehensive()) {
      console.log(`[docgen] manifest coverage gaps detected: ${gaps.join(', ')}. Running one bounded coverage-repair planning pass.`);
      await runContractStage('plan-coverage-repair', [manifestPath],
        (reset) => runCommandCode('plan', renderPrompt('plan.md', { MISSING_COVERAGE: `The current manifest is missing these required evidence-backed coverage tags: ${gaps.join(', ')}. Reconcile the manifest so each is owned by an appropriate page; do not add unsupported content.` }), 'coverage-repair', progressLabel, { beforeRetry: reset }),
        () => normalizeManifest());
      manifest = normalizeManifest(); gaps = manifestCoverageGaps(manifest);
    }
    if (gaps.length) throw new Error(`Manifest coverage gaps remain: ${gaps.join(', ')}`);
    const preflight = manifestPreflight(manifest);
    if (!preflight.valid) throw new Error(`Manifest preflight failed immediately after planning:\n- ${preflight.errors.join('\n- ')}\nReport: ${rel(preflightPath)}`);
    writeNavigationSummary(manifest);
    updateStage('plan', 'completed', { pageCount: manifest.pages.length, navigationGroups: manifest.navigation.length, preflight: 'passed' });
  } catch (e) { updateStage('plan', 'failed', { error: e.message }); throw e; }
}
function pageFile(page) { return path.join(root, canonicalPagePath(page.path)); }
function pageIsValid(page) { try { validatePageFile(page); return true; } catch { return false; } }
function pageCurrentHash(page) { const f=pageFile(page); return fs.existsSync(f)?sha256Text(stripFrontmatter(fs.readFileSync(f,'utf8'))):null; }
function pageInputHash(page) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({ ...page, evidence: [...(page.evidence ?? [])].sort(), models: [...(page.models ?? [])].sort() }));
  for (const ref of [...(page.evidence ?? []), ...(page.models ?? [])].sort()) {
    const file = path.join(root, ref);
    hash.update(`\n${ref}:`);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) hash.update(fs.readFileSync(file));
    else hash.update('MISSING');
  }
  return hash.digest('hex');
}
function pageIsReusable(page) {
  if (!pageIsValid(page)) return false;
  const currentInputHash = pageInputHash(page);
  const state = loadPageState().pages?.[page.id];
  if (state?.generateInputHash === currentInputHash) return true;
  const pageState=loadPageState();
  const preP2=String(pageState.kitVersion??'0.0.0').localeCompare('0.9.0',undefined,{numeric:true,sensitivity:'base'})<0;
  if ((!state?.generateInputHash || (preP2 && loadConfig().documentationExperience?.adoptPreP2Pages !== false)) && executionConfig().adoptLegacyValidPages) {
    updatePageState(page.id, { generateStatus: 'completed', generatedAt: state?.generatedAt ?? now(), pageHash: pageCurrentHash(page), generateInputHash: currentInputHash, targetPath: page.path, adoptedLegacyValidPage: true, adoptedP2Metadata:preP2 });
    console.log(`[docgen] adopted legacy valid page checkpoint: ${page.id}${preP2?' (P2 metadata/frontmatter migration)':''}`);
    return true;
  }
  return false;
}
function pageNeedsEnrichment(page) { try { return pageQualityReport(page).errors.length > 0; } catch { return true; } }
function executionConfig() {
  const e = loadConfig().execution ?? {};
  return {
    generateBatchSize: Math.max(1, Number(e.generateBatchSize ?? 4)),
    auditBatchSize: Math.max(1, Number(e.auditBatchSize ?? 6)),
    enrichBatchSize: Math.max(1, Number(e.enrichBatchSize ?? 4)),
    resumeByDefault: e.resumeByDefault !== false,
    skipValidPages: e.skipValidPages !== false,
    adoptLegacyValidPages: e.adoptLegacyValidPages !== false,
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
  if (!force && executionConfig().skipValidPages && pageIsReusable(page)) {
    console.log(`[docgen] SKIP generate:${id} — valid page already exists at ${page.path}`);
  } else {
    updatePageState(id, { generateStatus: 'running', targetPath: page.path });
    await runCommandCode('generate', renderPrompt('generate.md', { PAGE_JSON: JSON.stringify(pageRuntimeContract(page), null, 2) }), id, progressLabel);
    validatePageFile(page); refreshPageTraceabilityHashes(page);
    updatePageState(id, { generateStatus: 'completed', generatedAt: now(), pageHash: pageCurrentHash(page), generateInputHash: pageInputHash(page), targetPath: page.path });
  }
  if (allowEnrich && qualityConfig().autoEnrich !== false && isComprehensive() && pageNeedsEnrichment(page)) await doEnrich(id, progressLabel, force);
}
async function doGenerateBatch(pages, progressLabel = '') {
  const pending = pages.filter((p) => !(executionConfig().skipValidPages && pageIsReusable(p)));
  for (const p of pages.filter((p) => !pending.includes(p))) console.log(`[docgen] SKIP generate:${p.id} — valid page already exists.`);
  if (!pending.length) {
    if (qualityConfig().autoEnrich !== false && isComprehensive()) { const thin=pages.filter(pageNeedsEnrichment); if(thin.length) await doEnrichBatch(thin, `${progressLabel} | quality-repair`); }
    return;
  }
  for (const p of pending) updatePageState(p.id, { generateStatus: 'running', targetPath: p.path });
  await runCommandCode('generate', renderPrompt('generate-batch.md', { PAGES_JSON: JSON.stringify(pending.map(pageRuntimeContract), null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  const failures = [];
  for (const page of pending) {
    try { validatePageFile(page); refreshPageTraceabilityHashes(page); updatePageState(page.id, { generateStatus: 'completed', generatedAt: now(), pageHash: pageCurrentHash(page), generateInputHash: pageInputHash(page), targetPath: page.path }); }
    catch (e) { failures.push({ page, error: e.message }); updatePageState(page.id, { generateStatus: 'failed', error: e.message }); }
  }
  if (failures.length) {
    console.warn(`[docgen] batch generated ${pending.length - failures.length}/${pending.length} valid pages; retrying ${failures.length} failed page(s) individually.`);
    for (const f of failures) await doGenerate(f.page.id, `individual fallback after batch`, false, true);
  }
  if (qualityConfig().autoEnrich !== false && isComprehensive()) {
    const thin = pages.filter(pageNeedsEnrichment);
    if (thin.length) await doEnrichBatch(thin, `${progressLabel} | quality-repair`);
  }
}
function normalizeRefKey(value) { return String(value ?? '').replaceAll('\\','/').replace(/^\.\//,'').toLowerCase(); }
function itemRefsForPage(page) {
  const system = normalizeSystemObject(loadOptionalJson(systemPath, {}));
  const business = normalizeBusinessObject(loadOptionalJson(businessPath, {}));
  const flows = normalizeFlowsObject(loadOptionalJson(flowsPath, {}));
  const catalogs = normalizeCatalogsObject(loadOptionalJson(catalogsPath, {}));
  const security = normalizeSecurityObject(loadOptionalJson(securityPath, {})); const operations = normalizeOperationsObject(loadOptionalJson(operationsPath, {}));
  const testing = normalizeTestingObject(loadOptionalJson(testingPath, {})); const dataGovernance = normalizeDataGovernanceObject(loadOptionalJson(dataGovernancePath, {}));
  const decisions = normalizeDecisionsObject(loadOptionalJson(decisionsPath, {})); const configuration = normalizeConfigurationObject(loadOptionalJson(configurationPath, {}));
  const changeImpact = normalizeChangeImpactObject(loadOptionalJson(changeImpactPath, {})); const ownership = normalizeOwnershipObject(loadOptionalJson(ownershipPath, {}));
  const tags = new Set(page.coverageTags ?? []); const expected = { model: [], catalog: [], branch: [] };
  const add = (target, items) => target.push(...(items ?? []).map((x) => x.id));
  if (tags.has('system-overview') || tags.has('architecture')) add(expected.model, [...system.components, ...system.relationships, ...system.workflows]);
  if (tags.has('business-domain')) add(expected.model, [...business.actors, ...business.capabilities, ...business.concepts]);
  if (tags.has('business-rules')) add(expected.model, business.businessRules);
  if (tags.has('branch-conditions')) { add(expected.model, business.branchConditions); add(expected.branch, business.branchConditions); }
  if (tags.has('state-lifecycle')) add(expected.model, business.lifecycles);
  for (const [tag, key] of [['business-flow','businessFlows'],['control-flow','controlFlows'],['request-flow','requestFlows'],['traffic-flow','trafficFlows'],['data-flow','dataFlows'],['event-flow','eventFlows']]) if (tags.has(tag)) { add(expected.model, flows[key]); for (const f of flows[key]) add(expected.branch, f.branches ?? []); }
  if (tags.has('endpoint-catalog')) add(expected.catalog, catalogs.endpoints);
  if (tags.has('message-handler-catalog')) add(expected.catalog, catalogs.messageHandlers);
  if (tags.has('external-dependency-catalog')) add(expected.catalog, catalogs.externalDependencies);
  if (tags.has('security-trust-boundaries')) add(expected.model, [...security.trustBoundaries,...security.principals,...security.authenticationFlows,...security.serviceIdentities,...security.threats,...security.controls]);
  if (tags.has('authorization-model')) add(expected.model, [...security.authorizationRules,...security.permissions]);
  if (tags.has('data-governance')) add(expected.model, Object.values(dataGovernance).filter(Array.isArray).flat());
  if (tags.has('consistency-transactions')) add(expected.model, [...dataGovernance.transactionBoundaries,...dataGovernance.consistencyModels,...dataGovernance.concurrencyControls,...dataGovernance.idempotencyRules,...dataGovernance.reconciliationProcesses]);
  if (tags.has('operations-observability')) add(expected.model, [...operations.runtimeComponents,...operations.healthChecks,...operations.observabilitySignals,...operations.slis,...operations.slos,...operations.alerts,...operations.capacityLimits,...operations.scalingSignals]);
  if (tags.has('failure-recovery')) add(expected.model, [...operations.failureModes,...operations.recoveryProcedures,...operations.backups,...operations.runbooks]);
  if (tags.has('testing-strategy')) add(expected.model, Object.values(testing).filter(Array.isArray).flat());
  if (tags.has('configuration-matrix')) add(expected.model, Object.values(configuration).filter(Array.isArray).flat());
  if (tags.has('architecture-decisions')) add(expected.model, Object.values(decisions).filter(Array.isArray).flat());
  if (tags.has('change-impact')) add(expected.model, Object.values(changeImpact).filter(Array.isArray).flat());
  if (tags.has('ownership-responsibilities')) add(expected.model, Object.values(ownership).filter(Array.isArray).flat());
  return { model: [...new Set(expected.model)], catalog: [...new Set(expected.catalog)], branch: [...new Set(expected.branch)] };
}
function ratio(covered, expected) { return expected <= 0 ? 1 : Math.min(1, covered / expected); }
function pageSemanticMetrics(page, text) {
  const trace = ensurePageTraceability(page);
  const claims = trace.claims ?? [];
  const knownIds = new Set();
  for (const model of [normalizeSystemObject(loadOptionalJson(systemPath, {})), normalizeBusinessObject(loadOptionalJson(businessPath, {})), normalizeFlowsObject(loadOptionalJson(flowsPath, {})), normalizeCatalogsObject(loadOptionalJson(catalogsPath, {})), normalizeSecurityObject(loadOptionalJson(securityPath, {})), normalizeOperationsObject(loadOptionalJson(operationsPath, {})), normalizeTestingObject(loadOptionalJson(testingPath, {})), normalizeDataGovernanceObject(loadOptionalJson(dataGovernancePath, {})), normalizeDecisionsObject(loadOptionalJson(decisionsPath, {})), normalizeConfigurationObject(loadOptionalJson(configurationPath, {})), normalizeChangeImpactObject(loadOptionalJson(changeImpactPath, {})), normalizeOwnershipObject(loadOptionalJson(ownershipPath, {}))]) for (const value of Object.values(model)) if (Array.isArray(value)) for (const item of value) if (item?.id) knownIds.add(normalizeRefKey(item.id));
  const aliases = buildReferenceAliases();
  const evidenceValid = (ev) => { const ref=normalizeRefKey(ev?.path); if(!ref) return Boolean(ev?.symbol); const resolved=normalizeReference(ref, aliases); if(!exists(resolved)) return false; if(ev?.startLine){ try{const lines=fs.readFileSync(path.join(root,resolved),'utf8').split(/\r?\n/).length; if(ev.startLine>lines || (ev.endLine&&ev.endLine>lines)) return false;}catch{return false;} } return true; };
  const modelRefValid = (ref) => knownIds.has(normalizeRefKey(ref));
  const groundable = claims.filter((c) => c.classification !== 'UNKNOWN');
  const grounded = groundable.filter((c) => (c.evidence ?? []).some(evidenceValid) || (c.sourceModelRefs ?? []).some(modelRefValid));
  const unsupported = groundable.filter((c) => !(c.evidence ?? []).some(evidenceValid) && !(c.sourceModelRefs ?? []).some(modelRefValid));
  const aliasesForCoverage = buildReferenceAliases();
  const resolveCoverageRef = (ref) => normalizeRefKey(normalizeReference(ref, aliasesForCoverage) ?? ref);
  const declared = [...(page.evidence ?? [])].map(resolveCoverageRef);
  const usedEvidence = new Set([...(trace.coverage?.evidenceRefsUsed ?? []), ...claims.flatMap((c) => (c.evidence ?? []).map((e) => e.path))].map(resolveCoverageRef));
  const declaredCovered = declared.filter((d) => usedEvidence.has(d)).length;
  const expected = itemRefsForPage(page);
  const modelRefs = new Set([...(trace.coverage?.modelItemRefs ?? []), ...claims.flatMap((c) => c.sourceModelRefs ?? [])].map(normalizeRefKey));
  const catalogRefs = new Set([...(trace.coverage?.catalogItemRefs ?? []), ...claims.flatMap((c) => c.sourceModelRefs ?? [])].map(normalizeRefKey));
  const branchRefs = new Set([...(trace.coverage?.branchItemRefs ?? []), ...claims.flatMap((c) => c.sourceModelRefs ?? [])].map(normalizeRefKey));
  const countCovered = (ids, refs) => ids.filter((id) => refs.has(normalizeRefKey(id))).length;
  const words = pageWordCount(text);
  return {
    claimCount: claims.length, groundableClaimCount: groundable.length, groundedClaimCount: grounded.length, structuredClaimCount: claims.filter((c)=>c.subject&&c.predicate).length,
    unsupportedClaims: unsupported.map((c) => c.id),
    claimGroundingRatio: ratio(grounded.length, groundable.length),
    structuredClaimRatio: ratio(claims.filter((c)=>c.subject&&c.predicate).length, claims.length),
    evidenceCoverageRatio: ratio(declaredCovered, declared.length),
    modelCoverageRatio: ratio(countCovered(expected.model, modelRefs), expected.model.length),
    catalogCoverageRatio: ratio(countCovered(expected.catalog, catalogRefs), expected.catalog.length),
    branchCoverageRatio: ratio(countCovered(expected.branch, branchRefs), expected.branch.length),
    evidenceClaimDensityPer1000Words: words ? grounded.length / words * 1000 : 0,
    traceabilityPath: traceabilityRelPath(page), legacyUnmapped: trace.legacyUnmapped,
    stale: trace.pageHash !== pageCurrentHash(page) || trace.inputHash !== pageInputHash(page) || Boolean(trace.sourceSnapshot?.sourceFingerprint && currentSourceSnapshot().sourceFingerprint && trace.sourceSnapshot.sourceFingerprint !== currentSourceSnapshot().sourceFingerprint),
    sourceStale: Boolean(trace.sourceSnapshot?.sourceFingerprint && currentSourceSnapshot().sourceFingerprint && trace.sourceSnapshot.sourceFingerprint !== currentSourceSnapshot().sourceFingerprint),
    sourceSnapshot: trace.sourceSnapshot
  };
}
function pageQualityReport(page) {
  const file = path.join(root, page.path);
  const text = fs.readFileSync(file, 'utf8');
  const q = qualityConfig(); const semanticQ = q.semanticMetrics ?? {};
  const words = pageWordCount(text); const headings = headingNames(text); const normalized = headings.map(normalizeHeading);
  const modeDefaults=loadConfig().documentationExperience?.modeRequiredSections??{};
  const requiredSections = [...new Set([...(page.requiredSections ?? []), ...(loadConfig().documentationExperience?.enforceModeSections===false?[]:(modeDefaults[page.mode]??[]))])];
  const missingSections = requiredSections.filter((x) => !normalized.some((h) => h.includes(normalizeHeading(x)) || normalizeHeading(x).includes(h)));
  const diagramIntents = page.diagramIntents ?? []; const mermaidCount = (text.match(/```mermaid\b/g) ?? []).length;
  const minWords = q.minWordsByType?.[page.type] ?? 0; const errors = []; const warnings = [];
  if (minWords && words < minWords) warnings.push(`word count ${words} is below advisory target ${minWords} for ${page.type}`);
  if ((q.minHeadings ?? 0) && headings.length < q.minHeadings) errors.push(`heading count ${headings.length} is below ${q.minHeadings}`);
  if (q.requireDeclaredSections !== false && missingSections.length) errors.push(`missing required sections: ${missingSections.join(', ')}`);
  if (q.requirePlannedDiagrams !== false && diagramIntents.length && mermaidCount < 1) errors.push('manifest declares diagram intents but no Mermaid diagram exists');
  const exampleIntents=page.exampleIntents??[]; const extractedExamples=extractExamples(page,text); const exampleHeadingCount=extractedExamples.length;
  if(loadConfig().documentationExperience?.requireEvidenceDerivedExamples!==false && exampleIntents.length && exampleHeadingCount<1) errors.push(`manifest declares example intents but no evidence-derived example/scenario section exists`);
  if(loadConfig().documentationExperience?.requireEvidenceDerivedExamples!==false && exampleIntents.length && extractedExamples.some((x)=>!x.evidenceDerived)) errors.push(`example/scenario sections lack claim-level evidence or model references: ${extractedExamples.filter((x)=>!x.evidenceDerived).map((x)=>x.title).join(', ')}`);
  if(page.status==='deprecated' && !headings.some((x)=>/(deprecat|migration|replacement|sunset)/i.test(x))) errors.push('deprecated page lacks a deprecation/migration/replacement section');
  const semantic = pageSemanticMetrics(page, text);
  if (semantic.structuredClaimRatio < Number(semanticQ.minStructuredClaimRatio ?? 0.7)) errors.push(`structured claim ratio ${semantic.structuredClaimRatio.toFixed(2)} is below ${semanticQ.minStructuredClaimRatio ?? 0.7}`);
  if (semantic.claimGroundingRatio < Number(semanticQ.minClaimGroundingRatio ?? 0.9)) errors.push(`claim grounding ratio ${semantic.claimGroundingRatio.toFixed(2)} is below ${semanticQ.minClaimGroundingRatio ?? 0.9}`);
  if (semantic.evidenceCoverageRatio < Number(semanticQ.minEvidenceCoverageRatio ?? 0.8)) errors.push(`declared evidence coverage ratio ${semantic.evidenceCoverageRatio.toFixed(2)} is below ${semanticQ.minEvidenceCoverageRatio ?? 0.8}`);
  if (semantic.modelCoverageRatio < Number(semanticQ.minModelCoverageRatio ?? 0.9)) errors.push(`model-item coverage ratio ${semantic.modelCoverageRatio.toFixed(2)} is below ${semanticQ.minModelCoverageRatio ?? 0.9}`);
  if (semantic.catalogCoverageRatio < Number(semanticQ.minCatalogCoverageRatio ?? 1)) errors.push(`catalog coverage ratio ${semantic.catalogCoverageRatio.toFixed(2)} is below ${semanticQ.minCatalogCoverageRatio ?? 1}`);
  if (semantic.branchCoverageRatio < Number(semanticQ.minBranchCoverageRatio ?? 0.9)) errors.push(`branch coverage ratio ${semantic.branchCoverageRatio.toFixed(2)} is below ${semanticQ.minBranchCoverageRatio ?? 0.9}`);
  if (semantic.unsupportedClaims.length > Number(semanticQ.maxUnsupportedClaims ?? 0)) errors.push(`unsupported claims: ${semantic.unsupportedClaims.join(', ')}`);
  if (semantic.stale) errors.push('traceability fingerprint is stale for current page/evidence/model inputs');
  const requiredGroundedClaims = Math.max(1, Math.ceil(words / 1000 * Number(semanticQ.minEvidenceClaimsPer1000Words ?? 1.5)));
  semantic.requiredGroundedClaims = requiredGroundedClaims;
  if (semantic.groundedClaimCount < requiredGroundedClaims) errors.push(`grounded claim count ${semantic.groundedClaimCount} is below evidence-density requirement ${requiredGroundedClaims}`);
  return { pageId: page.id, pagePath: page.path, type: page.type, mode:page.mode, words, exampleIntents, exampleHeadingCount, examples:extractedExamples, headings: headings.length, minWords, requiredSections, missingSections, diagramIntents, mermaidCount, semantic, errors, warnings };
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
  await runCommandCode('enrich', renderPrompt('enrich.md', { PAGE_JSON: JSON.stringify(pageRuntimeContract(page), null, 2) }), id, progressLabel);
  validatePageFile(page); refreshPageTraceabilityHashes(page); validatePageQuality(page, false);
  updatePageState(id, { enrichStatus: 'completed', enrichedAt: now(), enrichedHash: pageCurrentHash(page) });
}
async function doEnrichBatch(pages, progressLabel = '') {
  const pending = pages.filter(pageNeedsEnrichment);
  if (!pending.length) return;
  await runCommandCode('enrich', renderPrompt('enrich-batch.md', { PAGES_JSON: JSON.stringify(pending.map(pageRuntimeContract), null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  const failures = [];
  for (const page of pending) {
    try { validatePageFile(page); refreshPageTraceabilityHashes(page); validatePageQuality(page, false); updatePageState(page.id, { enrichStatus: 'completed', enrichedAt: now(), enrichedHash: pageCurrentHash(page) }); }
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
function claimSemanticKey(claim) {
  if (claim.subject && claim.predicate) return `${normalizeHeading(claim.subject)}|${normalizeHeading(claim.predicate)}`;
  return null;
}
function claimValueKey(claim) { return `${normalizeHeading(String(claim.object ?? ''))}|${claim.polarity}`; }
function claimDuplicateKey(claim) {
  if (claim.subject && claim.predicate) return `${claimSemanticKey(claim)}|${claimValueKey(claim)}`;
  return normalizeHeading(claim.statement);
}
function rebuildTraceabilityIndex() {
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = loadManifest(); const pages = []; const claims = [];
  for (const page of manifest.pages) if (fs.existsSync(pageFile(page))) {
    const trace = ensurePageTraceability(page); pages.push({ pageId: page.id, pagePath: page.path, traceabilityPath: traceabilityRelPath(page), pageHash: trace.pageHash, inputHash: trace.inputHash, claimCount: trace.claims.length, sourceSnapshot: trace.sourceSnapshot }); claims.push(...trace.claims);
  }
  const byDuplicate = new Map(); const bySemantic = new Map(); const claimIds=new Map(); const claimIdCollisions=[];
  for (const claim of claims) {
    if(claimIds.has(claim.id)) claimIdCollisions.push({id:claim.id,pages:[claimIds.get(claim.id),claim.pageId]}); else claimIds.set(claim.id,claim.pageId);
    const dk = claimDuplicateKey(claim); if (dk) { if (!byDuplicate.has(dk)) byDuplicate.set(dk, []); byDuplicate.get(dk).push(claim); }
    const sk = claimSemanticKey(claim); if (sk) { if (!bySemantic.has(sk)) bySemantic.set(sk, []); bySemantic.get(sk).push(claim); }
  }
  const duplicateGroups = [...byDuplicate.entries()].filter(([, group]) => group.filter((x) => !x.intentionalDuplicate).length > 1).map(([key, group], i) => ({ id: `duplicate-${i + 1}`, key, claims: group.map((x) => ({ id: x.id, pageId: x.pageId, statement: x.statement, intentionalDuplicate: x.intentionalDuplicate })) }));
  const contradictions = [];
  for (const [key, group] of bySemantic.entries()) {
    const factual = group.filter((x) => x.classification !== 'UNKNOWN');
    const byObject = new Map(); for (const claim of factual) { const objectKey=normalizeHeading(String(claim.object ?? '')); if(!byObject.has(objectKey))byObject.set(objectKey,[]); byObject.get(objectKey).push(claim); }
    const polarityConflict=[...byObject.values()].some((claims)=>new Set(claims.map((x)=>x.polarity)).size>1);
    const exclusiveConflict=factual.some((x)=>x.exclusivePredicate) && new Set(factual.map((x)=>normalizeHeading(String(x.object ?? '')))).size>1;
    if (polarityConflict || exclusiveConflict) contradictions.push({ id: `contradiction-${contradictions.length + 1}`, key, severity: factual.some((x) => x.classification === 'FACT') ? 'high' : 'medium', claims: factual.map((x) => ({ id: x.id, pageId: x.pageId, statement: x.statement, classification: x.classification, object: x.object, polarity: x.polarity, exclusivePredicate:x.exclusivePredicate })) });
  }
  const currentSource = currentSourceSnapshot(true);
  const freshnessPages = pages.map((p) => { const page=findPage(p.pageId); const currentPageHash=pageCurrentHash(page); const currentInputHash=pageInputHash(page); const sourceStale=Boolean(p.sourceSnapshot?.sourceFingerprint && currentSource.sourceFingerprint && p.sourceSnapshot.sourceFingerprint !== currentSource.sourceFingerprint); return { ...p, currentPageHash, currentInputHash, currentSourceSnapshot: currentSource, sourceStale, stale: p.pageHash !== currentPageHash || p.inputHash !== currentInputHash || sourceStale }; });
  const index = { schemaVersion:'1.0', generatedAt:now(), sourceSnapshot:currentSourceSnapshot(), pages, claims, summary:{ pages:pages.length, claims:claims.length, groundedClaims:claims.filter((c)=>(c.evidence??[]).length||(c.sourceModelRefs??[]).length).length, duplicateGroups:duplicateGroups.length, contradictions:contradictions.length, claimIdCollisions:claimIdCollisions.length, stalePages:freshnessPages.filter((x)=>x.stale).length } };
  index.claimIdCollisions=claimIdCollisions; writeJson(traceabilityIndexPath,index); writeJson(duplicatesPath,{schemaVersion:'1.0',generatedAt:now(),groups:duplicateGroups}); writeJson(contradictionsPath,{schemaVersion:'1.0',generatedAt:now(),contradictions}); writeJson(freshnessPath,{schemaVersion:'1.0',generatedAt:now(),sourceSnapshot:index.sourceSnapshot,pages:freshnessPages}); return {index,duplicateGroups,contradictions,claimIdCollisions,freshnessPages};
}
function writeQualitySummary() {
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = loadManifest(); const pages = [];
  for (const page of manifest.pages) if (fs.existsSync(path.join(root,page.path))) pages.push(pageQualityReport(page));
  const audit = fs.existsSync(auditIndexPath) ? readJson(auditIndexPath) : {summary:{}}; const trace = rebuildTraceabilityIndex();
  const totals = pages.reduce((a,p)=>{ a.claims+=p.semantic.claimCount; a.groundable+=p.semantic.groundableClaimCount; a.grounded+=p.semantic.groundedClaimCount; a.unsupported+=p.semantic.unsupportedClaims.length; a.stale+=p.semantic.stale?1:0; return a; },{claims:0,groundable:0,grounded:0,unsupported:0,stale:0});
  const summary = { schemaVersion:'1.0', generatedAt:now(), qualityProfile:qualityProfile(), sourceSnapshot:currentSourceSnapshot(), pages, localGateFailures:pages.filter((p)=>p.errors.length).length, warningCount:pages.reduce((n,p)=>n+p.warnings.length,0), semanticSummary:{...totals,claimGroundingRatio:ratio(totals.grounded,totals.groundable),contradictions:trace?.contradictions.length??0,duplicateGroups:trace?.duplicateGroups.length??0,claimIdCollisions:trace?.claimIdCollisions.length??0,stalePages:trace?.freshnessPages.filter((x)=>x.stale).length??0}, auditSummary:audit.summary??{} };
  writeJson(path.join(root,'.docgen','audit','quality-summary.json'),summary); return summary;
}
function doTraceability() {
  const result = rebuildTraceabilityIndex(); if (!result) fail('Missing manifest. Run plan first.');
  console.log(`Traceability pages: ${result.index.pages.length}`); console.log(`Claims: ${result.index.claims.length}`); console.log(`Contradictions: ${result.contradictions.length}`); console.log(`Duplicate claim groups: ${result.duplicateGroups.length}`); console.log(`Claim ID collisions: ${result.claimIdCollisions.length}`); console.log(`Stale pages: ${result.freshnessPages.filter((x)=>x.stale).length}`); console.log(`Index: ${rel(traceabilityIndexPath)}`);
}
function doQuality() {
  const summary = writeQualitySummary(); if (!summary) fail('Missing manifest. Run plan first.');
  for (const p of summary.pages) { const mark=p.errors.length?'FAIL':'PASS'; console.log(`${mark.padEnd(4)} ${p.pageId.padEnd(32)} grounding ${(p.semantic.claimGroundingRatio*100).toFixed(0).padStart(3)}% | evidence ${(p.semantic.evidenceCoverageRatio*100).toFixed(0).padStart(3)}% | model ${(p.semantic.modelCoverageRatio*100).toFixed(0).padStart(3)}% | catalog ${(p.semantic.catalogCoverageRatio*100).toFixed(0).padStart(3)}% | ${p.words} words`); for(const e of p.errors) console.log(`     - ERROR: ${e}`); for(const w of p.warnings) console.log(`     - WARN: ${w}`); }
  const q=qualityConfig(), sq=q.semanticMetrics??{}, a=summary.auditSummary, s=summary.semanticSummary;
  const failed=summary.localGateFailures>0||(a.critical??0)>(q.maxCriticalFindings??0)||(a.high??0)>(q.maxHighFindings??0)||s.contradictions>Number(sq.maxContradictions??0)||s.claimIdCollisions>Number(sq.maxClaimIdCollisions??0)||s.stalePages>Number(sq.maxStalePages??0);
  console.log(`Quality profile: ${summary.qualityProfile}`); console.log(`Local gate failures: ${summary.localGateFailures}`); console.log(`Semantic summary: ${JSON.stringify(s)}`); console.log(`Audit findings: ${JSON.stringify(a)}`); console.log(`Quality gate: ${failed?'FAIL':'PASS'}`); if(failed) process.exitCode=1;
}

async function doGenerateAll(force = false) {
  const manifest = requireManifestPreflight();
  const cfg = executionConfig();
  const batches = [];
  for (let i = 0; i < manifest.pages.length; i += cfg.generateBatchSize) batches.push(manifest.pages.slice(i, i + cfg.generateBatchSize));
  const alreadyValid = manifest.pages.filter(pageIsReusable).length;
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
  try { const report = normalizeJsonFile(audit, (obj) => normalizeAuditReportObject(obj, page), (obj) => assertCanonicalModel(`audit/${page.id}.json`, obj, ['findings'])); return report.pageId === page.id && report.pagePath === page.path && report.pageHash === pageCurrentHash(page) && report.inputHash === pageInputHash(page); } catch { return false; }
}
async function doAudit(id, progressLabel = '', force = false) {
  const page = findPage(id);
  if (!fs.existsSync(pageFile(page))) fail(`Generate page first: ${page.path}`);
  if (!force && auditIsCurrent(page)) { console.log(`[docgen] SKIP audit:${id} — current audit already matches page hash.`); return; }
  await runCommandCode('audit', renderPrompt('audit.md', { PAGE_JSON: JSON.stringify(pageRuntimeContract(page), null, 2), PAGE_ID: page.id, PAGE_HASH: pageCurrentHash(page), PAGE_INPUT_HASH: pageInputHash(page) }), id, progressLabel);
  const reportPath = path.join(root, '.docgen', 'audit', 'pages', `${id}.json`);
  const report = normalizeJsonFile(reportPath, (obj) => normalizeAuditReportObject(obj, page, { defaultHashes: true }), (obj) => {
    assertCanonicalModel(`audit/${id}.json`, obj, ['findings']);
    if (obj.pageId !== page.id) throw new Error(`Audit report pageId ${obj.pageId} does not match ${page.id}.`);
    if (obj.pagePath !== page.path) throw new Error(`Audit report pagePath ${obj.pagePath} does not match ${page.path}.`);
    if (obj.pageHash !== pageCurrentHash(page)) throw new Error(`Audit report hash does not match the current page content.`);
    if (obj.inputHash !== pageInputHash(page)) throw new Error(`Audit report input hash does not match current evidence/model inputs.`);
  });
  updatePageState(id, { auditStatus: 'completed', auditedAt: now(), auditHash: report.pageHash, auditInputHash: report.inputHash });
}
async function doAuditBatch(pages, progressLabel = '') {
  const pending = pages.filter((p) => !auditIsCurrent(p));
  for (const p of pages.filter((p) => !pending.includes(p))) console.log(`[docgen] SKIP audit:${p.id} — current audit exists.`);
  if (!pending.length) return;
  await runCommandCode('audit', renderPrompt('audit-batch.md', { PAGES_JSON: JSON.stringify(pending.map((p) => ({ ...pageRuntimeContract(p), pageHash: pageCurrentHash(p), inputHash: pageInputHash(p) })), null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  for (const page of pending) {
    const reportPath = path.join(root, '.docgen', 'audit', 'pages', `${page.id}.json`);
    try {
      const report = normalizeJsonFile(reportPath, (obj) => normalizeAuditReportObject(obj, page, { defaultHashes: true }), (obj) => {
        assertCanonicalModel(`audit/${page.id}.json`, obj, ['findings']);
        if (obj.pageId !== page.id || obj.pagePath !== page.path) throw new Error('Audit report identity mismatch.');
        if (obj.pageHash !== pageCurrentHash(page)) throw new Error('Audit report hash is stale.');
        if (obj.inputHash !== pageInputHash(page)) throw new Error('Audit report input hash is stale.');
      });
      updatePageState(page.id, { auditStatus: 'completed', auditedAt: now(), auditHash: report.pageHash, auditInputHash: report.inputHash });
    } catch { await doAudit(page.id, 'individual fallback after audit batch', true); }
  }
}
function rebuildAuditIndex() {
  const dir = path.join(root, '.docgen', 'audit', 'pages');
  const pages = [];
  const invalidReports = [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const manifest = fs.existsSync(manifestPath) ? normalizeManifest(false) : { pages: [] };
  const byId = new Map((manifest.pages ?? []).map((p) => [p.id, p]));
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const raw = readJson(file);
      const candidateId = slug(raw.pageId ?? raw.pageID ?? raw.id ?? path.basename(name, '.json'));
      const page = byId.get(candidateId);
      if (!page) throw new Error(`unknown page id ${candidateId}`);
      const report = normalizeJsonFile(file, (obj) => normalizeAuditReportObject(obj, page), (obj) => {
        assertCanonicalModel(`audit/${page.id}.json`, obj, ['findings']);
        if (obj.pageId !== page.id || obj.pagePath !== page.path) throw new Error('identity mismatch');
      });
      pages.push({ pageId: report.pageId, pagePath: report.pagePath, pageHash: report.pageHash, inputHash: report.inputHash, findingCount: report.findings.length });
      for (const f of report.findings) if (f.severity in counts) counts[f.severity]++;
    } catch (e) { invalidReports.push({ file: rel(file), error: e.message }); }
  }
  const index = { schemaVersion: '1.0', generatedAt: now(), pages, summary: counts, invalidReports };
  writeJson(auditIndexPath, index);
  if (invalidReports.length) throw new Error(`Invalid audit report(s):\n- ${invalidReports.map((x) => `${x.file}: ${x.error}`).join('\n- ')}`);
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
  await runCommandCode('fix', renderPrompt('fix.md', { PAGE_JSON: JSON.stringify(pageRuntimeContract(page), null, 2), PAGE_ID: id }), id, progressLabel);
  validatePageFile(page); refreshPageTraceabilityHashes(page);
  if (isComprehensive()) validatePageQuality(page, false);
}
async function doFixAll() {
  const manifest = loadManifest();
  const fixed = [];
  for (const page of manifest.pages) {
    const audit = path.join(root, '.docgen', 'audit', 'pages', `${page.id}.json`);
    if (!fs.existsSync(audit)) continue;
    const report = normalizeJsonFile(audit, (obj) => normalizeAuditReportObject(obj, page), (obj) => assertCanonicalModel(`audit/${page.id}.json`, obj, ['findings']));
    if ((report.findings ?? []).length) { printItemProgress('fix', manifest.pages.indexOf(page) + 1, manifest.pages.length, page.id); await doFix(page.id, `page ${manifest.pages.indexOf(page) + 1}/${manifest.pages.length}`); fixed.push(page.id); }
  }
  return fixed;
}

function normalizeRepoPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}
function regexEscape(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }
const DEFAULT_BINARY_EXTENSIONS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.bmp','.ico','.tif','.tiff','.avif','.heic','.psd','.ai','.eps',
  '.mp3','.wav','.flac','.aac','.ogg','.m4a','.wma','.mid','.midi',
  '.mp4','.m4v','.mov','.avi','.mkv','.webm','.wmv','.flv','.mpeg','.mpg','.3gp',
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp','.rtf',
  '.zip','.gz','.tgz','.bz2','.xz','.7z','.rar','.tar','.jar','.war','.ear','.class','.dll','.exe','.so','.dylib','.o','.a','.lib',
  '.woff','.woff2','.ttf','.otf','.eot','.bin','.dat','.db','.sqlite','.sqlite3','.pack','.idx','.p12','.pfx','.jks','.keystore',
  '.apk','.ipa','.deb','.rpm','.iso','.dmg','.img','.wasm','.pyc','.pyo'
]);
const DEFAULT_TEXT_EXTENSIONS = new Set([
  '.txt','.md','.mdx','.adoc','.rst','.java','.kt','.kts','.groovy','.scala','.clj','.cljs','.go','.rs','.cs','.fs','.fsx',
  '.c','.h','.cc','.cpp','.cxx','.hpp','.m','.mm','.swift','.dart','.py','.rb','.php','.pl','.pm','.lua','.r','.jl',
  '.js','.mjs','.cjs','.jsx','.ts','.tsx','.vue','.svelte','.html','.htm','.css','.scss','.sass','.less',
  '.xml','.xsd','.xsl','.xslt','.svg','.json','.jsonl','.yaml','.yml','.toml','.ini','.cfg','.conf','.properties','.env',
  '.sql','.graphql','.gql','.proto','.thrift','.avsc','.bpmn','.dmn','.sh','.bash','.zsh','.fish','.ps1','.bat','.cmd',
  '.dockerfile','.gradle','.make','.mk','.tf','.tfvars','.hcl','.rego','.feature','.csv','.tsv','.log','.lock'
]);
function binaryConfig(config = loadConfig()) {
  const cfg = config.ignore?.binary ?? {};
  return {
    enabled: cfg.enabled !== false,
    probeBytes: Math.max(512, Number(cfg.probeBytes ?? 16384)),
    maxTextFileBytes: Math.max(1024, Number(cfg.maxTextFileBytes ?? 4 * 1024 * 1024)),
    controlCharacterRatio: Math.max(0, Math.min(1, Number(cfg.controlCharacterRatio ?? 0.08))),
    allowExtensions: new Set([...(config.sourceExtensions ?? []), ...(cfg.allowExtensions ?? [])].map((x)=>String(x).toLowerCase())),
    denyExtensions: new Set([...(cfg.denyExtensions ?? [])].map((x)=>String(x).toLowerCase()))
  };
}
function hasBinaryMagic(buf) {
  if (!buf?.length) return false;
  const sig=(...bytes)=>bytes.every((b,i)=>buf[i]===b);
  return sig(0x89,0x50,0x4e,0x47)||sig(0xff,0xd8,0xff)||sig(0x47,0x49,0x46,0x38)||sig(0x25,0x50,0x44,0x46)||sig(0x50,0x4b,0x03,0x04)||sig(0x1f,0x8b)||sig(0x7f,0x45,0x4c,0x46)||sig(0x4d,0x5a)||sig(0x00,0x61,0x73,0x6d)||sig(0xca,0xfe,0xba,0xbe)||sig(0x52,0x49,0x46,0x46);
}
function classifySourceFile(fullPath, relPath, config = loadConfig()) {
  const cfg=binaryConfig(config);
  if (!cfg.enabled) return { text:true, reason:null, size:fs.existsSync(fullPath)?fs.statSync(fullPath).size:0 };
  let stat; try { stat=fs.statSync(fullPath); } catch { return { text:false, reason:'unreadable-source-file', size:0 }; }
  const ext=path.extname(relPath).toLowerCase();
  if (cfg.denyExtensions.has(ext) || (!cfg.allowExtensions.has(ext) && DEFAULT_BINARY_EXTENSIONS.has(ext))) return { text:false, reason:`binary-extension:${ext || '<none>'}`, size:stat.size };
  if (stat.size > cfg.maxTextFileBytes) return { text:false, reason:`text-file-too-large:${stat.size}`, size:stat.size };
  const declaredText = cfg.allowExtensions.has(ext) || DEFAULT_TEXT_EXTENSIONS.has(ext);
  let buf; try { const fd=fs.openSync(fullPath,'r'); buf=Buffer.alloc(Math.min(cfg.probeBytes, stat.size)); const n=fs.readSync(fd,buf,0,buf.length,0); fs.closeSync(fd); buf=buf.subarray(0,n); } catch { return { text:false, reason:'unreadable-source-file', size:stat.size }; }
  if (hasBinaryMagic(buf)) return { text:false, reason:'binary-magic-signature', size:stat.size };
  if (buf.includes(0)) return { text:false, reason:'binary-null-byte', size:stat.size };
  let decoded=''; try { decoded=new TextDecoder('utf-8',{fatal:true}).decode(buf); } catch { return { text:false, reason:'non-utf8-content', size:stat.size }; }
  let controls=0; for(const ch of decoded){const c=ch.codePointAt(0);if(c<32&&!['\n','\r','\t','\f','\b'].includes(ch))controls++;}
  const ratioValue=decoded.length?controls/decoded.length:0;
  if(ratioValue>cfg.controlCharacterRatio)return{text:false,reason:`binary-control-ratio:${ratioValue.toFixed(3)}`,size:stat.size};
  return { text:true, reason:null, size:stat.size };
}
function ignorePatternRegex(pattern, anchored = false) {
  let body = ''; let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*') {
      if (pattern[i + 1] === '*') { while (pattern[i + 1] === '*') i++; body += '.*'; }
      else body += '[^/]*';
    } else if (pattern[i] === '?') body += '[^/]';
    else body += regexEscape(pattern[i]);
    i++;
  }
  return new RegExp(anchored ? `^${body}(?:/.*)?$` : `(?:^|/)${body}(?:/.*)?$`);
}
function loadIgnoreRules(file) {
  if (!fs.existsSync(file)) return [];
  const stat=fs.statSync(file); const cached=ignoreRulesCache.get(file); if(cached?.mtimeMs===stat.mtimeMs)return cached.rules;
  const rules = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let negated = false;
    if (line.startsWith('!')) { negated = true; line = line.slice(1); }
    if (!line) continue;
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.replace(/\/+$/, '');
    const anchored = line.startsWith('/');
    if (anchored) line = line.slice(1);
    rules.push({ raw, pattern: line, negated, directoryOnly, anchored, regex: ignorePatternRegex(line, anchored) });
  }
  ignoreRulesCache.set(file,{mtimeMs:stat.mtimeMs,rules});
  return rules;
}
function matchIgnoreRules(relPath, isDirectory, rules) {
  const normalized = normalizeRepoPath(relPath);
  let decision = null;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory && !normalized.includes(`${rule.pattern}/`) && !normalized.startsWith(`${rule.pattern}/`)) continue;
    if (rule.regex.test(normalized)) decision = { ignored: !rule.negated, reason: `.docgenignore:${rule.raw}` };
  }
  return decision;
}
function configExcludeDecision(relPath, isDirectory, config) {
  const normalized = normalizeRepoPath(relPath);
  for (const raw of config.exclude ?? []) {
    const pattern = String(raw).replaceAll('\\', '/').replace(/^\.\//, '');
    const directoryOnly = pattern.endsWith('/**') || pattern.endsWith('/');
    const cleaned = pattern.replace(/\/\*\*$/, '').replace(/\/+$/, '');
    const regex = ignorePatternRegex(cleaned, cleaned.startsWith('/'));
    if (regex.test(normalized) || (directoryOnly && (normalized === cleaned || normalized.startsWith(`${cleaned}/`)))) return { ignored: true, reason: `config.exclude:${raw}` };
  }
  return null;
}
function gitRepositoryAvailable() {
  if (gitRepositoryAvailabilityCache !== null) return gitRepositoryAvailabilityCache;
  if (!commandExists('git')) return (gitRepositoryAvailabilityCache=false);
  const marker = path.join(root, '.git');
  if (fs.existsSync(marker)) return (gitRepositoryAvailabilityCache=true);
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  return (gitRepositoryAvailabilityCache = r.status === 0 && String(r.stdout ?? '').trim() === 'true');
}
function gitIgnoredBatch(paths) {
  if (!paths.length || !gitRepositoryAvailable()) return new Set();
  const input = paths.map(normalizeRepoPath).join('\0') + '\0';
  const r = spawnSync('git', ['check-ignore', '--stdin', '-z', '--no-index'], { cwd: root, input, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  if (r.status !== 0 && r.status !== 1) return new Set();
  return new Set(Buffer.from(r.stdout ?? []).toString('utf8').split('\0').filter(Boolean).map(normalizeRepoPath));
}
function gitIgnoredSingle(relPath) { const key=normalizeRepoPath(relPath); if(gitIgnoreSingleCache.has(key))return gitIgnoreSingleCache.get(key); const value=gitIgnoredBatch([key]).has(key); gitIgnoreSingleCache.set(key,value); return value; }
function fallbackGitIgnoreDecision(relPath, isDirectory = false) {
  const normalized = normalizeRepoPath(relPath);
  const segments = normalized.split('/');
  let decision = null;
  for (let depth = 0; depth <= Math.max(0, segments.length - (isDirectory ? 0 : 1)); depth++) {
    const base = segments.slice(0, depth).join('/');
    const file = path.join(root, base, '.gitignore');
    if (!fs.existsSync(file)) continue;
    const relative = segments.slice(depth).join('/');
    const matched = matchIgnoreRules(relative, isDirectory, loadIgnoreRules(file));
    if (matched) decision = { ignored: matched.ignored, reason: `${base ? `${base}/` : ''}.gitignore:${matched.reason.replace(/^\.docgenignore:/,'')}` };
  }
  return decision;
}
function hardIgnoreDecision(relPath, isDirectory, config) {
  const normalized = normalizeRepoPath(relPath);
  const outputRoot = normalizeRepoPath(config.outputRoot || 'docs');
  const hard = ['.git', '.commandcode', '.docgen', outputRoot, 'node_modules', 'target', 'build', 'dist', 'coverage', 'vendor'];
  for (const prefix of hard) if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return { ignored: true, reason: `docgen-hard-exclude:${prefix}/**` };
  return configExcludeDecision(normalized, isDirectory, config);
}
function ignoreDecision(relPath, isDirectory = false, config = loadConfig()) {
  const normalized = normalizeRepoPath(relPath);
  if (!normalized) return { ignored: false, reason: null };
  const hard = hardIgnoreDecision(normalized, isDirectory, config);
  if (hard) return hard;
  // The canonical inventory already performed ignore + binary/text classification. Reuse it on hot validation paths.
  if (!isDirectory && sourceInventoryCache?.includedSet?.has(normalized)) return { ignored:false, reason:null };
  if (config.ignore?.useGitignore !== false) {
    const gitRepo = gitRepositoryAvailable();
    if (gitRepo && gitIgnoredSingle(normalized)) return { ignored: true, reason: '.gitignore' };
    const fallback = fallbackGitIgnoreDecision(normalized, isDirectory);
    if (!gitRepo && fallback) return fallback;
  }
  if (config.ignore?.useDocgenignore !== false) {
    const ignoreFile = path.join(root, config.ignore?.docgenignoreFile || '.docgenignore');
    const matched = matchIgnoreRules(normalized, isDirectory, loadIgnoreRules(ignoreFile));
    if (matched) return matched;
  }
  if (!isDirectory) {
    const full = path.join(root, normalized);
    if (fs.existsSync(full)) { const classified = classifySourceFile(full, normalized, config); if (!classified.text) return { ignored:true, reason:classified.reason }; }
  }
  return { ignored: false, reason: null };
}
function candidateFilesFromGit() {
  if (!commandExists('git') || !fs.existsSync(path.join(root, '.git'))) return null;
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 128 * 1024 * 1024, shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  return Buffer.from(r.stdout ?? []).toString('utf8').split('\0').filter(Boolean).map(normalizeRepoPath);
}
function fallbackWalkCandidates(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name); const r = rel(full); const hard = hardIgnoreDecision(r, entry.isDirectory(), loadConfig());
    if (hard?.ignored) continue;
    if (entry.isDirectory()) fallbackWalkCandidates(full, out); else out.push(normalizeRepoPath(r));
  }
  return out;
}
function buildSourceInventory(options = {}) {
  const config = loadConfig();
  let candidates = candidateFilesFromGit();
  const usedGit = Boolean(candidates);
  if (!candidates) candidates = fallbackWalkCandidates(root);
  const gitRepo = gitRepositoryAvailable();
  const gitIgnored = config.ignore?.useGitignore === false ? new Set() : gitIgnoredBatch(candidates);
  const docgenRules = config.ignore?.useDocgenignore === false ? [] : loadIgnoreRules(path.join(root, config.ignore?.docgenignoreFile || '.docgenignore'));
  const included = []; const ignoredSamples = []; const reasonCounts = {}; let includedBytes=0; let excludedBytes=0; let binaryExcludedCount=0;
  for (const item of [...new Set(candidates)].sort()) {
    const full = path.join(root, item);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const stat=fs.statSync(full);
    let decision = hardIgnoreDecision(item, false, config);
    if (!decision && gitIgnored.has(item)) decision = { ignored: true, reason: '.gitignore' };
    if (!decision && !gitRepo && config.ignore?.useGitignore !== false) decision = fallbackGitIgnoreDecision(item, false);
    if (!decision && docgenRules.length) decision = matchIgnoreRules(item, false, docgenRules);
    if (!decision) { const classified=classifySourceFile(full,item,config); if(!classified.text){decision={ignored:true,reason:classified.reason};binaryExcludedCount++;} }
    if (decision?.ignored) {
      excludedBytes += stat.size;
      reasonCounts[decision.reason] = (reasonCounts[decision.reason] ?? 0) + 1;
      if (ignoredSamples.length < 500) ignoredSamples.push({ path: item, reason: decision.reason, size:stat.size });
    } else { included.push(item); includedBytes += stat.size; }
  }
  const controlFiles = ['.gitignore', config.ignore?.docgenignoreFile || '.docgenignore'].filter((x) => fs.existsSync(path.join(root, x)));
  const report = { schemaVersion: '1.1', generatedAt: now(), usedGit, gitAvailable: commandExists('git'), gitRepository: gitRepo, includedCount: included.length, binaryOrNonTextExcludedCount:binaryExcludedCount, includedBytes, excludedBytes, ignoredSampleCount: ignoredSamples.length, reasonCounts, controlFiles, includedFiles: options.includeFiles === false ? undefined : included, ignoredSamples };
  return report;
}
function writeSourceInventory() {
  const inventory = buildSourceInventory();
  sourceInventoryCache = { inventory, includedSet:new Set(inventory.includedFiles ?? []) }; gitIgnoreSingleCache.clear();
  writeJson(sourceInventoryPath, inventory);
  fs.mkdirSync(path.dirname(sourceFilesPath), { recursive: true });
  fs.writeFileSync(sourceFilesPath, (inventory.includedFiles ?? []).join('\n') + '\n');
  if (loadConfig().ignore?.writeReport !== false) writeJson(ignoreReportPath, { ...inventory, includedFiles: undefined });
  return inventory;
}
function walkFiles(dir, config, out = []) {
  const inventory = buildSourceInventory();
  sourceInventoryCache = { inventory, includedSet:new Set(inventory.includedFiles ?? []) };
  for (const relPath of inventory.includedFiles ?? []) out.push(path.join(root, relPath));
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
  const ignoreControls = { configIgnore: config.ignore ?? {}, exclude: config.exclude ?? [], gitignore: fs.existsSync(path.join(root,'.gitignore')) ? fileSha256(path.join(root,'.gitignore')) : null, docgenignore: fs.existsSync(path.join(root, config.ignore?.docgenignoreFile || '.docgenignore')) ? fileSha256(path.join(root, config.ignore?.docgenignoreFile || '.docgenignore')) : null };
  return { schemaVersion: '1.0', generatedAt: now(), ignorePolicyHash: sha256Text(JSON.stringify(ignoreControls)), files: entries };
}
function doSourceList(pattern = '') {
  const inventory = writeSourceInventory();
  const needle = String(pattern ?? '').toLowerCase();
  for (const file of (inventory.includedFiles ?? []).filter((x)=>!needle || x.toLowerCase().includes(needle))) console.log(file);
}
function doSourceGrep(args = []) {
  const regexMode = args.includes('--regex');
  const query = args.filter((x)=>x!=='--regex').join(' ');
  if (!query) fail('source-grep requires a search string (or --regex <pattern>).', 2);
  let matcher;
  try { matcher = regexMode ? new RegExp(query, 'i') : { test:(x)=>x.toLowerCase().includes(query.toLowerCase()) }; }
  catch(e) { fail(`Invalid regex: ${e.message}`,2); }
  const inventory = writeSourceInventory(); let matches=0; const maxMatches=500;
  for (const relPath of inventory.includedFiles ?? []) {
    const file=path.join(root,relPath); let stat; try{stat=fs.statSync(file);}catch{continue;} if(stat.size>2*1024*1024)continue;
    let text; try{text=fs.readFileSync(file,'utf8');}catch{continue;} if(text.includes('\0'))continue;
    const lines=text.split(/\r?\n/);
    for(let i=0;i<lines.length;i++) if(matcher.test(lines[i])) { console.log(`${relPath}:${i+1}:${lines[i].trimEnd()}`); matches++; if(matches>=maxMatches){console.log(`[docgen] source-grep stopped at ${maxMatches} matches.`);return;} }
  }
  if(!matches) console.log('[docgen] source-grep found no matches in included source files.');
}
function doIgnore(target) {
  const inventory = writeSourceInventory();
  if (target) {
    const normalized = normalizeRepoPath(target);
    const full = path.join(root, normalized);
    const decision = ignoreDecision(normalized, fs.existsSync(full) && fs.statSync(full).isDirectory());
    console.log(`${normalized}: ${decision.ignored ? 'IGNORED' : 'INCLUDED'}${decision.reason ? ` (${decision.reason})` : ''}`);
    return;
  }
  console.log(`Included source files: ${inventory.includedCount}`);
  console.log(`Binary/non-text/oversized files excluded: ${inventory.binaryOrNonTextExcludedCount ?? 0}`);
  console.log(`Included source bytes: ${inventory.includedBytes ?? 0}`);
  console.log(`Git ignore engine: ${inventory.usedGit ? 'active' : inventory.gitAvailable ? 'fallback inventory' : 'git unavailable'}`);
  console.log(`.docgenignore: ${fs.existsSync(path.join(root, loadConfig().ignore?.docgenignoreFile || '.docgenignore')) ? 'present' : 'not present'}`);
  console.log(`Source list: ${rel(sourceFilesPath)}`);
  console.log(`Ignore report: ${rel(ignoreReportPath)}`);
  for (const [reason,count] of Object.entries(inventory.reasonCounts ?? {}).sort()) console.log(`- ${reason}: ${count}`);
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
  const updatePlanPath = path.join(root, '.docgen', 'plan', 'update-plan.json');
  const plan = await runContractStage('update-impact', [updatePlanPath],
    (reset) => runCommandCode('update-impact', renderPrompt('update-impact.md', { CHANGED_PATHS_JSON: JSON.stringify(changed, null, 2) }), changed.join(', '), '', { beforeRetry: reset }),
    () => normalizeJsonFile(updatePlanPath, (obj) => normalizeUpdatePlanObject(obj, changed), (obj) => assertCanonicalModel('update-plan.json', obj, ['changedPaths', 'affectedEvidenceScopes', 'affectedModels', 'affectedPageIds', 'rationale'])));
  const scopes = plan.affectedEvidenceScopes?.length ? plan.affectedEvidenceScopes : changed;
  for (const scope of scopes) await doDiscover(scope);
  await doAnalyze(`incremental changes: ${changed.join(', ')}`);
  await doSemantics();
  if (loadConfig().enterpriseDepth?.enabled !== false) await doEnterprise();
  await doPlan();
  for (const id of plan.affectedPageIds ?? []) {
    const currentManifest = loadManifest();
    if (currentManifest.pages.some((p) => p.id === id)) { await doGenerate(id); await doAudit(id); }
  }
  rebuildAuditIndex();
  doSnapshot();
}

function validateStageArtifact(stage) {
  if (stage === 'discover') return normalizeEvidenceIndex();
  if (stage === 'analyze') return normalizeJsonFile(systemPath, normalizeSystemObject, assertSystemModel);
  if (stage === 'semantics') return [
    normalizeJsonFile(businessPath, normalizeBusinessObject, assertBusinessModel),
    normalizeJsonFile(flowsPath, normalizeFlowsObject, assertFlowsModel),
    normalizeJsonFile(catalogsPath, normalizeCatalogsObject, assertCatalogsModel)
  ];
  if (stage === 'enterprise') return ENTERPRISE_PASSES.flatMap((p)=>p.outputs).map(normalizeEnterpriseFile);
  if (stage === 'plan') return requireManifestPreflight();
  return true;
}
function stageCheckpointValid(stage) {
  try { validateStageArtifact(stage); return true; } catch (e) { console.warn(`[docgen] checkpoint ${stage} is not reusable: ${e.message}`); return false; }
}
function contractSelfTest() {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push({ name, status: 'passed' }); console.log(`PASS contract ${name}`); }
    catch (e) { results.push({ name, status: 'failed', error: e.message }); console.error(`FAIL contract ${name}: ${e.message}`); }
  };
  check('system aliases', () => assertCanonicalModel('system', normalizeSystemObject({ services: [{}], dependencies: [], processes: [], openQuestions: [] }), ['components','relationships','workflows','unknowns']));
  check('business aliases', () => assertCanonicalModel('business', normalizeBusinessObject({ roles: [], businessCapabilities: [], domainConcepts: [], rules: [{}], decisionPoints: [], conditions: [], stateMachines: [], constraints: [], scenarios: [], gaps: [] }), ['actors','capabilities','concepts','businessRules','decisions','branchConditions','lifecycles','invariants','useCases','unknowns']));
  check('flow aliases', () => assertCanonicalModel('flows', normalizeFlowsObject({ flows: [{ type: 'request' }, { type: 'data' }, { type: 'event' }] }), ['businessFlows','controlFlows','requestFlows','trafficFlows','dataFlows','eventFlows']));
  check('catalog aliases', () => assertCanonicalModel('catalogs', normalizeCatalogsObject({ routes: [{}], handlers: [{}], integrations: [{}], databases: [{}], cronJobs: [{}] }), ['endpoints','messageHandlers','externalDependencies','dataStores','scheduledJobs']));
  check('enterprise aliases', () => {
    assertEnterpriseModel('security', normalizeSecurityObject({boundaries:[{}],authnFlows:[],authzRules:[],gaps:[]}), 'security');
    assertEnterpriseModel('operations', normalizeOperationsObject({health:[{}],failures:[],runbooks:[],gaps:[]}), 'operations');
    assertEnterpriseModel('testing', normalizeTestingObject({suites:[{}],testCommands:[],gaps:[]}), 'testing');
    assertEnterpriseModel('data-governance', normalizeDataGovernanceObject({entities:[{}],transactions:[],lineage:[],gaps:[]}), 'dataGovernance');
    assertEnterpriseModel('decisions', normalizeDecisionsObject({adrs:[{}],options:[],gaps:[]}), 'decisions');
    assertEnterpriseModel('configuration', normalizeConfigurationObject({properties:[{}],environmentMatrix:[],gaps:[]}), 'configuration');
    assertEnterpriseModel('change-impact', normalizeChangeImpactObject({changePoints:[{}],blastRadius:[],gaps:[]}), 'changeImpact');
    assertEnterpriseModel('ownership', normalizeOwnershipObject({owners:[{}],raci:[],gaps:[]}), 'ownership');
  });
  check('ignore pattern semantics', () => { const rules=[{raw:'private/**',pattern:'private/**',negated:false,directoryOnly:false,anchored:false,regex:ignorePatternRegex('private/**',false)},{raw:'!private/public.md',pattern:'private/public.md',negated:true,directoryOnly:false,anchored:false,regex:ignorePatternRegex('private/public.md',false)}]; if(!matchIgnoreRules('private/secret.md',false,rules)?.ignored) throw new Error('ignore rule not applied'); if(matchIgnoreRules('private/public.md',false,rules)?.ignored) throw new Error('negation not applied'); });
  check('update-plan aliases', () => assertCanonicalModel('update', normalizeUpdatePlanObject({ changedFiles:['a'], scopes:['.'], models:['system'], pages:['overview'], reasons:['x'] }), ['changedPaths','affectedEvidenceScopes','affectedModels','affectedPageIds','rationale']));
  check('page path variants', () => { for (const x of ['orientation/overview','/orientation/overview.md','docs/orientation/overview','docs/orientation/overview.md']) if (canonicalPagePath(x) !== 'docs/orientation/overview.md') throw new Error(x); });
  check('binary signature detection', () => { if(!hasBinaryMagic(Buffer.from([0x89,0x50,0x4e,0x47])))throw new Error('PNG magic not detected'); if(hasBinaryMagic(Buffer.from('plain text')))throw new Error('text misclassified'); });
  check('documentation mode defaults', () => { const allowed=new Set(loadConfig().documentationExperience?.modes??[]); for(const x of ['tutorial','how-to','explanation','reference','runbook','decision-record','migration-guide','troubleshooting'])if(!allowed.has(x))throw new Error(`missing mode ${x}`); });
  check('audit aliases', () => { const page = { id: 'overview', path: 'docs/orientation/overview.md' }; const x = normalizeAuditReportObject({ id: 'overview', path: 'orientation/overview', hash: 'abc', inputHash: 'def', issues: ['x'] }, page); if (x.pagePath !== page.path || x.findings.length !== 1) throw new Error('audit normalization'); });
  check('normalizer idempotence', () => {
    const samples = [
      [normalizeSystemObject, { services:[{id:'a'}], modules:[{id:'b'}], dependencies:[], processes:[], gaps:[] }],
      [normalizeBusinessObject, { roles:[], rules:[{id:'r'}], policies:[{id:'p'}] }],
      [normalizeFlowsObject, { flows:[{id:'q',type:'request'}], httpFlows:[{id:'q',type:'request'}] }],
      [normalizeCatalogsObject, { consumers:[{id:'c'}], producers:[{id:'p'}], listeners:[{id:'l'}] }],
      [normalizeUpdatePlanObject, { changedFiles:['a'], pages:['x'] }],
      [normalizeSecurityObject, { boundaries:[{id:'b'}], authnFlows:[] }],
      [normalizeOperationsObject, { health:[{id:'h'}], deploymentStrategies:[{id:'dep'}], failures:[] }],
      [normalizeTestingObject, { suites:[{id:'s'}], testCommands:[] }],
      [normalizeDataGovernanceObject, { entities:[{id:'d'}], transactions:[] }],
      [normalizeDecisionsObject, { adrs:[{id:'a'}], options:[] }],
      [normalizeConfigurationObject, { properties:[{id:'c'}], environmentMatrix:[] }],
      [normalizeChangeImpactObject, { changePoints:[{id:'x'}], blastRadius:[] }],
      [normalizeOwnershipObject, { owners:[{id:'o'}], raci:[] }]
    ];
    for (const [fn, input] of samples) { const once = fn(input); const twice = fn(once); if (JSON.stringify(once) !== JSON.stringify(twice)) throw new Error(`${fn.name} is not idempotent`); }
  });
  check('catalog losslessness', () => { const x = normalizeCatalogsObject({ consumers:[{id:'c'}], producers:[{id:'p'}], listeners:[{id:'l'}], kafkaHandlers:[{id:'k'}] }); if (x.messageHandlers.length < 3) throw new Error(`expected at least 3 handlers, got ${x.messageHandlers.length}`); });
  check('evidence path canonicalization', () => { const p = canonicalEvidencePath('repo.json', path.join(root,'.docgen','evidence')); if (p !== '.docgen/evidence/repo.json') throw new Error(p); });
  check('typed semantic items', () => { const x=normalizeBusinessObject({rules:['Only DRAFT may submit']}); const r=x.businessRules[0]; if(r.kind!=='business-rule'||!r.id||!Array.isArray(r.evidence)) throw new Error('typed rule contract'); assertBusinessModel(x); });
  check('evidence line notation', () => { const x=normalizeEvidenceRef('src/A.java#L10-L12'); if(x.path!=='src/A.java'||x.startLine!==10||x.endLine!==12) throw new Error('line notation'); });
  check('duplicate semantic IDs rejected', () => { let failed=false; try{assertBusinessModel(normalizeBusinessObject({rules:[{id:'same',statement:'a'},{id:'same',statement:'b'}]}));}catch{failed=true;} if(!failed) throw new Error('duplicate IDs accepted'); });
  check('FACT requires direct evidence', () => { let failed=false; try{assertBusinessModel(normalizeBusinessObject({rules:[{id:'r',statement:'unsupported',classification:'FACT'}]}));}catch{failed=true;} if(!failed) throw new Error('unsupported FACT was accepted'); });
  check('traceability aliases', () => { const page={id:'overview',path:'docs/orientation/overview.md',evidence:[],models:[]}; const x=normalizeTraceabilityObject({facts:[{claim:'Service uses PostgreSQL',status:'fact',sources:['pom.xml'],subject:'service',predicate:'database',object:'postgresql'}]},page); if(x.claims.length!==1||x.claims[0].kind!=='claim'||x.claims[0].classification!=='FACT') throw new Error('traceability normalization'); });
  check('contradiction detection keys', () => { const a={subject:'quote',predicate:'mutable',object:'yes',polarity:'positive',statement:'a',exclusivePredicate:true}, b={subject:'quote',predicate:'mutable',object:'no',polarity:'positive',statement:'b',exclusivePredicate:true}; if(claimSemanticKey(a)!==claimSemanticKey(b)||claimValueKey(a)===claimValueKey(b)) throw new Error('contradiction keys'); });
  check('word count advisory only', () => { const q=qualityConfig(); if(q.wordCountGate==='hard') throw new Error('word count must not be primary hard gate'); });
  const failures = results.filter((x) => x.status === 'failed');
  const report = {
    schemaVersion: '1.0', kitVersion, checkedAt: now(), passed: failures.length === 0,
    invariants: ['canonicalization', 'idempotence', 'losslessness', 'path-safety', 'identity-consistency', 'transactional-restore', 'typed-items', 'claim-traceability', 'semantic-quality', 'freshness'],
    boundaries: ['discover/evidence-index', 'analyze/system-model', 'semantics/business-model', 'semantics/flow-model', 'semantics/catalog-model', 'plan/manifest', 'generate/markdown-path', 'audit/report', 'update/impact-plan', 'generate/traceability-sidecar', 'quality/cross-page-consistency', 'enterprise/security', 'enterprise/operations', 'enterprise/testing', 'enterprise/data-governance', 'enterprise/decisions', 'enterprise/configuration', 'enterprise/change-impact', 'enterprise/ownership', 'source-ignore/gitignore-docgenignore'],
    tests: results
  };
  writeJson(path.join(root, '.docgen', 'state', 'contract-report.json'), report);
  if (failures.length) throw new Error(`Contract self-test failed:\n- ${failures.map((x) => `${x.name}: ${x.error}`).join('\n- ')}`);
  console.log('Contract firewall self-test passed.');
  console.log('Report: .docgen/state/contract-report.json');
  return true;
}
function status() {
  const state = loadState();
  console.log(`DocGen Kit ${kitVersion}`);
  for (const stage of ['discover', 'analyze', 'semantics', 'enterprise', 'plan', 'generate', 'audit']) console.log(`${stage.padEnd(10)} ${state.stages?.[stage]?.status ?? 'pending'}`);
  if (fs.existsSync(manifestPath)) {
    const m = normalizeManifest(); const generated = (m.pages ?? []).filter(pageIsValid).length; const reusable = (m.pages ?? []).filter(pageIsReusable).length;
    console.log(`pages      ${generated}/${m.pages?.length ?? 0} generated | ${reusable} reusable for current inputs`);
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
    ['discover', 'analyze', 'semantics', 'enterprise', 'plan', 'generate', 'enrich', 'audit', 'fix', 'update-impact'].map((stage) => [stage, commandCodeArgs(stage)])
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
  contractSelfTest();
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
  const rootTemplate = path.join(engineHome, 'project-root-template');
  // Root-level files such as .docgenignore are user-owned policy and are never overwritten, even by init --force.
  if (fs.existsSync(rootTemplate)) copyTreeMissing(rootTemplate, target, false);
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
  for (const dir of ['hooks', 'prompts', 'schemas', 'project-template', 'project-root-template', 'bin']) if (!fs.existsSync(path.join(engineHome, dir))) errors.push(`Missing ${path.join(engineHome, dir)}`);
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
  docgen contract-test           run zero-token producer/consumer contract regression tests
  docgen discover [scope]
  docgen analyze [scope]
  docgen semantics              extract business/flow/catalog models
  docgen enterprise             extract P1 security/operations/testing/data/decision/config/impact/ownership models
  docgen ignore [path]          inspect effective .gitignore + .docgenignore source boundary
  docgen source-list [filter]   list only included repository source files
  docgen source-grep [--regex] <query> search only included repository source files
  docgen plan
  docgen preflight             normalize/validate the entire manifest before any page LLM call
  docgen generate <id|--all>    generate pages; comprehensive profile auto-enriches
  docgen enrich <id|--all>      run explicit depth/completeness pass
  docgen audit <id|--all>
  docgen fix <id|--all>
  docgen traceability           rebuild claim index, contradiction, duplicate, and freshness reports
  docgen publish                generate frontmatter, llms.txt, search/navigation/backlinks/redirects/examples metadata
  docgen quality                run evidence-centric semantic + audit quality gates
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
  case 'validate': contractSelfTest(); if (!validateStatic() || !validateGenerated()) process.exit(1); break;
  case 'contract-test': contractSelfTest(); break;
  case 'discover': await doDiscover(args.join(' ') || '.'); break;
  case 'analyze': await doAnalyze(args.join(' ') || 'all current evidence'); break;
  case 'semantics': await doSemantics(); break;
  case 'enterprise': await doEnterprise(); break;
  case 'ignore': doIgnore(args[0]); break;
  case 'source-list': doSourceList(args.join(' ')); break;
  case 'source-grep': doSourceGrep(args); break;
  case 'plan': await doPlan(); break;
  case 'preflight': { const m = requireManifestPreflight(); console.log(`Manifest preflight PASS: ${m.pages.length} pages. Report: ${rel(preflightPath)}`); break; }
  case 'generate': if (args[0] === '--all') await doGenerateAll(args.includes('--force')); else if (args[0]) await doGenerate(args[0], '', true, args.includes('--force')); else fail('generate requires <page-id|--all>'); break;
  case 'enrich': if (args[0] === '--all') await doEnrichAll(); else if (args[0]) await doEnrich(args[0]); else fail('enrich requires <page-id|--all>'); break;
  case 'audit': if (args[0] === '--all') await doAuditAll(); else if (args[0]) { await doAudit(args[0]); rebuildAuditIndex(); writeQualitySummary(); } else fail('audit requires <page-id|--all>'); break;
  case 'fix': if (args[0] === '--all') await doFixAll(); else if (args[0]) await doFix(args[0]); else fail('fix requires <page-id|--all>'); break;
  case 'traceability': doTraceability(); break;
  case 'publish': doPublish(); break;
  case 'quality': doQuality(); break;
  case 'snapshot': doSnapshot(); break;
  case 'changed': console.log(changedPaths().join('\n')); break;
  case 'update': await doUpdate(args); break;
  case 'resume':
  case 'all': {
    const fresh = args.includes('--fresh');
    console.log(`DocGen full pipeline | quality profile: ${qualityProfile()} | mode: ${fresh ? 'fresh' : 'resume'}`);
    const state = loadState();
    const stageComplete = (name, artifact) => !fresh && state.stages?.[name]?.status === 'completed' && (!artifact || fs.existsSync(artifact)) && stageCheckpointValid(name);
    let upstreamReran = false;
    if (!upstreamReran && stageComplete('discover', evidenceIndexPath)) console.log('[docgen] SKIP phase 1/8 discovery — completed evidence checkpoint exists.');
    else { printItemProgress('phase', 1, 8, 'evidence discovery'); await doDiscover('.', 'phase 1/8'); upstreamReran = true; }
    if (!upstreamReran && stageComplete('analyze', systemPath)) console.log('[docgen] SKIP phase 2/8 analysis — completed system model exists.');
    else { printItemProgress('phase', 2, 8, 'technical architecture analysis'); await doAnalyze('all current evidence', 'phase 2/8'); upstreamReran = true; }
    if (!upstreamReran && stageComplete('semantics', catalogsPath) && fs.existsSync(businessPath) && fs.existsSync(flowsPath)) console.log('[docgen] SKIP phase 3/8 semantics — completed semantic models exist.');
    else { printItemProgress('phase', 3, 8, 'business, flow, and catalog semantics'); await doSemantics('phase 3/8'); upstreamReran = true; }
    const enterpriseFiles = ENTERPRISE_PASSES.flatMap((p)=>p.outputs);
    if (loadConfig().enterpriseDepth?.enabled === false) console.log('[docgen] SKIP phase 4/8 enterprise depth — disabled by configuration.');
    else if (!upstreamReran && stageComplete('enterprise', securityPath) && enterpriseFiles.every((f)=>fs.existsSync(f))) console.log('[docgen] SKIP phase 4/8 enterprise depth — completed P1 models exist.');
    else { printItemProgress('phase', 4, 8, 'P1 enterprise depth'); await doEnterprise('phase 4/8'); upstreamReran = true; }
    if (!upstreamReran && stageComplete('plan', manifestPath)) { const m = requireManifestPreflight(); console.log(`[docgen] SKIP phase 5/8 planning — valid preflighted manifest exists (${m.pages.length} pages).`); }
    else { printItemProgress('phase', 5, 8, 'multi-page documentation planning'); await doPlan('phase 5/8'); upstreamReran = true; }
    const manifest = requireManifestPreflight(); console.log(`Plan contains ${manifest.pages.length} pages across ${manifest.navigation?.length ?? 0} navigation categories.`);
    printItemProgress('phase', 6, 8, 'batched page generation + targeted enrichment'); await doGenerateAll(fresh);
    printItemProgress('phase', 7, 8, 'batched independent audit'); await doAuditAll();
    if (isComprehensive() && qualityConfig().autoFix !== false) {
      console.log('Phase 7b/8 — automatic repair only for pages with audit findings');
      const fixed = await doFixAll();
      if (fixed.length && qualityConfig().reAuditAfterFix !== false) {
        console.log(`Re-auditing ${fixed.length} repaired page(s)...`);
        for (let i = 0; i < fixed.length; i++) { printItemProgress('re-audit', i + 1, fixed.length, fixed[i]); await doAudit(fixed[i], `re-audit ${i + 1}/${fixed.length}`, true); }
        rebuildAuditIndex();
      }
    }
    printItemProgress('phase', 8, 8, 'quality summary + source snapshot');
    writeQualitySummary(); doPublish(); doSnapshot(); doQuality();
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
