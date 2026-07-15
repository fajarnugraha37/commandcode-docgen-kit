---
name: "doc-messaging-catalog"
description: "Build a source-grounded catalog of Kafka, RabbitMQ, queue, stream, and other message producers/consumers/handlers."
---
# Messaging catalog

Inventory every evidenced producer, consumer, listener, handler, stream processor, scheduler-to-message bridge, retry handler and DLQ handler.

Capture when available:

- technology;
- role: producer / consumer / processor / listener;
- topic, exchange, queue, routing key or stream;
- handler symbol and source path;
- message key and payload/schema;
- trigger and business purpose;
- acknowledgement/commit semantics;
- ordering/partitioning/concurrency;
- retry/backoff/DLQ;
- idempotency/deduplication;
- side effects and downstream calls;
- failure behavior.
