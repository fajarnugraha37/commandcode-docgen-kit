#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, '.commandcode', 'docgen', 'bin', 'docgen.mjs');
const result = spawnSync(process.execPath, [engine, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: 'inherit' });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
