# EY ECHO documentation

Start with [features.md](features.md) for what EY ECHO does today, and [demo.md](demo.md) for a
walkthrough from an empty Builder to a running flow image.

## Guides (kept up to date with the code)

| Document | What it covers |
|---|---|
| [features.md](features.md) | Everything that is built, by area, with links to the details |
| [demo.md](demo.md) | The demo: create, validate, run and publish a flow, then build and run its image |
| [api-spec.md](api-spec.md) | Interface Specs: the flow's OpenAPI spec, the REST service made from it, request validation, Swagger UI, Import from Jira using AI |
| [apis.md](apis.md) | Approved downstream APIs (`echo.apis`) and the REST OpenApi and Enrich steps that call them |
| [publishing.md](publishing.md) | Publish targets (Git, S3), clash checks, templates, adding a target |
| [branding.md](branding.md) | Logo, colours and themes per install (`echo.branding`) |
| [http-log.md](http-log.md) | The log of every HTTP request and response in flow images and Run |
| [observability.md](observability.md) | Logs, Prometheus metrics and OpenTelemetry tracing of flow images |
| [presentation/](presentation/README.md) | The ECHO presentation and its diagrams |

Outside this folder: `README.md` (quick start), `CLAUDE.md` (layout, commands, pinned versions,
conventions), `pipeline/README.md` (building images and Kubernetes manifests),
`runtime-template/README.md`, `samples/README.md` and `config/application.example.yaml` (the
install's settings, with comments).

## Where each setting is explained

| Settings | Document |
|---|---|
| `echo.security.users` | `config/application.example.yaml` |
| `echo.git`, `echo.s3` | [publishing.md](publishing.md) |
| `echo.branding` | [branding.md](branding.md) |
| `echo.apis` | [apis.md](apis.md) |
| `echo.jira`, `echo.ai` | [api-spec.md](api-spec.md#setting-up-jira) |
| `echo.editor.autosave-seconds`, `echo.run.*` | [demo.md](demo.md) |
| `echo.validation.allowed-components`, `allowed-languages`, `echo.catalog.hidden-processors` | [decisions/0005](decisions/0005-catalog-shows-allowed-components.md), `CLAUDE.md` |
| `echo.http-log.*` (flows) | [http-log.md](http-log.md) |
| `OTEL_*`, metrics (flow images) | [observability.md](observability.md) |
| `pipeline/k8s.properties`, `--env-values` | `pipeline/README.md` |

Secrets (Git, S3, Jira and AI tokens) belong in the git-ignored `config/application.yaml` or in
environment variables, never in Git.

## Decisions

One short note per significant choice, in [decisions/](decisions/). A note records what was decided
and why at the time; several carry dated additions as the feature grew.

| No. | Decision |
|---|---|
| [0001](decisions/0001-m1-kaoto-datamapper-spike.md) | Embed Kaoto and use its DataMapper for JSON |
| [0002](decisions/0002-validation-and-publishing.md) | Validation and publishing |
| [0003](decisions/0003-pluggable-publish-targets.md) | Pluggable publish targets (Git, S3) |
| [0004](decisions/0004-run-flows-in-the-builder.md) | Run flows in the Builder |
| [0005](decisions/0005-catalog-shows-allowed-components.md) | The catalog shows only allowed components |
| [0006](decisions/0006-approved-downstream-apis.md) | Approved downstream APIs |
| [0007](decisions/0007-save-as-and-templates.md) | Save As and templates |
| [0008](decisions/0008-rest-from-the-spec.md) | The REST service comes from the spec |
| [0009](decisions/0009-bundle-flows-in-one-image.md) | Bundle flows in one image, or one image per flow |
| [0010](decisions/0010-validation-and-swagger-ui.md) | Request validation and Swagger UI |
| [0011](decisions/0011-disable-flows-and-routes.md) | Disable flows and routes |
| [0012](decisions/0012-combined-api-docs.md) | One Swagger UI page for a bundle (`/api-docs`) |
| [0013](decisions/0013-operation-ids-from-method-and-path.md) | operationIds from method and path; routes follow the spec; the route scaffold |
| [0014](decisions/0014-every-flow-named-first.md) | Every flow named first |
| [0015](decisions/0015-a-path-in-one-flow-only.md) | A path in one flow only |
| [0016](decisions/0016-import-specs-from-jira.md) | Import specs from Jira, with an optional AI engine |
| [0017](decisions/0017-kubernetes-manifests-from-the-pipeline.md) | Kubernetes manifests from the pipeline |
| [0018](decisions/0018-flow-settings-as-configmap.md) | Flow settings as a ConfigMap |
| [0019](decisions/0019-run-with-a-properties-file.md) | Run with a properties file |
| [0020](decisions/0020-http-log.md) | HTTP log |
| [0021](decisions/0021-metrics-and-tracing.md) | Metrics and tracing |

## Historical documents (kept as written)

| Document | What it is |
|---|---|
| [Initial Requirements.md](Initial%20Requirements.md) | The requirements EY ECHO started from, with the Version 1 decisions |
| [ECHO Builder Plan.md](ECHO%20Builder%20Plan.md) | The Version 1 build plan and milestones; a status note at its top says where the product now differs |
| [ECHO-frontend-plan.md](ECHO-frontend-plan.md) | A plan for a "Workflow Development Setup" screen (Next.js). Not built; today's Builder covers part of it differently (Import from Jira using AI, approved APIs) |
