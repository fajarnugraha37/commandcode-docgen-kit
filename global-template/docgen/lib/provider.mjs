import fs from 'node:fs';
import path from 'node:path';
import {
  appendJsonl,
  commandExists,
  ensureDir,
  estimateTokens,
  formatDuration,
  loadConfig,
  now,
  projectPaths,
  resolveCommand,
  sha256,
  sleep,
  spawnCommand,
  terminateProcessTree,
  writeJson
} from './core.mjs';

const MIN_MAX_TURNS = 30;

function executable(config) {
  if (process.env.DOCGEN_COMMAND_CODE_BIN) return process.env.DOCGEN_COMMAND_CODE_BIN;
  if (config.commandCode?.executable) return config.commandCode.executable;
  for (const candidate of process.platform === 'win32' ? ['cmdc', 'command-code'] : ['cmd', 'cmdc', 'command-code']) {
    if (commandExists(candidate)) return resolveCommand(candidate) ?? candidate;
  }
  throw new Error('Command Code executable not found. Set commandCode.executable or DOCGEN_COMMAND_CODE_BIN.');
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function providerInvocation(config, stage) {
  const cc = config.commandCode ?? {}; const bin = executable(config); const args = ['-p'];
  if (cc.trust !== false) args.push('--trust');
  if (cc.skipOnboarding !== false) args.push('--skip-onboarding');
  if (cc.yolo !== false) args.push('--yolo');
  const model = process.env.DOCGEN_MODEL || cc.stageModels?.[stage] || cc.model || null;
  if (model) args.push('--model', String(model));
  const configuredTurns = process.env.DOCGEN_MAX_TURNS ?? cc.maxTurns?.[stage] ?? cc.maxTurns?.default ?? MIN_MAX_TURNS;
  const maxTurns = Math.max(MIN_MAX_TURNS, Math.floor(finiteNumber(configuredTurns, MIN_MAX_TURNS)));
  args.push('--max-turns', String(maxTurns));
  if (cc.verbose === true) args.push('--verbose');
  return { bin, resolvedBin: resolveCommand(bin) ?? String(bin), args, model, maxTurns };
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

function executionConfig(config, stage) {
  const execution = config.execution ?? {}; const timeouts = execution.stageTimeoutMinutes ?? {};
  const defaults = { modelCore: 30, modelEnterprise: 30, plan: 20, generate: 25, audit: 20 };
  const timeoutMinutes = finiteNumber(process.env.DOCGEN_STAGE_TIMEOUT_MINUTES ?? (typeof timeouts === 'number' ? timeouts : timeouts[stage] ?? timeouts.default) ?? defaults[stage] ?? 20, 20);
  const timeoutMsOverride = finiteNumber(process.env.DOCGEN_STAGE_TIMEOUT_MS ?? 0, 0);
  return {
    heartbeatSeconds: Math.max(0.1, finiteNumber(execution.heartbeatSeconds ?? 10, 10)),
    silenceNoticeSeconds: Math.max(0.1, finiteNumber(execution.silenceNoticeSeconds ?? 45, 45)),
    timeoutMinutes: Math.max(1, timeoutMinutes),
    timeoutMs: timeoutMsOverride > 0 ? timeoutMsOverride : Math.max(1, timeoutMinutes) * 60_000,
    timeoutLabel: timeoutMsOverride > 0 ? formatDuration(timeoutMsOverride) : `${Math.max(1, timeoutMinutes)} minute(s)`,
    streamProviderOutput: execution.streamProviderOutput === true || config.commandCode?.verbose === true
  };
}

function label(stage, target) { return `${stage}${target ? `:${target}` : ''}`; }

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
    successfulCalls: runs.filter((run) => run.status === 'completed').length,
    failedCalls: runs.filter((run) => run.status === 'failed').length,
    estimatedInputTokens: runs.reduce((n, x) => n + Number(x.estimatedInputTokens ?? 0), 0),
    estimatedOutputTokens: runs.reduce((n, x) => n + Number(x.estimatedOutputTokens ?? 0), 0),
    cacheHits: runs.filter((x) => x.cacheHit).length
  };
  const remaining = { providerCalls: limits.maxProviderCalls - usage.providerCalls, estimatedInputTokens: limits.maxEstimatedInputTokens - usage.estimatedInputTokens, estimatedOutputTokens: limits.maxEstimatedOutputTokens - usage.estimatedOutputTokens };
  const stages = {};
  for (const run of runs) {
    const stage = stages[run.stage] ??= { calls: 0, completed: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
    stage.calls++; stage[run.status]++; stage.inputTokens += Number(run.estimatedInputTokens ?? 0); stage.outputTokens += Number(run.estimatedOutputTokens ?? 0);
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

function terminalRecord(root, record, patch) {
  const completed = { ...record, finishedAt: now(), ...patch };
  appendJsonl(path.join(projectPaths(root).telemetry, 'provider-runs.jsonl'), completed); budgetReport(root); return completed;
}

function runOnce(root, stage, target, prompt, attempt, maxAttempts) {
  const paths = projectPaths(root); const config = loadConfig(root); const invocation = providerInvocation(config, stage); const execution = executionConfig(config, stage);
  const startedAt = now(); const startedMs = Date.now(); const runId = `${startedAt.replace(/[:.]/g, '-')}-${stage}-${sha256(target || 'global').slice(0, 8)}-a${attempt}`;
  ensureDir(paths.runs); const stdoutFile = path.join(paths.runs, `${runId}.stdout.log`); const stderrFile = path.join(paths.runs, `${runId}.stderr.log`);
  fs.writeFileSync(stdoutFile, ''); fs.writeFileSync(stderrFile, '');
  const inputTokens = estimateTokens(prompt); assertBudget(root, inputTokens);
  const record = { schemaVersion: '2.0', runId, stage, target: target || null, attempt, maxAttempts, startedAt, estimatedInputTokens: inputTokens, promptHash: sha256(prompt), executable: invocation.resolvedBin, model: invocation.model, maxTurns: invocation.maxTurns, timeoutMs: execution.timeoutMs, status: 'running' };
  appendJsonl(path.join(paths.telemetry, 'provider-runs.jsonl'), record);
  const stageLabel = label(stage, target);
  console.log(`[docgen] ${stageLabel} RUNNING | attempt ${attempt}/${maxAttempts} | context ~${inputTokens.toLocaleString()} tokens | maxTurns ${invocation.maxTurns} | timeout ${execution.timeoutLabel}`);
  console.log(`         provider: ${invocation.resolvedBin}${invocation.model ? ` | model: ${invocation.model}` : ''}`);
  console.log(`         logs: ${path.relative(root, stdoutFile).replaceAll('\\', '/')} | ${path.relative(root, stderrFile).replaceAll('\\', '/')}`);

  return new Promise((resolve, reject) => {
    let settled = false; let timedOut = false; let stdout = ''; let stderr = ''; let lastOutputAt = Date.now(); let child;
    try {
      child = spawnCommand(invocation.bin, invocation.args, { cwd: root, env: { ...process.env, DOCGEN_MODE: '1', DOCGEN_STAGE: stage, DOCGEN_TARGET: target, DOCGEN_CONTEXT_ONLY: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      const completed = terminalRecord(root, record, { exitCode: 1, status: 'failed', estimatedOutputTokens: 0, error: error.message });
      console.error(`[docgen] ${stageLabel} FAILED | ${error.message}`); reject(Object.assign(error, { exitCode: completed.exitCode })); return;
    }
    const heartbeat = setInterval(() => {
      if (settled) return; const elapsed = Date.now() - startedMs; const quiet = Date.now() - lastOutputAt;
      const quietText = quiet >= execution.silenceNoticeSeconds * 1000 ? ` | no provider output for ${formatDuration(quiet)}` : '';
      console.log(`[docgen] ${stageLabel} RUNNING | elapsed ${formatDuration(elapsed)} | pid ${child.pid ?? '?'} | maxTurns ${invocation.maxTurns}${quietText}`);
    }, execution.heartbeatSeconds * 1000); heartbeat.unref?.();
    const timeout = setTimeout(() => {
      if (settled) return; timedOut = true; console.error(`[docgen] ${stageLabel} TIMEOUT | exceeded ${execution.timeoutLabel}; terminating process tree ${child.pid ?? '?'}.`); terminateProcessTree(child);
    }, execution.timeoutMs); timeout.unref?.();
    const cleanup = () => { clearInterval(heartbeat); clearTimeout(timeout); };
    child.stdout.on('data', (chunk) => { lastOutputAt = Date.now(); stdout += chunk; fs.appendFileSync(stdoutFile, chunk); if (execution.streamProviderOutput) process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { lastOutputAt = Date.now(); stderr += chunk; fs.appendFileSync(stderrFile, chunk); if (execution.streamProviderOutput) process.stderr.write(chunk); });
    child.stdin.on('error', (error) => { stderr += `\nstdin: ${error.message}`; });
    child.on('error', (error) => {
      if (settled) return; settled = true; cleanup();
      const completed = terminalRecord(root, record, { exitCode: 1, status: 'failed', estimatedOutputTokens: estimateTokens(stdout + stderr), stdoutFile: path.relative(root, stdoutFile).replaceAll('\\', '/'), stderrFile: path.relative(root, stderrFile).replaceAll('\\', '/'), error: error.message });
      console.error(`[docgen] ${stageLabel} FAILED | elapsed ${formatDuration(Date.now() - startedMs)} | ${error.message}`); reject(Object.assign(error, { exitCode: completed.exitCode, stdout, stderr, run: completed }));
    });
    child.on('close', (code) => {
      if (settled) return; settled = true; cleanup(); const exitCode = timedOut ? 124 : (code ?? 1); const status = exitCode === 0 ? 'completed' : 'failed';
      const completed = terminalRecord(root, record, { exitCode, status, timedOut, estimatedOutputTokens: estimateTokens(stdout + stderr), stdoutFile: path.relative(root, stdoutFile).replaceAll('\\', '/'), stderrFile: path.relative(root, stderrFile).replaceAll('\\', '/') });
      const elapsed = formatDuration(Date.now() - startedMs);
      if (exitCode === 0) { console.log(`[docgen] ${stageLabel} COMPLETED | elapsed ${elapsed} | exit 0`); resolve(completed); }
      else { const detail = timedOut ? `timed out after ${execution.timeoutLabel}` : `exit ${exitCode}`; console.error(`[docgen] ${stageLabel} FAILED | elapsed ${elapsed} | ${detail}`); reject(Object.assign(new Error(`${stageLabel} failed: ${detail}. ${stderr.slice(-2000)}`), { exitCode, stdout, stderr, timedOut, run: completed })); }
    });
    child.stdin.end(prompt);
  });
}

export async function runProvider(root, { stage, target = '', prompt, acceptArtifacts = null }) {
  const config = loadConfig(root); const retry = config.retry ?? {}; const maxAttempts = Math.max(1, Number(retry.maxAttempts ?? 3)); let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await runOnce(root, stage, target, prompt, attempt, maxAttempts); }
    catch (error) {
      lastError = error;
      if (typeof acceptArtifacts === 'function') {
        let accepted = false;
        try { accepted = Boolean(await acceptArtifacts({ error, attempt, maxAttempts })); } catch (validationError) { error.artifactValidationError = validationError; }
        if (accepted) {
          console.warn(`[docgen] ${label(stage, target)} RECOVERED | provider failed but valid expected artifacts were checkpointed; retry suppressed.`);
          return { ...(error.run ?? {}), status: 'recovered', recovered: true, recoveredFromExitCode: Number(error.exitCode ?? 1) };
        }
      }
      const retryable = [5, 6, 7].includes(Number(error.exitCode)) || /429|rate.?limit|timeout|ECONN|5\d\d/i.test(`${error.message}\n${error.stderr ?? ''}`);
      if (!retryable || attempt === maxAttempts) throw error;
      const base = Number(retry.initialDelaySeconds ?? 15); const max = Number(retry.maxDelaySeconds ?? 120); const delay = Math.min(max, base * (2 ** (attempt - 1)));
      console.warn(`[docgen] ${label(stage, target)} RETRY | attempt ${attempt + 1}/${maxAttempts} in ${delay}s`); await sleep(delay * 1000);
    }
  }
  throw lastError;
}

export function resetTelemetry(root) {
  const paths = projectPaths(root); fs.rmSync(paths.telemetry, { recursive: true, force: true }); fs.rmSync(path.dirname(paths.budget), { recursive: true, force: true });
}
