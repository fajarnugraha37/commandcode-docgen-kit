#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const homeIndex = argv.indexOf('--commandcode-home');
const commandCodeHome = path.resolve(homeIndex >= 0 && argv[homeIndex + 1] ? argv[homeIndex + 1] : path.join(os.homedir(), '.commandcode'));
const dryRun = argv.includes('--dry-run');
const noUnlinkCli = argv.includes('--no-unlink-cli');
const installationPath = path.join(commandCodeHome, 'docgen', 'installation.json');

function remove(target) {
  if (!fs.existsSync(target)) return;
  console.log(`${dryRun ? '[dry-run] ' : ''}remove ${target}`);
  if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
}

let installation = null;
if (fs.existsSync(installationPath)) {
  try { installation = JSON.parse(fs.readFileSync(installationPath, 'utf8')); }
  catch (error) { console.warn(`WARNING: could not parse ${installationPath}: ${error.message}`); }
}

// Remove only files recorded as installed by this kit. Never delete arbitrary
// user skills merely because their names share a prefix.
for (const item of installation?.files ?? []) {
  const rel = String(item.path ?? '');
  if (!rel || rel === 'settings.json' || rel.startsWith('docgen/')) continue;
  const target = path.resolve(commandCodeHome, rel);
  const safeRel = path.relative(commandCodeHome, target);
  if (safeRel.startsWith('..') || path.isAbsolute(safeRel)) continue;
  remove(target);
}

// Remove only hook handlers whose command points at this DocGen engine.
const settingsPath = path.join(commandCodeHome, 'settings.json');
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const engineHookRoot = path.join(commandCodeHome, 'docgen', 'hooks');
  for (const event of Object.keys(settings.hooks ?? {})) {
    settings.hooks[event] = (settings.hooks[event] ?? [])
      .map((definition) => ({
        ...definition,
        hooks: (definition.hooks ?? []).filter((handler) => !String(handler.command ?? '').includes(engineHookRoot)),
      }))
      .filter((definition) => (definition.hooks ?? []).length > 0);
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}remove DocGen hook entries from ${settingsPath}`);
  if (!dryRun) fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

if (!noUnlinkCli && !dryRun) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['unlink', '-g', 'commandcode-docgen-kit'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) console.warn('WARNING: npm unlink did not complete successfully. The DocGen engine files will still be removed.');
}

remove(path.join(commandCodeHome, 'docgen'));
console.log('DocGen global installation removed. Repository-local .docgen/ workspaces and docs/ were not deleted.');
