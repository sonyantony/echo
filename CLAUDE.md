# EY ECHO

EY ECHO has two parts: the **Builder** (web drag-and-drop designer for Camel YAML DSL flows,
publishes them to Git and/or S3) and the **Runtime** (each flow exported by Camel JBang to a Spring Boot
app and built into an image by the buyer's pipeline).

- Requirements: `docs/Initial Requirements.md`. Build plan and milestones: `docs/ECHO Builder Plan.md`.
- Decisions: `docs/decisions/` (one short note per significant choice).
- Save As, Save As Template and Open Template (templates in `templates/` next to `flows/`): `docs/decisions/0007-save-as-and-templates.md`.
- The REST service made from the flow's spec (Base Path, 404 for missing operations, no Rest tab): `docs/decisions/0008-rest-from-the-spec.md`.
- Branding (logo, product name, colours) is per install config, `echo.branding`: `docs/branding.md`.
  Themes: colours only in `builder-ui/src/theme/themes.css`; Kaoto and Apicurio map onto its tokens
  (`kaoto-mapping.css`, `apicurio-mapping.css`), never with colour values of their own.
- Publish targets (Git, S3; each with `enabled`) are per install config: `docs/publishing.md`.
- A flow's OpenAPI spec (Openapi Design; one file per flow under its own name, YAML or JSON, edited in the vendored Apicurio editor): `docs/api-spec.md`.
  Request body validation (`camel-openapi-validator`, on with Client Request Validation) and Swagger UI at
  `<Base Path>/docs` (webjar, routes added by `RestFromSpec`): `docs/decisions/0010-validation-and-swagger-ui.md`.
- Downstream APIs flows may call (approved specs per install, `echo.apis`, REST OpenApi steps): `docs/apis.md`.
- Version 1 is a demo prototype: prefer simple over production-hardened, but keep the seams
  (auth, Git provider, CI, secrets, database) swappable. No cloud SDKs, no provider-specific
  Git APIs, no hard-wired CI or IdP.
- Work on the `Version2` branch line; PRs target `Version2`.

## Layout

| Path | What |
|---|---|
| `builder-backend/` | Spring Boot 3.5, Java 21, Maven |
| `builder-ui/` | React 19 + TypeScript, Vite, PatternFly 6, Kaoto 2.13 embedded; pnpm |
| `samples/` | Golden flows used by tests at every level (`flows/orders`) |
| `runtime-template/` | Versions and runtime defaults every flow image is built with |
| `pipeline/` | `build-flow.sh` (export → jar → Jib image; `--mode bundle` (default, all flows in one image, `BundleCheck.java` fails on clashes) or `per-flow`), sample `Jenkinsfile`, smoke test |

## Pinned versions (change together)

| Thing | Version | Where |
|---|---|---|
| Java | 21 | `builder-backend/pom.xml`, CI |
| Node / pnpm | 22 / 10.28 | `builder-ui/package.json`, CI |
| Camel | 4.22.1 | `builder-backend/pom.xml` (`camel.version`), `builder-ui/scripts/copy-camel-catalog.mjs`, `builder-ui/src/editor/kaotoEnvelope.ts`, `runtime-template/versions.properties` (checked by `VersionAlignmentTest`) |
| Kaoto | 2.13.0 (`@kaoto/camel-catalog` 0.10.6) | `builder-ui/package.json` |
| Spring Boot (Builder) | 3.5.16 | `builder-backend/pom.xml` |

## Commands

```bash
# Backend
cd builder-backend && mvn verify            # unit + integration tests
cd builder-backend && mvn spring-boot:run   # http://localhost:8080

# UI (postinstall copies the Camel catalog into public/camel-catalog)
cd builder-ui && pnpm install
pnpm dev          # http://localhost:5173, proxies /api to :8080
pnpm typecheck && pnpm test   # Vitest
pnpm e2e          # Playwright (starts Vite itself)
pnpm build        # production bundle in dist/
ECHO_E2E_BUNDLED=1 pnpm e2e   # against the packaged jar (after pnpm build + mvn -Pwith-ui package)

# Flow images (needs Java, Maven; Docker only for --local-image and the smoke test)
pipeline/build-flow.sh samples/flows --local-image          # bundle (default): echo-flows:1.0.0
pipeline/smoke-test-orders.sh --bundle
pipeline/build-flow.sh samples/flows --mode per-flow --local-image   # echo-flow-<flow>:1.0.0
pipeline/smoke-test-orders.sh

# Builder image (UI + backend in one jar); config/application.yaml is mounted at /config
docker compose up -d --build
```

Camel JBang: use the `camel-launcher` jar (`java -jar camel-launcher-4.22.1.jar ...`) and pass
`--quarkus-version=3.36.0` to `run`/`export`, otherwise it tries to reach registry.quarkus.io.

## Conventions

- Kaoto's catalog is served by the backend (`/api/camel-catalog/**`), cut down to
  `echo.validation.allowed-components` (docs/decisions/0005). To allow another component, add it to
  that list and its jar to `builder-backend/pom.xml` together, or Run cannot start flows using it.
- REST DSL always runs on platform-http: Run and `runtime-template` set it; Validate rejects another
  component, binding or API docs. There is no Rest tab: ECHO adds the flow's REST service from its
  OpenAPI spec whenever the flow leaves the editor (`RestFromSpec`, docs/decisions/0008); the
  checkboxes before Publish set Client Request Validation and Enable CORS in the route's `restConfiguration`.
- Kaoto stays unmodified; Builder code wraps it (`builder-ui/src/editor/`). Kaoto is rendered
  in its own React root because it brings its own router.
- A flow is a folder: `<name>.camel.yaml` plus side files next to it (DataMapper
  `kaoto-datamapper-*.xsl`, `*.schema.json` (`openapi-*.schema.json` are made from the spec and
  follow it, docs/api-spec.md), `.kaoto` metadata, `application.properties`,
  the flow's OpenAPI spec, e.g. `customer-api.yaml`, or `openapi.json` in older flows).
- `builder-ui/public/apicurio-editor/` is Apicurio's prebuilt editor, vendored unmodified; refresh it
  with `builder-ui/scripts/update-apicurio-editor.sh`, don't edit it.
- Every milestone's "done when" check becomes an automated test. Tests run offline: Git is a
  local bare repo, S3 is an in-memory fake (`FakeS3`), downstream HTTP is mocked.
- Run the relevant tests before every commit.
