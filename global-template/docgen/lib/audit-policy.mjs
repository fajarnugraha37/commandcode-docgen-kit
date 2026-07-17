export function advisoryLlmAuditSummary(summary, config = {}) {
  if (!summary || config.audit?.blockOnLlmFindings === true) return null;
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
