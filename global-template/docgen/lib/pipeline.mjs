import path from 'node:path';
import * as base from './pipeline-base.mjs';
import { guardedAudit } from './audit-guard.mjs';
import { advisoryLlmAuditSummary } from './audit-policy.mjs';
import { budgetReport } from './provider.mjs';
import { ingestModels } from './indexer.mjs';
import { loadConfig, projectPaths, readJson, sourceSnapshot, updateStage, writeJson } from './core.mjs';
import { synthesizeModels } from './model-synthesis.mjs';

export const index = base.index;
export async function model(root, { skipIndex = false } = {}) {
  if (!skipIndex) index(root);
  await synthesizeModels(root, 'modelCore', ['system', 'business', 'flows', 'catalogs'], 'repository structure architecture components modules symbols interfaces contracts dependencies behavior domain rules states flows data and automation');
  ingestModels(root);
  await synthesizeModels(root, 'modelEnterprise', ['security', 'operations', 'testing', 'data-governance', 'decisions', 'configuration', 'change-impact', 'ownership'], 'security operations testing governance configuration ownership decisions change impact reliability consistency and compatibility');
  return ingestModels(root);
}
export const plan = base.plan;
export const generate = base.generate;
export async function audit(root) {
  try {
    return await guardedAudit(root, base.audit);
  } catch (error) {
    const paths = projectPaths(root);
    const summaryFile = path.join(paths.audit, 'quality-summary.json');
    const summary = readJson(summaryFile, null);
    const advisory = advisoryLlmAuditSummary(summary, loadConfig(root));
    if (advisory) {
      writeJson(summaryFile, advisory);
      updateStage(root, 'audit', 'completed', {
        ...advisory,
        inputHash: advisory.auditInputHash,
        advisory: true,
        originalError: error.message
      });
      console.warn(`[docgen] audit ADVISORY | ${advisory.advisoryHighRiskFindings} high/critical LLM finding(s) recorded but not blocking. Set audit.blockOnLlmFindings=true to enforce them.`);
      return advisory;
    }
    throw error;
  }
}
export const publish = base.publish;
export function status(root) {
  const result = base.status(root);
  result.summary.degradedModels = ['modelCore', 'modelEnterprise'].flatMap((stage) =>
    (result.state.stages?.[stage]?.degradedModels ?? []).map((name) => `${stage}:${name}`));
  return result;
}
export async function all(root) {
  index(root); await model(root, { skipIndex: true }); await plan(root); await generate(root); await audit(root);
  return { publishing: publish(root), budget: budgetReport(root), snapshot: sourceSnapshot(root) };
}
