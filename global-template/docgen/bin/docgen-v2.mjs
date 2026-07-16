#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildInventory } from '../lib/inventory.mjs';
import { compileContext } from '../lib/context.mjs';
import { databaseStats } from '../lib/indexer.mjs';
import { all, audit, generate, index, model, plan, publish, status } from '../lib/pipeline.mjs';
import { budgetReport, resetTelemetry } from '../lib/provider.mjs';
import { commandExists, engineHome, ensureDir, kitVersion, loadConfig, parseArgs, projectPaths, readJson, requireProjectRoot, writeJson } from '../lib/core.mjs';
import { runWorkspace } from './workspace.mjs';

function usage() {
  console.log(`Command Code DocGen ${kitVersion} — token-efficient semantic-index pipeline

Repository commands:
  docgen init [directory]
  docgen migrate
  docgen doctor
  docgen index [--force]
  docgen model
  docgen plan
  docgen generate
  docgen audit
  docgen publish
  docgen all | resume
  docgen status

Budget and context:
  docgen budget [report|reset]
  docgen context <stage> [query] [--target ID] [--max-tokens N]
  docgen ignore [path]
  docgen source-list [substring]
  docgen source-grep <text>

System workspace:
  docgen workspace <command>
`);
}

function copyTree(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(target, entry.name);
    if (entry.isDirectory()) { ensureDir(to); copyTree(from, to); }
    else if (!fs.existsSync(to)) { ensureDir(path.dirname(to)); fs.copyFileSync(from, to); }
  }
}

function defaultConfig() { return readJson(path.join(engineHome, 'project-template', 'config', 'documentation.json')); }
function defaultState() { return readJson(path.join(engineHome, 'project-template', 'state', 'state.json')); }
function init(target = '.') {
  const root = path.resolve(target); ensureDir(root); const paths = projectPaths(root); const template = path.join(engineHome, 'project-template');
  if (fs.existsSync(template)) copyTree(template, paths.base);
  for (const dir of [paths.context, paths.telemetry, path.dirname(paths.budget), paths.model, path.dirname(paths.plan), paths.audit, paths.publish, paths.traceability, paths.runs, path.dirname(paths.inventory)]) ensureDir(dir);
  const marker = readJson(paths.project, {}); writeJson(paths.project, { ...marker, schemaVersion: '2.0', kitVersion, initializedAt: marker.initializedAt ?? new Date().toISOString(), engineScope: marker.engineScope ?? 'global', projectRoot: root.replaceAll('\\', '/') });
  if (!fs.existsSync(paths.config)) writeJson(paths.config, defaultConfig());
  if (!fs.existsSync(paths.state)) writeJson(paths.state, defaultState());
  console.log(`Initialized DocGen ${kitVersion} at ${root}`);
}

function migrate(root) {
  const paths = projectPaths(root); const current = readJson(paths.config, {}); const marker = readJson(paths.project, {});
  if (current.schemaVersion === '2.0' && marker.kitVersion === kitVersion) { console.log(`DocGen project is already on ${kitVersion}.`); return; }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); const backup = path.join(paths.base, 'migration-backup', timestamp); ensureDir(backup);
  const moveNames = ['evidence','model','plan','audit','traceability','state','publish','index','context','telemetry','budget','runs','prompts'];
  for (const name of moveNames) {
    const source = path.join(paths.base, name); if (!fs.existsSync(source)) continue;
    const target = path.join(backup, name); ensureDir(path.dirname(target)); fs.renameSync(source, target);
  }
  const configDir = path.join(paths.base, 'config');
  if (fs.existsSync(configDir)) { const target = path.join(backup, 'config'); ensureDir(path.dirname(target)); fs.renameSync(configDir, target); }
  const next = defaultConfig();
  next.projectName = current.projectName ?? next.projectName;
  next.outputRoot = current.outputRoot ?? next.outputRoot;
  next.commandCode = { ...next.commandCode, executable: current.commandCode?.executable ?? '', trust: current.commandCode?.trust ?? next.commandCode.trust, skipOnboarding: current.commandCode?.skipOnboarding ?? next.commandCode.skipOnboarding, yolo: current.commandCode?.yolo ?? next.commandCode.yolo, model: current.commandCode?.model ?? '', stageModels: { ...next.commandCode.stageModels, ...(current.commandCode?.stageModels ?? {}) } };
  next.ignore = { ...next.ignore, ...(current.ignore ?? {}), binary: { ...next.ignore.binary, ...(current.ignore?.binary ?? {}) } };
  writeJson(paths.config, next); writeJson(paths.state, defaultState());
  for (const dir of [paths.context, paths.telemetry, path.dirname(paths.budget), paths.model, path.dirname(paths.plan), paths.audit, paths.publish, paths.traceability, paths.runs, path.dirname(paths.inventory)]) ensureDir(dir);
  writeJson(paths.project, { ...marker, schemaVersion: '2.0', kitVersion, migratedAt: new Date().toISOString(), migrationBackup: path.relative(root, backup).replaceAll('\\', '/') });
  console.log(`Migrated project to DocGen ${kitVersion}.`);
  console.log(`Legacy .docgen artifacts were archived at ${path.relative(root, backup).replaceAll('\\', '/')}.`);
  console.log('Generated docs and .docgenignore were preserved. Run `docgen index`, then `docgen all`.');
}

