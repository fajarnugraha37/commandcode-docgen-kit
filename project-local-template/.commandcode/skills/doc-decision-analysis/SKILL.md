---
name: doc-decision-analysis
description: Extract recorded and inferred architecture decisions, alternatives, trade-offs, constraints, consequences, and supersession.
---

# Decision Analysis

Prefer ADRs and explicit rationale. Classify reconstructed rationale as INFERENCE. Record alternatives, trade-offs, constraints, consequences, status/supersession, and unknown rationale. Never rewrite an implementation choice as a historical decision without evidence.

## Evidence boundary

Use only paths listed in `.docgen/state/source-files.txt` or existing `.docgen` model/evidence artifacts. All FACT items require resolvable non-ignored source evidence.
