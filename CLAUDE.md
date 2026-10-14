# ECHO

ECHO has two parts: the **Builder** (web drag-and-drop designer for Camel YAML DSL flows,
publishes them to Git) and the **Runtime** (each flow exported by Camel JBang to a Spring Boot
app and built into an image by the buyer's pipeline).

- Requirements: `docs/Initial Requirements.md`. Build plan and milestones: `docs/ECHO Builder Plan.md`.
- Decisions: `docs/decisions/` (one short note per significant choice).
- Version 1 is a demo prototype: prefer simple over production-hardened, but keep the seams
  (auth, Git provider, CI, secrets, database) swappable. No cloud SDKs, no provider-specific
  Git APIs, no hard-wired CI or IdP.
- Work on the `Version1` branch line; PRs target `Version1`.

## Layout

| Path | What |
|---|---|
| `builder-backend/` | Spring Boot 3.5, Java 21, Maven |
| `builder-ui/` | React 19 + TypeScript, Vite, PatternFly 6, Kaoto 2.13 embedded; pnpm |
| `samples/` | Golden flows used by tests at every level (`flows/orders`) |
| `runtime-template/` | Versions and runtime defaults every flow image is built with |
| `pipeline/` | `build-flow.sh` (export → jar → Jib image), sample `Jenkinsfile`, smoke test |

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
pipeline/build-flow.sh samples/flows/orders --local-image
pipeline/smoke-test-orders.sh

# Builder image (UI + backend in one jar); config/application.yaml is mounted at /config
docker compose up -d --build
```

Camel JBang: use the `camel-launcher` jar (`java -jar camel-launcher-4.22.1.jar ...`) and pass
`--quarkus-version=3.36.0` to `run`/`export`, otherwise it tries to reach registry.quarkus.io.

## Conventions

- Kaoto stays unmodified; Builder code wraps it (`builder-ui/src/editor/`). Kaoto is rendered
  in its own React root because it brings its own router.
- A flow is a folder: `<name>.camel.yaml` plus side files next to it (DataMapper
  `kaoto-datamapper-*.xsl`, `*.schema.json`, `.kaoto` metadata, `application.properties`).
- Every milestone's "done when" check becomes an automated test. Tests run offline: Git is a
  local bare repo, downstream HTTP is mocked.
- Run the relevant tests before every commit.
