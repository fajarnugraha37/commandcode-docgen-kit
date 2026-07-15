---
name: doc-workflow-analysis
description: Analyze end-to-end request, event, job, or business workflows and normalize transitions with evidence.
---

# Workflow Analysis Procedure

For each workflow:

1. identify trigger and initiating actor/system;
2. follow synchronous calls;
3. follow asynchronous messages and correlation identifiers;
4. record state mutations and persistence boundaries;
5. record external dependencies;
6. enumerate failure branches, retries, compensation, and terminal outcomes only when evidenced;
7. identify unresolved transitions explicitly.

Model steps and transitions in `.docgen/model/workflows/**`. A plausible domain flow is not evidence of implemented behavior.
