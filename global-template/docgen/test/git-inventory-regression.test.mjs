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

test('git-aware inventory executes native git path enumeration', () => {
  const root = fixture();
  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  fs.writeFileSync(path.join(root, 'src', 'Tracked.java'), 'class Tracked {}\n');
  fs.writeFileSync(path.join(root, 'ignored.log'), 'ignore me\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '*.log\n');

  const inventory = buildInventory(root);
  assert(inventory.files.some((item) => item.path === 'src/Tracked.java'));
  assert(!inventory.files.some((item) => item.path === 'ignored.log'));
});

test('shipped JavaScript contains no misspelled Boolean global', () => {
  const stack = [engineRoot];
  const offenders = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (/\.(?:mjs|js|cjs)$/.test(entry.name) && /\bBolean\b/.test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(engineRoot, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});
