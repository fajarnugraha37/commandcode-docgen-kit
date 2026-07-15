You are running a bounded DocGen discovery stage.

Scope: {{SCOPE}}

Delegate the evidence extraction work to the `doc-discoverer` custom agent. Require it to follow the evidence contract and relevant technology skills. It must inspect the requested scope and reconcile `.docgen/evidence/**` plus `.docgen/evidence/index.json`.

Completion contract:
- no application source changes;
- no published docs generation;
- evidence index exists and is valid JSON;
- important facts include source paths;
- unknowns remain unknown rather than invented.

Keep this run bounded to the stated scope.
