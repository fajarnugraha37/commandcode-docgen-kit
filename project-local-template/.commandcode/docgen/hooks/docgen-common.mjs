import fs from 'node:fs';
import path from 'node:path';

export function active() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.DOCGEN_MODE ?? '').toLowerCase());
}

export async function readStdinJson() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  if (!data.trim()) return {};
  return JSON.parse(data);
}

export function resolveWorkspacePath(inputPath, cwd) {
  if (!inputPath) return null;
  return path.resolve(cwd, inputPath);
}

export function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

export function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj));
}

export function deny(reason, systemMessage = 'DocGen policy blocked a tool call') {
  jsonOut({
    continue: true,
    systemMessage,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

export function advisory(reason) {
  jsonOut({
    continue: true,
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: reason,
    },
  });
}

export function readTextIfExists(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
