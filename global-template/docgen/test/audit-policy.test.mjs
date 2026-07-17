import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryLlmAuditSummary } from '../lib/audit-policy.mjs';

test('high-risk LLM findings are advisory by default after deterministic audit passes', () => {
  const result = advisoryLlmAuditSummary({
    auditInputHash: 'audit-hash',
    deterministicFailures: 0,
    highRiskFindings: 3,
    pass: false
  }, { audit: {} });
  assert.equal(result.pass, true);
  assert.equal(result.llmFindingsBlocking, false);
  assert.equal(result.advisoryHighRiskFindings, 3);
});

test('explicit blockOnLlmFindings preserves the hard gate', () => {
  const result = advisoryLlmAuditSummary({
    deterministicFailures: 0,
    highRiskFindings: 3,
    pass: false
  }, { audit: { blockOnLlmFindings: true } });
  assert.equal(result, null);
});

test('LLM advisory policy never hides deterministic failures', () => {
  const result = advisoryLlmAuditSummary({
    deterministicFailures: 114,
    highRiskFindings: 3,
    pass: false
  }, { audit: { blockOnLlmFindings: false } });
  assert.equal(result, null);
});
