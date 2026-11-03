# Runtime template

What every flow image is built with, so all flows run the same way:

- `versions.properties`: Camel version (must match the Builder's Kaoto catalog and validator),
  Swagger UI version (must match the Builder's, for `<Base Path>/docs`), base image and tool versions.
- `application.properties`: runtime defaults (port 8080, Actuator health with liveness and
  readiness probes, Prometheus metrics at `/actuator/prometheus`, JSON logs). Each flow's own
  `application.properties` is appended after it and can override anything.

- `java/`: EY ECHO's HTTP log (every request and response, in and out, as JSON fields;
  `docs/http-log.md`), and the images' tracing and log context (`ObservabilityConfiguration`,
  OpenTelemetry, off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set; `docs/observability.md`), copied
  into every app. The Builder's Run compiles the HTTP log only.

`pipeline/build-flow.sh` reads all three. Copy this folder and `pipeline/` into the root of your flow
repository.
