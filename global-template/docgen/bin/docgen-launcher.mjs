#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(here, 'docgen-v2.mjs');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
  env: process.env
});

child.on('error', (error) => {
  console.error(`ERROR: failed to start DocGen: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
