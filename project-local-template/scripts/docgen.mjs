#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '..');
const kitVersion = '0.2.0';
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
  return args;
}
function renderPrompt(name, vars = {}) {
  const file = path.join(root, '.docgen', 'prompts', name);
  let text = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, String(v));
  return text;
}
function runCommandCode(stage, prompt, target = '') {
  const bin = commandCodeBin();
  if (!bin) fail('Command Code executable not found. Install it or set DOCGEN_COMMAND_CODE_BIN.');
  const args = commandCodeArgs(stage);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${stage}`;
  const meta = {
    schemaVersion: '1.0',
    runId, stage, target, startedAt: now(),
    commandCodeBin: bin, commandCodeArgs: args,
    status: 'running'
  };
  const metaPath = path.join(root, '.docgen', 'runs', `${runId}.json`);
  writeJson(metaPath, meta);
  const env = { ...process.env, DOCGEN_MODE: '1', DOCGEN_STAGE: stage, DOCGEN_TARGET: target };
  console.log(`\n==> ${stage}${target ? `: ${target}` : ''}`);
  console.log(`    ${bin} ${args.join(' ')}`);
  const result = spawnSync(bin, args, { cwd: root, env, input: prompt, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  meta.finishedAt = now(); meta.exitCode = result.status; meta.status = result.status === 0 ? 'completed' : 'failed';
  writeJson(metaPath, meta);
  if (result.error) fail(`${stage} failed to launch: ${result.error.message}`);
  if (result.status !== 0) {
    const hint = result.status === 3 ? ' Command Code is not authenticated; run `cmd login` (or `cmdc login` on native Windows).'
      : result.status === 8 ? ' The headless max-turn limit was reached; increase commandCode.maxTurns for this stage or DOCGEN_MAX_TURNS.'
      : '';
    fail(`${stage} failed with exit code ${result.status}.${hint}`, result.status || 1);
  }
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
  const skillRoot = path.join(root, '.commandcode', 'skills');
  if (!fs.existsSync(skillRoot)) { errors.push('Missing .commandcode/skills'); return; }
  for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) { errors.push(`Missing ${rel(file)}`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) { errors.push(`${rel(file)} missing YAML frontmatter`); continue; }
    const nameLine = m[1].split(/\r?\n/).find((x) => x.startsWith('name:'));
    const name = nameLine?.slice(5).trim().replace(/^['"]|['"]$/g, '');
    if (name !== entry.name) errors.push(`${rel(file)} name must equal directory: ${entry.name}`);
  }
}

function validateStatic() {
  const errors = [];
  for (const f of [configPath, statePath, path.join(root, '.commandcode', 'settings.json')]) {
    try { validateJsonFile(f); } catch (e) { errors.push(e.message); }
  }
  validateSkills(errors);
  const requiredAgents = ['doc-discoverer', 'doc-architect', 'doc-planner', 'doc-writer', 'doc-auditor'];
  for (const a of requiredAgents) if (!exists(`.commandcode/agents/${a}.md`)) errors.push(`Missing agent: ${a}`);
  const requiredCommands = ['docgen-discover', 'docgen-analyze', 'docgen-plan', 'docgen-generate', 'docgen-audit', 'docgen-fix', 'docgen-update', 'docgen-status'];
  for (const c of requiredCommands) if (!exists(`.commandcode/commands/${c}.md`)) errors.push(`Missing command: ${c}`);
  for (const prompt of ['discover.md', 'analyze.md', 'plan.md', 'generate.md', 'audit.md', 'fix.md', 'update-impact.md']) if (!exists(`.docgen/prompts/${prompt}`)) errors.push(`Missing prompt: ${prompt}`);
  for (const schema of ['evidence-artifact.schema.json', 'evidence-index.schema.json', 'component.schema.json', 'workflow.schema.json', 'system.schema.json', 'manifest.schema.json', 'audit-page.schema.json', 'audit-index.schema.json', 'update-plan.schema.json']) {
    try { validateJsonFile(path.join(root, '.docgen', 'schemas', schema)); } catch (e) { errors.push(e.message); }
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

function doDiscover(scope = '.') {
  updateStage('discover', 'running', { scope });
  runCommandCode('discover', renderPrompt('discover.md', { SCOPE: scope }), scope);
  validateJsonFile(evidenceIndexPath, ['schemaVersion', 'artifacts']);
  updateStage('discover', 'completed', { scope });
}
function doAnalyze(scope = 'all current evidence') {
  if (!fs.existsSync(evidenceIndexPath)) fail('Run discover first.');
  updateStage('analyze', 'running', { scope });
  runCommandCode('analyze', renderPrompt('analyze.md', { SCOPE: scope }), scope);
  validateJsonFile(systemPath, ['schemaVersion', 'components', 'relationships', 'workflows', 'unknowns']);
  updateStage('analyze', 'completed', { scope });
}
function doPlan() {
  if (!fs.existsSync(systemPath)) fail('Run analyze first.');
  updateStage('plan', 'running');
  runCommandCode('plan', renderPrompt('plan.md'));
  const manifest = validateJsonFile(manifestPath, ['schemaVersion', 'pages']);
  updateStage('plan', 'completed', { pageCount: manifest.pages.length });
}
function doGenerate(id) {
  const page = findPage(id);
  runCommandCode('generate', renderPrompt('generate.md', { PAGE_JSON: JSON.stringify(page, null, 2) }), id);
  validatePageFile(page);
}
function doGenerateAll() {
  const manifest = loadManifest();
  updateStage('generate', 'running', { pageCount: manifest.pages.length });
  for (const page of manifest.pages) doGenerate(page.id);
  updateStage('generate', 'completed', { pageCount: manifest.pages.length });
}
function doAudit(id) {
  const page = findPage(id);
  if (!fs.existsSync(path.join(root, page.path))) fail(`Generate page first: ${page.path}`);
  runCommandCode('audit', renderPrompt('audit.md', { PAGE_JSON: JSON.stringify(page, null, 2), PAGE_ID: page.id }), id);
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
function doAuditAll() {
  const manifest = loadManifest();
  updateStage('audit', 'running', { pageCount: manifest.pages.length });
  for (const page of manifest.pages) doAudit(page.id);
  const summary = rebuildAuditIndex();
  updateStage('audit', 'completed', { pageCount: manifest.pages.length, findings: summary });
}
function doFix(id) {
  const page = findPage(id);
  const audit = path.join(root, '.docgen', 'audit', 'pages', `${id}.json`);
  if (!fs.existsSync(audit)) fail(`Missing audit for ${id}. Run audit first.`);
  runCommandCode('fix', renderPrompt('fix.md', { PAGE_JSON: JSON.stringify(page, null, 2), PAGE_ID: id }), id);
  validatePageFile(page);
}
function doFixAll() {
  const manifest = loadManifest();
  for (const page of manifest.pages) {
    const audit = path.join(root, '.docgen', 'audit', 'pages', `${page.id}.json`);
    if (!fs.existsSync(audit)) continue;
    const report = readJson(audit);
    if ((report.findings ?? []).length) doFix(page.id);
  }
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
function doUpdate(explicitPaths) {
  const changed = explicitPaths.length ? explicitPaths : changedPaths();
  if (!changed.length) { console.log('No source changes detected since the last snapshot.'); return; }
  runCommandCode('update-impact', renderPrompt('update-impact.md', { CHANGED_PATHS_JSON: JSON.stringify(changed, null, 2) }), changed.join(', '));
  const plan = validateJsonFile(path.join(root, '.docgen', 'plan', 'update-plan.json'), ['changedPaths', 'affectedEvidenceScopes', 'affectedModels', 'affectedPageIds']);
  const scopes = plan.affectedEvidenceScopes?.length ? plan.affectedEvidenceScopes : changed;
  for (const scope of scopes) doDiscover(scope);
  doAnalyze(`incremental changes: ${changed.join(', ')}`);
  doPlan();
  for (const id of plan.affectedPageIds ?? []) {
    const currentManifest = loadManifest();
    if (currentManifest.pages.some((p) => p.id === id)) { doGenerate(id); doAudit(id); }
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
  const requiredFlags = ['--trust', '--print', '--max-turns', '--yolo', '--skip-onboarding'];
  const missingFlags = requiredFlags.filter((flag) => !helpText.includes(flag));
  report.checks.requiredFlags = { ok: help.status === 0 && missingFlags.length === 0, requiredFlags, missingFlags };
  if (!report.checks.requiredFlags.ok) report.compatible = false;

  const skills = runCaptured(bin, ['skills', 'list', '--debug']);
  const skillOutput = `${skills.stdout ?? ''}${skills.stderr ?? ''}`.trim();
  const expectedSkills = fs.readdirSync(path.join(root, '.commandcode', 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
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
    ['discover', 'analyze', 'plan', 'generate', 'audit', 'fix', 'update-impact'].map((stage) => [stage, commandCodeArgs(stage)])
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
  console.log(`Project skills load: ${report.checks.skills?.ok ? 'PASS' : 'FAIL'}`);
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
function usage() {
  console.log(`Usage: node ${rel(self)} <command> [args]\n\nCommands:\n  doctor              run compatibility + installation diagnostics\n  compat              alias of doctor\n  status              show DocGen pipeline state\n  validate            validate static and generated artifacts\n  discover [scope]    extract source-grounded evidence\n  analyze [scope]     build normalized system model\n  plan                build documentation manifest\n  generate <id|--all> generate one or all planned pages\n  audit <id|--all>    independently verify generated pages\n  fix <id|--all>      apply audit-backed documentation corrections\n  snapshot            fingerprint current source state\n  changed             list source paths changed since snapshot\n  update [path ...]   impact-analyze and regenerate affected docs\n  all                 run discover -> analyze -> plan -> generate -> audit -> snapshot`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'doctor': doctor(); break;
  case 'compat': doctor(); break;
  case 'status': status(); break;
  case 'validate': if (!validateStatic() || !validateGenerated()) process.exit(1); break;
  case 'discover': doDiscover(args.join(' ') || '.'); break;
  case 'analyze': doAnalyze(args.join(' ') || 'all current evidence'); break;
  case 'plan': doPlan(); break;
  case 'generate': if (args[0] === '--all') doGenerateAll(); else if (args[0]) doGenerate(args[0]); else fail('generate requires <page-id|--all>'); break;
  case 'audit': if (args[0] === '--all') doAuditAll(); else if (args[0]) { doAudit(args[0]); rebuildAuditIndex(); } else fail('audit requires <page-id|--all>'); break;
  case 'fix': if (args[0] === '--all') doFixAll(); else if (args[0]) doFix(args[0]); else fail('fix requires <page-id|--all>'); break;
  case 'snapshot': doSnapshot(); break;
  case 'changed': console.log(changedPaths().join('\n')); break;
  case 'update': doUpdate(args); break;
  case 'all': doDiscover('.'); doAnalyze('all current evidence'); doPlan(); doGenerateAll(); doAuditAll(); doSnapshot(); break;
  default: usage(); if (command) process.exit(2);
}
