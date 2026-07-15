---
name: tech-jakarta-rest-jersey
description: Discover Jakarta REST/Jersey resources, providers, filters, exception mappers, JSON integration, clients, SSE, and application registration.
---

# Jakarta REST / Jersey Discovery Heuristics

Look for `Application`/`ResourceConfig`, `@Path`, HTTP method annotations, `@Provider`, filters/interceptors, `ExceptionMapper`, `MessageBodyReader/Writer`, validation integration, SSE APIs, client configuration, package scanning, and explicit registration. Resolve effective paths by combining class and method annotations only when registration is evidenced.