function doctor(root) {
  const errors = []; const warnings = [];
  if (!commandExists('git')) errors.push('git executable not found');
  try { const config = loadConfig(root); if (!config || typeof config !== 'object') errors.push('invalid documentation config'); if (config.schemaVersion !== '2.0') errors.push('legacy configuration detected; run `docgen migrate`'); } catch (error) { errors.push(error.message); }
  if (!process.versions.node || Number(process.versions.node.split('.')[0]) < 22) errors.push('Node.js 22+ is required for node:sqlite');
  if (!commandExists(process.platform === 'win32' ? 'cmdc' : 'cmd') && !loadConfig(root).commandCode?.executable) warnings.push('Command Code executable was not found using default names; configure commandCode.executable if needed.');
  try { const inventory = buildInventory(root); if (!inventory.files.length) warnings.push('source inventory is empty'); } catch (error) { errors.push(error.message); }
  for (const warning of warnings) console.warn(`WARNING: ${warning}`); for (const error of errors) console.error(`ERROR: ${error}`);
  if (errors.length) process.exitCode = 1; else console.log('Doctor checks passed.');
}

function printStatus(root) { console.log(JSON.stringify(status(root), null, 2)); }
function printBudget(root) { console.log(JSON.stringify(budgetReport(root), null, 2)); }
function sourceList(root, filter = '') { const inv = buildInventory(root); for (const file of inv.files) if (!filter || file.path.toLowerCase().includes(filter.toLowerCase())) console.log(file.path); }
function sourceGrep(root, query) { if (!query) throw new Error('Usage: docgen source-grep <text>'); const inv = buildInventory(root); const needle = query.toLowerCase(); for (const item of inv.files) { const text = fs.readFileSync(path.join(root, item.path), 'utf8'); for (const [lineIndex, line] of text.split(/\r?\n/).entries()) if (line.toLowerCase().includes(needle)) console.log(`${item.path}:${lineIndex + 1}:${line.trim()}`); } }
function ignore(root, target) { const inv = buildInventory(root); if (target) { const found = inv.files.find((item) => item.path === target); const excluded = inv.excluded.find((item) => item.path === target); console.log(JSON.stringify(found ? { included: true, ...found } : { included: false, ...(excluded ?? { path: target, reason: 'not-found' }) }, null, 2)); } else console.log(JSON.stringify(inv.metrics, null, 2)); }

async function main() {
  const [command, ...rest] = process.argv.slice(2); const { positional, options } = parseArgs(rest);
  if (!command || ['help','--help','-h'].includes(command)) { usage(); return; }
  if (command === 'init') { init(positional[0] ?? '.'); return; }
  if (command === 'workspace') { await runWorkspace(rest, { kitVersion }); return; }
  const root = requireProjectRoot();
  switch (command) {
    case 'migrate': migrate(root); break;
    case 'doctor': doctor(root); break;
    case 'index': console.log(JSON.stringify(index(root, { force: Boolean(options.force) }), null, 2)); break;
    case 'model': console.log(JSON.stringify(await model(root), null, 2)); break;
    case 'plan': console.log(JSON.stringify(await plan(root), null, 2)); break;
    case 'generate': console.log(JSON.stringify(await generate(root), null, 2)); break;
    case 'audit': console.log(JSON.stringify(await audit(root), null, 2)); break;
    case 'publish': console.log(JSON.stringify(publish(root), null, 2)); break;
    case 'all':
    case 'resume': console.log(JSON.stringify(await all(root), null, 2)); break;
    case 'status': printStatus(root); break;
    case 'budget': if (positional[0] === 'reset') { resetTelemetry(root); console.log('Budget telemetry reset.'); } else printBudget(root); break;
    case 'context': { const stage = positional[0]; if (!stage) throw new Error('Usage: docgen context <stage> [query]'); const result = compileContext(root, { stage, query: positional.slice(1).join(' '), target: options.target ?? '', maxTokens: options.maxTokens ? Number(options.maxTokens) : undefined }); console.log(JSON.stringify({ file: path.relative(root, result.file).replaceAll('\\', '/'), estimatedTokens: result.payload.estimatedTokens, omissions: result.payload.omissions }, null, 2)); break; }
    case 'ignore': ignore(root, positional[0]); break;
    case 'source-list': sourceList(root, positional.join(' ')); break;
    case 'source-grep': sourceGrep(root, positional.join(' ')); break;
    case 'stats': console.log(JSON.stringify(databaseStats(root), null, 2)); break;
    default: usage(); throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = error.exitCode ?? 1; });
