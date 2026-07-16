import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { appendJsonl, commandExists, ensureDir, estimateTokens, loadConfig, now, projectPaths, sha256, sleep, writeJson } from './core.mjs';

function executable(config) {
  if (process.env.DOCGEN_COMMAND_CODE_BIN) return process.env.DOCGEN_COMMAND_CODE_BIN;
  if (config.commandCode?.executable) return config.commandCode.executable;
  for (const candidate of process.platform === 'win32' ? ['cmdc', 'command-code'] : ['cmd', 'cmdc', 'command-code']) if (commandExists(candidate)) return candidate;
  throw new Error('Command Code executable not found. Set commandCode.executable or DOCGEN_COMMAND_CODE_BIN.');
}

function commandArgs(config, stage) {
  const args = ['-p']; const cc = config.commandCode ?? {};
  if (cc.trust !== false) args.push('--trust');
  if (cc.skipOnboarding !== false) args.push('--skip-onboarding');
  if (cc.yolo !== false) args.push('--yolo');
  const model = process.env.DOCGEN_MODEL || cc.stageModels?.[stage] || cc.model; if (model) args.push('--model', String(model));
  const turns = Number(process.env.DOCGEN_MAX_TURNS || cc.maxTurns?.[stage] || cc.maxTurns?.default || 12); if (turns > 0) args.push('--max-turns', String(turns));
  if (cc.verbose === true) args.push('--verbose');
  return args;
}

function budgetConfig(config) {
  const budget = config.budget ?? {};
  return {
    maxProviderCalls: Number(budget.maxProviderCalls ?? 24),
    maxEstimatedInputTokens: Number(budget.maxEstimatedInputTokens ?? 2_500_000),
    maxEstimatedOutputTokens: Number(budget.maxEstimatedOutputTokens ?? 500_000),
    maxContextTokensPerCall: Number(budget.maxContextTokensPerCall ?? 80_000),
    onExceeded: String(budget.onExceeded ?? 'stop-and-report')
  };
}

