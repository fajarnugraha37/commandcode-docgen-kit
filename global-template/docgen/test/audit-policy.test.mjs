import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryLlmAuditSummary, auditLlmMode, deterministicOnlyAuditSummary } from '../lib/audit-policy.mjs';

test('LLM audit is off for legacy and unspecified configurations', () => {
  assert.equal(auditLlmMode({ audit: {} }), 'off');
  assert.equal(auditLlmMode({ audit: { llmEnabled: true } }), 'off');
});

test('advisory mode records high-risk findings without failing the audit', () => {
  const result = advisoryLlmAuditSummary({
    auditInputHash: 'audit-hash',
    deterministicFailures: 0,
    highRiskFindings: 3,
    pass: false
  }, { audit: { llmMode: 'advisory' } });
  assert.equal(result.pass, true);
  assert.equal(result.llmFindingsBlocking, false);
  assert.equal(result.advisoryHighRiskFindings, 3);
});

test('blocking mode preserves the hard LLM gate', () => {
  const result = advisoryLlmAuditSummary({
    deterministicFailures: 0,
    highRiskFindings: 3,
    pass: false
  }, { audit: { llmMode: 'blocking' } });
  assert.equal(result, null);
});

test('LLM advisory policy never hides deterministic failures', () => {
  const result = advisoryLlmAuditSummary({
    deterministicFailures: 114,
    highRiskFindings: 3,
    pass: false
  }, { audit: { llmMode: 'advisory' } });
  assert.equal(result, null);
});

test('deterministic-only summary records zero provider audit work', () => {
  const result = deterministicOnlyAuditSummary({
    auditInputHash: 'hash', inventoryFingerprint: 'inventory', manifestHash: 'manifest',
    metrics: { pages: 2, claims: 4, evidenceReferences: 5, modelItems: 6, referencedModelItems: 3, modelReferenceCoverage: 0.5 },
    errors: [], warnings: ['warning'], pass: true
  });
  assert.equal(result.pass, true);
  assert.equal(result.llmAuditedPages, 0);
  assert.equal(result.highRiskFindings, 0);
  assert.equal(result.llmSkippedReason, 'llm-audit-off');
});
