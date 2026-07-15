---
name: doc-claim-verification
description: Audit documentation claims against evidence and models, classify severity, and produce actionable machine-readable findings.
---

# Claim Verification

For each material claim, ask:

- Is it directly supported?
- Is it an inference presented as a fact?
- Is contradictory evidence present?
- Is the claim too broad for the evidence?
- Is it stale relative to current source?

Severity:

- `critical`: materially unsafe or fundamentally wrong system behavior
- `high`: important unsupported/incorrect architectural or operational claim
- `medium`: misleading ambiguity, stale reference, significant inconsistency
- `low`: terminology, navigation, minor structural issue

Findings must identify page, claim/section, evidence references, explanation, and recommended action.
