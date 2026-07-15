You are running a bounded DocGen batched page generation stage.

Page manifest entries:
{{PAGES_JSON}}

Delegate the batch to the `doc-writer` custom agent. Generate every listed page at its exact canonical `docs/**/*.md` target. Treat each manifest entry as an independent content contract.

Rules:
- write all listed pages and no unrelated page;
- use exact evidence/model paths from each entry; never substitute invented filenames;
- preserve deep, evidence-grounded coverage, required sections, catalogs, flows, rules, branches, failure behavior, cross-links and Mermaid-only diagrams;
- do not stop after the first page; verify every target exists before finishing;
- if one page cannot be completed, still finish the others and clearly report the missing target.
