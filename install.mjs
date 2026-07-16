#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const version = fs.readFileSync(path.join(here, 'VERSION'), 'utf8').trim();
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const dryRun = argv.includes('--dry-run');
const noHooks = argv.includes('--no-hooks');
const noLinkCli = argv.includes('--no-link-cli');
const localIndex = argv.indexOf('--project-local');
const homeIndex = argv.indexOf('--commandcode-home');
const commandCodeHome = path.resolve(homeIndex >= 0 && argv[homeIndex + 1] ? argv[homeIndex + 1] : path.join(os.homedir(), '.commandcode'));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const LEGACY_ENGINE = [
  'docgen/bin/docgen.mjs',
  ...['discover','analyze','semantics','enterprise','plan','generate','generate-batch','enrich','enrich-batch','audit','audit-batch','fix','update-impact','workspace-synthesis'].map((name) => `docgen/prompts/${name}.md`)
];
const LEGACY_AGENTS = ['doc-discoverer','doc-architect','doc-domain-analyst','doc-enterprise-analyst','doc-planner','doc-writer','doc-auditor','doc-system-analyst'].map((name) => `agents/${name}.md`);
const LEGACY_COMMANDS = ['docgen-discover','docgen-analyze','docgen-fix','docgen-update','docgen-enrich','docgen-quality','docgen-semantics','docgen-preflight','docgen-contract-test','docgen-traceability','docgen-enterprise'].map((name) => `commands/${name}.md`);
const LEGACY_MANAGED = [...LEGACY_ENGINE, ...LEGACY_AGENTS, ...LEGACY_COMMANDS];

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function walk(dir) { if (!fs.existsSync(dir)) return []; const out = []; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); entry.isDirectory() ? out.push(...walk(file)) : out.push(file); } return out; }
function ensureDir(dir) { if (!dryRun) fs.mkdirSync(dir, { recursive: true }); }
function copyWithPolicy(src, dest, backupRoot, installed, skipped) {
  const data = fs.readFileSync(src); const rel = path.relative(commandCodeHome, dest).replaceAll('\\', '/');
  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest); if (sha256(existing) === sha256(data)) { installed.push({ path: rel, action: 'unchanged' }); return; }
    if (!force) { skipped.push({ path: rel, reason: 'conflict; use --force to overwrite' }); return; }
    if (!dryRun) { const backup = path.join(backupRoot, rel); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(dest, backup); }
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}copy ${dest}`);
  if (!dryRun) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); try { fs.chmodSync(dest, fs.statSync(src).mode); } catch {} }
  installed.push({ path: rel, action: fs.existsSync(dest) ? 'updated' : 'created' });
}
function removeLegacy(root, relPaths, backupRoot, installed) {
  for (const rel of relPaths) {
    const file = path.join(root, rel); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    console.log(`${dryRun ? '[dry-run] ' : ''}remove legacy ${file}`);
    if (!dryRun) { const backup = path.join(backupRoot, 'removed-legacy', rel); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(file, backup); fs.rmSync(file, { force: true }); }
    installed.push({ path: rel.replaceAll('\\', '/'), action: 'removed-legacy' });
  }
}
function hookCommand(file) { return `node ${JSON.stringify(path.join(commandCodeHome, 'docgen', 'hooks', file))}`; }
function mergeGlobalSettings(backupRoot, installed) {
  if (noHooks) return;
  const dest = path.join(commandCodeHome, 'settings.json'); let current = {};
  if (fs.existsSync(dest)) { try { current = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch (error) { console.error(`Invalid JSON: ${dest}: ${error.message}`); process.exit(2); } if (!dryRun) { const backup = path.join(backupRoot, 'settings.json'); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(dest, backup); } }
  current.hooks ??= {};
  const defs = {
    SessionStart: [{ hooks: [{ type: 'command', command: hookCommand('docgen-session-context.mjs'), timeout: 5 }] }],
    PreToolUse: [
      { matcher: 'write|edit', hooks: [{ type: 'command', command: hookCommand('docgen-guard-write-paths.mjs'), timeout: 5 }] },
      { matcher: 'read', hooks: [{ type: 'command', command: hookCommand('docgen-guard-read-paths.mjs'), timeout: 5 }] },
      { matcher: 'shell', hooks: [{ type: 'command', command: hookCommand('docgen-guard-shell.mjs'), timeout: 5 }] }
    ],
    PostToolUse: [{ matcher: 'write|edit', hooks: [{ type: 'command', command: hookCommand('docgen-validate-written-artifact.mjs'), timeout: 10 }] }]
  };
  for (const [event, definitions] of Object.entries(defs)) {
    current.hooks[event] ??= []; const signatures = new Set(current.hooks[event].flatMap((definition) => (definition.hooks ?? []).map((hook) => `${definition.matcher ?? ''}|${hook.command ?? ''}`)));
    for (const definition of definitions) { const fresh = (definition.hooks ?? []).filter((hook) => !signatures.has(`${definition.matcher ?? ''}|${hook.command ?? ''}`)); if (fresh.length) current.hooks[event].push({ ...definition, hooks: fresh }); }
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}merge ${dest}`);
  if (!dryRun) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(current, null, 2) + '\n'); }
  installed.push({ path: 'settings.json', action: 'merged-docgen-hooks' });
}
function installGlobal() {
  const template = path.join(here, 'global-template'); const backupRoot = path.join(commandCodeHome, 'docgen-backup', timestamp); const installed = []; const skipped = [];
  ensureDir(commandCodeHome);
  for (const area of ['agents', 'skills', 'commands']) { const areaRoot = path.join(template, area); for (const src of walk(areaRoot)) copyWithPolicy(src, path.join(commandCodeHome, area, path.relative(areaRoot, src)), backupRoot, installed, skipped); }
  const engineRoot = path.join(template, 'docgen'); for (const src of walk(engineRoot)) copyWithPolicy(src, path.join(commandCodeHome, 'docgen', path.relative(engineRoot, src)), backupRoot, installed, skipped);
  removeLegacy(commandCodeHome, LEGACY_MANAGED, backupRoot, installed);
  mergeGlobalSettings(backupRoot, installed);
  if (!dryRun) {
    fs.writeFileSync(path.join(commandCodeHome, 'docgen', 'installation.json'), JSON.stringify({ schemaVersion: '2.0', kitVersion: version, scope: 'global', installedAt: new Date().toISOString(), commandCodeHome, files: installed, skipped }, null, 2) + '\n');
    if (!noLinkCli) { const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'; const link = spawnSync(npm, ['link'], { cwd: path.join(commandCodeHome, 'docgen'), stdio: 'inherit', shell: process.platform === 'win32' }); if (link.status !== 0) console.warn('WARNING: npm link failed. Use `node ~/.commandcode/docgen/bin/docgen-v2.mjs` or rerun after fixing npm.'); }
  }
  console.log(`\nInstalled Command Code DocGen Kit ${version} globally into ${commandCodeHome}`);
  if (skipped.length) { console.log('\nSkipped conflicts:'); for (const item of skipped) console.log(`- ${item.path}: ${item.reason}`); }
  console.log('\nNext:'); console.log('  cd <repository>'); console.log('  docgen init   # new repository'); console.log('  docgen migrate # existing v1 repository'); console.log('  docgen doctor'); console.log('  docgen all');
}
function installProjectLocal(target) {
  const template = path.join(here, 'project-local-template'); const abs = path.resolve(target); if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) { console.error(`Target is not a directory: ${abs}`); process.exit(2); }
  const backupRoot = path.join(abs, '.docgen', 'install-backup', timestamp); const installed = []; const skipped = [];
  function localCopy(src, dest) { const data = fs.readFileSync(src); const rel = path.relative(abs, dest).replaceAll('\\', '/'); if (fs.existsSync(dest)) { if (sha256(fs.readFileSync(dest)) === sha256(data)) { installed.push({ path: rel, action: 'unchanged' }); return; } if (rel === '.docgenignore') { skipped.push({ path: rel, reason: 'preserved user-owned ignore policy' }); return; } if (!force) { skipped.push({ path: rel, reason: 'conflict; use --force' }); return; } if (!dryRun) { const backup = path.join(backupRoot, rel); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(dest, backup); } } console.log(`${dryRun ? '[dry-run] ' : ''}copy ${rel}`); if (!dryRun) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); } installed.push({ path: rel, action: 'copied' }); }
  for (const src of walk(template)) { const rel = path.relative(template, src); if (rel === 'AGENTS.md' || rel === '.commandcode/settings.json') continue; localCopy(src, path.join(abs, rel)); }
  const localEngineTemplate = path.join(here, 'global-template', 'docgen');
  for (const src of walk(localEngineTemplate)) { const rel = path.relative(localEngineTemplate, src); localCopy(src, path.join(abs, '.commandcode', 'docgen', rel)); }
  removeLegacy(path.join(abs, '.commandcode'), LEGACY_MANAGED, backupRoot, installed);
  if (!dryRun) { const marker = { schemaVersion: '2.0', kitVersion: version, initializedAt: new Date().toISOString(), engineScope: 'project-local', engineHome: path.join(abs, '.commandcode', 'docgen').replaceAll('\\', '/'), projectRoot: abs.replaceAll('\\', '/') }; fs.mkdirSync(path.join(abs, '.docgen'), { recursive: true }); fs.writeFileSync(path.join(abs, '.docgen', 'project.json'), JSON.stringify(marker, null, 2) + '\n'); }
  const markerStart = '<!-- COMMANDCODE-DOCGEN:START -->', markerEnd = '<!-- COMMANDCODE-DOCGEN:END -->';
  const memorySrc = fs.readFileSync(path.join(template, 'AGENTS.md'), 'utf8'); const memoryDest = path.join(abs, 'AGENTS.md'); const existingMemory = fs.existsSync(memoryDest) ? fs.readFileSync(memoryDest, 'utf8') : '';
  if (!existingMemory.includes(markerStart) || !existingMemory.includes(markerEnd)) { console.log(`${dryRun ? '[dry-run] ' : ''}${existingMemory ? 'append' : 'create'} ${memoryDest}`); if (!dryRun) fs.writeFileSync(memoryDest, existingMemory.trimEnd() + (existingMemory ? '\n\n' : '') + memorySrc.trim() + '\n'); }
  if (!noHooks) {
    const settingsDest = path.join(abs, '.commandcode', 'settings.json'); let current = {}; const source = JSON.parse(fs.readFileSync(path.join(template, '.commandcode', 'settings.json'), 'utf8'));
    if (fs.existsSync(settingsDest)) { try { current = JSON.parse(fs.readFileSync(settingsDest, 'utf8')); } catch (error) { console.error(`Invalid JSON: ${settingsDest}: ${error.message}`); process.exit(2); } }
    current.hooks ??= {}; for (const [event, definitions] of Object.entries(source.hooks ?? {})) { current.hooks[event] ??= []; const signatures = new Set(current.hooks[event].flatMap((definition) => (definition.hooks ?? []).map((hook) => `${definition.matcher ?? ''}|${hook.command ?? ''}`))); for (const definition of definitions) { const fresh = (definition.hooks ?? []).filter((hook) => !signatures.has(`${definition.matcher ?? ''}|${hook.command ?? ''}`)); if (fresh.length) current.hooks[event].push({ ...definition, hooks: fresh }); } }
    console.log(`${dryRun ? '[dry-run] ' : ''}merge ${settingsDest}`); if (!dryRun) { fs.mkdirSync(path.dirname(settingsDest), { recursive: true }); fs.writeFileSync(settingsDest, JSON.stringify(current, null, 2) + '\n'); }
  }
  console.log(`\nInstalled self-contained project-local DocGen ${version} into ${abs}`); if (skipped.length) { console.log('\nSkipped or preserved files:'); for (const item of skipped) console.log(`- ${item.path}: ${item.reason}`); }
}

if (localIndex >= 0) { const target = argv[localIndex + 1]; if (!target) { console.error('Usage: node install.mjs --project-local <repository> [--force]'); process.exit(2); } installProjectLocal(target); } else installGlobal();
