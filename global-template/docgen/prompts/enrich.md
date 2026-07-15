You are running a bounded DocGen depth-and-completeness enrichment pass.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-writer` custom agent. Read the existing page, its declared evidence/model inputs, project style guide, glossary, and documentation quality configuration.

Improve the existing page rather than replacing it with generic prose. Close omissions and shallow areas. Ensure the page is useful to a new engineer, an experienced maintainer, and an architect. Add supported detail such as:
- clearer mental model and scope boundaries;
- end-to-end flows and state transitions;
- invariants, assumptions, and failure modes;
- data ownership and dependency implications;
- operational and troubleshooting guidance where applicable;
- concrete examples and decision tables;
- Mermaid diagrams declared by the manifest;
- navigation links to related pages.

Do not invent unsupported behavior. Preserve useful existing material. Modify only the requested page.
