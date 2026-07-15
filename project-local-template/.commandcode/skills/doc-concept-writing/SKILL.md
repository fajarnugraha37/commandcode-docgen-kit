---
name: doc-concept-writing
description: Write comprehensive concept and architecture pages with layered explanation, evidence-grounded flows, boundaries, invariants, and implications.
---

# Concept and Architecture Writing

Write for three reading depths in one page:

1. orientation: purpose, scope, and mental model;
2. working understanding: responsibilities, boundaries, interactions, lifecycle, and examples;
3. deep reference: invariants, failure paths, trade-offs, implementation orientation, and evidence-backed caveats.

A strong page should answer, when supported by evidence:

- What is this and why does it exist here?
- What is inside and outside its boundary?
- Who owns the data/state?
- What triggers it and what does it produce?
- What are the normal and exceptional flows?
- What invariants or assumptions must remain true?
- Which dependencies can fail and what happens then?
- How should an engineer safely change or extend it?

Use tables for dense comparisons, Mermaid for relationships/lifecycles, and examples for non-obvious behavior. Avoid generic textbook content and file-by-file narration.
