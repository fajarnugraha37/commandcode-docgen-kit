---
name: doc-mermaid
description: Create Mermaid diagrams only when they clarify relationships, sequences, states, or data flow and keep them consistent with evidence.
---

# Mermaid Diagram Rules

Use Mermaid for:

- `flowchart` for component/data relationships
- `sequenceDiagram` for temporal interactions
- `stateDiagram-v2` for explicit state transitions

Keep diagrams small enough to read. Every node and transition must be supported by the page's declared evidence/model inputs. Do not add architecture that exists only to make the diagram look complete. Ensure diagram terminology matches prose exactly.
