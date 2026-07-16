import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../lib/inventory.mjs';
import { projectPaths, writeJson } from '../lib/core.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(testDir, '..');
const repositoryRoot = path.resolve(engineRoot, '..', '..');
const misspelledBoolean = ['Bole', 'an'].join('');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-git-inventory-'));
  const paths = projectPaths(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.dirname(paths.config), { recursive: true });
  writeJson(paths.project, { schemaVersion: '2.0', kitVersion: '2.0.0' });
  writeJson(paths.config, {
    schemaVersion: '2.0',
    ignore: {
      useGitignore: true,
      useDocgenignore: true,
      binary: { enabled: true, maxTextFileBytes: 1024 * 1024 }
    },
    execution: { progress: false }
  });
  return root;
}

function initializeGitFixture() {
  const root = fixture();
  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  fs.writeFileSync(path.join(root, 'src', 'Tracked.java'), 'class Tracked {}\n');
  fs.writeFileSync(path.join(root, 'ignored.log'), 'ignore me\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '*.log\n');
  return root;
}

test('git-aware inventory executes native git path enumeration', () => {
  const root = initializeGitFixture();
  const inventory = buildInventory(root);
  assert(inventory.files.some((item) => item.path === 'src/Tracked.java'));
  assert(!inventory.files.some((item) => item.path === 'ignored.log'));
});

test('installed launcher indexes a real Git repository', () => {
  const commandCodeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-installed-home-'));
  const install = spawnSync(process.execPath, [
    path.join(repositoryRoot, 'install.mjs'),
    '--force',
    '--no-link-cli',
    '--no-hooks',
    '--commandcode-home',
    commandCodeHome
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(install.status, 0, `INSTALL STDERR:\n${install.stderr}\nINSTALL STDOUT:\n${install.stdout}`);

  const root = initializeGitFixture();
  const launcher = path.join(commandCodeHome, 'docgen', 'bin', 'docgen-launcher.mjs');
  const run = spawnSync(process.execPath, [launcher, 'index'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DOCGEN_PROGRESS: '0' }
  });
  const combinedOutput = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.status, 0, `INDEX STDERR:\n${run.stderr}\nINDEX STDOUT:\n${run.stdout}`);
  assert(!combinedOutput.includes(`${misspelledBoolean} is not defined`));
  assert(fs.existsSync(path.join(root, '.docgen', 'index', 'semantic.db')));
});

test('shipped JavaScript contains no misspelled Boolean global', () => {
  const pattern = new RegExp(`\\b${misspelledBoolean}\\b`);
  const stack = [engineRoot];
  const offenders = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (/\.(?:mjs|js|cjs)$/.test(entry.name) && pattern.test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(engineRoot, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});
