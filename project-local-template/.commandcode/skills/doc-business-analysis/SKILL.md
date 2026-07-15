---
name: "doc-business-analysis"
description: "Extract business capabilities, actors, domain concepts, rules, decisions, branch conditions, lifecycles, invariants, and use cases from source-grounded evidence."
---
# Business analysis

Separate **business meaning** from implementation mechanics.

For each supported business capability or use case identify:

1. actor or initiating system;
2. goal and business outcome;
3. preconditions and eligibility;
4. inputs and business data involved;
5. rules and validations;
6. decisions and branch conditions;
7. state transitions and lifecycle constraints;
8. side effects and downstream consequences;
9. failure/rejection outcomes;
10. evidence references and FACT / INFERENCE / UNKNOWN classification.

A source-code `if` is not automatically a business rule. Promote it only when it changes a domain outcome, eligibility, state, monetary result, permission, obligation, or externally visible behavior.

Record unresolved semantics as UNKNOWN rather than completing the domain model from general industry knowledge.
