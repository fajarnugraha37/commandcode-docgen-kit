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
function normalizeSystemObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    components: canonicalArray(obj, 'components', ['services', 'modules', 'subsystems', 'applications', 'nodes']),
    relationships: canonicalArray(obj, 'relationships', ['dependencies', 'links', 'interactions', 'connections', 'edges']),
    workflows: canonicalArray(obj, 'workflows', ['processes', 'executionFlows', 'systemFlows', 'scenarios']),
    unknowns: canonicalArray(obj, 'unknowns', ['openQuestions', 'unresolved', 'gaps', 'uncertainties']),
    metadata: obj.metadata ?? {}
  };
}
function normalizeBusinessObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    actors: canonicalArray(obj, 'actors', ['roles', 'personas', 'participants', 'users']),
    capabilities: canonicalArray(obj, 'capabilities', ['businessCapabilities', 'functions', 'features']),
    concepts: canonicalArray(obj, 'concepts', ['domainConcepts', 'entities', 'terms', 'vocabulary']),
    businessRules: canonicalArray(obj, 'businessRules', ['rules', 'policies', 'businessLogic']),
    decisions: canonicalArray(obj, 'decisions', ['decisionPoints', 'decisionRules']),
    branchConditions: canonicalArray(obj, 'branchConditions', ['branches', 'conditions', 'guards']),
    lifecycles: canonicalArray(obj, 'lifecycles', ['lifeCycles', 'stateMachines', 'stateLifecycles']),
    invariants: canonicalArray(obj, 'invariants', ['domainInvariants', 'constraints']),
    useCases: canonicalArray(obj, 'useCases', ['usecases', 'scenarios', 'businessScenarios']),
    unknowns: canonicalArray(obj, 'unknowns', ['openQuestions', 'unresolved', 'gaps', 'uncertainties']),
    metadata: obj.metadata ?? {}
  };
}
function normalizeFlowsObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    businessFlows: canonicalArray(obj, 'businessFlows', ['businessProcesses', 'businessWorkflows']),
    controlFlows: canonicalArray(obj, 'controlFlows', ['executionFlows', 'codeFlows', 'callFlows']),
    requestFlows: canonicalArray(obj, 'requestFlows', ['httpFlows', 'apiFlows', 'inboundFlows']),
    trafficFlows: canonicalArray(obj, 'trafficFlows', ['networkFlows', 'runtimeTrafficFlows']),
    dataFlows: canonicalArray(obj, 'dataFlows', ['dataPipelines', 'informationFlows']),
    eventFlows: canonicalArray(obj, 'eventFlows', ['messageFlows', 'messagingFlows', 'asyncFlows']),
    metadata: obj.metadata ?? {}
  };
  const generic = arrayValue(obj, ['flows'], []);
  for (const flow of generic) {
    const type = String(flow?.type ?? flow?.kind ?? flow?.category ?? '').toLowerCase();
    if (/business/.test(type)) result.businessFlows.push(flow);
    else if (/control|execution|call/.test(type)) result.controlFlows.push(flow);
    else if (/request|http|api/.test(type)) result.requestFlows.push(flow);
    else if (/traffic|network|runtime/.test(type)) result.trafficFlows.push(flow);
    else if (/data|information/.test(type)) result.dataFlows.push(flow);
    else if (/event|message|async|kafka|rabbit/.test(type)) result.eventFlows.push(flow);
  }
  for (const key of ['businessFlows','controlFlows','requestFlows','trafficFlows','dataFlows','eventFlows']) result[key] = uniqueArray(result[key]);
  return result;
}
function normalizeCatalogsObject(input = {}) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: '1.0', generatedAt: obj.generatedAt ?? obj.createdAt ?? obj.updatedAt ?? obj.timestamp ?? now(),
    endpoints: canonicalArray(obj, 'endpoints', ['apis', 'routes', 'httpEndpoints', 'apiEndpoints', 'restEndpoints', 'grpcEndpoints', 'websocketEndpoints', 'sseEndpoints']),
    messageHandlers: canonicalArray(obj, 'messageHandlers', ['handlers', 'consumers', 'listeners', 'producers', 'messageConsumers', 'messageProducers', 'publishers', 'kafkaHandlers', 'rabbitHandlers', 'queueHandlers', 'streamHandlers']),
    externalDependencies: canonicalArray(obj, 'externalDependencies', ['dependencies', 'integrations', 'externalServices', 'cloudServices', 'services', 'internalServices', 'upstreamServices', 'downstreamServices', 'thirdPartyServices', 'cloudResources']),
    dataStores: canonicalArray(obj, 'dataStores', ['datastores', 'databases', 'storage', 'stores', 'caches']),
    scheduledJobs: canonicalArray(obj, 'scheduledJobs', ['jobs', 'schedulers', 'cronJobs', 'scheduledTasks']),
    metadata: obj.metadata ?? {}
  };
}
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
    if (typeof f === 'string') return { id: `finding-${i + 1}`, severity: 'medium', summary: f };
    const item = f && typeof f === 'object' ? { ...f } : { summary: String(f) };
    item.id ??= item.code ?? `finding-${i + 1}`;
    item.severity = String(item.severity ?? item.level ?? item.priority ?? 'medium').toLowerCase();
    if (!['critical', 'high', 'medium', 'low'].includes(item.severity)) item.severity = 'medium';
    item.summary ??= item.message ?? item.description ?? item.title ?? 'Unspecified finding';
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
      qualityHints: arrayValue(page, ['qualityHints', 'hints', 'qualityRequirements'], []).map(String)
    };
  });
  const pageIdByAlias = new Map();
  for (const p of pages) {
    for (const alias of [p.id, p.title, p.path, p.path.replace(/^docs\//, '').replace(/\.md$/i, ''), path.posix.basename(p.path, '.md')]) pageIdByAlias.set(slug(alias), p.id);
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
  const allowedTypes = new Set(loadConfig().pageTypes ?? ['overview','architecture','business','concept','flow','guide','reference','data','integration','operations','troubleshooting']);
  for (const page of manifest.pages) {
    if (ids.has(page.id)) errors.push(`duplicate page id: ${page.id}`); ids.add(page.id);
    if (paths.has(page.path)) errors.push(`duplicate page path: ${page.path}`); paths.add(page.path);
    if (!page.title?.trim()) errors.push(`${page.id}: title is required`);
    if (!page.category?.trim()) errors.push(`${page.id}: category is required`);
    if (!allowedTypes.has(page.type)) errors.push(`${page.id}: unsupported page type ${page.type}`);
    if (!Array.isArray(page.requiredSections) || !page.requiredSections.length) errors.push(`${page.id}: requiredSections must not be empty`);
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
  const business = normalizeBusinessObject(loadOptionalJson(businessPath, {}));
  const flows = normalizeFlowsObject(loadOptionalJson(flowsPath, {}));
  const catalogs = normalizeCatalogsObject(loadOptionalJson(catalogsPath, {}));
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
  const requiredCommands = ['docgen-init', 'docgen-doctor', 'docgen-discover', 'docgen-analyze', 'docgen-plan', 'docgen-generate', 'docgen-audit', 'docgen-fix', 'docgen-update', 'docgen-status', 'docgen-enrich', 'docgen-quality', 'docgen-semantics', 'docgen-preflight', 'docgen-resume', 'docgen-contract-test'];
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
  try { if (fs.existsSync(evidenceIndexPath)) normalizeEvidenceIndex(); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(systemPath)) normalizeJsonFile(systemPath, normalizeSystemObject, (obj) => assertCanonicalModel('system.json', obj, ['components', 'relationships', 'workflows', 'unknowns'])); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(businessPath)) normalizeJsonFile(businessPath, normalizeBusinessObject, (obj) => assertCanonicalModel('business.json', obj, ['actors', 'capabilities', 'concepts', 'businessRules', 'decisions', 'branchConditions', 'lifecycles', 'invariants', 'useCases', 'unknowns'])); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(flowsPath)) normalizeJsonFile(flowsPath, normalizeFlowsObject, (obj) => assertCanonicalModel('flows.json', obj, ['businessFlows', 'controlFlows', 'requestFlows', 'trafficFlows', 'dataFlows', 'eventFlows'])); } catch (e) { errors.push(e.message); }
  try { if (fs.existsSync(catalogsPath)) normalizeJsonFile(catalogsPath, normalizeCatalogsObject, (obj) => assertCanonicalModel('catalogs.json', obj, ['endpoints', 'messageHandlers', 'externalDependencies', 'dataStores', 'scheduledJobs'])); } catch (e) { errors.push(e.message); }
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
  try {
    const evidenceIndex = await runContractStage('discover', [path.dirname(evidenceIndexPath)],
      (reset) => runCommandCode('discover', renderPrompt('discover.md', { SCOPE: scope }), scope, progressLabel, { beforeRetry: reset }),
      () => normalizeEvidenceIndex());
    updateStage('discover', 'completed', { scope, artifactCount: evidenceIndex.artifacts.length });
  } catch (e) { updateStage('discover', 'failed', { scope, error: e.message }); throw e; }
}
async function doAnalyze(scope = 'all current evidence', progressLabel = '') {
  if (!fs.existsSync(evidenceIndexPath)) fail('Run discover first.');
  normalizeEvidenceIndex();
  updateStage('analyze', 'running', { scope });
  try {
    const system = await runContractStage('analyze', [systemPath],
      (reset) => runCommandCode('analyze', renderPrompt('analyze.md', { SCOPE: scope }), scope, progressLabel, { beforeRetry: reset }),
      () => normalizeJsonFile(systemPath, normalizeSystemObject, (obj) => assertCanonicalModel('system.json', obj, ['components', 'relationships', 'workflows', 'unknowns'])));
    updateStage('analyze', 'completed', { scope, components: system.components.length, relationships: system.relationships.length, workflows: system.workflows.length });
  } catch (e) { updateStage('analyze', 'failed', { scope, error: e.message }); throw e; }
}
async function doSemantics(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  normalizeJsonFile(systemPath, normalizeSystemObject, (obj) => assertCanonicalModel('system.json', obj, ['components', 'relationships', 'workflows', 'unknowns']));
  updateStage('semantics', 'running');
  try {
    const [business, flows, catalogs] = await runContractStage('semantics', [businessPath, flowsPath, catalogsPath],
      (reset) => runCommandCode('semantics', renderPrompt('semantics.md'), '', progressLabel, { beforeRetry: reset }),
      () => [
        normalizeJsonFile(businessPath, normalizeBusinessObject, (obj) => assertCanonicalModel('business.json', obj, ['actors', 'capabilities', 'concepts', 'businessRules', 'decisions', 'branchConditions', 'lifecycles', 'invariants', 'useCases', 'unknowns'])),
        normalizeJsonFile(flowsPath, normalizeFlowsObject, (obj) => assertCanonicalModel('flows.json', obj, ['businessFlows', 'controlFlows', 'requestFlows', 'trafficFlows', 'dataFlows', 'eventFlows'])),
        normalizeJsonFile(catalogsPath, normalizeCatalogsObject, (obj) => assertCanonicalModel('catalogs.json', obj, ['endpoints', 'messageHandlers', 'externalDependencies', 'dataStores', 'scheduledJobs']))
      ]);
    updateStage('semantics', 'completed', { endpoints: catalogs.endpoints.length, messageHandlers: catalogs.messageHandlers.length, externalDependencies: catalogs.externalDependencies.length, businessRules: business.businessRules.length, flows: Object.values(flows).filter(Array.isArray).reduce((n, x) => n + x.length, 0) });
  } catch (e) { updateStage('semantics', 'failed', { error: e.message }); throw e; }
}
async function doPlan(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  normalizeJsonFile(systemPath, normalizeSystemObject, (obj) => assertCanonicalModel('system.json', obj, ['components', 'relationships', 'workflows', 'unknowns']));
  if (fs.existsSync(businessPath)) normalizeJsonFile(businessPath, normalizeBusinessObject, (obj) => assertCanonicalModel('business.json', obj, ['actors', 'capabilities', 'concepts', 'businessRules', 'decisions', 'branchConditions', 'lifecycles', 'invariants', 'useCases', 'unknowns']));
  if (fs.existsSync(flowsPath)) normalizeJsonFile(flowsPath, normalizeFlowsObject, (obj) => assertCanonicalModel('flows.json', obj, ['businessFlows', 'controlFlows', 'requestFlows', 'trafficFlows', 'dataFlows', 'eventFlows']));
  if (fs.existsSync(catalogsPath)) normalizeJsonFile(catalogsPath, normalizeCatalogsObject, (obj) => assertCanonicalModel('catalogs.json', obj, ['endpoints', 'messageHandlers', 'externalDependencies', 'dataStores', 'scheduledJobs']));
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
function pageCurrentHash(page) { return fileSha256(pageFile(page)); }
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
  if (!state?.generateInputHash && executionConfig().adoptLegacyValidPages) {
    updatePageState(page.id, { generateStatus: 'completed', generatedAt: state?.generatedAt ?? now(), pageHash: pageCurrentHash(page), generateInputHash: currentInputHash, targetPath: page.path, adoptedLegacyValidPage: true });
    console.log(`[docgen] adopted legacy valid page checkpoint: ${page.id}`);
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
    await runCommandCode('generate', renderPrompt('generate.md', { PAGE_JSON: JSON.stringify(page, null, 2) }), id, progressLabel);
    validatePageFile(page);
    updatePageState(id, { generateStatus: 'completed', generatedAt: now(), pageHash: pageCurrentHash(page), generateInputHash: pageInputHash(page), targetPath: page.path });
  }
  if (allowEnrich && qualityConfig().autoEnrich !== false && isComprehensive() && pageNeedsEnrichment(page)) await doEnrich(id, progressLabel, force);
}
async function doGenerateBatch(pages, progressLabel = '') {
  const pending = pages.filter((p) => !(executionConfig().skipValidPages && pageIsReusable(p)));
  for (const p of pages.filter((p) => !pending.includes(p))) console.log(`[docgen] SKIP generate:${p.id} — valid page already exists.`);
  if (!pending.length) return;
  for (const p of pending) updatePageState(p.id, { generateStatus: 'running', targetPath: p.path });
  await runCommandCode('generate', renderPrompt('generate-batch.md', { PAGES_JSON: JSON.stringify(pending, null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
  const failures = [];
  for (const page of pending) {
    try { validatePageFile(page); updatePageState(page.id, { generateStatus: 'completed', generatedAt: now(), pageHash: pageCurrentHash(page), generateInputHash: pageInputHash(page), targetPath: page.path }); }
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
  await runCommandCode('audit', renderPrompt('audit.md', { PAGE_JSON: JSON.stringify(page, null, 2), PAGE_ID: page.id, PAGE_HASH: pageCurrentHash(page), PAGE_INPUT_HASH: pageInputHash(page) }), id, progressLabel);
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
  await runCommandCode('audit', renderPrompt('audit-batch.md', { PAGES_JSON: JSON.stringify(pending.map((p) => ({ ...p, pageHash: pageCurrentHash(p), inputHash: pageInputHash(p) })), null, 2) }), pending.map((p) => p.id).join(','), progressLabel);
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
    const report = normalizeJsonFile(audit, (obj) => normalizeAuditReportObject(obj, page), (obj) => assertCanonicalModel(`audit/${page.id}.json`, obj, ['findings']));
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
  const updatePlanPath = path.join(root, '.docgen', 'plan', 'update-plan.json');
  const plan = await runContractStage('update-impact', [updatePlanPath],
    (reset) => runCommandCode('update-impact', renderPrompt('update-impact.md', { CHANGED_PATHS_JSON: JSON.stringify(changed, null, 2) }), changed.join(', '), '', { beforeRetry: reset }),
    () => normalizeJsonFile(updatePlanPath, (obj) => normalizeUpdatePlanObject(obj, changed), (obj) => assertCanonicalModel('update-plan.json', obj, ['changedPaths', 'affectedEvidenceScopes', 'affectedModels', 'affectedPageIds', 'rationale'])));
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

function validateStageArtifact(stage) {
  if (stage === 'discover') return normalizeEvidenceIndex();
  if (stage === 'analyze') return normalizeJsonFile(systemPath, normalizeSystemObject, (obj) => assertCanonicalModel('system.json', obj, ['components', 'relationships', 'workflows', 'unknowns']));
  if (stage === 'semantics') return [
    normalizeJsonFile(businessPath, normalizeBusinessObject, (obj) => assertCanonicalModel('business.json', obj, ['actors', 'capabilities', 'concepts', 'businessRules', 'decisions', 'branchConditions', 'lifecycles', 'invariants', 'useCases', 'unknowns'])),
    normalizeJsonFile(flowsPath, normalizeFlowsObject, (obj) => assertCanonicalModel('flows.json', obj, ['businessFlows', 'controlFlows', 'requestFlows', 'trafficFlows', 'dataFlows', 'eventFlows'])),
    normalizeJsonFile(catalogsPath, normalizeCatalogsObject, (obj) => assertCanonicalModel('catalogs.json', obj, ['endpoints', 'messageHandlers', 'externalDependencies', 'dataStores', 'scheduledJobs']))
  ];
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
  check('update-plan aliases', () => assertCanonicalModel('update', normalizeUpdatePlanObject({ changedFiles:['a'], scopes:['.'], models:['system'], pages:['overview'], reasons:['x'] }), ['changedPaths','affectedEvidenceScopes','affectedModels','affectedPageIds','rationale']));
  check('page path variants', () => { for (const x of ['orientation/overview','/orientation/overview.md','docs/orientation/overview','docs/orientation/overview.md']) if (canonicalPagePath(x) !== 'docs/orientation/overview.md') throw new Error(x); });
  check('audit aliases', () => { const page = { id: 'overview', path: 'docs/orientation/overview.md' }; const x = normalizeAuditReportObject({ id: 'overview', path: 'orientation/overview', hash: 'abc', inputHash: 'def', issues: ['x'] }, page); if (x.pagePath !== page.path || x.findings.length !== 1) throw new Error('audit normalization'); });
  check('normalizer idempotence', () => {
    const samples = [
      [normalizeSystemObject, { services:[{id:'a'}], modules:[{id:'b'}], dependencies:[], processes:[], gaps:[] }],
      [normalizeBusinessObject, { roles:[], rules:[{id:'r'}], policies:[{id:'p'}] }],
      [normalizeFlowsObject, { flows:[{id:'q',type:'request'}], httpFlows:[{id:'q',type:'request'}] }],
      [normalizeCatalogsObject, { consumers:[{id:'c'}], producers:[{id:'p'}], listeners:[{id:'l'}] }],
      [normalizeUpdatePlanObject, { changedFiles:['a'], pages:['x'] }]
    ];
    for (const [fn, input] of samples) { const once = fn(input); const twice = fn(once); if (JSON.stringify(once) !== JSON.stringify(twice)) throw new Error(`${fn.name} is not idempotent`); }
  });
  check('catalog losslessness', () => { const x = normalizeCatalogsObject({ consumers:[{id:'c'}], producers:[{id:'p'}], listeners:[{id:'l'}], kafkaHandlers:[{id:'k'}] }); if (x.messageHandlers.length < 3) throw new Error(`expected at least 3 handlers, got ${x.messageHandlers.length}`); });
  check('evidence path canonicalization', () => { const p = canonicalEvidencePath('repo.json', path.join(root,'.docgen','evidence')); if (p !== '.docgen/evidence/repo.json') throw new Error(p); });
  const failures = results.filter((x) => x.status === 'failed');
  const report = {
    schemaVersion: '1.0', kitVersion, checkedAt: now(), passed: failures.length === 0,
    invariants: ['canonicalization', 'idempotence', 'losslessness', 'path-safety', 'identity-consistency', 'transactional-restore'],
    boundaries: ['discover/evidence-index', 'analyze/system-model', 'semantics/business-model', 'semantics/flow-model', 'semantics/catalog-model', 'plan/manifest', 'generate/markdown-path', 'audit/report', 'update/impact-plan'],
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
  for (const stage of ['discover', 'analyze', 'semantics', 'plan', 'generate', 'audit']) console.log(`${stage.padEnd(10)} ${state.stages?.[stage]?.status ?? 'pending'}`);
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
  docgen contract-test           run zero-token producer/consumer contract regression tests
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
  case 'validate': contractSelfTest(); if (!validateStatic() || !validateGenerated()) process.exit(1); break;
  case 'contract-test': contractSelfTest(); break;
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
    const stageComplete = (name, artifact) => !fresh && state.stages?.[name]?.status === 'completed' && (!artifact || fs.existsSync(artifact)) && stageCheckpointValid(name);
    let upstreamReran = false;
    if (!upstreamReran && stageComplete('discover', evidenceIndexPath)) console.log('[docgen] SKIP phase 1/7 discovery — completed evidence checkpoint exists.');
    else { printItemProgress('phase', 1, 7, 'evidence discovery'); await doDiscover('.', 'phase 1/7'); upstreamReran = true; }
    if (!upstreamReran && stageComplete('analyze', systemPath)) console.log('[docgen] SKIP phase 2/7 analysis — completed system model exists.');
    else { printItemProgress('phase', 2, 7, 'technical architecture analysis'); await doAnalyze('all current evidence', 'phase 2/7'); upstreamReran = true; }
    if (!upstreamReran && stageComplete('semantics', catalogsPath) && fs.existsSync(businessPath) && fs.existsSync(flowsPath)) console.log('[docgen] SKIP phase 3/7 semantics — completed semantic models exist.');
    else { printItemProgress('phase', 3, 7, 'business, flow, and catalog semantics'); await doSemantics('phase 3/7'); upstreamReran = true; }
    if (!upstreamReran && stageComplete('plan', manifestPath)) { const m = requireManifestPreflight(); console.log(`[docgen] SKIP phase 4/7 planning — valid preflighted manifest exists (${m.pages.length} pages).`); }
    else { printItemProgress('phase', 4, 7, 'multi-page documentation planning'); await doPlan('phase 4/7'); upstreamReran = true; }
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
