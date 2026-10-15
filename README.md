# ECHO

ECHO Builder (web flow designer that publishes Camel YAML DSL flows to Git) and ECHO Runtime
(flows exported to Spring Boot apps and built into container images by your own pipeline).

See `CLAUDE.md` for layout and commands, `docs/ECHO Builder Plan.md` for the plan and
`docs/decisions/` for decisions made along the way.

## Quick start

```bash
cp config/application.example.yaml config/application.yaml   # users and the flow repository
docker compose up -d --build                                 # http://localhost:8080
```

To give an install its own logo, product name and colours, see `docs/branding.md`.

`docs/demo.md` walks through the Version 1 demo: create, validate and publish a flow, then
build and run its image.
