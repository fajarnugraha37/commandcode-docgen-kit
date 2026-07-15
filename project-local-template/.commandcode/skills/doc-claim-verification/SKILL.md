---
name: doc-claim-verification
description: Independently verify documentation claims and completeness against declared evidence and normalized models.
---

# Claim and Completeness Verification

Audit independently. Treat the generated page as untrusted until evidence supports it.

Check:

- factual correctness and source support;
- contradiction with evidence or normalized models;
- inference presented as fact;
- missing required sections or planned diagrams;
- material supported behavior that is omitted or treated too shallowly;
- missing boundaries, invariants, failure paths, state transitions, or operational implications;
- terminology, navigation, and cross-page ownership consistency;
- generic filler that could describe any repository;
- diagram/text disagreement.

Severity guidance:

- `critical`: dangerous or materially false guidance;
- `high`: incorrect core behavior or major required coverage missing;
- `medium`: meaningful incompleteness, ambiguity, or weak support;
- `low`: polish, navigation, or minor clarity issue.
