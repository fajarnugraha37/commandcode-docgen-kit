import fs from 'node:fs';
import path from 'node:path';
import { compileContext } from './context.mjs';
import { runProvider } from './provider.mjs';
import { ensureDir, loadConfig, now, projectPaths, rel, sha256, updateStage } from './core.mjs';
import { extractModelObjects, mergeModelObjects, safeModelPlaceholder } from './model-bundle.mjs';
import { changed, commitModels, modelPath, readBundle, renderModelPrompt, stageCurrent, stamp } from './model-io.mjs';

export async function synthesizeModels(root, stage, names, query) {
  const paths = projectPaths(root); const config = loadConfig(root);
  const context = compileContext(root, { stage, query, target: stage, metadata: { expectedModels: names } });
  const inputHash = context.payload.inputHash; const outputs = names.map((name) => modelPath(root, name));
  if (stageCurrent(root, stage, inputHash, outputs)) return { skipped: true, inputHash };
  ensureDir(paths.model); updateStage(root, stage, 'running', { inputHash, contextId: context.payload.id });
  const temporary = new Set(); const resolved = {}; const recoveryErrors = [];
  let providerCalls = 0; let recovered = false;
  async function request(expected, target, repair = false) {
    temporary.add(target); const before = stamp(target); let extraction = null;
    const inspect = () => {
      if (!changed(target, before)) return null;
      extraction = extractModelObjects(readBundle(target), expected);
      return extraction;
    };
    providerCalls++;
    const provider = await runProvider(root, {
      stage,
      target: repair ? `${stage}:repair:${expected.join(',')}` : stage,
      prompt: renderModelPrompt(root, stage === 'modelCore' ? 'model-core.md' : 'model-enterprise.md', {
        CONTEXT_PATH: rel(root, context.file), OUTPUT_PATH: rel(root, target), MODEL_NAMES: JSON.stringify(expected)
      }, repair),
      acceptArtifacts: () => Boolean(Object.keys(inspect()?.objects ?? {}).length)
    });
    recovered ||= provider.recovered === true;
    extraction ??= inspect();
    if (!extraction || !Object.keys(extraction.objects ?? {}).length) throw new Error(`${stage}: provider completed without a fresh recognizable model artifact`);
    return extraction;
  }
  const merge = (result) => mergeModelObjects(resolved, result);
  try {
    try { merge(await request(names, path.join(paths.model, `${stage}-bundle.json`))); }
    catch (error) { recoveryErrors.push(`initial: ${error.message}`); }
    let missing = names.filter((name) => !Object.hasOwn(resolved, name));
    if (missing.length) {
      console.warn(`[docgen] ${stage} REPAIR | unresolved: ${missing.join(', ')}`);
      try { merge(await request(missing, path.join(paths.model, `${stage}-repair-${sha256(missing.join('|')).slice(0, 10)}-bundle.json`), true)); }
      catch (error) { recoveryErrors.push(`batch: ${error.message}`); }
    }
    missing = names.filter((name) => !Object.hasOwn(resolved, name));
    for (const name of missing) {
      console.warn(`[docgen] ${stage} OBJECT REPAIR | ${name}`);
      try { merge(await request([name], path.join(paths.model, `${stage}-repair-${sha256(name).slice(0, 10)}-${name}.json`), true)); }
      catch (error) { recoveryErrors.push(`${name}: ${error.message}`); }
    }
    missing = names.filter((name) => !Object.hasOwn(resolved, name));
    const policy = String(config.execution?.missingModelPolicy ?? 'placeholder').toLowerCase();
    if (missing.length && policy === 'fail') throw new Error(`Model recovery exhausted for: ${missing.join(', ')}`);
    const degradedModels = [];
    for (const name of missing) {
      resolved[name] = safeModelPlaceholder(name, `${stage} provider output omitted ${name} after bounded recovery.`);
      degradedModels.push(name);
      console.warn(`[docgen] ${stage} DEGRADED | ${name} -> explicit UNKNOWN placeholder`);
    }
    commitModels(root, stage, names, resolved);
    updateStage(root, stage, 'completed', {
      inputHash, completedAt: now(), models: names, degradedModels, recoveryErrors, providerCalls,
      contextId: context.payload.id, contextTokens: context.payload.estimatedTokens, recovered
    });
    return { skipped: false, inputHash, degradedModels, providerCalls, recovered };
  } catch (error) {
    updateStage(root, stage, 'failed', { inputHash, failedAt: now(), error: error.message, recoveryErrors, contextId: context.payload.id });
    throw error;
  } finally {
    for (const file of temporary) fs.rmSync(file, { force: true });
  }
}