export function telemetry(root) {
  const file = path.join(projectPaths(root).telemetry, 'provider-runs.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function completedRuns(root) {
  const terminal = new Map();
  for (const record of telemetry(root)) if (record.status === 'completed' || record.status === 'failed') terminal.set(record.runId, record);
  return [...terminal.values()];
}

export function budgetReport(root) {
  const paths = projectPaths(root); const limits = budgetConfig(loadConfig(root)); const runs = completedRuns(root);
  const usage = {
    providerCalls: runs.length,
    estimatedInputTokens: runs.reduce((n, x) => n + Number(x.estimatedInputTokens ?? 0), 0),
    estimatedOutputTokens: runs.reduce((n, x) => n + Number(x.estimatedOutputTokens ?? 0), 0),
    cacheHits: runs.filter((x) => x.cacheHit).length
  };
  const remaining = { providerCalls: limits.maxProviderCalls - usage.providerCalls, estimatedInputTokens: limits.maxEstimatedInputTokens - usage.estimatedInputTokens, estimatedOutputTokens: limits.maxEstimatedOutputTokens - usage.estimatedOutputTokens };
  const stages = {};
  for (const run of runs) {
    const stage = stages[run.stage] ??= { calls: 0, inputTokens: 0, outputTokens: 0 };
    stage.calls++; stage.inputTokens += Number(run.estimatedInputTokens ?? 0); stage.outputTokens += Number(run.estimatedOutputTokens ?? 0);
  }
  const report = { schemaVersion: '2.0', generatedAt: now(), limits, usage, remaining, exceeded: Object.values(remaining).some((x) => x < 0), stages };
  writeJson(paths.budget, report); return report;
}

function assertBudget(root, inputTokens) {
  const report = budgetReport(root); const next = { calls: report.usage.providerCalls + 1, input: report.usage.estimatedInputTokens + inputTokens };
  if (next.calls > report.limits.maxProviderCalls) throw new Error(`Provider call budget exceeded (${next.calls}/${report.limits.maxProviderCalls}).`);
  if (next.input > report.limits.maxEstimatedInputTokens) throw new Error(`Estimated input-token budget exceeded (${next.input}/${report.limits.maxEstimatedInputTokens}).`);
  if (inputTokens > report.limits.maxContextTokensPerCall) throw new Error(`Per-call context budget exceeded (${inputTokens}/${report.limits.maxContextTokensPerCall}).`);
}

function runOnce(root, stage, target, prompt, attempt, maxAttempts) {
  const paths = projectPaths(root); const config = loadConfig(root); const bin = executable(config); const args = commandArgs(config, stage);
  const startedAt = now(); const runId = `${startedAt.replace(/[:.]/g, '-')}-${stage}-${sha256(target || 'global').slice(0, 8)}-a${attempt}`;
  ensureDir(paths.runs); const stdoutFile = path.join(paths.runs, `${runId}.stdout.log`); const stderrFile = path.join(paths.runs, `${runId}.stderr.log`);
  const inputTokens = estimateTokens(prompt); assertBudget(root, inputTokens);
  const record = { schemaVersion: '2.0', runId, stage, target: target || null, attempt, maxAttempts, startedAt, estimatedInputTokens: inputTokens, promptHash: sha256(prompt), model: process.env.DOCGEN_MODEL || config.commandCode?.stageModels?.[stage] || config.commandCode?.model || null, status: 'running' };
  appendJsonl(path.join(paths.telemetry, 'provider-runs.jsonl'), record);
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(bin, args, { cwd: root, env: { ...process.env, DOCGEN_MODE: '1', DOCGEN_STAGE: stage, DOCGEN_TARGET: target, DOCGEN_CONTEXT_ONLY: '1' }, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; fs.appendFileSync(stdoutFile, chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; fs.appendFileSync(stderrFile, chunk); });
    child.on('error', (error) => { if (!settled) { settled = true; reject(error); } });
    child.on('close', (code) => {
      if (settled) return; settled = true;
      const completed = { ...record, finishedAt: now(), exitCode: code ?? 1, status: code === 0 ? 'completed' : 'failed', estimatedOutputTokens: estimateTokens(stdout + stderr), stdoutFile: path.relative(root, stdoutFile).replaceAll('\\', '/'), stderrFile: path.relative(root, stderrFile).replaceAll('\\', '/') };
      appendJsonl(path.join(paths.telemetry, 'provider-runs.jsonl'), completed); budgetReport(root);
      if (code === 0) resolve(completed); else reject(Object.assign(new Error(`${stage}${target ? `:${target}` : ''} failed with exit ${code}. ${stderr.slice(-2000)}`), { exitCode: code ?? 1, stdout, stderr }));
    });
    child.stdin.end(prompt);
  });
}

export async function runProvider(root, { stage, target = '', prompt }) {
  const config = loadConfig(root); const retry = config.retry ?? {}; const maxAttempts = Math.max(1, Number(retry.maxAttempts ?? 3)); let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await runOnce(root, stage, target, prompt, attempt, maxAttempts); }
    catch (error) {
      lastError = error; const retryable = [5,6,7].includes(Number(error.exitCode)) || /429|rate.?limit|timeout|ECONN|5\d\d/i.test(`${error.message}\n${error.stderr ?? ''}`);
      if (!retryable || attempt === maxAttempts) throw error;
      const base = Number(retry.initialDelaySeconds ?? 15); const max = Number(retry.maxDelaySeconds ?? 120); const delay = Math.min(max, base * (2 ** (attempt - 1)));
      await sleep(delay * 1000);
    }
  }
  throw lastError;
}

export function resetTelemetry(root) {
  const paths = projectPaths(root); fs.rmSync(paths.telemetry, { recursive: true, force: true }); fs.rmSync(path.dirname(paths.budget), { recursive: true, force: true });
}
