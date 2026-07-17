import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, fileSha256, now, projectPaths, readJson, writeJson } from './core.mjs';
import { normalizeSemanticDocument } from './semantic.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const modelPath = (root, name) => path.join(projectPaths(root).model, `${name}.json`);
export const stamp = (file) => fs.existsSync(file) ? { hash: fileSha256(file), mtimeMs: fs.statSync(file).mtimeMs } : null;
export const changed = (file, before) => { const after = stamp(file); return Boolean(after && (!before || after.hash !== before.hash || after.mtimeMs !== before.mtimeMs)); };

export function renderModelPrompt(root, name, vars, repair = false) {
  const override = path.join(root, '.docgen', 'prompts', name);
  let text = fs.readFileSync(fs.existsSync(override) ? override : path.resolve(moduleDir, '..', 'prompts', name), 'utf8');
  for (const [key, value] of Object.entries(vars)) text = text.replaceAll(`{{${key}}}`, String(value));
  return repair ? `${text}\n\nRecovery request: write only the requested model object(s). A direct object is accepted for a single requested name.` : text;
}
export function stageCurrent(root, stage, inputHash, outputs) {
  const current = readJson(projectPaths(root).state, {}).stages?.[stage];
  return current?.status === 'completed' && current.inputHash === inputHash && outputs.every(fs.existsSync);
}
export function readBundle(file) {
  const value = readJson(file);
  if (!value || typeof value !== 'object') throw new Error(`Invalid model bundle JSON: ${file}`);
  return value;
}
export function commitModels(root, stage, names, objects) {
  const dir = projectPaths(root).model;
  const token = `${stage}-${process.pid}-${Date.now()}`;
  const staging = path.join(dir, `.staging-${token}`);
  const backup = path.join(dir, `.backup-${token}`);
  ensureDir(staging); ensureDir(backup);
  const existed = new Set();
  try {
    for (const name of names) {
      const value = structuredClone(objects[name]);
      normalizeSemanticDocument(value);
      writeJson(path.join(staging, `${name}.json`), { schemaVersion: '2.0', generatedAt: now(), ...value });
    }
    for (const name of names) {
      const final = modelPath(root, name);
      if (fs.existsSync(final)) { fs.copyFileSync(final, path.join(backup, `${name}.json`)); existed.add(name); }
    }
    for (const name of names) fs.copyFileSync(path.join(staging, `${name}.json`), modelPath(root, name));
  } catch (error) {
    for (const name of names) {
      const final = modelPath(root, name); const saved = path.join(backup, `${name}.json`);
      if (existed.has(name) && fs.existsSync(saved)) fs.copyFileSync(saved, final); else fs.rmSync(final, { force: true });
    }
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
}
