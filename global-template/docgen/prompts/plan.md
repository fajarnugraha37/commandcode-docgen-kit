You are running the DocGen documentation planning stage.

Delegate to the `doc-planner` custom agent. Read `.docgen/evidence/index.json`, `.docgen/model/system.json`, documentation config/style/glossary, and the existing manifest when present. Produce or reconcile `.docgen/plan/manifest.json` conforming to the manifest schema.

The manifest must be coverage-driven and reader-oriented. It must provide a coherent documentation set comparable to a curated developer portal, not a source-file inventory. Cover, when evidence supports them:
- system/repository overview and architecture at a glance;
- module/component boundaries and dependency relationships;
- core domain concepts and terminology;
- important end-to-end request/event/workflow lifecycles;
- API, messaging, persistence, configuration, security, and integration reference surfaces;
- local development and common engineering tasks;
- operations, failure modes, observability, and troubleshooting.

For every page define audience, purpose, evidence/models, required sections, diagram intents, related pages, and optional quality hints. Avoid duplicate ownership of the same concept. Preserve stable page ids/paths where reasonable.
