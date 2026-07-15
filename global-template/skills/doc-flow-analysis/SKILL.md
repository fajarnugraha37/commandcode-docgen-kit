---
name: "doc-flow-analysis"
description: "Model business, control, request, traffic, data, and event flows as distinct evidence-grounded views."
---
# Flow analysis

Produce separate flow views because they answer different questions.

## Business flow
Actor intent, business steps, decisions, outcomes, rejections, compensations.

## Control flow
Runtime execution chain, calls, branches, loops, async boundaries, retries, fallbacks.

## Request flow
Inbound request from entry point through filters/middleware/resources/services/persistence/outbound calls to response.

## Traffic flow
Network hops, protocols, ports/listeners when evidenced, ingress/gateway/proxy/load balancer/service boundaries, trust zones, TLS/mTLS/auth boundaries.

## Data flow
Data origin, payload/entity, validation, transformation, enrichment, ownership, persistence, replication/caching, outbound propagation, retention/deletion when evidenced.

## Event flow
Producer, topic/exchange/queue, key/routing, schema/payload, consumer, acknowledgement/offset semantics, retry/DLQ, idempotency, ordering and side effects when evidenced.

Every flow step should reference source evidence. Capture branch conditions explicitly. Published diagrams must be Mermaid.
