# Runtime template

What every flow image is built with, so all flows run the same way:

- `versions.properties`: Camel version (must match the Builder's Kaoto catalog and validator),
  Swagger UI version (must match the Builder's, for `<Base Path>/docs`), base image and tool versions.
- `application.properties`: runtime defaults (port 8080, Actuator health with liveness and
  readiness probes, JSON logs). Each flow's own `application.properties` is appended after it
  and can override anything.

- `java/`: EY ECHO's HTTP log (every request and response, in and out, as JSON fields;
  `docs/http-log.md`), copied into every app. The Builder's Run compiles the same class.

`pipeline/build-flow.sh` reads all three. Copy this folder and `pipeline/` into the root of your flow
repository.
