---
name: tech-maven
description: Interpret Maven reactor structure, dependency management, plugins, profiles, generated sources, and build metadata during discovery.
---

# Maven Discovery Heuristics

Read parent/child `pom.xml` files, `<modules>`, dependency management, plugins, profiles, properties, and packaging. Treat active profile behavior as unknown unless activation is evidenced. Do not run mutation-producing Maven goals during DocGen automation. Prefer direct POM inspection.
