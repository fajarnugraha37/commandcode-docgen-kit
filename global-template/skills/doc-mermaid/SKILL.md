---
name: "doc-mermaid"
description: "Create evidence-grounded Mermaid diagrams for architecture, business, control, request, traffic, data, event, state and dependency views."
---
# Mermaid-only diagrams

All generated diagrams MUST use fenced `mermaid` blocks.

Choose diagram type by question:

- `flowchart` for business/control/data/traffic topology;
- `sequenceDiagram` for request/event interactions over time;
- `stateDiagram-v2` for lifecycle/state transitions;
- `erDiagram` for evidenced logical data relationships;
- `classDiagram` only for useful conceptual/type relationships.

Do not use PlantUML, Graphviz/DOT, ASCII-art diagrams, or external image-only diagrams.

Every node/edge must be grounded in evidence or explicitly marked as inference in surrounding prose. Show alternate/error branches when they materially change behavior. Keep diagrams readable; split overloaded diagrams into multiple focused views.
