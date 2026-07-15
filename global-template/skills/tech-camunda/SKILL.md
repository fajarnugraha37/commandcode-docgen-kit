---
name: tech-camunda
description: Discover Camunda 7/8 process models, workers/delegates, variables, message correlation, incidents, retries, and external integration boundaries.
---

# Camunda Discovery Heuristics

Detect Camunda version and runtime model before interpretation. For Camunda 7 inspect BPMN deployment, delegates/external tasks, job executor, incidents, variables, message correlation, and embedded vs standalone engine. For Camunda 8 inspect Zeebe jobs/workers, process instance variables, retries, incidents, message correlation, and gateway/client configuration. Never merge semantics across versions without evidence.
