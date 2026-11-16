# What EY ECHO does today

A summary of what is built, by area, with the document that has the details. Updated 2026-11-16
(branch `release/1.0.0`). For the list of all documents see [README.md](README.md); for a guided
tour see [demo.md](demo.md).

EY ECHO has two parts. The **Builder** is a web application where flows are designed (Camel YAML
DSL, drawn on an embedded Kaoto canvas) and published. The **Runtime** is each published flow
exported to a Spring Boot app and built into a container image by the buyer's own pipeline. Each
buyer hosts their own install; nothing depends on a particular Git server, CI tool, cloud, login
system or secrets store.

## Builder

### Signing in, starting and finding flows

| What | Details |
|---|---|
| Own login screen; users and bcrypt passwords in `application.yaml` (`echo.security.users`) | [ECHO Builder Plan.md](ECHO%20Builder%20Plan.md) M2 |
| Login lands on a start page: New Flow, Open Flow, Open Flow Template, Upload Flow. Every flow is named before any work on it | [0014](decisions/0014-every-flow-named-first.md) |
| Flow names are free text ("First Flow"); ECHO derives the folder-safe ID (`first-flow`). A name or ID another flow has, in the Builder or published, is refused with an offer to open that flow | [0014](decisions/0014-every-flow-named-first.md) |
| Flows page (Open Flow, and Manage Flows from the File menu): search, Published / Unpublished filters, open (a published flow opens as a draft), download, rename, delete (from the Builder and every publish target), Disable / Enable | [publishing.md](publishing.md), [0011](decisions/0011-disable-flows-and-routes.md) |
| Drafts live in the Builder's H2 database; Save, autosave (`echo.editor.autosave-seconds`, default 10) and Upload write only there | [demo.md](demo.md) |
| Download a flow as a `.zip` or as a picture of the canvas; Upload Flow opens a zip as a new draft and never overwrites | [demo.md](demo.md) |
| Save As (another name) and Save As Template / Open Flow Template (templates in `templates/` next to `flows/`, never built) | [0007](decisions/0007-save-as-and-templates.md) |

### The editor

