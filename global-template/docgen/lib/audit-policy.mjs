export function auditLlmMode(config = {}) {
  const configured = String(config.audit?.llmMode ?? '').trim().toLowerCase();
  if (['off', 'advisory', 'blocking'].includes(configured)) return configured;
  if (config.audit?.blockOnLlmFindings === true) return 'blocking';
  return 'off';
}

export function deterministicOnlyAuditSummary(quality) {
  return {
    schemaVersion: '2.0',
    generatedAt: new Date().toISOString(),
    auditInputHash: quality.auditInputHash,
    inventoryFingerprint: quality.inventoryFingerprint,
    manifestHash: quality.manifestHash,
    pages: quality.metrics.pages,
    claims: quality.metrics.claims,
    evidenceReferences: quality.metrics.evidenceReferences,
    modelItems: quality.metrics.modelItems,
    referencedModelItems: quality.metrics.referencedModelItems,
    modelReferenceCoverage: quality.metrics.modelReferenceCoverage,
    deterministicFailures: quality.errors.length,
    deterministicWarnings: quality.warnings.length,
    llmAuditedPages: 0,
    highRiskFindings: 0,
    llmSkippedReason: 'llm-audit-off',
    llmFindingsBlocking: false,
    pass: quality.pass
  };
}

export function advisoryLlmAuditSummary(summary, config = {}) {
  if (!summary || auditLlmMode(config) !== 'advisory') return null;
  const deterministicFailures = Number(summary.deterministicFailures ?? 0);
  const highRiskFindings = Number(summary.highRiskFindings ?? 0);
  if (deterministicFailures !== 0 || highRiskFindings <= 0) return null;
  return {
    ...summary,
    pass: true,
    llmFindingsBlocking: false,
    advisoryHighRiskFindings: highRiskFindings
  };
}
