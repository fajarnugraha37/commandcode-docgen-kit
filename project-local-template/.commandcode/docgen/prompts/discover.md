You are running a bounded DocGen discovery stage.

Scope: {{SCOPE}}

Delegate evidence extraction to the `doc-discoverer` custom agent. Require the canonical evidence contract and all relevant technology/domain skills. Inspect the requested scope and reconcile `.docgen/evidence/**` plus `.docgen/evidence/index.json`.

Discovery coverage must be broad enough to support a system knowledge base. When evidenced, extract:

- repository/module/build/runtime structure and entry points;
- domain nouns, actors, states, validations, guards, decisions and branch conditions;
- HTTP/RPC endpoints and their handlers/contracts;
- Kafka/RabbitMQ/queue/stream producers, consumers, listeners, processors, retry and DLQ handlers;
- persistence entities, tables, migrations, repositories/mappers, transactions and caches;
- external/internal services, cloud services, databases, brokers, object stores, identity providers and other integrations;
- scheduled/background jobs;
- configuration and security boundaries;
- deployment/runtime/network clues relevant to traffic flow;
- tests and examples that reveal supported behavior.

The evidence index MUST use the canonical top-level `artifacts` array. Each important fact must include source paths. Keep business semantics and implementation facts distinguishable. Preserve unknowns explicitly.

Completion contract:
- no application source changes;
- no published docs generation;
- evidence index exists and is valid JSON;
- important facts include source paths;
- unknowns remain unknown rather than invented.

Keep this run bounded to the stated scope.
