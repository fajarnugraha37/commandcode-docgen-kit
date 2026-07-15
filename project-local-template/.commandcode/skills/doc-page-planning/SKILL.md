---
name: doc-page-planning
description: Design a curated, coverage-driven documentation information architecture and stable page manifest from system models and audience needs.
---

# Documentation Planning Procedure

Plan around reader questions, system concepts, and operational tasks—not source files.

## Coverage model

For every repository, inspect whether evidence supports documentation for:

1. overview and architecture at a glance;
2. component/module boundaries and ownership;
3. core domain concepts and terminology;
4. important end-to-end request, event, workflow, and state lifecycles;
5. HTTP/API, messaging, persistence, configuration, security, and external integration surfaces;
6. local development and common engineering tasks;
7. operations, observability, failure modes, recovery, and troubleshooting.

Do not force a page for a category with no evidence. Do not omit a material surface simply because it is complex.

## Page contract

For every page define:

- stable `id` and target `path`;
- type and audience;
- explicit purpose and reader question;
- declared evidence and normalized model inputs;
- required sections;
- diagram intents;
- related pages;
- quality hints when the page needs unusual depth.

Prefer one conceptual owner for each topic and links between pages over duplicated prose. Preserve stable ids and paths during reconciliation unless the architecture genuinely changed.
