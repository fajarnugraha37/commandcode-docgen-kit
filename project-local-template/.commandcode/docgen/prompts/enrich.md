You are running a bounded DocGen depth-and-completeness enrichment pass.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-writer` custom agent. Read the existing page, all declared evidence/model inputs, normalized business/flows/catalog models, style guide, glossary, and quality configuration.

Improve the existing page rather than replacing it with generic prose. Close omissions and shallow areas. Aim for documentation that remains useful across three reading depths: orientation, working understanding, and deep technical/reference use.

Check for missing supported detail such as:
- business intent, actors, capabilities and outcomes;
- business rules, validations, decisions and explicit branch conditions;
- lifecycle/state transitions and invariants;
- control/execution sequence;
- request path from entry point to response;
- traffic/network/trust boundaries;
- data origin, transformation, ownership, persistence and propagation;
- event/message producer-channel-consumer behavior;
- complete endpoint/message/integration catalog coverage where applicable;
- failure, retry, recovery, idempotency and operational implications;
- concrete examples, decision tables and troubleshooting cues;
- Mermaid diagrams and navigation links.

All diagrams must be Mermaid. Do not invent unsupported behavior. Preserve useful existing material. Modify only the requested page.
