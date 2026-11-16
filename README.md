# EY ECHO

EY ECHO Builder (web flow designer that publishes Camel YAML DSL flows to Git) and EY ECHO Runtime
(flows exported to Spring Boot apps and built into container images by your own pipeline).

See `docs/features.md` for what EY ECHO does today and `docs/README.md` for the list of all
documentation. `CLAUDE.md` has the layout and commands, `docs/decisions/` the decisions made along
the way, and `docs/ECHO Builder Plan.md` the original Version 1 plan.

## Quick start

```bash
cp config/application.example.yaml config/application.yaml   # users and the flow repository
docker compose up -d --build                                 # http://localhost:8080
```

To give an install its own logo, product name and colours, see `docs/branding.md`.

`docs/demo.md` walks through the demo: create, validate, run and publish a flow, then
build and run its image.