| What | Details |
|---|---|
| Tab line: File, Interface Specs, Flow, Datamappers, Run, Advanced (Java Beans), About; at the right Publish Flow, Draft / Published, save state and "Flow: <name>" | [demo.md](demo.md) |
| Kaoto embedded unmodified, in its own React root; ECHO adds its controls around it | [0001](decisions/0001-m1-kaoto-datamapper-spike.md) |
| The catalog offers only the allowed components (`echo.validation.allowed-components`) and step forms only the allowed expression languages (`allowed-languages`) | [0005](decisions/0005-catalog-shows-allowed-components.md) |
| Canvas: Routes selector, the selected route outlined, the step toolbar only on the selected step, scroll bars when the flow overflows, Fit Route and Maximize | [demo.md](demo.md) |
| Datamappers tab lists the flow's DataMapper steps by their canvas name, route and step id; click one to open it | [demo.md](demo.md) |
| DataMapper's Attach Schema offers the request and response bodies of the flow's spec, and ECHO warns when a mapping no longer fits the spec | [api-spec.md](api-spec.md#datamapper-schemas-from-the-spec) |
| Routes can be switched off (`autoStartup: false`): they answer 404 and show a "Disabled" badge | [0011](decisions/0011-disable-flows-and-routes.md) |

### Interface Specs (the flow's OpenAPI spec)

| What | Details |
|---|---|
| One OpenAPI spec per flow, edited in the vendored Apicurio editor (visual and Source), YAML or JSON, kept under its own file name. New flows open here | [api-spec.md](api-spec.md) |
| Upload, Copy From Another Flow, Interface Specs from Samples (method, path and sample request / response; add to the spec, replace one method or the whole spec), downloads | [api-spec.md](api-spec.md) |
| Import from Jira using AI: operations and data types from a story's example payloads, with one shared read-only Jira account (`echo.jira`) and an optional AI engine (`echo.ai`, OpenAI protocol) | [0016](decisions/0016-import-specs-from-jira.md), [api-spec.md](api-spec.md#import-from-jira-using-ai) |
| The spec is the flow's REST service: Base Path, a `direct:<operationId>` route per operation, 404 for operations without a route. There is no Rest tab | [0008](decisions/0008-rest-from-the-spec.md) |
| operationIds are made by ECHO from method and path (uploaded specs keep theirs and their comments); path and method renames move the routes | [0013](decisions/0013-operation-ids-from-method-and-path.md) |
| A method added in Interface Specs gets a route at once, as a scaffold: Set Variables, Remove Headers, authorization headers, a parallel multicast with a REST OpenApi call, DataMappers started from the spec's schemas, and the JSON reply. Deleting a method asks only when its route was worked on. Flow > Add Route For Operation does the same on request | [0013](decisions/0013-operation-ids-from-method-and-path.md), [apis.md](apis.md) |
| A path (Base Path + spec path) is in one flow only: checked when typed, uploaded and saved | [0015](decisions/0015-a-path-in-one-flow-only.md) |
| Client Request Validation (requests checked against the spec, 400 when they do not fit) and Enable CORS, checkboxes on the canvas toolbar, both on in new flows | [0010](decisions/0010-validation-and-swagger-ui.md), [api-spec.md](api-spec.md#request-validation) |

### Calling downstream APIs

| What | Details |
|---|---|
| Approved APIs per install (`echo.apis`, spec files in `config/apis/`, allowed tags and operations); `only: true` forbids plain `http` steps | [apis.md](apis.md), [0006](decisions/0006-approved-downstream-apis.md) |
| REST OpenApi step: drop-downs for the approved spec, Tag and Operation Id; the Enrich step has the same | [apis.md](apis.md) |
| This repository's install approves the Blue Planet spec (`config/apis/blueplanet.yaml`), 45 of its 66 operations | [apis.md](apis.md) |

### Validate, Run, Publish

| What | Details |
|---|---|
| Validate loads the flow with Camel and enforces the allowed components, languages, DataMapper files and approved APIs. Problems show as red circles on the steps (Clear, Mark as done) and a "N problems" button for the rest | [0002](decisions/0002-validation-and-publishing.md), [demo.md](demo.md) |
| Run starts the draft inside the Builder on a test port (8081 to 8090) with a panel to send requests and see the log; stops after 30 idle minutes | [0004](decisions/0004-run-flows-in-the-builder.md), [demo.md](demo.md) |
| Run With...: a properties file of test values for the flow's `{{placeholders}}`, kept in memory, never published | [0019](decisions/0019-run-with-a-properties-file.md) |
| Publish Flow validates, then sends the flow to every enabled target: Git (commit as the user) and S3. History lists earlier publishes | [publishing.md](publishing.md), [0003](decisions/0003-pluggable-publish-targets.md) |
| Publish stops on endpoint, Base Path or operationId clashes with other published flows, and warns about operations without a route (Publish Anyway) | [publishing.md](publishing.md), [0013](decisions/0013-operation-ids-from-method-and-path.md) |
| Disable / Enable a published flow: it stays in Git but the pipeline leaves it out of images | [0011](decisions/0011-disable-flows-and-routes.md) |

### Look and install settings

| What | Details |
|---|---|
| Product name "EY ECHO" is fixed; the buyer's logo, favicon and colours are settings (`echo.branding`) | [branding.md](branding.md) |
| Six themes (`navy` default, `slate`, `contrast`, `studio`, `graphite`, `blueprint`), covering Kaoto and the Interface Specs editor; colours only in `themes.css` | [branding.md](branding.md#themes) |
| One Docker image (UI and backend in one jar) with docker-compose; `./config` mounted at `/config` overrides the defaults without a rebuild | `README.md`, `config/application.example.yaml` |

## Runtime and pipeline

| What | Details |
|---|---|
| `pipeline/build-flow.sh`: Camel JBang export to Spring Boot, Maven package, image with Jib (no Docker daemon needed). Sample `Jenkinsfile` | `pipeline/README.md` |
| Build modes: `bundle` (default, all flows in one image, the build stops on clashes) or `per-flow` | [0009](decisions/0009-bundle-flows-in-one-image.md) |
| Swagger UI in every image at `<Base Path>/docs`, and one page for all flows of a bundle at `/api-docs` | [0010](decisions/0010-validation-and-swagger-ui.md), [0012](decisions/0012-combined-api-docs.md) |
| Kubernetes manifests next to each image (`build/<app>/k8s/`): Deployment, Service, and an Ingress or HTTPRoute for only the flows' paths, so other apps on the same host keep theirs | [0017](decisions/0017-kubernetes-manifests-from-the-pipeline.md) |
| The flows' `{{placeholders}}` become a ConfigMap (values per environment from `--env-values`); sensitive names go only into an empty `secret.yaml.example` | [0018](decisions/0018-flow-settings-as-configmap.md) |
| HTTP log of every request and response, in and out, as JSON (ECS) fields with secrets masked; also in the Builder's Run | [http-log.md](http-log.md), [0020](decisions/0020-http-log.md) |
| Prometheus metrics at `/actuator/prometheus`, health probes, OpenTelemetry tracing (off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set), correlation and trace ids on every log line | [observability.md](observability.md), [0021](decisions/0021-metrics-and-tracing.md) |
| Flow secrets stay `{{placeholders}}`, supplied when the container starts; the Runtime never needs Git | `pipeline/README.md` |

## Demo aids in this repository

| What | Where |
|---|---|
| Golden flows used by tests at every level (`orders`, `greetings`) and a mock fulfilment service | `samples/README.md` |
| A mock of a downstream API made from its OpenAPI spec, with a live call log at `/__ui` (run for the Blue Planet spec on port 4020) | `mock-server/` |
| The ECHO presentation and its diagrams | [presentation/README.md](presentation/README.md) |

## Not built

- Publishing through a branch and pull request with approval, and choosing the target repository
  (Version 2 requirements in [Initial Requirements.md](Initial%20Requirements.md)).
- SSO or an external identity provider, an external secrets store, PostgreSQL. The seams for them
  are kept ([ECHO Builder Plan.md](ECHO%20Builder%20Plan.md), section 7).
- Protocols other than HTTP and formats other than JSON.
- Response validation, Validate listing operations without a route, an invalid spec stopping
  Publish, and AI engines other than the OpenAI protocol ([api-spec.md](api-spec.md#not-built-yet)).
- The "Workflow Development Setup" screen of [ECHO-frontend-plan.md](ECHO-frontend-plan.md).
