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
const auditIndexPath = path.join(root, '.docgen', 'audit', 'index.json');
const configPath = path.join(root, '.docgen', 'config', 'documentation.json');
const fingerprintsPath = path.join(root, '.docgen', 'state', 'fingerprints.json');

function fail(message, code = 1) { console.error(`ERROR: ${message}`); process.exit(code); }
function exists(relOrAbs) { return fs.existsSync(path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function now() { return new Date().toISOString(); }
function rel(file) { return path.relative(root, file).replaceAll('\\', '/'); }

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
  5: ['rate-limited', 'The LLM/API provider rate limit was exceeded. Retry later or change provider/model.'],
  6: ['network-failure', 'Command Code could not reach the API/provider. Check network, proxy, DNS, or provider availability.'],
  7: ['api-server-error', 'The LLM/API provider returned a server-side 5xx error.'],
  8: ['max-turns', 'The headless max-turn limit was reached before completion. Increase commandCode.maxTurns for this stage.'],
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

async function runCommandCode(stage, prompt, target = '', progressLabel = '') {
  const bin = commandCodeBin();
  if (!bin) fail('Command Code executable not found. Install it or set DOCGEN_COMMAND_CODE_BIN.');
  const args = commandCodeArgs(stage);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${stage}`;
  const startedMs = Date.now();
  const meta = {
    schemaVersion: '1.1', runId, stage, target, progressLabel, startedAt: now(),
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
  console.log(`\n==> ${stage}${target ? `: ${target}` : ''}${progressLabel ? ` | ${progressLabel}` : ''}`);
  console.log(`    ${bin} ${args.join(' ')}`);
  console.log(`    logs: ${rel(stdoutLogPath)} | ${rel(stderrLogPath)}`);

  const pc = progressConfig();
  const heartbeatMs = Math.max(2, Number(pc.heartbeatSeconds ?? 10)) * 1000;
  const noOutputWarnMs = Math.max(5, Number(pc.noOutputWarningSeconds ?? 45)) * 1000;
  let lastOutputMs = Date.now();
  let warnedNoOutput = false;
  let stderrTail = '';

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: root, env, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    meta.pid = child.pid ?? null; writeJson(metaPath, meta);

    const onChunk = (stream, chunk, logPath) => {
      lastOutputMs = Date.now(); warnedNoOutput = false;
      const text = chunk.toString();
      fs.appendFileSync(logPath, text);
      if (stream === 'stderr') stderrTail = (stderrTail + text).slice(-12000);
      if (pc.showCommandOutput !== false) (stream === 'stdout' ? process.stdout : process.stderr).write(text);
    };
    child.stdout.on('data', (c) => onChunk('stdout', c, stdoutLogPath));
    child.stderr.on('data', (c) => onChunk('stderr', c, stderrLogPath));

    const heartbeat = setInterval(() => {
      const nowMs = Date.now();
      const quiet = nowMs - lastOutputMs;
      const artifacts = recentArtifactActivity(startedMs);
      const quietMsg = quiet >= noOutputWarnMs ? ` | no CLI output for ${duration(quiet)}` : '';
      console.log(`[docgen] ${stage}${target ? `:${target}` : ''} RUNNING | elapsed ${duration(nowMs - startedMs)} | pid ${child.pid ?? '?'} | changed artifacts ${artifacts}${quietMsg}`);
      if (quiet >= noOutputWarnMs && !warnedNoOutput) {
        warnedNoOutput = true;
        console.log('[docgen] The process is still alive. Command Code headless may be quiet while the model is reasoning/tooling; API/network failures will be surfaced by stderr or the documented exit code.');
      }
    }, heartbeatMs);

    child.on('error', (err) => {
      clearInterval(heartbeat);
      meta.finishedAt = now(); meta.status = 'failed-to-launch'; meta.error = err.message;
      writeJson(metaPath, meta);
      reject(new Error(`${stage} failed to launch: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      clearInterval(heartbeat);
      const exitCode = code ?? (signal ? 130 : 1);
      const [classification, explanation] = EXIT_CLASSIFICATION[exitCode] ?? ['unknown-error', `Command Code exited with code ${exitCode}.`];
      meta.finishedAt = now(); meta.durationMs = Date.now() - startedMs; meta.exitCode = exitCode;
      meta.signal = signal ?? null; meta.status = exitCode === 0 ? 'completed' : 'failed';
      meta.errorClassification = classification; meta.stdoutLog = rel(stdoutLogPath); meta.stderrLog = rel(stderrLogPath);
      writeJson(metaPath, meta);
      console.log(`[docgen] ${stage}${target ? `:${target}` : ''} ${exitCode === 0 ? 'COMPLETED' : 'FAILED'} | ${duration(meta.durationMs)} | exit ${exitCode} (${classification})`);
      if (exitCode !== 0) {
        const tail = stderrTail.trim();
        const detail = tail ? `\n\nLast stderr output:\n${tail}` : '';
        reject(Object.assign(new Error(`${stage} failed: ${explanation}${detail}`), { exitCode }));
      } else resolve(meta);
    });

    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  }).catch((err) => fail(err.message, err.exitCode || 1));
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) fail('Missing .docgen/plan/manifest.json. Run plan first.');
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.pages)) fail('Manifest pages must be an array.');
  return manifest;
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
function validatePageFile(page) {
  const file = path.join(root, page.path);
  if (!fs.existsSync(file)) throw new Error(`Missing generated page: ${page.path}`);
  const text = fs.readFileSync(file, 'utf8');
  if (!/^#\s+\S/m.test(text)) throw new Error(`${page.path} has no H1 heading`);
  if ((text.match(/```/g) ?? []).length % 2 !== 0) throw new Error(`${page.path} has an unclosed fenced code block`);
  if (/[A-Za-z]:\\Users\\|\/home\/[^/]+\//.test(text)) throw new Error(`${page.path} appears to contain an absolute local user path`);
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
  const requiredAgents = ['doc-discoverer', 'doc-architect', 'doc-planner', 'doc-writer', 'doc-auditor'];
  for (const a of requiredAgents) if (!fs.existsSync(path.join(commandCodeHome, 'agents', `${a}.md`))) errors.push(`Missing global agent: ${a}`);
  const requiredCommands = ['docgen-init', 'docgen-doctor', 'docgen-discover', 'docgen-analyze', 'docgen-plan', 'docgen-generate', 'docgen-audit', 'docgen-fix', 'docgen-update', 'docgen-status', 'docgen-enrich', 'docgen-quality'];
  for (const c of requiredCommands) if (!fs.existsSync(path.join(commandCodeHome, 'commands', `${c}.md`))) errors.push(`Missing global command: ${c}`);
  for (const prompt of ['discover.md', 'analyze.md', 'plan.md', 'generate.md', 'enrich.md', 'audit.md', 'fix.md', 'update-impact.md']) if (!fs.existsSync(assetFile('prompts', prompt))) errors.push(`Missing prompt: ${prompt}`);
  for (const schema of ['evidence-artifact.schema.json', 'evidence-index.schema.json', 'component.schema.json', 'workflow.schema.json', 'system.schema.json', 'manifest.schema.json', 'audit-page.schema.json', 'audit-index.schema.json', 'update-plan.schema.json']) {
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
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = validateJsonFile(manifestPath, ['schemaVersion', 'pages']);
      const ids = new Set(); const paths = new Set();
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
  validateJsonFile(evidenceIndexPath, ['schemaVersion', 'artifacts']);
  updateStage('discover', 'completed', { scope });
}
async function doAnalyze(scope = 'all current evidence', progressLabel = '') {
  if (!fs.existsSync(evidenceIndexPath)) fail('Run discover first.');
  updateStage('analyze', 'running', { scope });
  await runCommandCode('analyze', renderPrompt('analyze.md', { SCOPE: scope }), scope, progressLabel);
  validateJsonFile(systemPath, ['schemaVersion', 'components', 'relationships', 'workflows', 'unknowns']);
  updateStage('analyze', 'completed', { scope });
}
async function doPlan(progressLabel = '') {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  updateStage('plan', 'running');
  await runCommandCode('plan', renderPrompt('plan.md'), '', progressLabel);
  const manifest = validateJsonFile(manifestPath, ['schemaVersion', 'pages']);
  updateStage('plan', 'completed', { pageCount: manifest.pages.length });
}
async function doGenerate(id, progressLabel = '', allowEnrich = true) {
  const page = findPage(id);
  await runCommandCode('generate', renderPrompt('generate.md', { PAGE_JSON: JSON.stringify(page, null, 2) }), id, progressLabel);
  validatePageFile(page);
  if (allowEnrich && qualityConfig().autoEnrich !== false && isComprehensive()) await doEnrich(id, progressLabel);
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
async function doEnrich(id, progressLabel = '') {
  const page = findPage(id);
  if (!fs.existsSync(path.join(root, page.path))) fail(`Generate page first: ${page.path}`);
  await runCommandCode('enrich', renderPrompt('enrich.md', { PAGE_JSON: JSON.stringify(page, null, 2) }), id, progressLabel);
  validatePageFile(page);
  validatePageQuality(page, false);
}
async function doEnrichAll() {
  const manifest = loadManifest();
  for (let i = 0; i < manifest.pages.length; i++) {
    const page = manifest.pages[i]; printItemProgress('enrich', i + 1, manifest.pages.length, page.id);
    await doEnrich(page.id, `page ${i + 1}/${manifest.pages.length}`);
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

async function doGenerateAll() {
  const manifest = loadManifest();
  updateStage('generate', 'running', { pageCount: manifest.pages.length });
  for (let i = 0; i < manifest.pages.length; i++) { const page = manifest.pages[i]; printItemProgress('generate', i + 1, manifest.pages.length, page.id); await doGenerate(page.id, `page ${i + 1}/${manifest.pages.length}`); }
  updateStage('generate', 'completed', { pageCount: manifest.pages.length });
}
async function doAudit(id, progressLabel = '') {
  const page = findPage(id);
  if (!fs.existsSync(path.join(root, page.path))) fail(`Generate page first: ${page.path}`);
  await runCommandCode('audit', renderPrompt('audit.md', { PAGE_JSON: JSON.stringify(page, null, 2), PAGE_ID: page.id }), id, progressLabel);
  validateJsonFile(path.join(root, '.docgen', 'audit', 'pages', `${id}.json`), ['schemaVersion', 'pageId', 'pagePath', 'findings']);
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
  const manifest = loadManifest();
  updateStage('audit', 'running', { pageCount: manifest.pages.length });
  for (let i = 0; i < manifest.pages.length; i++) { const page = manifest.pages[i]; printItemProgress('audit', i + 1, manifest.pages.length, page.id); await doAudit(page.id, `page ${i + 1}/${manifest.pages.length}`); }
  const summary = rebuildAuditIndex();
  updateStage('audit', 'completed', { pageCount: manifest.pages.length, findings: summary });
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
  for (const stage of ['discover', 'analyze', 'plan', 'generate', 'audit']) console.log(`${stage.padEnd(10)} ${state.stages?.[stage]?.status ?? 'pending'}`);
  if (fs.existsSync(manifestPath)) {
    const m = readJson(manifestPath); const generated = (m.pages ?? []).filter((p) => fs.existsSync(path.join(root, p.path))).length;
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
    ['discover', 'analyze', 'plan', 'generate', 'enrich', 'audit', 'fix', 'update-impact'].map((stage) => [stage, commandCodeArgs(stage)])
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
  docgen validate
  docgen discover [scope]
  docgen analyze [scope]
  docgen plan
  docgen generate <id|--all>    generate pages; comprehensive profile auto-enriches
  docgen enrich <id|--all>      run explicit depth/completeness pass
  docgen audit <id|--all>
  docgen fix <id|--all>
  docgen quality                run local + audit quality gates
  docgen snapshot
  docgen changed
  docgen update [path ...]
  docgen all

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
switch (command) {
  case 'doctor': doctor(); break;
  case 'compat': doctor(); break;
  case 'status': status(); break;
  case 'validate': if (!validateStatic() || !validateGenerated()) process.exit(1); break;
  case 'discover': await doDiscover(args.join(' ') || '.'); break;
  case 'analyze': await doAnalyze(args.join(' ') || 'all current evidence'); break;
  case 'plan': await doPlan(); break;
  case 'generate': if (args[0] === '--all') await doGenerateAll(); else if (args[0]) await doGenerate(args[0]); else fail('generate requires <page-id|--all>'); break;
  case 'enrich': if (args[0] === '--all') await doEnrichAll(); else if (args[0]) await doEnrich(args[0]); else fail('enrich requires <page-id|--all>'); break;
  case 'audit': if (args[0] === '--all') await doAuditAll(); else if (args[0]) { await doAudit(args[0]); rebuildAuditIndex(); writeQualitySummary(); } else fail('audit requires <page-id|--all>'); break;
  case 'fix': if (args[0] === '--all') await doFixAll(); else if (args[0]) await doFix(args[0]); else fail('fix requires <page-id|--all>'); break;
  case 'quality': doQuality(); break;
  case 'snapshot': doSnapshot(); break;
  case 'changed': console.log(changedPaths().join('\n')); break;
  case 'update': await doUpdate(args); break;
  case 'all': {
    console.log(`DocGen full pipeline | quality profile: ${qualityProfile()}`);
    printItemProgress('phase', 1, 6, 'discovery'); await doDiscover('.', 'phase 1/6');
    printItemProgress('phase', 2, 6, 'architecture analysis'); await doAnalyze('all current evidence', 'phase 2/6');
    printItemProgress('phase', 3, 6, 'documentation planning'); await doPlan('phase 3/6');
    const manifest = loadManifest(); console.log(`Plan contains ${manifest.pages.length} pages.`);
    printItemProgress('phase', 4, 6, 'page generation + enrichment'); await doGenerateAll();
    printItemProgress('phase', 5, 6, 'independent audit'); await doAuditAll();
    if (isComprehensive() && qualityConfig().autoFix !== false) {
      console.log('Phase 5b/6 — automatic repair of audit findings');
      const fixed = await doFixAll();
      if (fixed.length && qualityConfig().reAuditAfterFix !== false) {
        console.log(`Re-auditing ${fixed.length} repaired page(s)...`);
        for (let i = 0; i < fixed.length; i++) { printItemProgress('re-audit', i + 1, fixed.length, fixed[i]); await doAudit(fixed[i], `re-audit ${i + 1}/${fixed.length}`); }
        rebuildAuditIndex();
      }
    }
    printItemProgress('phase', 6, 6, 'quality summary + source snapshot');
    writeQualitySummary(); doSnapshot(); doQuality();
    break;
  }
  default: usage(); process.exit(2);
}
