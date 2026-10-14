# Runtime template

What every flow image is built with, so all flows run the same way:

- `versions.properties`: Camel version (must match the Builder's Kaoto catalog and validator),
  base image and tool versions.
- `application.properties`: runtime defaults (port 8080, Actuator health with liveness and
  readiness probes, JSON logs). Each flow's own `application.properties` is appended after it
  and can override anything.

`pipeline/build-flow.sh` reads both. Copy this folder and `pipeline/` into the root of your flow
repository.
