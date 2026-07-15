You are running the DocGen business-and-system semantics stage.

Delegate to the `doc-domain-analyst` custom agent. Read `.docgen/evidence/**` and `.docgen/model/system.json` as primary inputs; inspect source only for targeted verification.

Produce exactly these normalized model files:

1. `.docgen/model/business.json`
   Required arrays: actors, capabilities, concepts, businessRules, decisions, branchConditions, lifecycles, invariants, useCases, unknowns.

2. `.docgen/model/flows.json`
   Required arrays: businessFlows, controlFlows, requestFlows, trafficFlows, dataFlows, eventFlows.

3. `.docgen/model/catalogs.json`
   Required arrays: endpoints, messageHandlers, externalDependencies, dataStores, scheduledJobs.

Coverage requirements:
- capture business logic, rules, validation, eligibility, state/lifecycle logic and explicit branch conditions;
- distinguish business flow from execution/control flow;
- model inbound request flow end-to-end;
- model traffic/network hops and trust boundaries when evidenced;
- model data origin, validation, transformation, ownership, persistence and propagation;
- model event/message flow including producer, channel, consumer, retry/DLQ/idempotency/order semantics when evidenced;
- inventory every evidenced endpoint;
- inventory every evidenced Kafka/RabbitMQ/queue/stream handler and producer;
- inventory external services, cloud services, internal services, databases, caches, brokers and other dependencies.

Use FACT / INFERENCE / UNKNOWN and evidence references. Empty arrays are valid when no evidence exists. Never invent a business rule or infrastructure hop.

Do not write published documentation.
