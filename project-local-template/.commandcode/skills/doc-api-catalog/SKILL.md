---
name: "doc-api-catalog"
description: "Build a source-grounded catalog of HTTP/RPC endpoints, handlers, contracts, security, errors, and downstream behavior."
---
# API catalog

Inventory every evidenced inbound endpoint. Capture when available:

- protocol and method;
- resolved path including class/base paths;
- handler symbol and source path;
- request headers, path/query parameters and body type;
- response type/status codes;
- authentication/authorization boundary;
- validation;
- idempotency/concurrency semantics;
- downstream services, persistence, messages and side effects;
- error mapping;
- deprecation/versioning.

Do not invent undocumented status codes or schemas. Mark unresolved contract details UNKNOWN.
