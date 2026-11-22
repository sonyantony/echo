# EY ECHO: full rebuild specification

This document describes EY ECHO as it is on branch `release/1.0.0` (November 2026) in enough detail
to build the same application again without the source. It is written from the code; where a
behaviour is described, the class or file that implements it is named so the description can be
checked. The shorter guides in this folder (`features.md`, `demo.md`, `api-spec.md`, `apis.md`,
`publishing.md`, `branding.md`, `http-log.md`, `observability.md`, `decisions/`) explain the same
things for users and say why each choice was made.

Contents:

1. What EY ECHO is
2. Technology stack and exact versions
3. Repository file tree
4. Configuration
5. Database
6. Builder backend: security and sessions
7. Builder backend: flows, files, names, zip archives
8. The flow's OpenAPI spec on the backend
9. Publishing
10. Validation
11. Run (test runs inside the Builder)
12. Camel catalog, editor settings, approved APIs, branding endpoints
13. Import from Jira using AI (backend)
14. Backend HTTP API reference
15. Builder UI: project setup and structure
16. Builder UI: screens outside the editor
17. Builder UI: the flow editor
18. Builder UI: Interface Specs (the flow's OpenAPI spec)
19. Builder UI: DataMapper support
20. Themes and styling
21. Runtime template (runtime-template/)
22. Pipeline (pipeline/)
23. Samples, mock server, presentation
24. Builder image, docker-compose, CI
25. Tests
26. Edge cases and rules worth remembering
- Appendix A: file formats ECHO writes
- Appendix B: user-visible texts
- Appendix C: build order for a rebuild

---

## 1. What EY ECHO is

EY ECHO has two parts.

- **Builder**: a single-page web application (React) served by a Spring Boot backend, packaged as
  one jar and one Docker image. Users sign in, create **flows** (integration flows in Apache Camel
  YAML DSL), design each flow's REST interface as an OpenAPI spec, draw the routes on an embedded
  Kaoto canvas, validate them, run them inside the Builder on a test port, and publish them to Git
  and/or S3.
- **Runtime**: not a server of its own. The buyer's CI pipeline takes the published flow folders,
  exports them with Camel JBang to a Camel Spring Boot application, packages it with Maven and
  builds a container image with Jib. `pipeline/build-flow.sh` is the reference implementation, and
  it also writes Kubernetes manifests next to each image.

Constraints that shape everything:

- Version 1 is a demo prototype for about ten concurrent users on a single instance: prefer simple
  over production-hardened.
- Each buyer self-hosts a single-tenant install with its own Git server, CI, registry, identity
  and secrets. Nothing may depend on a particular cloud SDK, Git provider API, CI system or
  identity provider. The seams (authentication, publish target, database, AI engine) are kept as
  small replaceable classes.
- Messaging scope: HTTP and JSON only. Allowed Camel components are a short list
  (`platform-http, http, https, xslt-saxon, log, direct, rest-openapi`).
- The product name "EY ECHO" is fixed; only the buyer's logo, favicon and colours are settings.
- Kaoto (flow canvas) and Apicurio (OpenAPI editor) are embedded unmodified; ECHO wraps them and
  drives or restyles them from outside.
- Secrets never go to Git. Flow secrets are Camel `{{placeholders}}` supplied when the container
  starts.

Vocabulary used below:

| Term | Meaning |
|---|---|
| Flow | A folder of text files: `<id>.camel.yaml` (the route file) plus side files |
| Flow ID / name | Folder-safe identifier (`first-flow`); column `flow.name` |
| Display name | What users type and see (`First Flow`); column `flow.display_name` |
| Draft | The flow as stored in the Builder's H2 database |
| Published flow | The flow folder in the publish target (`flows/<id>/` in Git) |
| Spec | The flow's own OpenAPI document (one per flow, a side file) |
| Base Path | The path part of the spec's (last) server URL |
| Approved API | A downstream API spec listed in `echo.apis.specs` |
| Scaffold | The route ECHO makes for a spec operation |

---

## 2. Technology stack and exact versions

### 2.1 Builder backend (`builder-backend/pom.xml`)

| Thing | Version |
|---|---|
| Java | 21 |
| Build | Maven; parent `org.springframework.boot:spring-boot-starter-parent:3.5.16` |
| Artifact | `com.ey.echo:echo-builder-backend:0.1.0-SNAPSHOT`, name "EY ECHO Builder backend" |
| Apache Camel | 4.22.1 (`camel-bom` imported in `dependencyManagement`) |
| JGit | `org.eclipse.jgit:org.eclipse.jgit:7.8.0.202609011348-r` |
| Swagger UI webjar | `org.webjars:swagger-ui:5.33.1` |
| swagger-parser | `io.swagger.parser.v3:swagger-parser:2.1.45`, excluding `io.swagger.core.v3:swagger-models` (Camel brings `swagger-models-jakarta`) |
| Database | H2 (runtime scope), file mode; Flyway (`flyway-core`); Spring Data JPA / Hibernate with `ddl-auto: validate` |

Dependencies, all versions managed by the Spring Boot parent or the Camel BOM unless given above:

- Spring Boot starters: `web`, `actuator`, `validation`, `security`, `data-jpa`; test: `spring-boot-starter-test`, `spring-security-test`.
- `org.flywaydb:flyway-core`, `com.h2database:h2` (runtime).
- Camel (no Spring Boot starters; the Builder creates plain `DefaultCamelContext`s itself):
  `camel-core-engine`, `camel-core-languages`, `camel-yaml-dsl`, `camel-platform-http-vertx`,
  `camel-http`, `camel-xslt-saxon`, `camel-log`, `camel-direct`, `camel-rest-openapi`,
  `camel-openapi-validator`.
- `org.webjars:swagger-ui`, `io.swagger.parser.v3:swagger-parser`, `org.eclipse.jgit`.

Build plugins:

- `spring-boot-maven-plugin`.
- `build-helper-maven-plugin`, execution `runtime-sources` in `generate-sources`, goal `add-source`
  with source `${project.basedir}/../runtime-template/java`. The HTTP log class of the flow images
  is therefore compiled into the Builder too.
- `maven-compiler-plugin` excludes `com/ey/echo/runtime/HttpExchangeLogConfiguration.java` and
  `com/ey/echo/runtime/ObservabilityConfiguration.java` (they need camel-spring-boot and
  OpenTelemetry, which only flow images have).
- Profile `with-ui`: `maven-resources-plugin` execution `copy-ui` in `process-resources` copies
  `../builder-ui/dist` to `${project.build.outputDirectory}/static`, so the jar serves the UI.

### 2.2 Builder UI (`builder-ui/package.json`)

See section 15.1 for the full dependency list with versions. Headlines: Node 22, pnpm 10.28,
React 19, TypeScript, Vite, PatternFly 6, Kaoto 2.13.0 with `@kaoto/camel-catalog` 0.10.6,
Vitest, Playwright 1.56.1. Apicurio's prebuilt OpenAPI editor is vendored as static files under
`builder-ui/public/apicurio-editor/`.

### 2.3 Flow images (`runtime-template/versions.properties`)

`camel.version=4.22.1`, `quarkus.version=3.36.0` (passed to Camel JBang only so that it does not call
`registry.quarkus.io`; any value works for Spring Boot exports), `swagger-ui.version=5.33.1`,
`jib.version=3.5.2`, `base.image=eclipse-temurin:21-jre`. Camel JBang is used as the launcher jar
`camel-launcher-4.22.1.jar` from Maven Central. Spring Boot and all other library versions of a flow image
come from the Camel Spring Boot BOM of that Camel version, through `camel export`. See sections 21 and 22.

### 2.4 Versions that must change together

| Thing | Version | Where |
|---|---|---|
| Java | 21 | `builder-backend/pom.xml`, CI, Dockerfile, `runtime-template/versions.properties` |
| Node / pnpm | 22 / 10.28 | `builder-ui/package.json`, CI, Dockerfile |
| Camel | 4.22.1 | `builder-backend/pom.xml` (`camel.version`), `builder-ui/scripts/copy-camel-catalog.mjs`, `builder-ui/src/editor/kaotoEnvelope.ts`, `runtime-template/versions.properties` |
| Swagger UI | 5.33.1 | `builder-backend/pom.xml`, `runtime-template/versions.properties` |
| Kaoto | 2.13.0 (`@kaoto/camel-catalog` 0.10.6) | `builder-ui/package.json` |
| Spring Boot (Builder) | 3.5.16 | `builder-backend/pom.xml` |

`VersionAlignmentTest` (backend) fails the build when the Camel or Swagger UI versions in the pom,
the UI script and the runtime template differ.

---

## 3. Repository file tree

Every tracked file, grouped. Test classes are listed in section 25, the e2e specs there too. Files
ignored by Git: `config/application.yaml`, `config/branding/`, `.env`, `builder-backend/target/`,
`builder-backend/data/`, `builder-ui/node_modules/`, `builder-ui/dist/`,
`builder-ui/public/camel-catalog/` (copied by postinstall), `build/` (pipeline output).

```
.
├── CLAUDE.md                      notes for coding agents: layout, pinned versions, commands, conventions
├── README.md
├── Dockerfile                     Builder image: UI build, backend build with the UI inside, JRE image (section 24)
├── docker-compose.yml             service echo-builder, ./config mounted at /config, volume for H2
├── .dockerignore  .gitignore
├── .github/workflows/ci.yml       jobs backend, ui, pipeline (bundle, per-flow), image (section 24.3)
│
├── builder-backend/
│   ├── pom.xml                    Spring Boot 3.5.16 parent, camel.version 4.22.1, profile with-ui (section 2.2)
│   └── src/
│       ├── main/java/com/ey/echo/builder/
│       │   ├── BuilderApplication.java        @SpringBootApplication, @ConfigurationPropertiesScan
│       │   ├── ClockConfig.java               the Clock bean (tests replace it)
│       │   ├── ai/          AiConfig, AiException, AiProperties, AiProvider, OpenAiCompatibleProvider
│       │   ├── apis/        ApiCatalog, ApiProperties
│       │   ├── branding/    BrandingController, BrandingProperties, BrandingWebConfig
│       │   ├── editor/      CamelCatalogController, CatalogProperties, EditorProperties, EditorSettingsController
│       │   ├── flow/        ApiPaths, ApiSpecFiles, Flow, FlowArchive, FlowController, FlowDtos, FlowExceptions,
│       │   │                FlowFile, FlowNames, FlowRepository, FlowService, FlowStatus, FlowTemplates,
│       │   │                OperationIds, PublishedNames, RestFromSpec
│       │   ├── jira/        AiExampleLabeler, ExampleFinder, JiraClient, JiraController, JiraException,
│       │   │                JiraProperties, Story, StoryExamples, StoryKeys, StoryText
│       │   ├── publish/     EndpointClashes, FlowPublisher, GitProperties, JGitPublisher, PublishConfig,
│       │   │                PublishController, PublishEvent, PublishEventRepository, PublishException,
│       │   │                PublishExceptionHandler, PublishService, PublishTargetController, PublishTargets,
│       │   │                PublishedFlowController, PublishedFlowNames, PublishedFlowService, S3Client,
│       │   │                S3Properties, S3Publisher, TargetOutcome, TemplateController, TemplateService
│       │   ├── run/         EmptyExpressions, FlowRun, FlowRunner, RunController, RunException, RunProperties,
│       │   │                RunValues
│       │   ├── security/    AuthController, AuthenticationConfig, EchoSecurityProperties, SecurityConfig
│       │   ├── validation/  FlowValidator, ValidationController, ValidationProperties, ValidationResult
│       │   └── web/         SpaForwardController
│       ├── main/resources/
│       │   ├── application.yaml               the defaults of every echo.* key (section 4)
│       │   ├── branding/logo.svg, favicon.svg the built-in logo and icon
│       │   └── db/migration/                  V1__flows.sql, V2__publish_events.sql, V3__publish_targets.sql,
│       │                                      V4__flow_display_name.sql (section 5)
│       └── test/
│           ├── java/com/ey/echo/builder/...   section 25.1
│           └── resources/
│               ├── apis/inventory.yaml, orders-swagger2.json
│               ├── config/application.yaml    the test profile's settings
│               ├── flows/                     bad-expression, disallowed-component, disallowed-language,
│               │                              malformed, missing-mapping, unknown-step (.camel.yaml each)
│               ├── static/index.html          stands in for the UI in backend tests
│               └── test-camel-catalog/        index.json + camel-springboot/4.22.1/ (boundaries-1, components-1,
│                                              entities-1, index-abc, kamelets-1, languages-1, models-1,
│                                              patterns-1 .json): a tiny catalog for CamelCatalogController tests
│
├── builder-ui/
│   ├── package.json  pnpm-lock.yaml  .gitignore
│   ├── index.html  vite.config.ts  tsconfig.json  playwright.config.ts
│   ├── scripts/
│   │   ├── copy-camel-catalog.mjs             postinstall: @kaoto/camel-catalog into public/camel-catalog
│   │   └── update-apicurio-editor.sh          refreshes public/apicurio-editor from Apicurio's release
│   ├── public/apicurio-editor/                Apicurio's prebuilt editor, 48 files, vendored unmodified
│   ├── e2e/                                   Playwright specs, helpers.ts, fake-jira.mjs (section 25.3)
│   └── src/
│       ├── main.tsx  App.tsx
│       ├── api/         client.ts, flows.ts, jira.ts
│       ├── auth/        AuthContext.tsx, LoginPage.tsx/.css, RequireAuth.tsx
│       ├── branding/    BrandingContext.tsx, BrandLogo.tsx/.css, applyBranding.ts
│       ├── layout/      AppLayout.tsx/.css
│       ├── flows/       StartPage.tsx/.css, FlowListPage.tsx, FlowEditorPage.tsx/.css, FlowFormModal.tsx,
│       │                FlowNameHint.tsx, NameTakenAlert.tsx, OpenTemplateModal.tsx, UploadFlowModal.tsx,
│       │                SaveAsModal.tsx, PublishModal.tsx, publishSummary.ts, HistoryModal.tsx,
│       │                RunPanel.tsx/.css, RunWithModal.tsx/.css, ValidationPanel.tsx,
│       │                AddOperationRouteModal.tsx, useOperationRoutes.tsx, useAutosave.ts, downloads.tsx
│       ├── editor/      KaotoEditorHost.tsx/.css, kaotoEnvelope.ts, kaotoInternals.ts, flowFiles.ts,
│       │                apiFlowFiles.ts, KaotoTabMenu.tsx, AdvancedMenu.tsx, menuDismiss.ts, restSettings.ts,
│       │                CanvasViewButtons.tsx, canvasZoom.ts, canvasScrollbars.ts, diagramImage.ts,
│       │                selectedRoute.ts, disabledRoutes.ts, tabUnderline.ts, stepProblems.ts,
│       │                StepProblemBadges.tsx, operationTags.ts, OperationTagFilter.tsx, enrichApi.ts,
│       │                EnrichApiPicker.tsx, dataMapperList.ts, EchoAboutPage.tsx, EchoDataMappersPage.tsx,
│       │                EchoDataMapperPage.tsx
│       ├── apispec/     ApiSpecPanel.tsx/.css, ApicurioEditorHost.tsx, ApiSpecMenu.tsx, apiSpec.ts,
│       │                apicurioTheme.ts, basePath.ts, operationIds.ts, operationIdFiller.ts, overviewNav.ts,
│       │                sectionLabels.ts, sourceToolbar.ts, sampleExampleFiller.ts, specFromSamples.ts,
│       │                SamplesSpecModal.tsx, JiraImportModal.tsx, jiraImport.ts, CopySpecModal.tsx,
│       │                SpecNameModal.tsx, SparkleIcon.tsx
│       ├── datamapper/  specSchemas.ts, specMappings.ts, mappingCheck.ts, useSpecMappingReview.ts,
│       │                scaffoldSchemas.ts, callSchemas.ts, SpecSchemaPickerModal.tsx/.css,
│       │                SpecMappingWarnings.tsx, ordersSpec.fixture.ts
│       ├── theme/       themes.css, kaoto-mapping.css, apicurio-mapping.css, echo.css
│       ├── playground/  Playground.tsx        bare Kaoto on /playground, used by the embedding e2e test
│       └── test/        setup.ts, fetchMock.ts
│       (unit tests sit next to their subject as <name>.test.ts(x), section 25.2)
│
├── config/
│   ├── .gitignore                             ignores application.yaml and branding/
│   ├── application.example.yaml               copy to application.yaml
│   └── apis/        approved-apis.yaml, blueplanet.yaml, blueplanet.original.yaml
│
├── runtime-template/
│   ├── README.md  versions.properties  application.properties
│   └── java/com/ey/echo/runtime/              HttpExchangeLog, HttpExchangeLogConfiguration,
│                                              ObservabilityConfiguration (section 21)
│
├── pipeline/        build-flow.sh, BundleCheck.java, ApiDocsPage.java, K8sManifests.java, k8s.properties,
│                    Jenkinsfile, smoke-test-orders.sh, README.md (section 22)
│
├── samples/
│   ├── README.md
│   ├── flows/orders/      orders.camel.yaml, .kaoto, application.properties, kaoto-datamapper-order-request.xsl,
│   │                      kaoto-datamapper-order-response.xsl, order-request.schema.json,
│   │                      order-response.schema.json, fulfilment-request.schema.json,
│   │                      fulfilment-response.schema.json, sample-request.json
│   ├── flows/greetings/   greetings.camel.yaml, greetings-api.yaml
│   └── mock-downstream/fulfilment-mock.camel.yaml
│
├── mock-server/     mock-server.js, BPI-api-docs-latest.yaml, BPI-api-docs-latest-modified.yaml, run.bat,
│                    runAsJar.properties, runAsContainer.properties, samplerequests.txt, README.md
│
└── docs/
    ├── README.md (index), features.md, demo.md, api-spec.md, apis.md, branding.md, publishing.md, http-log.md,
    │   observability.md, Initial Requirements.md, ECHO Builder Plan.md, PROJECT_ECHO_SPEC.md (this file)
    ├── decisions/   0001-m1-kaoto-datamapper-spike, 0002-validation-and-publishing,
    │                0003-pluggable-publish-targets, 0004-run-flows-in-the-builder,
    │                0005-catalog-shows-allowed-components, 0006-approved-downstream-apis,
    │                0007-save-as-and-templates, 0008-rest-from-the-spec, 0009-bundle-flows-in-one-image,
    │                0010-validation-and-swagger-ui, 0011-disable-flows-and-routes, 0012-combined-api-docs,
    │                0013-operation-ids-from-method-and-path, 0014-every-flow-named-first,
    │                0015-a-path-in-one-flow-only, 0016-import-specs-from-jira,
    │                0017-kubernetes-manifests-from-the-pipeline, 0018-flow-settings-as-configmap,
    │                0019-run-with-a-properties-file, 0020-http-log, 0021-metrics-and-tracing (.md each)
    └── presentation/  ECHO-Presentation-v2.html/.pdf, README.md, build-html.js, render-pdf.js,
                       deck/ (deck.json, images.json, images/, slides/*.html), diagrams/ (svg, png, the
                       two .py and render.js that draw them)
```

The published Git repository (not this one) has its own layout: `flows/<flow id>/` and
`templates/<template id>/`, each a flat folder of the flow's files plus `echo-flow.json` or
`echo-template.json` (section 9, Appendix A).

---

## 4. Configuration

Spring Boot configuration. The defaults are in
`builder-backend/src/main/resources/application.yaml`. The Docker image starts with
`--spring.config.additional-location=optional:file:/config/`, so `/config/application.yaml`
(mounted from `./config`, git-ignored) overrides them without a rebuild. Every key can also be set
as an environment variable through Spring's relaxed binding (`ECHO_EDITOR_AUTOSAVESECONDS`).
`@ConfigurationPropertiesScan` on the application class binds the records below.

### 4.1 Spring and server settings (fixed defaults)

```yaml
spring:
  application.name: echo-builder
  datasource:
    url: jdbc:h2:file:${echo.data-dir}/h2/echo;AUTO_SERVER=FALSE
    username: sa
    password: ""
  jpa:
    open-in-view: false
    hibernate.ddl-auto: validate
  mvc.problemdetails.enabled: true      # errors are RFC 9457 problem details
  servlet.multipart:
    max-file-size: 5MB
    max-request-size: 5MB
server.servlet.session:
  timeout: 8h
  cookie.same-site: lax
management.endpoints.web.exposure.include: health,info
```

### 4.2 `echo.*` keys

| Key | Default | Bound to | Meaning |
|---|---|---|---|
| `echo.data-dir` | `./data` (image: env `ECHO_DATA_DIR=/data`) | `@Value` | Folder for the H2 database (`<data-dir>/h2/echo`) and the Git working copy (`<data-dir>/git`) |
| `echo.security.users[]` | one user `designer` / `designer` | `EchoSecurityProperties` | `username`, `password` (Spring encoded form, e.g. `{bcrypt}$2a$10$...`), `roles` (default `[DESIGNER]`) |
| `echo.git.enabled` | `${ECHO_GIT_ENABLED:true}` | `GitProperties` | Switch; the target is active only when enabled and `url` is not blank |
| `echo.git.url` | `${ECHO_GIT_URL:}` | | Repository URL (HTTPS, or `file://` in tests) |
| `echo.git.branch` | `${ECHO_GIT_BRANCH:main}` | | Branch committed to directly |
| `echo.git.username` / `token` | `${ECHO_GIT_USERNAME:}` / `${ECHO_GIT_TOKEN:}` | | HTTPS credentials |
| `echo.git.committer-name` / `committer-email` | `EY ECHO Builder` / `echo-builder@example.com` (record fallback `echo-builder@localhost`) | | Committer identity; the author is the Builder user |
| `echo.git.workdir` | `<data-dir>/git` | | Local working copy |
| `echo.git.flows-folder` | `flows` | | Folder in the repository with one sub-folder per flow; templates go to the sibling `templates` |
| `echo.s3.enabled` | `${ECHO_S3_ENABLED:false}` | `S3Properties` | Active only when enabled and `bucket` not blank |
| `echo.s3.bucket` | `${ECHO_S3_BUCKET:}` | | |
| `echo.s3.prefix` | `flows` | | Leading and trailing slashes stripped |
| `echo.s3.region` | `${ECHO_S3_REGION:us-east-1}` | | Signing region |
| `echo.s3.endpoint` | `${ECHO_S3_ENDPOINT:}` | | S3-compatible store; trailing slashes stripped; path-style addressing when set |
| `echo.s3.access-key` / `secret-key` | `${ECHO_S3_ACCESS_KEY:${AWS_ACCESS_KEY_ID:}}` / `${ECHO_S3_SECRET_KEY:${AWS_SECRET_ACCESS_KEY:}}` | | |
| `echo.s3.session-token` | `${AWS_SESSION_TOKEN:}` | | Optional |
| `echo.branding.logo` | `/branding/logo.svg` | `BrandingProperties` | URL the browser loads |
| `echo.branding.logo-alt` | `Company logo` | | |
| `echo.branding.favicon` | `/branding/favicon.svg` | | Falls back to the logo |
| `echo.branding.asset-dir` | `${ECHO_BRANDING_DIR:./config/branding}` (image: `/config/branding`) | | Files served at `/branding/<file>`, before the built-in ones |
| `echo.branding.theme` | `navy` | | `navy`, `slate`, `contrast`, `studio`, `graphite`, `blueprint` |
| `echo.branding.colors.*` | `primary: "#FFE600"`, `primary-hover: "#E6CF00"`, `on-primary: "#2E2E38"`, `accent-text: "#2E2E38"`; `masthead-background`, `masthead-text` unset | | CSS colours; an unset one keeps the theme's |
| `echo.catalog.hidden-processors` | `[circuitBreaker, onFallback, saga, marshal, unmarshal, transacted, policy, script, tokenizer, a2aSubTask, pausable, resumable]` | `CatalogProperties` | Processors removed from the catalog served to Kaoto |
| `echo.editor.autosave-seconds` | `10` | `EditorProperties` | 0 turns autosave off |
| `echo.run.enabled` | `true` | `RunProperties` | |
| `echo.run.first-port` / `last-port` | `8081` / `8090` | | One port per running flow |
| `echo.run.idle-minutes` | `30` | | Idle runs are stopped |
| `echo.run.public-url` | `http://localhost` | | Host shown in the Run panel, without the port |
| `echo.http-log.enabled` / `bodies` / `max-body` | `true` / `true` / `8192` (commented out) | read by Run | Defaults for the HTTP log of test runs; the flow's own values win |
| `echo.apis.only` | `false` | `ApiProperties` | `true` forbids plain `http`/`https` steps |
| `echo.apis.specs[]` | `[]` | | `id` (lower case), `name`, `file`, `allowed-tags[]`, `allowed-operations[]` |
| `echo.jira.base-url` | `${ECHO_JIRA_URL:}` | `JiraProperties` | Only links on this site are read |
| `echo.jira.deployment` | `cloud` | | `cloud` or `data-center` |
| `echo.jira.username` / `token` | `${ECHO_JIRA_USERNAME:}` / `${ECHO_JIRA_TOKEN:}` | | |
| `echo.jira.read-comments` | `true` | | |
| `echo.ai.provider` | `${ECHO_AI_PROVIDER:none}` | `AiProperties` | `none` or `openai-compatible` |
| `echo.ai.timeout-seconds` | `60` | | |
| `echo.ai.openai-compatible.base-url` / `api-key` / `key-header` / `model` / `api-version` | `${ECHO_AI_BASE_URL:}` / `${ECHO_AI_KEY:}` / `Authorization` / `${ECHO_AI_MODEL:}` / empty | | |
| `echo.validation.allowed-components` | `[platform-http, http, https, xslt-saxon, log, direct, rest-openapi]` | `ValidationProperties` | Also what the catalog shows |
| `echo.validation.allowed-languages` | `[simple, constant, header, exchangeProperty, variable]` | | |

The default user's password hash is
`{bcrypt}$2a$10$CpoTFsLB8DIRLsxvK3yozekVXxg0.BnR9vwzVMUqXpTlmUPvf8/.a` ("designer").

### 4.3 Files under `config/`

- `config/application.example.yaml`: a commented copy of the keys a buyer usually sets (users,
  git, s3, apis, jira, ai, editor, branding). Users copy it to `config/application.yaml`.
- `config/.gitignore`: one line, `application.yaml`.
- `config/apis/approved-apis.yaml`: the `echo.apis` block of this install, kept in Git:
  `only: false`, one spec `id: blueplanet`, `name: Blue Planet`,
  `file: /config/apis/blueplanet.yaml`, `allowed-tags`: `TMF638 Service Controller`,
  `TMF639 Resource Typed Controller`, `TMF634 Resource Catalog Controller`,
  `Lumen Custom Numbers API Controller`, `Lumen Device Template API Controller`,
  `Lumen Name Generation API Controller`. docker-compose loads it with
  `SPRING_CONFIG_IMPORT=optional:file:/config/apis/approved-apis.yaml`, so it wins over
  `application.yaml`.
- `config/apis/blueplanet.yaml` (the approved spec, 66 operations of which 45 are allowed, with
  `getResource`/`getResources` typed as `InventoryResource`) and `blueplanet.original.yaml` (the
  vendor's file as received). These are data of this install, not part of the product.

---

## 5. Database

H2 in file mode at `<data-dir>/h2/echo`, schema managed by Flyway
(`src/main/resources/db/migration`), entities validated by Hibernate. Four migrations:

```sql
-- V1__flows.sql
CREATE TABLE flow (
    id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name         VARCHAR(63)   NOT NULL,
    description  VARCHAR(1000),
    status       VARCHAR(20)   NOT NULL,
    created_by   VARCHAR(100)  NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_by   VARCHAR(100)  NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    version      BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uk_flow_name UNIQUE (name)
);
CREATE TABLE flow_file (
    id       BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    flow_id  BIGINT        NOT NULL,
    path     VARCHAR(200)  NOT NULL,
    content  CLOB          NOT NULL,
    CONSTRAINT fk_flow_file_flow FOREIGN KEY (flow_id) REFERENCES flow (id) ON DELETE CASCADE,
    CONSTRAINT uk_flow_file_path UNIQUE (flow_id, path)
);

-- V2__publish_events.sql
CREATE TABLE publish_event (
    id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    flow_id       BIGINT        NOT NULL,
    flow_name     VARCHAR(63)   NOT NULL,
    commit_sha    VARCHAR(64)   NOT NULL,
    branch        VARCHAR(200)  NOT NULL,
    published_by  VARCHAR(100)  NOT NULL,
    published_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    message       VARCHAR(1000) NOT NULL,
    CONSTRAINT fk_publish_event_flow FOREIGN KEY (flow_id) REFERENCES flow (id) ON DELETE CASCADE
);
CREATE INDEX ix_publish_event_flow ON publish_event (flow_id, published_at);

-- V3__publish_targets.sql
CREATE TABLE publish_target (
    publish_event_id  BIGINT        NOT NULL,
    target_index      INT           NOT NULL,
    target            VARCHAR(20)   NOT NULL,
    location          VARCHAR(500)  NOT NULL,
    revision          VARCHAR(200),
    changed           BOOLEAN       NOT NULL,
    error             VARCHAR(1000),
    PRIMARY KEY (publish_event_id, target_index),
    CONSTRAINT fk_publish_target_event FOREIGN KEY (publish_event_id) REFERENCES publish_event (id) ON DELETE CASCADE
);
INSERT INTO publish_target (publish_event_id, target_index, target, location, revision, changed, error)
SELECT id, 0, 'git', branch, commit_sha, TRUE, NULL FROM publish_event;
ALTER TABLE publish_event DROP COLUMN commit_sha;
ALTER TABLE publish_event DROP COLUMN branch;

-- V4__flow_display_name.sql
ALTER TABLE flow ADD COLUMN display_name VARCHAR(100);
```

Final shape:

| Table | Columns |
|---|---|
| `flow` | `id`, `name` (unique, the ID), `display_name` (nullable: old flows show their ID), `description`, `status` (`DRAFT` or `PUBLISHED`), `created_by`, `created_at`, `updated_by`, `updated_at`, `version` (optimistic lock) |
| `flow_file` | `id`, `flow_id` (FK, cascade), `path` (unique per flow, max 200), `content` (CLOB) |
| `publish_event` | `id`, `flow_id` (FK, cascade), `flow_name` (the folder published to), `published_by`, `published_at`, `message` |
| `publish_target` | `publish_event_id` + `target_index` (PK), `target` (`git`/`s3`), `location`, `revision`, `changed`, `error` |

JPA mapping:

- `Flow` (`@Entity`): `@Id @GeneratedValue(IDENTITY) Long id`; `name` (`nullable=false, unique`);
  `displayName` (`@Column(name="display_name")`); `description`; `@Enumerated(STRING) FlowStatus status = DRAFT`;
  `createdBy`, `createdAt` (`Instant`), `updatedBy`, `updatedAt`; `@Version long version`;
  `@OneToMany(mappedBy="flow", cascade=ALL, orphanRemoval=true) @OrderBy("path") List<FlowFile> files`.
  `touch(user, now)` sets `updatedBy`, `updatedAt` and status `DRAFT`. `getDisplayName()` returns
  the ID when the display name is null or blank. `putFile` updates a row in place when the path
  exists; `removeFile` removes by path.
- `FlowFile` (`@Entity`): `id`, `@ManyToOne(fetch=LAZY, optional=false) @JoinColumn(name="flow_id") flow`, `path`, `@Lob content`.
- `PublishEvent` (`@Entity`): `id`, `flowId`, `flowName`, `publishedBy`, `publishedAt`, `message`,
  `@ElementCollection(fetch=EAGER) @CollectionTable(name="publish_target", joinColumns=@JoinColumn(name="publish_event_id")) @OrderColumn(name="target_index") List<TargetOutcome> targets`.
- `TargetOutcome` (`@Embeddable` record): `target`, `location`, `revision`, `changed`, `error`
  (cut to 1000 characters); `ok()` is `error == null`.
- Repositories: `FlowRepository` (`existsByNameIgnoreCase`, `findAllByOrderByNameAsc`,
  `findByNameIgnoreCase`), `PublishEventRepository`
  (`findByFlowIdOrderByPublishedAtDescIdDesc`, `findFirstByFlowIdOrderByPublishedAtDescIdDesc`,
  `countByFlowId`).
- A `Clock` bean (`Clock.systemUTC()`) is injected wherever "now" is needed, so tests fix time.

What is **not** in the database: published flows (they are read from the publish target each
time), templates, Run values (memory only), Jira or AI results, user accounts (configuration).

---

## 6. Builder backend: security and sessions

Package `com.ey.echo.builder.security`.

- `AuthenticationConfig` is the one seam for a future identity provider. It defines a delegating
  `PasswordEncoder` (`PasswordEncoderFactories.createDelegatingPasswordEncoder()`), an
  `InMemoryUserDetailsManager` built from `echo.security.users` (roles become `ROLE_<role>`), and
  an `AuthenticationManager` (`ProviderManager` over a `DaoAuthenticationProvider`).
- `SecurityConfig`: session-based, `HttpSessionSecurityContextRepository`.
  - Permit all: `/api/auth/login`, `/api/auth/csrf`, `/api/branding`, `/api/camel-catalog/**`,
    `/actuator/health`, `/actuator/health/**`, `/actuator/info`.
  - Authenticated: every other `/api/**` and `/actuator/**`.
  - Permit all: everything else (the UI bundle and static files).
  - `X-Frame-Options: SAMEORIGIN` (Apicurio runs in a same-origin frame).
  - CSRF: `CookieCsrfTokenRepository.withHttpOnlyFalse()` with the plain
    `CsrfTokenRequestAttributeHandler` (cookie `XSRF-TOKEN`, header `X-XSRF-TOKEN`, no BREACH
    masking because the UI echoes the raw cookie).
  - Unauthenticated API calls answer **401** (`HttpStatusEntryPoint`), never a redirect.
  - Logout: `POST /api/auth/logout` answers **204**.
  - Form login and HTTP Basic are disabled.
- `AuthController` (`/api/auth`):
  - `GET /csrf` loads the deferred token (which writes the cookie) and answers 204.
  - `POST /login` with `{username, password}` (both `@NotBlank`): authenticates, changes the
    session id if a session exists (session fixation), stores the security context, answers
    `{username, roles}` (roles without the `ROLE_` prefix); bad credentials answer 401 with no body.
  - `GET /me` answers the same record for the current user (401 when logged out).
- There is no authorisation beyond "logged in": every user may do everything. The role is carried
  for later use.
- `SpaForwardController` forwards `/`, `/login`, `/flows`, `/flows/{id}`, `/flows/{id}/api` and
  `/playground` to `/index.html`, so a browser refresh on a UI route works. It must list the same
  routes as the UI's router.

---

## 7. Builder backend: flows, files, names, zip archives

Package `com.ey.echo.builder.flow`.

### 7.1 Names and paths (`FlowNames`)

- ID pattern: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at most 63 characters.
- Display name: not blank, at most 100 characters after stripping, no ISO control characters.
- `idFor(displayName)`: NFD-normalise, remove combining marks, lower-case, replace every run of
  characters other than `a-z0-9` with one dash, trim dashes at both ends. Empty gives `flow`. A
  result that does not start with a letter gets the prefix `flow-`. Longer than 63 is cut at 63 and
  trailing dashes removed. Examples: `First Flow` is `first-flow`, `Café Orders!` is
  `cafe-orders`, `2nd try` is `flow-2nd-try`.
- File path inside a flow: at most 200 characters, segments separated by `/`, each segment matches
  `^[A-Za-z0-9_.-]+$` and is not empty, `.` or `..`.
- Route file name: `<id>.camel.yaml`.

### 7.2 A new flow (`FlowService.create`, `FlowTemplates`)

A new flow has two files:

```yaml
# <id>.camel.yaml
- restConfiguration:
    clientRequestValidation: true
    enableCORS: true
```

```properties
# application.properties
# Non-secret settings for the <id> flow (ports, downstream URLs).
```

There are no routes: routes come from the spec's operations (section 18) or are drawn by hand.
Status starts as `DRAFT`.

### 7.3 Name uniqueness (`FlowService.checkNewDisplayName`, decision 0014)

Applied by create, upload, Open Flow Template, Save As (when the target does not exist) and rename.
With `display` the stripped name and `id = idFor(display)`:

1. For every other Builder flow: if its display name or its ID equals `display` ignoring case,
   throw 409 `nameTaken`; if its ID equals `id` ignoring case, throw 409 `idTaken`.
2. For every published flow in the primary publish target (`PublishedNames.list()`), except the
   flow's own folder: the same two checks against its display name (from `echo-flow.json`, else
   the folder name) and folder name.
3. If the publish target cannot be read, `PublishedFlowNames.flows()` logs a warning and returns
   an empty list, so only the Builder is checked.

Both errors are problem details with extra properties `nameTaken: true`, `existingName`, and
`existingFlowId` (a Builder flow) or `existingFolder` (published only). Messages:
`A flow named '<existingName>' already exists.` and
`The name '<name>' makes the ID <id>, which flow '<existingName>' already has.` There are no
numbered IDs (`orders-2`).

### 7.4 Operations of `FlowService` (all `@Transactional`)

| Method | Behaviour |
|---|---|
| `list()` | All flows ordered by ID |
| `get(id)` | 404 `Flow <id> not found` when missing |
| `findByDisplayName(name)` | The flow with that display name, else the one with that ID, ignoring case |
| `detail(id)` | `FlowDetail` with the sorted file list and the spec file name (`ApiSpecFiles.find`) |
| `files(id)` | All files as a sorted map, passed through `RestFromSpec.apply` (section 8.3). This is "the flow as it leaves the editor" and is what Run, Validate, Publish, Download and Save As Template use |
| `create(displayName, description, user)` | Section 7.2. Blank description becomes null |
| `upload(archive, displayName, description, user)` | `importArchive`, then refuses with 409 `pathClashes` when the flow's spec has a path another flow has (the transaction rolls back, nothing is kept). Message starts `This flow cannot be uploaded: its spec has paths other flows have:` |
| `importArchive(archive, displayName, description, user)` | Name is the given display name or, when blank, the archive's route-file name; checked for uniqueness |
| `importArchive(archive, id, displayName, description, user)` | Checks the ID pattern (400), `existsByNameIgnoreCase` (409 `A flow named '<id>' already exists.`), description at most 1000 (400). The archive's `<name>.camel.yaml` is stored as `<id>.camel.yaml` after `RestFromSpec.strip`; other files as they are |
| `update(id, displayName, description, user)` | Changes only the display name (checked when it differs) and description; the ID never changes. Touches the flow (status `DRAFT`) |
| `saveAs(sourceId, displayName, routeContent, overwrite, user)` | Invalid name is 400. If the name is the source's own, it is a plain save of the route (when `routeContent` given). If another Builder flow has it and `overwrite` is false: 409 `confirmOverwrite` with message `A flow named '<name>' already exists. Replace it?`. If no Builder flow has it, the uniqueness check runs (so a published-only flow, or an ID clash, is refused). The target gets all files of the source, with the route file renamed and holding `routeContent` when given, else the saved route; files the target had and the source lacks are removed. The source is untouched. Controller answers 201 for a new flow, 200 for a replaced one |
| `createFromTemplate(templateName, files, name, description, user)` | 422 `The template '<t>' has no <t>.camel.yaml.` when missing; every path checked; blank name is 400; then `importArchive` by display name |
| `replaceWithPublished(id, published, user)` | Replaces the draft's files with the published ones (route renamed to the draft's ID and stripped), touches it, and sets status `PUBLISHED` when the draft's ID equals the published folder |
| `delete(id)` | Removes the flow row (files and publish events cascade) |
| `readFile` / `writeFile` / `deleteFile` | Path checked (400 `File path '<p>' is not allowed.`). Writing identical content changes nothing (the `PUBLISHED` status is kept). Any real change touches the flow. The route file cannot be deleted (400 `The flow's route file cannot be deleted.`); deleting a missing file is 404 |
| `saveApiSpec`, `apiSpecs`, `copyApiSpec`, `pathClashes` | Section 8 |

`FlowController` serialises file writes and deletes per flow: a `ConcurrentHashMap<Long, Object>`
of locks, `synchronized` on the flow's lock, and up to three attempts when Hibernate throws
`ObjectOptimisticLockingFailureException`. The editor saves several files at once (a DataMapper's
`.xsl` and `.kaoto`), and each save bumps the flow's version; without this, concurrent saves
answered 500 and left a blank DataMapper.

### 7.5 DTOs (`FlowDtos`)

```
CreateFlow  { name (not blank), description (max 1000) }
UpdateFlow  { name (not blank), description (max 1000) }
SaveAs      { name (not blank), routeContent (nullable), overwrite (boolean) }
ApiSpecRef  { flowId, flowName (display name), fileName }
FlowSummary { id, name, displayName, description, status, updatedBy, updatedAt }
FlowDetail  { id, name, displayName, description, status, routeFile, files[], apiSpec (nullable),
              createdBy, createdAt, updatedBy, updatedAt }
```

### 7.6 Zip archives (`FlowArchive`)

- Write: a zip with a directory entry `<id>/` and one entry `<id>/<path>` per file, UTF-8.
- Read: skips directories and junk (`__MACOSX/`, `.DS_Store`, `Thumbs.db`), backslashes become
  slashes. Limits: 200 files, 5 MB unpacked in total. Every file must decode as strict UTF-8. If
  every file sits under one top-level folder, that folder is removed. Every path must be valid.
  Exactly one top-level `*.camel.yaml` must exist; it names the flow.
- Errors are 400 with `This file cannot be uploaded as a flow: <reason>.`; reasons:
  `it has more than 200 files`, `it is larger than 5 MB unpacked`, `it is not a valid zip file`,
  `it is not a zip file, or the zip is empty`, `file path '<p>' is not allowed`,
  `'<p>' is not a UTF-8 text file`,
  `it must contain exactly one <flow-name>.camel.yaml file, found <n>`.

---

## 8. The flow's OpenAPI spec on the backend

### 8.1 Finding the spec (`ApiSpecFiles`)

A flow has at most one spec. It is the top-level file (no `/` in the path) ending in `.json`,
`.yaml` or `.yml`, whose content parses (SnakeYAML `SafeConstructor`; JSON is YAML) as a map with a
key `openapi` or `swagger`, and which is not: the route file, any `*.camel.yaml`, any
`*.schema.json`, `application.properties`, or a copy of an approved API
(`ApiCatalog.forSpecificationUri(path)` is present, i.e. `<id>.openapi.json`). If several
qualify, `openapi.json` (the legacy name) wins, else the first by name.

Saving (`FlowService.saveApiSpec(id, name, content, user)`):

1. Name must match `^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(json|yaml|yml)$` and be at most 200 characters,
   else 400 `'<name>' cannot be used: end the name with .yaml, .yml or .json, and use only letters, digits, '.', '-' and '_'.`
   A reserved name is 400 `'<name>' is the name of a file the flow needs for something else. Pick another name.`
   A name another (non-spec) file of the flow has is 400 `The flow already has a file named '<name>'. Pick another name.`
2. Content must be an OpenAPI document, else 400
   `This is not an OpenAPI spec: it needs an 'openapi' (or Swagger 2.0 'swagger') field at the top.`
3. Path ownership: `ApiPaths.newClashes` (section 8.4); clashes are 409 with message
   `The spec cannot be saved: it has paths other flows have: <list>. A path can be in one flow only.`
4. If the flow had a spec under another name, that file is removed (a rename).
5. Identical content under the same name changes nothing; otherwise the file is stored and the
   flow touched.

`apiSpecs()` lists `{flowId, flowName, fileName}` for every flow that has a spec.
`copyApiSpec(id, sourceId, user)` saves the source's spec into the flow under the same file name
through `saveApiSpec` (so the same checks apply); copying from itself changes nothing; a source
without a spec is 404.

### 8.2 operationIds (`OperationIds`)

- `natural(method, path)`: the method in lower case followed by each run of letters and digits of
  the path with its first letter upper-cased. `GET /cards/{cardId}` is `getCardsCardId`;
  `POST /cards/{cardId}/activate` is `postCardsCardIdActivate`.
- `unique(base, taken)`: `base`, else `base2`, `base3`, ...
- `fill(specContent, json)`: for every operation (keys `get, put, post, delete, options, head,
  patch, trace` under each path) without a non-blank `operationId`, sets the natural name made
  unique against all ids in the spec. Returns the same string when nothing was missing or the spec
  cannot be read; otherwise writes the document again (pretty JSON with Jackson, or block-style
  YAML with indicator indent 2 and unlimited width). The UI has the same naming
  (`operationIds.ts`) and normally leaves nothing missing.

### 8.3 The generated REST service (`RestFromSpec`, decisions 0008, 0010, 0011, 0012)

The draft's route file holds only what the user designs: routes, beans and an optional
`restConfiguration`. `RestFromSpec.apply(routeFile, specName, files)` is applied whenever the flow
leaves the editor and returns the files with:

1. The spec's missing operationIds filled (`OperationIds.fill`).
2. The route file rewritten (`applyTo`). The YAML is parsed with SnakeYAML's node API
   (`compose`), so comments and ordering of untouched entries survive as far as SnakeYAML keeps
   them, and serialised in block style, indent 2, indicator indent 2, unlimited width, with the
   two-space indent of the top-level list removed (Kaoto starts the list at the margin). If the
   file is not a YAML list it is returned unchanged.
   - First, anything generated earlier is removed (`removeGenerated`): a top-level entry with the
     single key `rest` whose mapping has an `openApi` key and only keys from
     `{id, description, openApi}`; and any `route` whose `id` starts with `echo-missing-` or
     `echo-docs-`. A hand-written code-first `rest` (with verbs) is kept.
   - If the flow has a spec, these entries are appended:

     ```yaml
     - rest:
         id: echo-openapi
         openApi:
           specification: '<spec file name>'
           missingOperation: ignore
     ```

     For each operationId of the spec that has no started `direct:` route in the file, a 404 route:

     ```yaml
     - route:
         id: 'echo-missing-<operationId>'
         description: Made by EY ECHO; the flow has no route for this operation of its OpenAPI spec
         from:
           uri: 'direct:<operationId>'
           steps:
             - setHeader:
                 name: CamelHttpResponseCode
                 constant: 404
             - setHeader:
                 name: Content-Type
                 constant: application/json
             - setBody:
                 constant: '{"error":"Not found","message":"This flow does not implement the operation <operationId> yet."}'
     ```

     When the flow has a route for the operation but it is switched off (`autoStartup: false`),
     the description says `no enabled route` and the message is
     `The route for the operation <operationId> is disabled in this flow.`
   - A `direct:` route is recognised in both forms Kaoto writes: `uri: direct:<name>` (a leading
     `//` and any `?query` removed) and `uri: direct` (or `direct:`) with `parameters.name`. Both
     `- route: {from: ...}` and a bare top-level `- from: ...` count; a bare `from` is always
     "started".
   - If the spec has a Base Path, `contextPath` is removed from `restConfiguration` (it would
     override the Base Path in Camel). Otherwise the base is the `contextPath`, if any.
   - Four Swagger UI routes (`docsRoutes`), each
     `from: {uri: 'platform-http:<path>', parameters: {httpMethodRestrict: GET}}` with a
     `setHeader Content-Type` (constant) and a `setBody` (constant), description
     `Made by EY ECHO; Swagger UI for the flow's OpenAPI spec`:

     | Route id | Path | Content-Type | Body |
     |---|---|---|---|
     | `echo-docs-<flow>` | `<base>/docs` | `text/html; charset=utf-8` | The page below, as one line |
     | `echo-docs-<flow>-spec` | `<base>/docs/openapi` | `application/json` or `application/yaml` by the spec's extension | `resource:classpath:<spec file>`; or, when some operations are switched off, a one-line JSON copy of the spec with `deprecated: true` on them (content type `application/json`) |
     | `echo-docs-<flow>-script` | `<base>/docs/swagger-ui-bundle.js` | `text/javascript` | `resource:classpath:META-INF/resources/webjars/swagger-ui/{{echo.swagger-ui.version}}/swagger-ui-bundle.js` |
     | `echo-docs-<flow>-style` | `<base>/docs/swagger-ui.css` | `text/css` | `resource:classpath:META-INF/resources/webjars/swagger-ui/{{echo.swagger-ui.version}}/swagger-ui.css` |

     `docsPath(base)`: strip, drop trailing slashes, add a leading slash when not empty, append
     `/docs` (no base gives `/docs`).

     The page (each line stripped and joined without separators; the title is HTML-escaped and
     `{` written as `&#123;` so that `{{` is never a Camel placeholder):

     ```html
     <!doctype html>
     <html lang="en">
     <head>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <title>{spec title, else flow id} - API docs</title>
     <link rel="stylesheet" href="docs/swagger-ui.css">
     </head>
     <body>
     <div id="swagger-ui"></div>
     <script src="docs/swagger-ui-bundle.js"></script>
     <script>
     window.ui = SwaggerUIBundle({
       url: 'docs/openapi',
       dom_id: '#swagger-ui',
       deepLinking: true,
       requestInterceptor: function (request) {
         var url = new URL(request.url, window.location.href);
         if (url.origin !== window.location.origin) {
           request.url = window.location.origin + url.pathname + url.search;
         }
         return request;
       }
     });
     </script>
     </body>
     </html>
     ```

     The links are relative (`docs/...` from `<base>/docs`), so the page works behind a proxy, and
     the interceptor sends Try it out to the host the page came from.
   - The deprecated copy is read with a YAML 1.2-like resolver (timestamps stay strings; only
     `true/True/TRUE/false/False/FALSE` are booleans, so `on`/`off`/`yes`/`no` stay text) and
     written as JSON with every `{{` replaced by `{{`.
3. All strings ECHO writes into the YAML are single-quoted with `'` doubled.

Other functions of `RestFromSpec`:

- `strip(yaml)`: the route file without the generated part (used when a published, downloaded or
  template flow becomes a draft).
- `unrouted(routeYaml, specContent)`: the operations no started `direct:` route handles, as
  `{method, path, operationId, disabled}` (`disabled` when a switched-off route exists; an
  operation without an id is always unrouted). Publish uses it.
- `contextPath(routeYaml)`, `specificationOf(routeYaml)` (the `rest.openApi.specification` of a
  published route file, without a `classpath:` prefix).
- `servedOperations(specContent, contextPath)` / `servedPaths`: each operation with its full path;
  here a non-blank `contextPath` wins over the Base Path (callers pass the context path of the
  route file after `apply`, which has removed it when the spec has a Base Path).
- `Spec.read(content)`: operations (method upper case, path, operationId or null), path names (also
  paths without operations), Base Path and `info.title`. Base Path: the path component of the
  **last** `servers[].url` (a URL that does not parse is used as it is), or Swagger 2.0 `basePath`
  when there is no `servers` list; trailing slashes removed. An unreadable spec reads as empty.

### 8.4 A path in one flow only (`ApiPaths`, decision 0015)

- A served path is `join(base, specPath)` where `base` is the spec's Base Path, or the route
  file's `contextPath` when the spec has none.
- `key(path)`: collapse repeated slashes, replace every `{name}` with `{}`, then repeatedly remove
  a trailing `/` and a trailing `/{}`; empty becomes `/`. So `/shop/shoes`, `/shop/shoes/{id}` and
  `/shop/shoes/{shoeId}/` have the same key. Methods do not matter.
- `clashes(selfId, selfFolder, specContent, contextPath, specPaths)`: for each path of the spec
  (all, or only those in `specPaths`; paths without operations count), looks for the same key in
  (a) every other Builder flow that has a spec and (b) every published flow in the primary target
  that is not in the Builder and is not the flow's own folder (its spec is the one its published
  route file names in `rest.openApi.specification`). Result records:
  `{path, specPath, otherPath, flowName, flowId (Builder) | folder (published only)}`.
- `newClashes(flow, previousSpec, newSpec)`: only paths whose key the stored spec did not have are
  checked, so flows made before the rule can still be saved.
- `conflict(message, clashes)`: 409 problem detail whose detail is
  `<message> <path> (in flow <name>), ... . A path can be in one flow only.` and whose property
  `pathClashes` is the list.
- Endpoint: `POST /api/flows/{id}/path-clashes` with `{spec, paths}` returns the list (200, maybe
  empty) for a spec that is not saved yet.

---

## 9. Publishing

Package `com.ey.echo.builder.publish` (decisions 0002, 0003, 0007, 0011).

### 9.1 Targets (`FlowPublisher`, `PublishConfig`, `PublishTargets`)

```java
interface FlowPublisher {
  String id();            // "git", "s3"
  String displayName();   // "Git", "S3"
  String location();      // shown to users
  boolean enabled();
  PublishResult publish(String flowName, String previousName, Map<String,String> files, String author, String message);
  PublishResult remove(String flowName, String author, String message);
  FlowPublisher templates();            // same target, the templates folder
  List<PublishedFolder> list();         // sorted by name
  Optional<Map<String,String>> read(String flowName);
  static String templatesFolder(String flowsFolder); // "flows" -> "templates", "a/flows" -> "a/templates"
  record PublishedFolder(String name, Map<String,String> files) {}
  record PublishResult(String revision, String location, boolean changed) {}
}
```

`PublishConfig` declares the Git bean with `@Order(1)` and the S3 bean with `@Order(2)`.
`PublishTargets`: `enabled()` (in order), `primary()` (first enabled), `require()` (throws
`PublishException("Publishing is not configured: enable a publish target in application.yaml (echo.git with url, or echo.s3 with enabled: true and bucket).")`
when none), `displayName(id)`, and `removeEverywhere(flow, author, message)` which tries every
enabled target and then throws `Could not delete flow <f> from <Target>: <error>; ...` if any
failed. `PublishException` thrown from the publish, published-flow and template controllers
becomes **502** with title `Publish failed` (`PublishExceptionHandler`).

### 9.2 Git (`JGitPublisher`)

- A working copy in `echo.git.workdir`, owned by the Builder. One `ReentrantLock` serialises all
  Git work (shared with the templates view).
- `openWorkingCopy`: opens the folder if it has `.git` and resets the `origin` URL; otherwise
  `git init` with the configured initial branch and adds `origin`.
- `syncWithRemote`: fetch `+refs/heads/*:refs/remotes/origin/*` with the credentials; if the
  remote branch does not exist (empty repository or new branch) nothing more; else forced
  checkout of the branch (created from the remote ref if missing), `reset --hard` to the remote
  ref and `clean -fd`.
- `publish`: sync; delete the flow folder (and the previous folder if the flow was published under
  another name) and write every file (paths must stay inside the folder); stage additions and
  deletions under the publisher's folder; if nothing is staged, return
  `{revision: HEAD, location: branch, changed: false}`. Otherwise commit with author
  `PersonIdent(<Builder user>, committer-email)`, committer
  `PersonIdent(committer-name, committer-email)`, unsigned, and push
  `refs/heads/<branch>:refs/heads/<branch>`. A push rejected as non-fast-forward or
  remote-changed is retried once from the new remote head (2 attempts), then fails with
  `The branch '<b>' changed while publishing; try again.` Any other push status fails with
  `Push failed: <status> <message>`. JGit and IO errors become `Git error: <message>`.
- `remove`: the same with the folder deleted. `list` and `read` sync first, then read the folders
  under the flows folder (non-UTF-8 files are skipped with a warning).
- `location()`: `<url without user info> (branch <branch>)`.
- Credentials: `UsernamePasswordCredentialsProvider(username or "", token or "")`, or none when
  both are null.

### 9.3 S3 (`S3Publisher`, `S3Client`)

- Objects `<prefix>/<flow>/<file>`. `publish` lists and reads the existing objects of the folder,
  PUTs files whose content differs, DELETEs objects the flow no longer has, deletes the previous
  folder after a rename; `revision` is null and `location` is `s3://<bucket>/<prefix>/<flow>/`.
- `list()` groups every key under `<prefix>/` by its first segment; `read` returns empty when the
  folder has no objects.
- `location()`: `s3://<bucket>/<prefix>/` plus ` at <endpoint>` when set.
- `S3Client` is hand-written on `java.net.http.HttpClient` (10 s connect timeout, 30 s request
  timeout, default proxy selector) with AWS Signature Version 4: headers `host`,
  `x-amz-content-sha256`, `x-amz-date` (and `x-amz-security-token`), service `s3`, scope
  `<date>/<region>/s3/aws4_request`, RFC 3986 encoding of keys and query. URL: virtual-hosted
  `https://<bucket>.s3.<region>.amazonaws.com/<key>` for Amazon, path-style
  `<endpoint>/<bucket>/<key>` with an endpoint. Listing uses `list-type=2` with
  `continuation-token` paging and reads `Contents/Key` from the XML. A GET of a key answering 404
  is "absent"; any other non-2xx is `S3 error: <METHOD> <key|bucket listing> returned <status>: <Code> (<Message>)`.
  Bodies are sent as `text/plain; charset=utf-8`. No AWS SDK.

### 9.4 Publish (`PublishService.publish(flowId, user, message, allowMissingRoutes)`)

In order:

1. `targets.require()` (502 when none).
2. `files = ApiCatalog.withSpecs(routeFile, FlowService.files(id))`: the flow as it leaves the
   editor, plus a current OpenAPI 3 JSON copy of every approved API the route file calls
   (`<id>.openapi.json`).
3. `FlowValidator.validate(routeFile, files)`; invalid answers **422** with the
   `ValidationResult` (section 10).
4. Clash check (section 9.5) against the primary target, ignoring the flow's own folder and the
   folder of its last publish; any clash answers **409** with title `Endpoints already used`,
   detail `Not published: published flows already use these endpoints.` and property `clashes`
   (a list of strings).
5. Only when the request has `allowMissingRoutes: false`: `RestFromSpec.unrouted`; if not empty,
   **409** with title `Operations without a route`, detail
   `Not published yet: some operations of the flow's OpenAPI spec have no route and answer 404.`
   and property `missingRoutes: [{method, path, operationId, disabled}]`. When the field is left
   out or true, missing routes do not stop the publish.
6. `version = countByFlowId + 1`. The metadata file `echo-flow.json` is added (Appendix A). If the
   folder in the primary target is currently disabled, `"disabled": true` is kept.
7. Commit message: the user's description (stripped), or
   `Publish flow <id> (version <n>)` when blank.
8. Each enabled target is tried in order; a failure is recorded as that target's outcome and does
   not stop the others. If every target failed: `PublishException` listing
   `<Target>: <error>; ...` (502).
9. The flow's status becomes `PUBLISHED`.
10. If no target changed anything, all succeeded and there is an earlier publish, the earlier
    event is returned with `changed: false` and no new event is stored. Otherwise a
    `PublishEvent` is stored with one `TargetOutcome` per target.

Response 200:

```
{ publishedBy, publishedAt, message, changed,
  targets: [{ target, name, location, revision, changed, error }] }
```

`GET /api/flows/{id}/history` returns the same shape per event, newest first (`changed: true`).

`DELETE /api/flows/{id}` (`PublishService.delete`): if the flow was ever published, its folder
(the name of the last publish) is removed from every enabled target with commit message
`Delete flow <folder>` first; only then is the draft deleted. A failing target leaves the draft
in place (502).

### 9.5 Endpoint clashes (`EndpointClashes`)

For a set of files, `Uses.of(flowName, files)` reads the route file (which already holds the
generated part) and collects:

- every `platform-http:` consumer (in `route.from` or a bare `from`): path = the URI after the
  scheme without the query; methods from `parameters.httpMethodRestrict`, else from the URI query,
  comma-separated; none means every method. Label `<METHOD> <path>` or `<path> (any method)`.
  A consumer in a route whose id starts with `echo-docs-` is a docs endpoint labelled
  `Swagger UI at <path up to /docs>`.
- every operation of the spec named by `rest.openApi.specification`, at
  `servedOperations(spec, restConfiguration.contextPath)`; these lead the list. Their
  operationIds are collected.
- `basePath`: for a flow with a spec, the docs page path without `/docs`, normalised (`/` when
  none); null without a spec.

`normalise(path)`: collapse repeated slashes, `{name}` to `{}`, no trailing slash, leading slash.
Two endpoints overlap when the paths are equal and the methods are equal or either is "any".

For each other published folder, in this order, a line is added (duplicates removed):

1. `Base Path <base> is already used by flow <folder>` when both have a spec and the same base.
2. `<label> is already used by flow <folder>` for each overlapping endpoint (docs endpoints are
   skipped when rule 1 already fired).
3. `operationId <id> is already used by flow <folder>`.

Disabled published flows still count. Drafts are never checked here.

### 9.6 Published flows (`PublishedFlowService`, `/api/published-flows`)

- `list()`: the folders of the primary target with their `echo-flow.json` read:
  `{name, displayName, description, version, publishedBy (metadata "author"), publishedAt, flowId, draftChanged, target, disabled}`.
  `flowId` is the Builder flow whose latest publish event names this folder, else the Builder flow
  with this ID, else null. `draftChanged` is true when that flow's status is `DRAFT`. Broken
  metadata reads as empty. No enabled target returns an empty list.
- `files(name)`: the published files without `echo-flow.json` (download as zip).
- `createDraft(name, replace, user)`: 404 when the folder is missing; 422
  `The published flow '<n>' has no <n>.camel.yaml.`; with `replace=true` and a linked Builder
  flow, `replaceWithPublished`; otherwise `importArchive` under the same ID with the display name
  and description of the metadata (409 if the Builder already has a flow with that ID). Answers
  201 with the `FlowDetail`.
- `delete(name, user)`: removes the folder from every enabled target, then the linked Builder
  flow, if any.
- `setDisabled(name, disabled, user)`: in every enabled target that has the folder, writes
  `echo-flow.json` with `"disabled": true` added or removed and publishes the folder again with
  the message `Disable flow <name>` or `Enable flow <name>`. Nothing else changes.

### 9.7 Templates (`TemplateService`, `/api/templates`, decision 0007)

- A template is a flow folder in the `templates` folder next to the flows folder, plus
  `echo-template.json` (Appendix A).
- `list()`: folders of the primary target's templates view that contain `<folder>.camel.yaml`:
  `{name, displayName, description, savedBy, savedAt}`.
- `save(flowId, displayName, routeContent, overwrite, user)`: invalid name is 400
  `Give the template a name of at most 100 characters.`; folder = `idFor(displayName)`; when the
  folder exists in the primary target and `overwrite` is false: 409 `confirmOverwrite`,
  `A template named '<name>' already exists. Replace it?`. Files are `FlowService.files(flowId)`
  (with the generated REST part), the route file renamed to the template's ID and holding
  `routeContent` when given, plus the metadata. Written to every enabled target with message
  `Save template <id>`; any failure is 502 `Could not save template <id> to <Target>: <error>`.
- `open(templateName, flowName, description, user)`: 404 `Template <t> not found`; creates a draft
  through `createFromTemplate` with the description given or, when blank, the template's. The
  generated REST part is stripped on import.
- Templates are never checked for path ownership and never built by the pipeline.

---

## 10. Validation

`FlowValidator.validate(routeFile, files)` returns
`ValidationResult { valid, problems: [{ file, line (nullable), message }] }`. It is called by
`POST /api/flows/{id}/validate` (always 200), by Run and by Publish (both answer 422 with the
result when invalid). The files passed are always
`ApiCatalog.withSpecs(routeFile, FlowService.files(id))`, i.e. the saved draft with the generated
REST part and the approved API copies.

Steps (each runs only if the earlier ones found nothing, except as noted):

1. Empty or blank route file: `The route file is empty.` YAML that does not parse:
   `Malformed YAML: <problem>` with the line.
2. Camel loads the YAML into a throwaway, never-started `DefaultCamelContext(false)` with the
   routes loader. A failure becomes one problem with the root cause's first line and the line number
   (from a `MarkedYAMLException` or from `line N, column` in a message). The message containing
   both `resourceUri is required` and `syntax xslt` (a DataMapper step with no file yet) is
   replaced by `A DataMapper step has no mapping yet. Open it in the DataMapper and map its fields.`
   That one message does not stop the later steps; any other does.
3. `application.properties` is loaded (unreadable: `Cannot read properties: <reason>`, file
   `application.properties`).
4. A walk over the YAML node tree, key by key, with these checks (all with the line of the value):

   | Trigger | Problem message |
   |---|---|
   | `uri:` whose scheme (text before the first `:`, after placeholders are resolved) is not in `allowed-components` | `The '<scheme>' component is not allowed in flows (allowed components: <list>).` |
   | `uri:` using `{{name}}` not set in `application.properties` and without a default | `Property '<name>' is not set in application.properties.` (the URI is then not checked further) |
   | `uri: http...`/`https...` with `echo.apis.only: true` | `Flows may only call approved APIs (<names, or "none are set up in echo.apis">). Use a REST OpenApi step instead of <scheme>.` |
   | `uri: xslt-saxon:<file>` (also `xslt:`; `classpath:`/`file:` prefix and query removed) and the file is not in the flow | `The mapping file '<file>' is missing from the flow.` |
   | the same, file name starts with `kaoto-datamapper-` and its content has no `<xsl:template` | the "no mapping yet" message |
   | `uri: xslt-saxon` with no file, when Camel reported "no mapping yet" | the "no mapping yet" message, once per such step |
   | a key that is one of `jsonpath, jq, xpath, xquery, groovy, js, python, ognl, mvel, spel, datasonnet, jsonata, csimple, joor, java, wasm` | `The '<key>' expression language is not allowed in flows (allowed languages: <list>).` |
   | `simple:` (scalar, or a map with `expression`), `log:` with a scalar, `message:` with a scalar, that Camel's simple language cannot parse | `Invalid expression '<text>': <first line of the error>` |
   | `setHeader`, `setVariable`, `setProperty`, `setBody`, `transform`, `filter` whose map has no key other than `id, description, name, disabled, note, inheritErrorHandler, steps, statusPropertyName` | `The Set Header[ '<name>'] has no value. Give it one or delete it.` (with the step's own label: The Set Variable, The Set Property, The Set Body, The Transform, The Filter) |
   | an entry of `setHeaders.headers` / `setVariables.variables` with no name and no expression | `An empty header (no name, no value) is left in this step. Delete it.` (or `variable`) |
   | such an entry with an expression but no name | `A header in this step has no name.` |
   | such an entry with a name but no expression | `The header '<name>' has no value. Give it one or delete it.` |
   | a step with `uri: http`/`https` and no URL in the URI nor in `parameters.httpUri` | `This <scheme> step has no URL. Select it on the canvas and fill in Http Uri, for example <scheme>://host.docker.internal:9090/orders.` |
   | an http(s) step with a URL, in a route whose `from.uri` starts with `platform-http:`, before any `removeHeaders` whose pattern matches both `CamelHttpUri` and `CamelHttpPath`, without `parameters.bridgeEndpoint: true` (reported once per route) | `The incoming request's headers would change the URL this <scheme> step calls. Add a Remove Headers step with pattern * before it, or turn on Bridge Endpoint in the step.` |
   | `restConfiguration.component` other than `platform-http` | `REST services in flows always run on platform-http, so remove 'component: <c>' from the REST configuration.` |
   | `restConfiguration.bindingMode` other than `off` | `REST binding mode '<b>' is not supported in flows (bodies stay plain JSON text), so remove 'bindingMode' from the REST configuration.` |
   | `restConfiguration.apiContextPath` not blank | `Generated API docs are not supported in flows, so remove 'apiContextPath' from the REST configuration.` |

5. REST OpenApi calls. A step is one whose `uri` (placeholders resolved quietly) is `rest-openapi`
   or starts with `rest-openapi:`. The spec and operation come from the URI
   (`rest-openapi:<spec>#<operationId>`, query removed) or, when blank, from
   `parameters.specificationUri` / `parameters.operationId`; `host` from `parameters.host`. An
   **Enrich** step whose expression (`simple` or `constant`, directly or under `expression:`) is a
   plain endpoint URI (matches `^[a-z][a-z0-9+.-]*:\S*$`, no `${`) is checked like a `uri`, and a
   `rest-openapi:` one like a REST OpenApi step with its options read from the URI query
   (`?host=...`). The step's name in messages is `REST OpenApi step` or `Enrich step`.

   | Condition | Problem |
   |---|---|
   | route starts from `platform-http:` and headers not removed yet (once per route) | `The incoming request's headers would change the URL this <what> calls. Add a Remove Headers step with pattern * before it.` |
   | no spec and no operation, `only` false, no approved APIs | `This <what> calls nothing yet. Set Specification Uri and Operation Id to the API operation it calls.` |
   | the same, with approved APIs | `This <what> calls nothing yet. Set Specification Uri to one of: <files>, and pick its Operation Id.` |
   | spec not an approved API's file and `only` true | `This <what> has no spec. Set Specification Uri to one of: <files>.` or `'<spec>' is not an approved API. Set Specification Uri to one of: <files>.` |
   | spec not approved and `only` false (but something is set) | no problem: flows may call other specs |
   | approved API failed to load | `The approved API '<name>' could not be loaded: <problem>` |
   | no operation | `Choose the <name> operation this step calls (Operation Id).` |
   | unknown operation | `'<op>' is not an operation of <name>.` |
   | operation not allowed | `Flows may not call <name>'s '<op>' operation (<METHOD> <path>). Allowed: <ids>.` |
   | spec names no `http(s)://` server and `host` is blank | `<name>'s spec names no server, so set Host on this <what>, for example {{<id>.base-url}} in application.properties.` |

The `removeHeaders` state is per route: it is reset at each `from`, and a route started from
`direct:` (every scaffold route) never triggers the "incoming request's headers" problems.

`ValidationProperties` falls back to the default lists when a list is missing or empty.

---

## 11. Run (test runs inside the Builder)

Package `com.ey.echo.builder.run` (decisions 0004, 0019).

### 11.1 Placeholder values (`RunValues`)

- `placeholders(route)`: every `{{name}}` or `{{name:default}}` in the route file (a leading `?`
  is not part of the name), sorted by name, without Camel's functions (`env, sys, sysenv,
  service, service.host, service.port, bean, ref, configmap, secret, configmap-binding,
  secret-binding`) and names starting with `echo.`. A name has a fallback only if **every** use
  of it has a default.
- `choose(flowId, user, fileName, content, placeholders)`: stores the file in a
  `ConcurrentHashMap` keyed `<flowId>/<user>`. Errors (400): `Choose a properties file.`,
  `<file> is too large for a properties file.` (over 1,000,000 characters),
  `<file> is not a properties file: <reason>`, `<file> does not set <a, b>.`
- `missing(placeholders, values)`: names without a fallback that the file does not set.
- `merged(applicationProperties, file)`: the flow's properties text, a newline, then the file's
  text (later keys win).

### 11.2 Endpoints (`RunController`, base `/api/flows/{id}/run`)

| Call | Behaviour |
|---|---|
| `GET /values` | `{ fileName (nullable), placeholders: [{name, fallback}], missing: [names] }` for the saved draft |
| `POST` (body optional `{fileName, content}`) | Builds the files (as for Validate). If a file is sent it is checked and stored. If the route uses placeholders and no file is stored, or the stored file misses values: **409** with the `/values` shape. Otherwise the stored file is merged into `application.properties`, the flow is validated (**422** with the `ValidationResult`), and started. **200** `RunInfo` |
| `GET` | `RunInfo`, or **204** when the flow is not running |
| `DELETE` | Stops it; 204 |
| `GET /log?after=<seq>` | Log lines with `seq` greater than `after`: `[{seq, at, level, message}]`; empty when not running |
| `POST /request` `{method, path, contentType, body}` | Sends the request to `http://localhost:<port><path>` from the Builder and answers `{status, contentType, body, durationMs}` |

`RunInfo`: `{ flowId, flowName, port, url, endpoints: [{path, methods[], url}], docsUrl (nullable), startedBy, startedAt, idleMinutes }`
where `url` is `<public-url without trailing slash>:<port>`.

`POST /request` rules: method defaults to `POST`, must be one of GET, POST, PUT, PATCH, DELETE
(`Method '<m>' is not supported here.`); path defaults to `/`, must start with `/` and not contain
`://` (`The path must start with / (for example /orders).`); `Content-Type` is sent only with a
body and defaults to `application/json`; GET and DELETE with an empty body send no body; 60 s
timeout; the reply text is cut at 1,000,000 characters with `\n... (cut at 1,000,000 characters)`.
Not running: `The flow is not running. Choose Run first.` Failures:
`Could not call the flow: <root message>`. The client is pinned to **HTTP/1.1**, without a proxy,
5 s connect timeout: over HTTP/2 newer Java versions refuse replies carrying `Connection` or
`Keep-Alive` ("Prohibited header name 'keep-alive'"). `RunException` is 400 problem detail.

### 11.3 The runner (`FlowRunner`, `FlowRun`)

`start(flowId, flowName, routeFile, files, user)` (synchronised):

1. `Test runs are turned off for this Builder.` when `echo.run.enabled` is false.
2. An earlier run of the same flow is stopped first.
3. A free port is taken from `first-port..last-port`: not used by another run and bindable
   (`ServerSocket` with `SO_REUSEADDR`). None: `All test ports (<a>-<b>) are in use. Stop another run and try again.`
4. The files are written to a temp folder `echo-run-<flow>-*`; a `URLClassLoader` over that folder
   (parent: the Builder's class loader) is the context's application class loader, so
   `xslt-saxon:kaoto-datamapper-*.xsl`, `resource:classpath:<spec>` and
   `rest-openapi` find the flow's files as they do in an image.
5. A `DefaultCamelContext` named `echo-run-<flow>`:
   - initial properties = `application.properties` plus `echo.swagger-ui.version` (read from
     `META-INF/maven/org.webjars/swagger-ui/pom.properties` on the Builder's classpath) unless the
     flow sets it;
   - `getRestConfiguration().setComponent("platform-http")`;
   - a `VertxPlatformHttpServer` bound to the run's port;
   - the `HttpExchangeLog` of the runtime template (section 21) attached, with settings from the
     flow's properties falling back to the Builder's environment, the property values registered
     as secrets to mask, and a sink that appends each record's text to the run log
     (`WARN` or `INFO`);
   - a `LogListener` that copies what the flow logs (log steps) to the run log with its level;
   - an event notifier that touches the run on every exchange event (idle timer) and, only when
     the HTTP log is off, logs `Request: <METHOD> <uri>` and `Done in <n> ms.` for incoming
     platform-http exchanges (not the copies multicast makes); a failed exchange always logs
     `Failed: <root message>` at `ERROR`, plus a tip about Remove Headers when the message
     mentions `bridgeEndpoint`.
6. The route file is loaded and the context started. A failure closes the run and throws
   `The flow could not start: <reason>`; when the root cause starts with
   `Unsupported definition: null`, `EmptyExpressions` searches the route definitions for the
   first step without an expression and the reason becomes e.g.
   `the setHeaders step "SetMethodParameters" in route route-getCards: the header 'id' has no value. Open the step and fill it in, or delete it.`
7. Endpoints for the panel: every route consuming from platform-http (path, and methods from
   `httpMethodRestrict`, empty meaning any), except the `echo-docs-*` routes (the page route
   `echo-docs-<flow>` gives `docsPath`); for the contract-first REST consumer (endpoint URI
   starting `rest-openapi:`), the spec file is read from the temp folder and
   `RestFromSpec.servedPaths` lists each path with its methods.
8. The run log starts with `Started <flow> on port <port>.` It keeps the last 500 lines, each with
   an increasing `seq`.

`stop(flowId)` closes Camel, the class loader and deletes the temp folder. A scheduled task
(`@Scheduled(fixedDelay PT1M, initialDelay PT1M)`, `@EnableScheduling` on the controller) stops
runs idle for `idle-minutes`. `@PreDestroy` stops all runs. Runs are per flow, not per user: a
second user's Run replaces the first.

---

## 12. Camel catalog, editor settings, approved APIs, branding endpoints

### 12.1 Approved APIs (`ApiCatalog`, `ApiProperties`, decision 0006)

Loaded once at startup from `echo.apis.specs`. For each spec:

- `id` must match `^[a-z0-9][a-z0-9-]*$`; the flow's copy is called `<id>.openapi.json`.
- The file is read and parsed with swagger-parser's `OpenAPIParser.readContents` (OpenAPI 3.x or
  Swagger 2.0, YAML or JSON; Swagger 2.0 is converted to OpenAPI 3).
- Every operation with an `operationId` becomes `{id, method, path, tags, allowed}`. `allowed` is
  true when both lists are empty, or the id is in `allowed-operations`, or one of its tags is in
  `allowed-tags`.
- `hasHost`: some `servers[].url` starts with `http://` or `https://`.
- `content`: the spec as pretty OpenAPI 3 JSON (`Json.pretty`, or `Json31.pretty` for 3.1).
- A failure (bad id, no file, unreadable file, not a spec) is logged at ERROR and kept as an API
  with `problem` set; the Builder still starts and Validate reports it.

`forSpecificationUri(uri)` finds an API by file name (a `classpath:` prefix is ignored).
`withSpecs(routeFile, files)` adds `<id>.openapi.json` for every loaded API whose file name
appears anywhere in the route file's text.

### 12.2 The catalog served to Kaoto (`CamelCatalogController`, decision 0005)

`GET /api/camel-catalog/**` (public) serves the Camel catalog files that
`builder-ui/scripts/copy-camel-catalog.mjs` copies out of `@kaoto/camel-catalog`. The root is the
first of `echo.catalog.locations` (default `classpath:/static/camel-catalog/`,
`file:../builder-ui/public/camel-catalog/`, `file:public/camel-catalog/`) that has an
`index.json`. Paths with `..`, `\` or a leading `/` are 404. Content types: `.json` JSON, `.xsd`
and `.xsl` XML, else octet-stream.

`index.json` lists catalog definitions; each definition's own index (hashed file names) lists
`catalogs.components.file`, `languages`, `patterns`, `entities`, `kamelets`, `kameletBoundaries`.
Only definitions whose file name starts with `camel-` are handled. Filtering (results cached per
file):

- components file: keep only `allowed-components` (minus `http` and `https` when
  `echo.apis.only`). When approved APIs exist, the `rest-openapi` entry's `specificationUri` gets
  `enum: [<api file names>]` (and loses `default`/`defaultValue`) and `operationId` gets
  `enum: [<all allowed operation ids>]`, in both `properties` and `propertiesSchema.properties`,
  so Kaoto renders drop-downs.
- languages file: keep only `allowed-languages`.
- patterns file: drop `hidden-processors`, and `kamelet` unless the `kamelet` component is
  allowed; then, anywhere in the JSON, every `oneOf` whose choices are all single-language
  choices (`required: [<lang>]` with a `$ref` containing `.model.language.`) loses the choices
  for languages that are not allowed. This is what trims the language picker in step forms.
- kamelets and kamelet boundaries: empty unless `kamelet` is allowed.
- entities file: the same language trimming; the `specification` property of
  `org.apache.camel.model.rest.OpenApiDefinition` is titled `Openapi Specification`; and
  `restConfiguration`'s `properties` (both at the entry and under `propertiesSchema`) are cut down
  to `contextPath`, `clientRequestValidation`, `enableCORS`, in that order, each moved to the
  group `consumer` (so Kaoto shows them at the top level, not in collapsible groups).
- Every other file is passed through.

To allow another component, add it to `allowed-components` **and** add its jar to the Builder's
pom, or Run cannot start flows that use it.

### 12.3 Editor settings (`EditorSettingsController`)

`GET /api/editor/settings` (login needed), computed once at startup:

```
{ autosaveSeconds, runEnabled, jiraImport, aiEngine (nullable),
  routeCall: { specificationUri, host } | null,
  apiTags: [{ specificationUri, name, host (nullable), tags: [{ name, operations[] }] }] }
```

- `jiraImport`: `echo.jira` has `base-url` and `token`.
- `aiEngine`: `<model> at <host>` of the AI provider bean, null without one.
- `routeCall`: only when exactly one approved API loaded; `host` is `{{<id>.base-url}}` when its
  spec names no server host, else null. (The UI's scaffold now always writes `{{api.base-url}}`;
  it uses `routeCall.specificationUri`.)
- `apiTags`: per loaded API, its tags that have allowed operations, sorted A to Z ignoring case,
  each with its allowed operation ids (an operation under each of its tags).

`GET /api/editor/apis/{fileName}`: the approved API's OpenAPI 3 JSON (404 when unknown or not
loaded).

### 12.4 Branding (`BrandingController`, `BrandingWebConfig`)

`GET /api/branding` (public): `{ logo, logoAlt, favicon, theme, colors: { primary, primaryHover,
onPrimary, accentText, mastheadBackground, mastheadText } }`; unset colours are null; `theme` is
the lower-case enum name. `/branding/**` is a resource handler over the asset folder first, then
`classpath:/branding/` (built-in `logo.svg`, a dashed yellow box saying "LOGO", and `favicon.svg`,
a grey rounded square with a yellow "E").

---

## 13. Import from Jira using AI (backend)

Packages `jira` and `ai` (decision 0016).

`POST /api/jira/story-examples` with `{ link }` answers `StoryExamples`:

```
{ key, summary, link, comments (count), engine (nullable), notes[],
  examples:   [{ id, json (pretty), source, role: "request"|"response"|null }],
  operations: [{ method, path (with ?sample=query), request (example id|null),
                 response (example id|null), examples: [ids], reason (nullable) }] }
```

Errors are problem details: 404 `Import From Jira is not set up: echo.jira.base-url and token are needed.`;
400 for a bad link; 404 `<KEY> was not found, or ECHO's Jira account cannot see it.` (Jira 403 or
404); 502 for Jira unreachable, 401 from Jira
(`Jira did not accept ECHO's account. Check echo.jira.username and echo.jira.token.`), other
statuses, or an unreadable answer.

1. **The key** (`StoryKeys.keyOf`): the text itself if it matches `[A-Za-z][A-Za-z0-9_]*-\d+`
   (upper-cased); else it must be an `http(s)` URL on the configured site's host and port
   (`ECHO reads stories from <site> only, not from <host>.`); the key is the `selectedIssue` query
   parameter, else the last path segment that looks like a key. Messages:
   `Paste the link of a Jira story, or its key such as PAY-142.`,
   `That is not a link to a Jira story.`,
   `That link does not name a story. Open the story in Jira and copy its link.`
2. **Reading** (`JiraClient`): `GET <base>/rest/api/3/issue/<key>?fields=summary,description`
   (API `2` for data-center), then comments
   `.../comment?orderBy=created&startAt=<n>&maxResults=100` page by page when `read-comments`.
   Authorization: `Basic base64(username:token)` when a username is set, else `Bearer <token>`.
   20 s timeout. The story becomes parts: `Description`, then
   `Comment by <author>, <d MMM yyyy>` for each comment, each a list of blocks
   `{code, text}`.
3. **Rich text** (`StoryText`): Atlassian Document Format is walked: `codeBlock` is a code block;
   `text`, `hardBreak`, `inlineCard`/`blockCard` (their URL) and `mention` add text; table cells
   add ` | `; block nodes end with a newline. A plain string is wiki markup, where
   `{code}...{code}` and `{noformat}...{noformat}` are code blocks.
4. **Examples and ECHO's own guess** (`ExampleFinder`):
   - In each block, every span that starts with `{` or `[`, has a matching closing bracket
     (strings skipped) and parses leniently (trailing commas and comments allowed) as a non-empty
     object, or an array holding an object, is an example. It is numbered from 1 and pretty
     printed.
   - In the text between examples: calls `(GET|POST|PUT|PATCH|DELETE) <url or /path>`; named paths
     `endpoint|path|url|uri|resource [:=] [METHOD] <target>` (ignored within 40 characters of the
     same call); and "query parameters" lines (`query string|param|params|parameter(s)` followed
     by `name=value` pairs, joined with `&`). A target is reduced to its path and query
     (`pathOf`: trailing punctuation removed, `%7B/%7D` back to braces, must start with a single
     `/` and be longer than `/`).
   - A call sets the current operation (an existing one with the same path and a compatible
     method is reused; an operation that so far only has a body and no path takes the call). A
     query line fills the current operation's query, or waits for the next call.
   - An example joins the current operation (or starts a path-less one). Its role is `request` or
     `response` when one of the words `request, input, send(s), sent` or
     `response, output, return(s), returned, result, reply` appears in the 150 characters of text
     before it; the nearest word wins.
   - Per operation: request = the last example with role `request`; response = the last with role
     `response`; of the examples without a role, the last becomes the response if none, and the
     first becomes the request if none and the method is not GET or DELETE (and it is not the
     response). Method defaults to POST with a request, else GET. Operations with no examples and
     no path are dropped.
   - A transcript is built for the AI: `# <KEY>: <summary>`, then each part under
     `## <source>`, with each example replaced by `[Example n]` and code blocks fenced.
5. **The AI engine** (`AiExampleLabeler`, only when an `AiProvider` bean exists): sends the fixed
   instructions (asking for `{"operations":[{method, path, query, request, response,
   alternatives, reason}]}`, using only the listed examples by number) and the transcript (cut at
   40,000 characters) followed by `# Examples` with each example (cut at 4,000 characters). The
   answer is checked: example numbers that do not exist are dropped (noted), a method outside the
   five becomes POST with a request else GET, a path that is not a path is emptied (noted), a
   query is appended as `?query`, the reason is cut at 300 characters, and an operation with no
   path and no examples is skipped. If the engine fails, answers something that is not JSON, or
   finds no operations while ECHO's guess has some, the guess is returned with `engine: null` and
   a note ending `ECHO's own guess is shown instead.`
6. **Engines** (`AiProvider`): `completeJson(instructions, input)` and `describe()`.
   `OpenAiCompatibleProvider` posts to `<base-url>/chat/completions[?api-version=...]` with
   `{model, temperature: 0, response_format: {type: "json_object"}, messages: [system, user]}`;
   the key goes in `key-header` (`Bearer <key>` when the header is `Authorization`, else the raw
   key); 10 s connect timeout, `timeout-seconds` per request; reads
   `choices[0].message.content` and strips a Markdown code fence. The bean exists only when
   `echo.ai.provider=openai-compatible` (`@ConditionalOnProperty`); then `base-url` and `model`
   are required at startup.

The Jira token and AI key are never logged or sent to the browser.

---

## 14. Backend HTTP API reference

All under the same origin as the UI. JSON unless noted. Errors are RFC 9457 problem details
(`{type, title, status, detail, instance, ...extra}`); the UI shows `detail`. State-changing
requests need the `X-XSRF-TOKEN` header. "Public" means no login.

| Method and path | Purpose | Answers |
|---|---|---|
| `GET /api/auth/csrf` (public) | Issue the CSRF cookie | 204 |
| `POST /api/auth/login` (public) | `{username, password}` | 200 `{username, roles}`, 401 |
| `POST /api/auth/logout` | | 204 |
| `GET /api/auth/me` | Current user | 200, 401 |
| `GET /api/branding` (public) | Branding | 200 |
| `GET /branding/**` (public) | Logo and favicon files | file |
| `GET /api/camel-catalog/**` (public) | Filtered Camel catalog | file, 404 |
| `GET /api/editor/settings` | Editor settings | 200 |
| `GET /api/editor/apis/{fileName}` | Approved API spec as OpenAPI 3 JSON | 200, 404 |
| `GET /api/flows` | `FlowSummary[]` ordered by ID | 200 |
| `POST /api/flows` | `CreateFlow` | 201 `FlowDetail`, 400, 409 name taken |
| `POST /api/flows/upload` (multipart: `file`, optional `name`, `description`) | Flow zip as a new draft | 201 `FlowDetail`, 400, 409 name taken or `pathClashes` |
| `GET /api/flows/{id}` | `FlowDetail` | 200, 404 |
| `PUT /api/flows/{id}` | `UpdateFlow` (rename, describe) | 200 `FlowDetail`, 400, 409 |
| `DELETE /api/flows/{id}` | Delete the draft and its published folder everywhere | 204, 404, 502 |
| `GET /api/flows/{id}/download` | Zip of the flow as it leaves the editor (`<id>.zip`) | `application/zip` |
| `POST /api/flows/{id}/save-as` | `SaveAs` | 201 or 200 `FlowDetail`, 409 `confirmOverwrite` or name taken |
| `GET /api/flows/{id}/files/{*path}` | One file as `text/plain` | 200, 404 |
| `PUT /api/flows/{id}/files/{*path}` | Body is the content (any content type; empty body is an empty file) | 204 |
| `DELETE /api/flows/{id}/files/{*path}` | | 204, 400 (route file), 404 |
| `PUT /api/flows/{id}/api-spec/{name}` | Save the spec under this file name | 200 `FlowDetail`, 400, 409 `pathClashes` |
| `POST /api/flows/{id}/api-spec/copy-from/{sourceId}` | Copy another flow's spec | 200 `FlowDetail`, 404, 409 |
| `GET /api/flows/api-specs` | `ApiSpecRef[]` | 200 |
| `POST /api/flows/{id}/path-clashes` | `{spec, paths?}` | 200 `PathClash[]` |
| `POST /api/flows/{id}/validate` | Validate the saved draft | 200 `ValidationResult` |
| `GET /api/flows/{id}/run/values` | Placeholders and chosen file | 200 |
| `POST /api/flows/{id}/run` | Start (optional `{fileName, content}`) | 200 `RunInfo`, 409 values needed, 422 invalid, 400 |
| `GET /api/flows/{id}/run` | Status | 200 `RunInfo`, 204 |
| `DELETE /api/flows/{id}/run` | Stop | 204 |
| `GET /api/flows/{id}/run/log?after=` | Log lines | 200 |
| `POST /api/flows/{id}/run/request` | Send a test request | 200 `TestResponse`, 400 |
| `POST /api/flows/{id}/publish` | `{message?, allowMissingRoutes?}` | 200, 409 `clashes` or `missingRoutes`, 422 invalid, 502 |
| `GET /api/flows/{id}/history` | Publish history | 200 |
| `GET /api/publish-targets` | `[{id, name, location}]` of enabled targets | 200 |
| `GET /api/published-flows` | Published flows of the primary target | 200, 502 |
| `GET /api/published-flows/{name}/download` | Zip of the published folder without `echo-flow.json` | zip, 404 |
| `POST /api/published-flows/{name}/draft?replace=` | Published flow as a draft | 201 `FlowDetail`, 404, 409, 422 |
| `POST /api/published-flows/{name}/disable` / `enable` | Set or clear `disabled` | 204, 404, 502 |
| `DELETE /api/published-flows/{name}` | Remove from every target and the linked draft | 204, 404, 502 |
| `GET /api/templates` | Templates of the primary target | 200 |
| `POST /api/templates/from-flow/{flowId}` | `SaveAs` body: Save As Template | 200 `Template`, 400, 409 `confirmOverwrite`, 502 |
| `POST /api/templates/{name}/flows` | `{name, description?}`: new draft from a template | 201 `FlowDetail`, 404, 409, 422 |
| `POST /api/jira/story-examples` | `{link}` | 200 `StoryExamples`, 400, 404, 502 |
| `GET /actuator/health`, `/actuator/info` (public) | | 200 |
| `GET /`, `/login`, `/flows`, `/flows/{id}`, `/flows/{id}/api`, `/playground` | Forward to `/index.html` | UI |


---

## 15. Builder UI: project setup and structure

### 15.1 Dependencies (`builder-ui/package.json`)

Package `echo-builder-ui`, version `0.1.0`, `"type": "module"`, `"packageManager": "pnpm@10.28.0"`, `"engines": {"node": ">=22"}`.

| Dependency | Version |
|---|---|
| `@fontsource-variable/inter` | ^5.3.0 |
| `@kaoto/camel-catalog` | 0.10.6 (exact) |
| `@kaoto/kaoto` | 2.13.0 (exact) |
| `@patternfly/patternfly` | ^6.6.1 |
| `@patternfly/react-core` | 6.6.1 (exact) |
| `@patternfly/react-icons` | ^6.6.1 |
| `@patternfly/react-table` | 6.6.1 (exact) |
| `@tanstack/react-query` | ^5.104.2 |
| `monaco-editor` | ^0.55.1 |
| `monaco-yaml` | ^5.5.1 |
| `react`, `react-dom` | ^19.3.1 |
| `react-router-dom` | ^7.18.4 |
| `yaml` | 2.9.1 (exact) |

| Dev dependency | Version |
|---|---|
| `@playwright/test` | ~1.56.1 |
| `@testing-library/jest-dom` | ^7.0.1 |
| `@testing-library/react` | ^16.3.3 |
| `@testing-library/user-event` | ^14.6.8 |
| `@types/node` | ^26.6.5 |
| `@types/react`, `@types/react-dom` | ^19.3.0 |
| `@vitejs/plugin-react` | ^5.2.0 |
| `jsdom` | ^30.1.2 |
| `sass` | ^1.105.1 |
| `typescript` | ~5.9.3 |
| `vite` | ^7.3.7 |
| `vitest` | ^3.2.7 |

Scripts: `dev` = `vite`; `build` = `tsc -b && vite build`; `preview` = `vite preview`; `test` = `vitest run`;
`test:watch` = `vitest`; `e2e` = `playwright test`; `typecheck` = `tsc -b --noEmit`;
`catalog` and `postinstall` = `node scripts/copy-camel-catalog.mjs`.

### 15.2 Build configuration

`vite.config.ts`:

- Plugin `@vitejs/plugin-react`.
- **Kaoto page replacement.** Kaoto lazy-loads three of its pages with relative imports. ECHO replaces them at
  bundle time, without touching Kaoto: `resolve.alias` entries (regular expressions matched against the import
  text) send `../pages/About` to `src/editor/EchoAboutPage.tsx`, `../pages/DataMapperHowTo` to
  `src/editor/EchoDataMappersPage.tsx` and `../pages/DataMapper` to `src/editor/EchoDataMapperPage.tsx`. The same
  mapping is given to esbuild's dependency optimiser as a plugin named `echo-kaoto-pages` so `pnpm dev` behaves
  the same as the production build.
- SCSS: a custom importer resolves `~package/...` imports from `node_modules`; `quietDeps: true`;
  `silenceDeprecations: ['import', 'global-builtin', 'legacy-js-api']` (Kaoto and PatternFly SCSS).
- Dev server: port 5173, `fs.allow: ['..']` (the playground imports `samples/` from the repo root), proxy of
  `/api/` (with the trailing slash, so `/apicurio-editor` is not caught), `/actuator` and `/branding` to
  `process.env.ECHO_BACKEND_URL ?? 'http://localhost:8080'`.
- Build: `outDir: 'dist'`, `chunkSizeWarningLimit: 20000`.
- Vitest: `globals: true`, `environment: 'jsdom'`, `setupFiles: 'src/test/setup.ts'`,
  `include: ['src/**/*.test.{ts,tsx}']`, `css: false`.

`tsconfig.json`: target and lib ES2022 plus DOM and DOM.Iterable, `module: ESNext`, `moduleResolution: Bundler`,
`jsx: react-jsx`, `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `skipLibCheck`,
`isolatedModules`, `resolveJsonModule`, `noEmit`, types `vite/client`, `vitest/globals`,
`@testing-library/jest-dom`; `include: ['src']`.

`index.html`: title `EY ECHO Builder`, one `<div id="root">`, module script `/src/main.tsx`.

`scripts/copy-camel-catalog.mjs` (postinstall): constants `CAMEL_VERSION = '4.22.1'` and
`RUNTIME = 'camel-springboot'`. It copies from `node_modules/@kaoto/camel-catalog/dist` into
`public/camel-catalog/` only the catalog definitions under `camel-springboot/4.22.1/` (plus the Citrus runtime
entries Kaoto's index requires), the `xslt` and `starter-templates` directories, and writes a rewritten
`index.json` that lists only those definitions. `public/camel-catalog/` is git-ignored. In production the backend
serves the catalog (section 12.2); the copy is what the backend bundles and what the dev server serves.

`scripts/update-apicurio-editor.sh`: refreshes `public/apicurio-editor/` from the container image
`apicurio/apicurio-registry-ui:3.3` (default; overridable), copying `/opt/app-root/src/editors`, deleting
`*.svg`, `*.eot`, `*.ttf` and `pfbg_*.jpg`, keeping the folder's own `README.md`. The folder holds
`index.html`, one `main.<hash>.js`, fonts and the README. It is never edited by hand.

### 15.3 Entry and routing

`src/main.tsx` imports, in order: `@patternfly/react-core/dist/styles/base.css`, the Inter variable font,
`theme/themes.css`, `theme/kaoto-mapping.css`, `theme/echo.css`. It renders `<Playground />` when
`location.pathname` starts with `/playground`, otherwise `<App />`, inside `StrictMode`.

`App.tsx`: `QueryClientProvider` (default options `retry: false`, `refetchOnWindowFocus: false`), then
`BrandingProvider`, then `AuthProvider`, then a `RouterProvider` with `createBrowserRouter`:

| Path | Element |
|---|---|
| `/login` | `LoginPage` |
| `/` (index) | `RequireAuth` > `AppLayout` > `StartPage` |
| `/flows` | `RequireAuth` > `AppLayout` > `FlowListPage` |
| `/flows/:id/api?` | `RequireAuth` > `AppLayout` > lazy `FlowEditorPage` (the optional `/api` suffix shows the Interface Specs view over the canvas) |

`Playground` (`/playground`, used by one e2e test and for manual checks) shows `KaotoEditorHost` with
`InMemoryFlowFiles` and `samples/flows/orders/orders.camel.yaml` imported with `?raw`, plus a "Read YAML" button
and outputs with test ids `read-yaml`, `change-count`, `yaml-out`, `files-out`.

### 15.4 State management

There is no global store. State is of three kinds:

1. **Server state** in TanStack Query. Query keys: `['auth','me']`, `['branding']`, `['flows']` (drafts),
   `['flows','published']`, `['flow', id]`, `['flow', id, 'route', routeFile]` (`staleTime: Infinity`),
   `['flow', id, 'done-steps']`, `['flow', id, 'run']` (refetched every 15 s), `['flow', id, 'run-values']`,
   `['flow', id, 'mapped-xsl']`, `['flow', id, 'history']`, `['editor-settings']` (`staleTime: Infinity`),
   `['templates']`, `['approved-api', uri]` (`staleTime: Infinity`), and the spec panel's own keys (section 18).
   Mutations invalidate `['flows']` (which, being a prefix, also refreshes the published list) and `['flow', id]`.
2. **Component state** (`useState`, `useRef`) inside `FlowEditor` and the modals: dirty flags, open dialogs,
   messages, validation result, the latest YAML from Kaoto.
3. **Kaoto's own state**, reached only through the editor handle (`getContent`, `setContent`) and by pressing
   Kaoto's own DOM controls. ECHO never reaches into Kaoto's stores except in the three replaced pages.

`localStorage` holds one key, `echo.lastFlowId`, the last opened draft (used by Cancel on the flows page).

### 15.5 API client (`src/api/client.ts`)

`api<T>(path, init?: RequestInit & { json?: unknown }): Promise<T>`:

- Sends `Accept: application/json`, `credentials: 'same-origin'`; when `json` is given, the body is its JSON with
  `Content-Type: application/json`.
- For every method other than GET and HEAD it reads the `XSRF-TOKEN` cookie; if there is none it first calls
  `GET /api/auth/csrf`, then reads the cookie again. The value goes in the `X-XSRF-TOKEN` header.
- A non-2xx answer is parsed as JSON when possible and thrown as
  `new ApiError(status, details.detail ?? details.message ?? \`Request failed (${status})\`, details)`.
  `ApiError` has `status`, `message` and `details` (the whole parsed body, so callers read `nameTaken`,
  `confirmOverwrite`, `clashes`, `missingRoutes`, validation results and run values from it).
- 204 gives `undefined`.

`src/api/flows.ts` wraps every endpoint of section 14 (`flowsApi`, `templatesApi`, `publishedFlowsApi`,
`runApi`, `validateFlow`, `publishTargets`, `publishFlow(id, message, allowMissingRoutes = false)`,
`flowHistory`, `editorSettings`, `approvedApiSpec`). Details that matter:

- `flowsApi.readFile` answers `undefined` for 404. `writeFile` sends `text/plain`.
- `flowsApi.upload` sends `FormData` (`file`, and `name`, `description` when not empty).
- `downloadFlow(id)` and `downloadPublishedFlow(name)` click a temporary `<a download>` pointing at the zip URL.
- `isValidDisplayName(name)`: trimmed length 1 to `MAX_DISPLAY_NAME_LENGTH` (the same limit as the backend).
  `flowIdFor(name)` is a line by line mirror of the backend's `FlowNames.idFor` (section 7.2) so the dialogs can
  show the ID while the user types.
- `needsOverwriteConfirmation(e)`: `ApiError` with status 409 and `details.confirmOverwrite === true`.
  `nameTakenOf(e)`: the `details.nameTaken` object of a 409, or `undefined`.
- `runApi.status` answers `null` for 204.

`src/api/jira.ts`: `storyExamples(link)` posts `{link}` to `/api/jira/story-examples`.

### 15.6 Authentication and branding in the UI

- `AuthProvider` loads `GET /api/auth/me` (401 becomes `null`; `staleTime: Infinity`). `login(username, password)`
  posts and stores the answer in the query cache. `logout()` posts and stores `null`.
- `RequireAuth` shows a centred spinner while loading and otherwise redirects to `/login` with
  `state.from = location`.
- `LoginPage`: a centred card. Header is `BrandLogo`. Title "Log in to EY ECHO Builder". Fields "Username" and
  "Password", button "Log in" (disabled until both are filled, spinner while sending). Errors: 401 gives
  "Wrong username or password.", anything else "Could not log in. Try again.". Success navigates to
  `state.from ?? '/'` with `replace`.
- `branding.ts`: `PRODUCT_NAME = 'EY ECHO Builder'`; `THEMES = ['studio','graphite','blueprint','navy','slate','contrast']`;
  `DEFAULT_THEME = 'navy'`; `DARK_THEMES = {'graphite'}`. `applyBranding(b)` sets
  `document.documentElement.dataset.echoTheme` (unknown names fall back to navy), toggles the class
  `pf-v6-theme-dark` for dark themes, sets or removes the inline tokens `--echo-brand`, `--echo-brand-hover`,
  `--echo-on-brand`, `--echo-accent-text`, `--echo-masthead-background`, `--echo-masthead-text` from the optional
  colours of the branding answer, sets `document.title` to the product name and the favicon `<link rel="icon">`
  to the branding's favicon URL.
- `BrandingProvider` (query `['branding']`) renders nothing until the answer (or its failure) arrives, so the page
  never flashes another theme. On failure it uses `DEFAULT_BRANDING`.
- `BrandLogo`: `<img class="echo-brand__logo">` (hidden if it fails to load) followed by the product name with the
  letters "EY" in `<span class="echo-brand__ey">` (coloured `#FFE600`).

### 15.7 Layout (`layout/AppLayout.tsx`)

A PatternFly `Page` with a `Masthead` (class `echo-masthead`). Left: `BrandLogo` as a link to `/`. Right:
"User: <username>" (`data-testid="current-user"`) and a small secondary "Log out" button, which calls `logout()`
and then `window.location.assign('/login')` (a full reload, so no state of the previous user survives). There is no
side navigation. The page body is `<Outlet />`, with `isContentFilled` so the editor can take the full height.

---

## 16. Builder UI: screens outside the editor

### 16.1 Start page (`/`)

A centred card (`echo-start__card`) with a PatternFly `EmptyState`: title "Start with a flow" (h1), body
"Every flow has a name of its own. Start a new flow, or open one that exists, to work on it.", primary button
"New Flow", secondary "Open Flow" (navigates to `/flows` with `state: {from: '/'}`), and link buttons
"Open Flow Template" and "Upload Flow". There is no untitled canvas: a flow always has a name before any work.

- New Flow opens `FlowFormModal`; on Create the new draft opens on `/flows/<id>/api` (Interface Specs > Design).
- Open Flow Template and Upload Flow open their dialogs; the new draft opens on the canvas `/flows/<id>`.

### 16.2 Name dialogs

**`FlowFormModal`** (New flow, Rename flow). Small modal. Fields: "Name" (required, autofocus) and "Description"
(3 rows). Under Name a helper line from `flowNameHint`:

- empty: "Any name, e.g. First Flow. ECHO makes the flow's ID from it."
- too long: "Use at most <MAX> characters." (error style)
- otherwise: "ID: <id> (its folder in Git is flows/<id>/)." and, when renaming, "ID: <id> (its folder in Git is
  flows/<id>/; renaming keeps it)." For templates the folder is `templates/<id>/`.

The ID preview (`useFlowIdPreview`): when renaming, the kept ID; else, if a draft has exactly this display name
(ignoring case), that draft's ID; else `flowIdFor(name)`.

**Name taken, seen before submitting** (`useNameTaken(name, self?)`): looks at the cached drafts and published
flows, skipping `self`. A draft or published flow is in the way when its display name or ID equals the typed name
ignoring case ("A flow named '<existing>' already exists."), or when its ID equals the ID the typed name would
make ("The name '<typed>' makes the ID <id>, which flow '<existing>' already has."). The server makes the same
check and its 409 (`nameTaken`) is shown the same way.

**`NameTakenAlert`**: inline warning (`data-testid="name-taken"`) with the message as title, body "Every flow
needs a name of its own.", and the action links "Open <existing name>" (not offered when renaming) and "Choose
another name" (clears the refusal, focuses and selects the name field). Open navigates to the existing draft, or
first creates a draft from the published flow (`POST /api/published-flows/{name}/draft`) when there is none.

Submit buttons are disabled while the name is invalid or taken. Buttons: "Create" / "Save" and "Cancel".

**`OpenTemplateModal`** ("Open Flow Template", description "Start a new flow from a template stored in Git. The
template itself is not changed."): select "Template" (first one preselected; the chosen template's description
below it), "New flow name" (same hint and taken handling), "Description" (2 rows, placeholder "Leave empty to use
the template's description"), buttons "Open" and "Cancel". Empty list: info alert "There are no templates yet" with
"Open a flow and choose Save As Template from the Save menu.". Load failure: "Could not read the templates:
<message>".

**`UploadFlowModal`** ("Upload flow", description "Choose a flow .zip saved with Download. It opens as a new
draft."): file input "Flow file" (`accept=".zip,application/zip"`), optional "Name" (helper "Leave empty to keep
the name in the file. Any name, e.g. First Flow."), "Description", buttons "Upload" and "Cancel". Server refusals
(taken name, clashing paths, bad archive) are shown as the error or the name-taken alert.

**`SaveAsModal`** (Save As and Save As Template; title and description passed in): one "Name" field with the same
hint. On 409 with `confirmOverwrite` a warning (`data-testid="overwrite-warning"`) with the server's message as
title and "Its current content will be replaced by this flow." appears and the primary button becomes a danger
"Replace" that repeats the call with `overwrite=true`. On `nameTaken` the name-taken alert appears. Changing the
name clears both.

### 16.3 Flows page (`/flows`): Open Flow and Manage Flows

Title "Open Flow", or "Manage Flows" when reached with router state `manage: true`. Both are the same page.

Rows: every published flow (from `GET /api/published-flows`) and every draft (from `GET /api/flows`), sorted by
display name (case-insensitive, `localeCompare` with `sensitivity: 'base'`), then by ID, a published row before
the draft row of the same flow. If the published list cannot be read, a warning "Could not read the published
flows" with the error and "Only the drafts in the Builder are shown." appears and the drafts are still listed.

Toolbar: search field "Search flows" (matches display name, ID or description, case-insensitive substring),
checkboxes "Published" and "Unpublished" (both ticked at first; a draft row counts as published when its status is
`PUBLISHED`), and "Cancel". Cancel goes back to where the user came from (`state.from`), else to the last opened
draft if it still exists, else to `/`.

Table "Flows" (compact), columns Name, Description, Status, Where, Last changed, Delete, Actions:

| | Draft row | Published row |
|---|---|---|
| Name | Link to `/flows/<id>`; under it "ID: <id>" when the display name differs from the ID | Link-styled button that opens the published flow; same ID line |
| Status | Blue label "Draft" or green "Published" | Green "Published v<version>" (version when known), plus grey "Disabled" |
| Where | "Builder" | The target name, default "Git" |
| Last changed | "<local date time> by <user>" | "<date time> by <user or 'unknown'>", or "Added outside the Builder" when there is no publish metadata |
| Delete | Danger secondary button with trash icon, `aria-label="Delete <name>"` | Same |
| Actions (kebab) | Open, Download, Rename | Open, Download, Disable or Enable |

Opening a published row: if it has no draft, a draft is created from it and opened. If it has a draft with no
unpublished changes, the draft is opened. If the draft has changes (`draftChanged`), a dialog asks
"Open <name> from <target>?": "Your draft of this flow in the Builder has changes that are not in <target>. Replace
the draft with the <target> version (your unpublished changes are lost), or open your draft as it is." with buttons
"Replace draft with <target> version" (danger; `replace=true`), "Open my draft" and "Cancel".

Disable dialog "Disable <name>?": "The flow stays in <target>, but the pipeline leaves it out of the images it
builds from now on, so it stops running once the next build is deployed. Publishing a new version keeps it
disabled; use Enable to build it again." Buttons "Disable" (danger) and "Cancel". Enable has no dialog.

Delete dialog "Delete <name>?" with one of four texts:

- published row with a draft: "The flow is removed from every publish target, so the pipeline stops building it
  (Git keeps the old version in its history). Its draft in the Builder is deleted too."
- published row without a draft: the first sentence only.
- draft row whose flow is published: "This deletes the draft from the Builder, and the published version is
  removed from every publish target, so the pipeline stops building it (Git keeps the old version in its history)."
- draft never published: "This deletes the draft from the Builder. It was never published, so the publish targets
  are not changed."

Empty states: "No flows yet" ("Create a flow to start designing an integration, or upload one you saved.") with
buttons "New flow", "Open Flow Template", "Upload flow", "Cancel"; and "No flows match" ("Try a different search."
or, with both checkboxes cleared, "Tick Published or Unpublished to see flows.").

---

## 17. Builder UI: the flow editor

### 17.1 Embedding Kaoto (`src/editor/`)

Kaoto 2.13.0 is used as published, through its editor (Kogito envelope) API. `KaotoEditorHost` creates it once per
mount:

```ts
const editor = new KaotoEditorFactory().createEditor(envelopeContext, {
  resourcesPathPrefix: '', fileExtension: 'yaml', initialLocale: 'en', isReadOnly: false,
  channel: 'EMBEDDED', workspaceRootAbsolutePosixPath: '/',
});
```

`editor.af_componentRoot()` is rendered into **its own React root** (`createRoot` on a div inside the host),
because Kaoto brings its own hash router. Before creating it the URL hash is cleared. After Kaoto announces it is
ready, `editor.setContent(path, initialContent)` loads the route file. Another flow means another mount
(`key={id + ':' + routeFile}`). Failure shows "Could not start the flow editor: <error>".

`createEnvelopeContext(catalogUrl, files, callbacks)` builds the channel API Kaoto calls:

| Kaoto call | ECHO's answer |
|---|---|
| `getVSCodeKaotoSettings` | `{catalogUrl, runtimeCatalogName: 'Camel Spring Boot 4.22.1', colorScheme: 'light', nodeToolbarTrigger: 'onSelection'}` (the step toolbar shows only on the selected step). `catalogUrl` defaults to `/api/camel-catalog/index.json`. |
| `getMetadata(key)` / `setMetadata(key, value)` | A JSON object in the flow's `.kaoto` file. Writes are serialised (one after another, each reading the latest file) so concurrent keys are not lost. |
| `getResourceContent(path)`, `isResourceExist`, `saveResourceContent`, `deleteResource` | `FlowFiles.read / write / remove` (paths normalised: leading `./` and `/` dropped). |
| `askUserForFileSelection(pattern)` | `callbacks.pickFiles(pattern)`, then the picked files are written to the flow and their names returned. |
| notification `kogitoEditor_ready` | `onReady` |
| notification `kogitoWorkspace_newEdit` | `onNewEdit(edit.id)`: Kaoto puts the whole new YAML in `edit.id`; the host passes it to `onChange`. |

`FlowFiles` is `{read(path), write(path, content), remove(path), list()}`. `ApiFlowFiles` implements it over the
draft's file endpoints, so side files (DataMapper `.xsl`, schemas, `.kaoto`) are saved to the draft the moment
Kaoto writes them. `InMemoryFlowFiles` is for tests and the playground. Constants: `KAOTO_METADATA_FILE = '.kaoto'`,
`DONE_STEPS_FILE = '.echo-done.json'`.

The handle the page uses: `getContent(): Promise<string>`, `setContent(yaml): Promise<void>`,
`downloadDiagram(fileName): Promise<void>`.

**Slots injected into Kaoto's DOM.** A `MutationObserver` on the host keeps these in place (Kaoto re-renders
freely), each filled through a React portal:

| Slot | Where | What goes in |
|---|---|---|
| `li.echo-kaoto-host__tab-start` | first item of Kaoto's tab list (`.pf-v6-c-tabs__list`) | File menu, Interface Specs menu |
| `li.echo-kaoto-host__tab-design` | before Kaoto's Design tab (`[data-testid='design-tab']`) | "Flow" menu |
| `li.echo-kaoto-host__tab-advanced` | before Kaoto's About tab (`[data-testid='about-tab']`) | Run menu, Advanced menu |
| `div.echo-kaoto-host__tab-actions` | end of the tab bar region (`:scope > .shell > div[role='region']`) | Publish Flow button, status, save state, "Flow: <name>" |
| canvas toolbar slot | after `.context-toolbar [data-testid='clipboardButton']` | Download Flow, Download Flow As Image, Validate, problems button, the two REST checkboxes |
| view control slots | after `.pf-topology-control-bar #reset-view` | Fit Route, Maximize |

Kaoto's own tabs stay in the DOM but are hidden by CSS; ECHO's menus press them (`openKaotoTab(testId)` clicks
the hidden tab). Kaoto's "DataMapper" tab is relabelled "Datamappers" and stays visible, as does About.

**The tab line, left to right:** File, Interface Specs, Flow, Datamappers, Run, Advanced, About, then at the right
end: `Publish Flow` button, `Draft`/`Published` label, "Unsaved changes" or "Autosaved at HH:MM", "Flow: <name>".
The menus have no caret. `KaotoTabMenu` is a PatternFly `Dropdown` with a `MenuToggle variant="plainText"`, class
`echo-tab-menu`, plus `echo-tab-menu--current` while the Kaoto tab it stands for is selected; its popper is
appended to `document.body`. `tabUnderline.ts` moves PatternFly's tab accent line (the CSS variables
`--pf-v6-c-tabs--link-accent--start`, `--pf-v6-c-tabs--link-accent--length` on the tab list) under the menu that
stands for the current view, so the line always marks where the user is.

Menus close on a pointer press outside (capture phase; anything inside `.pf-v6-c-menu` or the expanded toggle is
"inside"), on Escape, and when the window loses focus to an iframe (the Apicurio editor), through
`useDismissMenu(open, setOpen)`.

**The cover.** `cover` is rendered in an absolutely positioned div over the canvas, with `top` equal to the tab
bar's height (measured with a `ResizeObserver`). It stays mounted while hidden (`coverVisible=false` hides it with
CSS), so the Interface Specs editor keeps its state when the user looks at the canvas. Pressing any Kaoto tab or
ECHO menu item that shows a Kaoto view calls `onKaotoViewPicked`, which hides the cover.

**Fit Route and Maximize** (`CanvasViewButtons`, `canvasZoom.ts`). Fit Route (`#echo-fit-route`) zooms and pans so
the selected route, or the whole flow when none is selected, fills the canvas with 40 px padding, up to
`MAX_FIT_SCALE = 2.5` (Kaoto's own "fit" stops at 100%). It is done from outside: read the current d3 zoom from the
canvas `svg.__zoom.k`, pan, then dispatch a synthetic `WheelEvent` whose `deltaY = -log2(factor) / 0.002` at the
point that must stay fixed. Tooltips: "Fit Route: enlarge the selected route to fill the canvas" and "Fit Route:
enlarge the flow to fill the canvas (select a route to fit only that one)". Maximize (`#echo-maximize-canvas`,
tooltips "Maximize: the canvas fills the window" and "Restore (Esc)") toggles the body class
`echo-canvas-maximized` and the host class `echo-kaoto-host--maximized` (the editor covers the window, masthead
hidden), then fits the route. Escape restores, unless a modal or backdrop is open.

**Selected route.** `selectedRoute.ts` finds the selected node's route group (`data-id="<routeId>|route"`, from
`.pf-topology-visualization-surface [data-selected='true']`), and a generated `<style>` outlines that group's
`.custom-group__container` with 2 px of `var(--echo-brand)` plus a soft shadow and marks its row in Kaoto's Routes
list with `--echo-selected`.

**Disabled routes.** `disabledRoutes.ts` reads the route ids with `autoStartup: false` from the YAML and generates
CSS that appends a "Disabled" pill after the first cell of that route's row in Kaoto's Routes list
(`#flows-list tr[data-testid="flows-list-row-<id>"] td:first-child::after`).

**Canvas scroll bars** (`canvasScrollbars.ts`): two 12 px tracks (2 px padding) drawn over the canvas, a vertical
one at its right edge (at the split with the step form when that is open) and a horizontal one at the bottom. A
bar shows only when the drawn flow reaches beyond the visible canvas on that axis. The scrollable extent is the
union of the view and the diagram's bounds; thumb length is `track * view / extent`, at least 28 px. Dragging a
thumb pans the canvas (by moving the d3 zoom transform), the diagram moving `hidden / free track` pixels per
thumb pixel.

**Diagram image** (`diagramImage.ts`): Kaoto has its own "export as image" button
(`[data-testid="exportImageButton"]`), which draws the whole flow and downloads `kaoto-flow.png` by clicking a
temporary anchor. ECHO presses that button with `HTMLAnchorElement.prototype.click` temporarily replaced, takes
the blob from the anchor's `href` instead of letting it download (20 s time-out: "The diagram image was not
created in time"; if the button is not on screen it first goes to Kaoto's Design view and waits up to 5 s, else
"The flow diagram is not available"), crops it to the non-transparent pixels, adds a 40 px margin on a white
background, and saves it as `<flow id>.png`.

**File picking for Kaoto** (`pickFiles(pattern)`): a hidden `<input type="file" data-testid="kaoto-file-picker">`.
`accept` is `.xsd,.xml` for Kaoto's XML-only pattern and `.json,.xsd,.xml` when the pattern includes JSON. When JSON
is allowed and the flow has a spec, `SpecSchemaPickerModal` is shown first: it lists the request and response
bodies of the flow's spec operations so the user can attach one as a generated JSON schema file
(section 19), or press "Upload File" for the plain file input.

**Replaced Kaoto pages.**

- About (`EchoAboutPage`): heading "EY ECHO (V2.0)." and the line "Developed By : Sony Antony". Nothing else.
- Datamappers list (`EchoDataMappersPage`, replaces Kaoto's DataMapper how-to page): title "Datamappers", intro
  "The DataMappers in this flow, named by their descriptions as on the canvas. Click one to open it.", a table with
  columns "Datamapper", "Route", "Step ID"; a row click navigates Kaoto's router to `/datamapper/<stepId>`. Empty
  state "This flow has no DataMappers" with "Add a Kaoto DataMapper step to a route on the Flow > Design canvas. It
  is listed here by its description.". A DataMapper is a `step` EIP whose `id` starts with `kaoto-datamapper` and
  that contains a `to` whose URI starts with `xslt-saxon` (`dataMapperList.ts`). Its name is the step's
  `description`, or the id when it has none.
- One DataMapper (`EchoDataMapperPage`): a back arrow labelled "All Datamappers", the DataMapper's name with
  "in <route>", then Kaoto's own `<DataMapper vizNode={...}>` built from Kaoto's entities, so it also works for
  routes hidden on the canvas. Unknown id: "This flow has no DataMapper <id>.".

Only these three pages import from Kaoto's internals (`kaotoInternals.ts` re-exports `EntitiesContext`,
`SettingsContext` and `DataMapper` from `@kaoto/kaoto/lib/...`).

### 17.2 The editor page (`flows/FlowEditorPage.tsx`)

`FlowEditorPage` renders `<FlowEditor key={id} />`. It loads the flow (`['flow', id]`), its route file text, the
done steps (`.echo-done.json`, a JSON array of step ids; anything unreadable counts as empty), the editor settings,
and, when Run is enabled, the run status and run values. Loading shows a centred spinner ("Loading flow"); failure
shows a danger alert "Could not open this flow" with the link "Back to flows". The opened draft is remembered in
`localStorage` (`echo.lastFlowId`).

Page structure: a header section holding, in this order, the page message (inline alert, closable; success
messages are plain), the DataMapper review warnings (section 19), the validation result, and the Run panel; under
it the canvas (`KaotoEditorHost`) takes the rest of the height. Dialogs are rendered at the end.

**Dirty tracking.** `savedYaml` (ref) is the text last written to the server, `latestYaml` the last text Kaoto
reported. `dirty = latestYaml !== savedYaml`. The spec panel reports its own `specDirty`. "Unsaved changes"
(`data-testid="unsaved"`) is shown when either is set; otherwise, after an autosave, "Autosaved at HH:MM"
(`data-testid="autosaved"`).

On load, "Attention" labels that no longer apply are stripped from the route text (`withoutAttentionLabels`,
section 18.6); if that changed the text, the flow starts dirty so the next save stores it.

**Save** (`save(auto = false)`): reads the YAML from Kaoto, `PUT`s the route file, updates `savedYaml`, then
invalidates `['flow', id]` (exact) and `['flows']`. Manual save shows "Saved."; autosave only sets the autosaved
time. Failure: "Could not save: <message>". `saveAll` (File > Save, Ctrl+S) saves the route and then the spec
(`specPanel.saveIfChanged()`).

**Autosave** (`useAutosave`): every `autosaveSeconds` (from editor settings; 0 or less turns it off) it calls
`save(true)` if the flow is dirty and nothing else is busy (saving, validating, publishing, starting a run). The
interval is not reset by edits. Autosave covers the route file only; the spec is saved by its own Save button, by
File > Save, or by the actions that need it saved.

**Keyboard.** A capture-phase `keydown` listener on `window`: Ctrl+S or Cmd+S saves all, Ctrl+O or Cmd+O opens
Open Flow Template. Both `preventDefault` and `stopPropagation`. They do nothing while a modal is open
(`.pf-v6-c-modal-box` in the document). Alt or Shift held: ignored.

**Leaving with unsaved changes.** `useBlocker` blocks navigation to another page (moving between `/flows/<id>` and
`/flows/<id>/api` is not leaving) while unsaved, with the dialog "Leave without saving?" and the text "Your changes
to this flow have not been saved." or, when only the spec is dirty, "Your changes to this flow's OpenAPI spec have
not been saved."; buttons "Leave" (danger) and "Stay". A `beforeunload` handler covers closing the tab. After Save
As and Switch to another flow the block is skipped (the work was saved under the other name).

### 17.3 Menus

**File** (class `echo-file-menu`). Items, with their descriptions:

| Item | Description | Does |
|---|---|---|
| New Flow | Start a new, empty flow | `FlowFormModal`; opens the new draft on Interface Specs > Design |
| Open Flow Template (Ctrl+O) | Start a new flow from a template stored in Git | `OpenTemplateModal` |
| Open Flow | Pick a flow from the list of flows | `/flows` with `state.from` |
| Manage Flows | Delete, rename or open flows from the list of flows | `/flows` with `state.manage` |
| Upload Flow | Open a flow .zip saved with Download, as a new draft | `UploadFlowModal` |
| (divider) | | |
| Save (Ctrl+S) | | `saveAll`; disabled while saving |
| Save As | Save this flow under another name and continue there | `SaveAsModal`, initial name "<display name> copy" |
| Save As Template | Store this flow in Git's templates folder for Open Flow Template | `SaveAsModal kind="template"`, initial name the display name |
| (divider) | | |
| Publish Flow (upload icon) | Save and publish this flow so the pipeline can build it | `PublishModal` |

Shortcuts are shown right-aligned in the item (`span.echo-menu-shortcut`).

Save As sends what is on screen (`POST /api/flows/{id}/save-as` with the current YAML). The dialog's description:
"Saves what is on screen as a draft with another name and opens it. This flow keeps its last saved version." If
the answer is this same flow (saved over itself), the page shows "Saved."; otherwise it navigates to the copy.
Save As Template's description: "Saves what is on screen as a template in Git's templates folder. Pipelines do not
build templates."; success message "Saved as template <name>.".

**Interface Specs** (`ApiSpecMenu`, section 18.2).

**Flow** (`KaotoTabMenu` label "Flow"):

| Item | Description |
|---|---|
| Design | The drag and drop canvas |
| Add Route For Operation | A route for an operation of the Openapi spec |
| History | When and where the flow was published |
| (divider) | |
| Download <flow id> | All the flow's files as a .zip you can upload again later |
| Download <flow id> As Image | A picture of the whole flow diagram (.png) |

**Run** (only when `runEnabled`; class `echo-run-menu`):

| Item | Description |
|---|---|
| "Run <name>" or, while running, "Restart <name>" (play icon) | "With the values in <file>" when a properties file is remembered, else "Restart the flow with your latest changes" while running, else "Run this flow inside the Builder and send it test requests" |
| "Run <name> With..." (file icon) | Choose a properties file and run with its values |

**Advanced**: one item "Java Beans" ("Define Java beans the flow's steps can use"), which presses Kaoto's Beans tab.

**About**: Kaoto's tab, showing the replaced page.

**Right end of the tab line** (`FlowNameTag`): primary small button "Publish Flow" (class `echo-publish-flow`,
title "Publish <name> so the pipeline can build it", disabled while saving or validating), the status label, the
save state, and `span.echo-flow-name-tag` (`data-testid="flow-name-tag"`) "Flow: <display name>" with the title
"Flow: <name> (ID: <id>, its folder in Git is flows/<id>/)".

### 17.4 Canvas toolbar

In Kaoto's canvas toolbar, after its own buttons: "Download Flow" (download icon), "Download Flow As Image" (image
icon), "Validate" (check icon; title "Validate <name>: check the flow for problems before publishing it"), the red
problems button when there are problems, and two checkboxes on one line:

- "Client Request Validation" (`#echo-rest-clientRequestValidation`), title "A request missing a body, query
  parameter or header the spec requires, or of the wrong content type, gets a 4xx before the flow runs".
- "Enable CORS" (`#echo-rest-enableCORS`), title "Lets web pages on other sites call this flow from the browser".

Each is disabled when the flow has no spec and the setting is off (title "Needs an OpenAPI spec: design one in
Interface"). Ticking edits the route file itself (`restSettings.ts`): the first list entry with a
`restConfiguration` key gets `clientRequestValidation: true` or `enableCORS: true`; when there is none, a
`- restConfiguration: {…}` entry is put first. Unticking deletes the key, and deletes the whole
`restConfiguration` entry when it becomes empty; an empty document is written as the empty string. The YAML is
edited with the `yaml` library's `Document` API (comments and order kept) and printed with `indentSeq: true`.
New flows start with both on (section 7).

Downloading the zip saves first when dirty.

### 17.5 Validate and the red circles

Validate saves when dirty, then calls `POST /api/flows/{id}/validate`.

- Valid: a plain success alert "The flow is valid." (`data-testid="validation-result"`), closable.
- Problems: no banner. Each problem is placed on the canvas when it can be (`stepProblems.ts`). The route YAML
  is parsed with line positions and every step is given an id in Kaoto's node id form,
  `<routeId>|route.from.steps.<i>.<processor>...` (branches `when`, `otherwise`, `doCatch`, `doFinally`, `onWhen`
  are steps of their own; the route itself is `<routeId>|route.from`), with its first and last line. A problem
  in the route file with a `line` goes to the innermost step whose lines contain it; every other problem (other
  files, no line) is "other" and is listed in the toolbar popover.
  `StepProblemBadges` appends a `<button class="echo-step-problem">` showing the count to the step's node on
  the canvas (to its icon container, or the group's title for containers; if the exact node is collapsed away, the
  nearest ancestor node that is drawn). Pointer events on it do not reach the canvas. Title: "N problems: click to
  see them" ("N things to do" for to-do circles). Clicking opens a popover to the right, header "N problems on
  <step label>", a list of the messages (each followed by "(<file>:<line>)" when it has a line), and a footer
  link "Clear" for validation problems or "Mark as done" for to-do circles.
- The toolbar button (danger, exclamation icon, `data-testid="validation-problems"`) reads "1 problem" or
  "N problems". Its popover header: "N problems to fix before publishing". Body: when some are on steps, "They
  are on steps of the flow: click the red circle on a step to see its problems." ("It is ... its problem." for one;
  "K of them are/is on steps of the flow: ..." when there are also others), then the list of the others as
  "**<place>** <message>". Footer link "Clear the problems". The popover opens by itself when there are problems
  that are not on a step.
- The count follows the circles: clearing a circle removes its problems from the button; editing a step after
  Validate drops that step's problems (the step's YAML at validation time is remembered and compared,
  `problemsLeft`).

**To-do circles without Validate** (`scaffoldAttention(yaml, doneIds, mappedXslFiles)`). Steps of a scaffolded
route that still need the user get a circle at once, with one message each:

| Step | Still to do when | Message |
|---|---|---|
| `to` with id `call-...` and `uri: rest-openapi` | no `parameters.operationId` | "Pick the operation this step calls: Operation Id." or, with no `specificationUri` either, "Pick the API and the operation this step calls: Specification Uri and Operation Id." |
| `setHeaders` with id `parameters-<op>-<n>` | headers are exactly as made: first `Accept` = constant `application/json`, the rest `name` + `simple: ${variable.<name>}` | "Match these headers to the operation this step's call picks: name each as the operation names its parameter, and add or remove rows as it needs. Any change marks this done." |
| `setBody` with id `label-...` | `simple` is still `"result": ${body}` | "Name this call's part of the reply: change "result" to a name for it." |
| `step` with id `kaoto-datamapper-...` | its `xslt-saxon` has no file yet, or (scaffold DataMappers only) its `.xsl` has no mapping in it | request mapper (`kaoto-datamapper-request-...`): "Map the request to what the called operation takes: select this step, choose Configure and map its fields in the DataMapper."; otherwise "Map the reply: select this step, choose Configure and map its fields in the DataMapper." |

A step with validation problems shows those instead. "Mark as done" adds the step's own `id` to
`.echo-done.json` (JSON array, 2-space indent, trailing newline), and the circle does not come back. Failure:
"Could not keep it as done: <message>". Which `.xsl` files hold a mapping comes from `mappedXslFiles`
(section 19), refreshed whenever Kaoto writes an `.xsl`.

### 17.6 Publish dialog

`PublishModal` (title "Publish <name>"): the text "The flow is validated, then published to every enabled target.
Your pipeline builds it from there.", a "Description" text area (placeholder "Publish flow <name>"; sent as the
commit message, empty means the server's default), buttons "Publish" and "Cancel". If no target is enabled:
warning "No publish target is enabled in application.yaml.".

Pressing Publish saves when dirty ("Could not save the flow before publishing." on failure), then posts.

| Answer | Shown |
|---|---|
| 200 | Dialog closes. Page message from `publishSummary`: all targets fine and something changed: "Published Successfully"; nothing changed: "Nothing changed since the last publish."; some target failed: warning "<Published to A (location, rev8) and B (...). or Nothing changed...> <name> failed: <error> Publish again to retry." |
| 422 (validation) | Dialog closes; the problems appear as after Validate |
| 409 with `missingRoutes` | Warning "These operations have no route" listing "METHOD path" (with " (its route is disabled)" where so), "Callers get 404 for them. Publish anyway, or add their routes first (Flow > Add Route For Operation)."; the button becomes a warning "Publish Anyway", which posts again with `allowMissingRoutes=true` |
| 409 otherwise | Danger "Not published: other published flows already use these" with the list of `clashes` and "Give this flow its own Base Path or paths in Interface, or rename the operationIds, then publish again." |
| other | The error text |

A target label is "<name> (<location>, <first 8 characters of revision>)", the revision part only when there is one.

**History** (`HistoryModal`, title "Publish history"): table When, Who, Where (one line per target, or
"<name> failed: <error>"), Message. Empty: "Not published yet".

### 17.7 Run in the editor

Starting (`startRun(file?)`): saves when dirty, posts `POST /api/flows/{id}/run` (with the properties file when one
was just chosen).

- 200: the Run panel appears.
- 409 (values missing): `RunWithModal` opens with the answer (`placeholders`, `fileName`, `missing`).
- 422: the validation problems are shown.
- Other: "Could not run: <message>" (or, when the dialog is open, the error inside the dialog).

"Run <name> With..." always opens the dialog (`missing` emptied), after saving.

**`RunWithModal`** (medium; title "Run <name> with"; description "Choose a properties file that sets every value
this flow uses. It is only used for test runs in the Builder: it is not saved with the flow or published."):

- "Properties file" file upload (placeholder "Choose a .properties file", button "Browse...", accepts
  `.properties`). The file is read in the browser and parsed with the Java properties rules that matter
  (`parseProperties`: `#` and `!` comments, `=`, `:` or whitespace separators, backslash line continuation,
  backslash escapes in keys).
- A table "Value the flow uses" / "Value" (or "In <file>"): before a file is chosen, "default <fallback>" or
  "needed"; after, a green check with the value (shown as eight bullets when the name matches
  `/password|passwd|pwd|secret|token|key|credential/i`), a green check with "default <fallback>", or a red icon
  with "not set in this file".
- When the remembered file no longer sets everything: warning "<file> does not set a, b" with "The flow uses
  it/them now. Choose a file that sets every value.". When the chosen file misses values: danger "N value is/values
  are missing from <file>" with "Add a, b to the file and choose it again.".
- No placeholders: "This flow uses no {{values}}, so it runs without a file.".
- "Run" is enabled when there are no placeholders or the chosen file sets every placeholder without a default.

**`RunPanel`** (`data-testid="run-panel"`, a compact card under the tab line):

- Header: green label "Running", "<flow name> on port <port>", and a danger secondary "Stop" button.
- Left column, "Call it from your own tools": one line per endpoint with its methods and a copyable URL; "This flow
  has no platform-http endpoint to call." when none; the link "Open API docs (Swagger UI)" (new tab) when the run
  has a docs URL; the hint "The flow runs inside the Builder. To call a service on your own computer from an http
  step, use host.docker.internal instead of localhost. The run stops after <idleMinutes> minutes without requests."
- "Send a test request": method select (POST, GET, PUT, PATCH, DELETE; first endpoint's first method preselected),
  path field (first endpoint's path), "Send". A JSON body area (5 rows, initial text `{\n  \n}`) is shown and sent
  for all methods except GET and DELETE. The reply shows "Reply", the status as a green (below 400) or red label,
  "<ms> ms", and the body pretty-printed when it is JSON, "(empty)" when empty.
- Right column, "Log" (`data-testid="run-log"`): polls `GET .../run/log?after=<last seq>` every second, keeps the
  last 200 lines, scrolls to the newest, shows the time (HH:MM:SS) and message, ERROR lines in red. The log is
  cleared when the run is restarted (`startedAt` changes).

The run status is refetched every 15 seconds, so the panel disappears on its own after the idle stop.

### 17.8 ECHO controls inside Kaoto's step form

Shown only when the editor settings list approved APIs (`apiTags` not empty). Both find Kaoto's form fields by
their test ids, insert a div before the field, and render into it through a portal; both re-check on every DOM
change and `input` event.

**Tag filter on REST OpenApi steps** (`OperationTagFilter`). When the form has both
`#.parameters.specificationUri` and `#.parameters.operationId`, a select "Tag" appears above Operation Id:
"All tags" and one option per tag, "<tag> (<number of operations>)". The tags are those of the API whose
`specificationUri` is in the form (a `classpath:` prefix is ignored); with no or an unknown URI, the tags of all
APIs merged and sorted. Picking a tag hides the other operations in Kaoto's Operation Id drop-down with a
generated CSS rule (`li` options whose `aria-label` is not `option <id in lower case>` of the tag). The tag is not
saved in the flow; when the form opens it is worked out from the chosen Operation Id.

**Approved API on Enrich steps** (`EnrichApiPicker`). When the form is an Enrich step's (header icon class ending
`.enrich`) a block appears above its expression field:

- radio group "Call": "Approved API" and "URI typed by hand". The initial choice is Approved API when the
  expression is empty or is a `rest-openapi:` URI of an approved API, else typed by hand. With Approved API chosen,
  Kaoto's expression field is hidden with CSS.
- "API" select (the approved APIs by name), "Tag" select ("All tags" and each tag with its count), "Operation Id"
  select (placeholder "Choose an operation"; the tag's operations, or all of the API's sorted).
- Picking an operation writes `rest-openapi:<specificationUri>#<operationId>?<options>` into Kaoto's expression
  (choosing the "Simple" language first when no text area is there yet, then setting the text area's value through
  the native setter and dispatching `input`). `options` are the query part already in the expression, or
  `host=<api host>` when the API has one. Changing the API rewrites the URI with no operation.
- Helper text: "Calls <uri>" once an operation is picked, else "Pick the operation this step calls.".

The radio and tag choices are kept per step while the form is open; they are not saved in the flow.

### 17.9 Routes for operations

Described with the scaffold in section 18.6. The dialogs:

**Add Route For Operation** (`AddOperationRouteModal`; description "Each route you add handles one operation of
the flow's Openapi spec. It logs the call until you design it on the canvas."): a checkbox per operation, labelled
"METHOD path", described by its summary; operations that already have a route are disabled and marked "Has a
route", or "Route is disabled" (orange). Buttons "Add" and "Cancel". Before opening, the spec is saved if changed
("Save the Openapi spec first." if that fails); with no spec: "The flow has no Openapi spec yet: design its
operations in Interface first.". After adding: "Added a route for <operations>. Design it on the canvas." and the
canvas is shown.

**Removing an operation** (`useOperationRoutes`): see section 18.6; the dialog is "Remove its route too?" /
"Remove their routes too?" with "This operation was deleted from the Interface. Its route is still on the canvas."
(plural: "These operations were deleted from the Interface. Their routes are still on the canvas."), the list of
operations, a warning "Other routes call <operations>: those calls fail if the route is removed." when so, and the
buttons "Remove Route(s)" (danger) and "Keep Route(s)".

---

## 18. Builder UI: Interface Specs (the flow's OpenAPI spec)

### 18.1 The vendored editor and how it is hosted

Apicurio's OpenAPI editor (the prebuilt Angular bundle from `apicurio/apicurio-registry-ui:3.3`, folder
`/editors`) is served unmodified from `/apicurio-editor/index.html` and shown in a **same-origin iframe**
(`<iframe class="echo-api-spec__frame" title="OpenAPI editor">`). Being same-origin is what lets ECHO style it
and add controls to it from outside.

`ApicurioEditorHost` (props `initialContent` (JSON text), `onChange(json)`, `onDialogChange(open)`,
`onUpload()`; handle `showNothing()`):

- **Loading content.** After the iframe's `load`, every 200 ms (at most 75 times, stopping once the document has
  an `oai-editor` element) it posts to the frame, with target origin `window.location.origin`:

  ```js
  { type: 'apicurio-editingInfo',
    data: { content: { type: 'OPENAPI', value: initialContent },
            features: { allowImports: false, allowCustomValidations: false },
            openapi: { vendorExtensions: [] } } }
  ```

- **Changes.** The editor posts `{type: 'apicurio_onChange', data: {content}}` on every edit. Messages from other
  sources are ignored. `content` is printed as JSON with 2-space indent and given to `onChange`.
- A new document means a new iframe (`key={editorKey}`); the editor is never told to replace its content.
- **Additions made to the frame's document** on load, each a function that returns its own clean-up and keeps
  itself applied with a `MutationObserver`:

| Addition | What it does |
|---|---|
| `followApicurioTheme` | Appends one `<style id="echo-apicurio-theme">` holding `apicurio-mapping.css` + `themes.css` (imported as text with `?inline`), copies `data-echo-theme` and every inline `--echo-*` property from the host page's `<html>` to the frame's, and repeats when they change. |
| `watchDialogs` | Reports whether an Apicurio dialog (`.entity-editor`) is open. |
| `simplifyBasePathDialog` | The Base Path dialog (section 18.4). |
| `titleCaseSectionLabels` | Section headings Apicurio prints in capitals (text nodes of `.section .section-label` that are all upper case) become Title Case. |
| `addSourceUpload` | Puts an "Upload" button (class `echo-source-upload`, title "Upload an Openapi file (.yaml or .json) as this flow's spec") first in the Source tab's toolbar (`main-form > .detail-actionbar`), so the toolbar reads Upload, Save, As YAML/JSON, Format, Revert. It calls `onUpload` (the panel's file picker; a whole spec only). |
| `addOverviewNav` | The left navigation, delete buttons and back arrows (section 18.3). |
| `fillNewOperationId` | After each change: when exactly one operation has no `operationId` and exactly one empty Operation ID field is on screen, types the ECHO-made id into Apicurio's own inline editor and presses its save, so new operations are named at once (tried every 100 ms, 10 times). The field itself is hidden by CSS. |
| `fillSampleExample` | After each change: for every media type that has just been given a `$ref` to a data type which carries an `example` (made from a sample) and has no example of its own, opens Apicurio's "Add an example" dialog on that row, names it `sample`, puts the data type's example in its Ace editor and presses Add (state machine tried every 100 ms, 40 times). |

### 18.2 The Interface Specs menu and bar

Menu "Interface Specs" on the tab line (class `echo-api-spec-tab`; `aria-current="page"` and the underline while
the spec view is shown). Clicking the toggle only opens the menu (and mounts the panel in the background).

| Item | Description | Does |
|---|---|---|
| Design | The flow's OpenAPI spec: paths, data types and responses | Shows the spec view with nothing selected on the right |
| Upload (upload icon) | Store a .yaml or .json OpenAPI file in this flow, under its own name | File picker |
| Copy From Another Flow (copy icon) | Start this flow's spec from a copy of another flow's | `CopySpecModal` |
| Interface Specs from Samples (code icon) | Make the spec, or add a method to it, from a sample request and response | `SamplesSpecModal` |
| (divider) | | |
| Download Openapi File As Yaml | The spec on screen, unsaved edits included | Download |
| Download Openapi File As Json | The spec on screen, unsaved edits included | Download |

The spec view is the route `/flows/<id>/api`. It is rendered as the cover over the canvas (section 17.1) and stays
mounted once opened.

`ApiSpecPanel` shows a bar above the iframe (where Apicurio's own title bar, hidden by CSS, would show the API's
name; Apicurio's undo, redo and Issues stay at the right):

| Control | Behaviour |
|---|---|
| Radios "Yaml" / "Json" (`role="radiogroup"`, label "File format") | The format the spec file is stored in. Changing it makes the spec dirty; the next save writes `<base>.<format>` and the server removes the file with the other extension. Default Yaml. |
| "Import from Jira using AI" (sparkle icon) | Opens the Jira import. When `jiraImport` is false in the editor settings it looks disabled (`aria-disabled`) with the title "Jira is not set up: add echo.jira base-url and token to the config". |
| "Interface Specs from Samples" | Opens the samples dialog. |
| "Save" (primary) | Saves. Disabled when there is nothing to save and the spec already has a name. |
| "Rename" | `SpecNameModal` titled "Rename". `aria-disabled` until the spec has a name; titles "Save names the spec the first time" or "Save <file> under another file name". |
| "Discard" | With unsaved changes asks "Discard your changes?" ("The editor starts again from a blank spec. **<file>** stays in the flow until you save over it."; buttons "Discard", "Cancel"); otherwise discards at once. Discard opens a blank spec and reports every operation as removed (so untouched routes go, section 18.6). |
| Status text | "Saved <file>.", "Autosaved at HH:MM", "Could not save: ...", and the messages of the actions below. |
| Hidden file input (`data-testid="spec-upload-input"`) | `accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml"` |

**A blank spec** (`newApiSpec(title, description)`):

```json
{ "openapi": "3.0.3", "info": { "title": "<flow display name>", "version": "1.0.0", "description": "<flow description, if any>" }, "paths": {}, "components": {} }
```

**File names.** `SPEC_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(json|ya?ml)$/i`, at most 200 characters. The
default name is `<flow id made safe>-api.<format>` (`defaultSpecBase`: characters outside `[A-Za-z0-9_.-]` become
`-`, leading characters that are not a letter, digit or `_` are dropped, an empty result becomes `flow`).
`SpecNameModal` ("File name" field; hint "Letters, digits, '.', '-' and '_'. The extension follows the format.";
when the typed name gets an extension added, "Saved as <file>. " comes first; when it would replace another file,
a warning "A flow has one spec: this replaces <file>."). The first Save of an unnamed spec opens it titled "Save"
with the default name.

**Saving** (`store(fileName, json)`), in this order:

1. `sampleExamples(json)`: every media type that refers to a data type with an `example` and has no example of
   its own gets `examples: {sample: {summary: "The sample", value: <the example>}}`.
2. `renameOperationIds` with the renames made since the editor was loaded (step 6), then `naturalOperationIds`
   against the last stored spec (section 18.5).
3. `serialize(json, format, previousText)`: JSON is the editor's own text (or the previous file text when the
   content is equal). YAML is **merged into the previous YAML document** when there is one, so comments, key order
   and formatting of an uploaded file survive: maps keep existing pairs and append new keys, sequences are merged
   by index, scalars are updated in place when the type is the same, anything else is replaced by a new node that
   keeps the old node's comments. Printed with `lineWidth: 0`. Without a previous YAML it is a plain
   `YAML.stringify`.
4. `PUT /api/flows/{id}/api-spec?name=<file>` with the text.
5. Status "Saved <file>." (or "Autosaved at HH:MM"). `['flow', id]` and `['flows']` are invalidated; the DataMapper
   review runs (section 19).
6. If operationIds changed, the renames are remembered (`renamedSince`: what the still-open editor shows mapped to
   what is stored) and reported so the routes follow (section 18.5). The editor is **not** reloaded while the user
   looks at it; the named JSON is loaded into it the next time the spec view is hidden (and it has no unsaved
   edits).

The spec **autosaves** on the same interval as the flow, when it is dirty, no dialog is open and it either has a
name or at least one path (then under the default name).

**Upload.** The file must parse as JSON or YAML ("This file is neither JSON nor YAML: ...") and have an `openapi` or
`swagger` field at the top ("This is not an OpenAPI spec: it needs an 'openapi' (or Swagger 2.0 'swagger') field at
the top."); failures show "Could not upload <file>: <reason>". Then:

- If any of its paths is in another flow (`POST /api/flows/{id}/path-clashes` with the text), nothing is uploaded:
  dialog "<file> cannot be uploaded" listing "**<path>** is in flow **<flow>** (as <other path>)" and "A path can be
  in one flow only. Nothing was uploaded.".
- If the file name does not fit the pattern: "Name the uploaded spec" ('"<file>" has characters a file name in the
  flow cannot have. Pick the name to keep it under.').
- If the flow already has a spec or unsaved edits: "Replace the current spec?" ("A flow has one OpenAPI spec. <file>
  replaces **<current>** / the spec on screen, and your unsaved edits are lost."; buttons "Replace", "Cancel").
- Stored at once, under its own file name and in its own format, with its own text as the base of the YAML merge.
  Its operationIds are kept (only missing ones are made); every operation is reported as added, and the ones no
  longer there as removed, so each gets a route.

**Download** gives the spec on screen (unsaved edits included, ids named as a save would), in the asked format,
named `<current or default name>.<format>`.

**Copy From Another Flow** (`CopySpecModal`, title "Copy an OpenAPI spec from another flow"): "This flow gets a
copy, which it then keeps as its own: editing it leaves the other flow alone.", a select "Pick a spec" listing
`<file>` with "From flow <name>" for every other draft that has a spec (`GET /api/api-specs`); warning "A flow has
one OpenAPI spec: <file> is replaced, and unsaved edits in Interface are lost." as applies; button "Copy", or danger
"Replace". None: "No other flow has an OpenAPI spec yet.". Failure: "Could not copy the spec: ...". After copying,
the panel reloads and routes are added and removed for the difference.

### 18.3 Layout inside the editor

Apicurio's layout is rearranged with CSS (`apicurio-mapping.css`) and the navigation added by `addOverviewNav`:

- The left column (`.editor-outline`) starts with ECHO's navigation (`div.echo-nav`), six items
  (`div.echo-nav-item[role=button][data-pane]`, Enter and Space work): **Info** (`fa-info-circle`), **Tag
  Definitions** (`fa-tags`), **Paths** (`fa-sitemap`), **Data Types** (`fa-cube`), **Responses** (`fa-reply-all`),
  **Source** (`fa-code`). Paths, Data Types and Responses show Apicurio's own count in brackets.
- `<html data-echo-pane="...">` in the frame says what the right side shows: `none` (empty, the default and what
  Design shows), `info` and `tags` (parts of Apicurio's main form, which also holds the **Base Path** as the
  first thing under Info), `paths` / `definitions` / `responses` (that list, expanded, placed over the detail pane
  at `--detail-pane-top` / `--detail-pane-left`), `source` (the main form's Source tab). CSS shows and hides
  Apicurio's sections by this attribute. Picking an entry of a list sets `none` so Apicurio's own form for that
  entry shows.
- Every entry of the Paths, Data Types and Responses lists gets a trash button
  (`button.echo-entry-delete`, title "Delete <name>"). It works by opening Apicurio's own context menu on the entry
  (a synthetic `contextmenu` event) and clicking its "Delete" item, so Apicurio's undo and validation still apply.
- An opened data type or response has a back arrow before its name (`button.echo-back`, `fa-arrow-left`, titles
  "Back to Data Types" / "Back to Responses") that shows the list again.
- Apicurio's title bar text, its "Operation ID" fields (ECHO makes the ids), its vendor-extension, security and
  import features that ECHO does not use, and its type icons' pointer cursor are hidden or neutralised by CSS.
- Unpicked type drop-downs ("Choose Type") are bold in the text colour instead of greyed.

### 18.4 Base Path

The flow's Base Path is the path of the spec's first server URL (`servers[0].url`; section 8). The UI presents
Apicurio's Servers section as one "Base Path" field:

- The section shows "/" when no server is set, with a pencil to edit it, and a note that all the flow's paths
  start with it.
- Clicking the row opens Apicurio's server dialog prefilled with the current path (instead of Apicurio's
  expanding row); the URL field's placeholder is `/customers/v1`; as the user types, Apicurio's own "apply"
  button for URL templates is pressed for them; on Save the old server entry is deleted through Apicurio's own
  menu, so there is always at most one server.

### 18.5 operationIds

Users never see or type operationIds. Rules (`operationIds.ts`):

- `operationIdFor(method, path)` = lower-case method + every run of letters and digits in the path, each
  capitalised: `GET /customers/{id}/orders` gives `getCustomersIdOrders`.
- `fillMissingOperationIds(json)`: gives each operation without an id its natural id, with `2`, `3`, ... appended
  while taken. Used when a spec is opened and when operations are imported.
- `naturalOperationIds(json, before?)` (on save) decides one id per operation:
  1. An operation keeps its id when the id is valid (`/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/`), not already taken by an
     earlier operation, and the operation has not moved. "Moved" means the stored spec (`before`) had this id on a
     different `METHOD path`. A moved operation keeps its id only when it already is the natural id for the new
     place (or that plus digits). This is what lets **uploaded specs keep their own ids** while **ECHO-made ids
     follow renamed paths**.
  2. Every other operation gets its natural id, numbered while taken.
  3. Each change of an id that was used by exactly one operation is reported as a rename `{from, to, label}`.
- Renames reach the route file through `renameDirectRoutes(yaml, renames)`: every `direct:<from>` URI (also
  `direct://`, with query) and every `uri: direct` + `parameters.name: <from>` becomes `<to>`; the route whose
  `from` is now `<to>` has its id `route-<from>` changed to `route-<to>` and its description, when it is still a
  "METHOD /path" label, changed to the new label. The canvas is updated and autosaved; when the canvas is not
  mounted the stored route file is rewritten instead.

### 18.6 Routes for operations and the scaffold

Every operation of the spec is served by the route `from: direct:<operationId>` (the REST service ECHO generates
calls `direct:<operationId>`, section 8). The UI keeps routes in step with the spec.

**When operations change** (`ApiSpecPanel.onChange` compares the operations before and after every edit with
`operationChanges`; `useOperationRoutes.onOperationsChanged({added, removed, changed})` applies it to the canvas,
one change after another in a queue):

- **Added** operation without a route: a scaffold route is appended (or, if the user removed that route earlier in
  this session, the removed route is put back). Message "Added a route for METHOD path, ...".
- **Removed** operation with a route: if the route is **untouched** (still exactly a scaffold of any era, or the
  older one-step route `log` with id `log-<operationId>`) it is removed silently. Otherwise the dialog of section
  17.9 asks; "Remove" removes them (remembered for putting back), "Keep" leaves them.
- **Changed** operation (its parameters or body schemas changed) whose route is still an untouched scaffold: the
  scaffold is made again for the new parameters and schemas, in the same era, keeping its description, API and
  host.
- "METHOD /path" route descriptions follow the operation (`relabelRoutes`).
- The `joinWithComma` bean is added when the first scaffold needs it and removed when nothing refers to it.
- The generated schema files for scaffold DataMappers are attached or forgotten (section 19).

A route with a DataMapper whose `.xsl` already holds a mapping never counts as untouched.

**The scaffold** (`routeForOperation(op, apiCall)`), for operation id `OP`, label `METHOD /path`, parameters
`p1..pn` (path parameters first, then query, then header, de-duplicated by name; path-level and operation-level,
`$ref`s into `components/parameters` resolved), with `apiCall = {specificationUri, host, name}` from the editor
settings' `routeCall` (the first approved API; `name` is the API's name without spaces, e.g. `BluePlanet`):

```yaml
- route:
    id: route-OP
    description: METHOD /path
    from:
      id: from-OP
      uri: direct
      parameters:
        name: OP
      steps:
        - setVariables:                      # only when the operation has parameters
            id: variables-OP
            variables:
              - name: p1
                simple: ${header.p1}
        - removeHeaders:
            id: remove-headers-OP
            pattern: "*"
        - setHeaders:
            id: authorization-OP
            description: SetAuthorizationHeaders
            headers:
              - name: Authorization
                simple: Bearer {{api.token}}
        - multicast:
            id: multicast-OP
            description: Parallel Processor
            parallelProcessing: true
            aggregationStrategy: "#joinWithComma"
            steps:
              - pipeline:
                  id: pipeline-OP-1
                  description: <ApiName> Call Path        # only when an approved API is set
                  steps:
                    - setHeaders:
                        id: parameters-OP-1
                        headers:
                          - name: Accept
                            constant: application/json
                          - name: p1
                            simple: ${variable.p1}
                    - step:                               # only for POST, PUT, PATCH
                        id: kaoto-datamapper-request-OP-1
                        steps:
                          - setBody:                      # left out when a request schema is attached
                              id: kaoto-datamapper-set-body-request-OP-1
                              expression:
                                simple:
                                  expression: ${null}
                          - to:
                              id: kaoto-datamapper-xslt-request-OP-1
                              uri: xslt-saxon             # xslt-saxon:kaoto-datamapper-request-OP-1.xsl when attached
                              parameters:
                                failOnNullBody: false     # plus useJsonBody: true when attached
                    - to:
                        id: call-OP-1
                        description: <ApiName> Call       # only when an approved API is set
                        uri: rest-openapi
                        parameters:
                          specificationUri: <approved API's specification URI>   # when set
                          host: "{{api.base-url}}"
                          requestValidationEnabled: true
                    - convertBodyTo:
                        id: to-string-OP-1
                        type: String
                    - setBody:
                        id: label-OP-1
                        simple: '"result": ${body}'
        - setBody:
            id: reply-OP
            simple: "{${body}}"
        - step:                                           # the reply DataMapper
            id: kaoto-datamapper-OP
            steps:
              - setBody: { id: kaoto-datamapper-set-body-OP, expression: { simple: { expression: "${null}" } } }
              - to:
                  id: kaoto-datamapper-xslt-OP
                  uri: xslt-saxon                         # xslt-saxon:kaoto-datamapper-OP.xsl when a response schema is attached
                  parameters:
                    failOnNullBody: false
        - removeHeaders:
            id: remove-reply-headers-OP
            pattern: "*"
        - setHeaders:
            id: reply-headers-OP
            description: SetResponseHeaders
            headers:
              - name: Content-Type
                constant: application/json
              - name: CamelHttpResponseCode
                constant: "200"
```

and, once per route file, first in the list:

```yaml
- beans:
    - name: joinWithComma
      type: org.apache.camel.processor.aggregate.StringAggregationStrategy
      properties:
        delimiter: ", "
```

Details:

- "A schema is attached" means the operation's spec has a JSON body schema for that side: the request body
  (POST, PUT, PATCH only) and the response of status 200, else the first 2xx, else `default` (methods GET, POST,
  PUT, PATCH only). With a request schema the request DataMapper is made with the `source` form
  (`useJsonBody: true`, no `setBody`); with a response schema the reply DataMapper is made with the `target` form
  (`setBody ${null}` kept, URI names the `.xsl`). The other variant leaves the URI as plain `xslt-saxon` (Kaoto's
  "not configured yet" state).
- What the shape is for: the caller's parameters are kept as variables, all inbound headers are dropped so nothing
  leaks downstream, the call's Authorization is set from a placeholder, each parallel branch calls one downstream
  operation and labels its reply `"name": <json>`, the strategy joins the branches with ", ", `{${body}}` makes
  one JSON object of them, the reply DataMapper shapes the answer, and all headers are dropped again before the
  reply headers are set so neither the Authorization nor the downstream's hop-by-hop or CORS headers reach the
  caller.
- Printed with `YAML.stringify(..., {lineWidth: 0})` and appended to the route file text (`appendRoute`: an empty
  file or `[]` is replaced by the route).
- **Eras.** The scaffold changed over time; routes made by older versions must still be recognised as untouched.
  `asScaffold` rebuilds the scaffold for every era (newest first: `reply-strip`, `shared-token`, `variables`,
  `validated`, `described`, `schemas`, `marked`, `request-mapper`, `attention`, `reply-headers`, `content-type`)
  and every combination of attached schemas, and compares it to the route with all `id` keys ignored. The
  differences between eras, oldest to newest: `content-type` ends with a single `setHeader` Content-Type;
  `reply-headers` ends with the SetResponseHeaders step and names the parameters step `SetMethodParameters`;
  `attention` adds the reply DataMapper and marks the parameters, call, label and DataMapper steps with the
  description `Attention`; `request-mapper` adds the request DataMapper for every method; `marked` drops the
  descriptions; `schemas` makes the request DataMapper only for body methods and attaches schemas; `described`
  adds the "Parallel Processor", "<Api> Call Path" and "<Api> Call" descriptions; `validated` adds
  `requestValidationEnabled: true`; `variables` uses one `setVariables` step instead of a `setVariable` per
  parameter (ids `variable-OP-<name>`); `shared-token` uses `{{api.token}}` and `host: {{api.base-url}}` (before:
  `{{<api>.token}}` where `<api>` is the specification URI without `.openapi.json`, and the API's own host);
  `reply-strip` adds the second Remove Headers. A refreshed route stays in its own era.
- `withoutAttentionLabels` (run when a flow is opened) deletes the description `Attention` from steps whose id
  matches `/^(parameters-.+-\d+|call-.+-\d+|label-.+-\d+|kaoto-datamapper-.+)$/`; the red circles replaced those
  labels.

**After the user picks operations** (an effect in the editor page, 800 ms after the route text last changed, only
when it contains `rest-openapi`; functions in `datamapper/callSchemas.ts`):

- The specs of the approved APIs called by the flow are loaded (`GET /api/apis/spec?uri=`).
- For a `call-...` step with a picked `operationId` that the API has: the pipeline's label step
  `"result": ${body}` becomes `"<operationId>": ${body}` (only while it is still `result` or a previous
  operationId), the call's description becomes `<ApiName>:<operationId>` and the pipeline's
  `<ApiName> <operationId> Path` (only while they are still ECHO-made).
- The request DataMapper before the call gets the called operation's request body schema as its **target**, and
  the reply DataMapper gets, as its **source**, one object schema with a property per call label holding that
  operation's response schema; the generated schema files and `.kaoto` metadata are written, and a plain
  `xslt-saxon` URI of such a DataMapper is given its `.xsl` file name. Details in section 19.
- Failure: "Could not attach the called operation's schema: <message>".

### 18.7 A path is in one flow only

Whenever paths are added in the editor (typed, imported, made from samples), `POST /api/flows/{id}/path-clashes`
is asked with the spec and the added paths. If any is in another flow, the dialog "This path is in another flow"
lists "**<Base Path + path>** is already in flow **<flow>** (as <its path>)." and says "A path can be in one flow
only. Switch to that flow to work on it there? This flow is saved without the path." with one button per other
flow, "Switch to <flow>" (the first primary), and the link "Remove the path here". Both remove the clashing paths
from this spec (their operations are reported removed) and save it; Switch then saves the route file and opens the
other flow's draft, creating the draft from the published flow when there is none. Closing the dialog is the same
as removing. Saving also refuses clashing paths on the server (section 8).

### 18.8 Interface Specs from Samples

`SamplesSpecModal` (large; title "Interface Specs from Samples"; description "ECHO writes the schemas, the paths
and the operations from each set of sample request and response, as a new spec or added to the one on screen. Sets
left blank are skipped. Fields with a value in the sample are marked required; tweak the spec afterwards in the
editor."; the "as a new spec or added..." part only when the flow already has a spec or unsaved edits).

- Starts with three cards "Sample 1..3"; "More Samples" adds three more; each card has "Remove" when there is more
  than one.
- Card fields: "Method" (GET, POST, PUT, PATCH, DELETE; default POST), "Path" (placeholder
  `/cards/{cardId}/activate or /cards?status=ACTIVE&limit=10`; hint "Each {name} becomes a path parameter. A sample
  query after ? (e.g. ?status=ACTIVE&limit=10) gives optional query parameters."), "Sample request (JSON)" (not
  required for GET and DELETE; placeholder "Optional for GET: leave blank for no request body"), "Sample response
  (JSON)" (required).
- Validation per used card: path needed ("A path is needed, e.g. /cards/{cardId}/activate."), path shape
  (`PATH_PATTERN = /^(\/([A-Za-z0-9._~-]+|\{[A-Za-z_][A-Za-z0-9_]*\}))+\/?$|^\/$/`; "Segments of letters, digits,
  - _ . or a {name}, split by /, then an optional ?query."), "A sample is needed.", "Not valid JSON: ...". Two cards
  with the same method and path: red label "Two sets are METHOD path". A leading "/" is added to the path.
- Buttons when the flow has a spec: "Add to this spec" (primary; it becomes a warning "Replace METHOD path" when the
  only set is already in the spec, or "Add to this spec, replacing N"), "Replace Whole Spec" (danger), "Cancel".
  A card whose operation exists shows the orange label "Already in the spec: replaces it (its route stays)". A
  path counts as existing when it matches a spec path with parameter names ignored (`pathInSpec`), and then the
  spec's own spelling is used. Without a spec: one button "Create".
- Status afterwards: "Added METHOD path from the samples: save to keep it.", "Replaced ...", "Added N operations
  ...", "Added N and replaced M operations ...", or for a whole spec "Made METHOD path / N operations from the
  samples: save to keep it/them.". Nothing is saved until Save.

**How a sample becomes a spec** (`specFromSamples.ts`, `jiraImport.ts`):

- Operation: `parameters` = one required string path parameter per `{name}`, then the query parameters;
  `requestBody` (required, `application/json`) when there is a request sample; `responses: {"200":
  {"description": "OK", content...}}`, with no content when there is no response sample.
- Query parameters from the sample query: values of one name are typed `integer` (`/^-?\d+$/`), `number`,
  `boolean` (`true`/`false`) or `string`; a repeated name is an array of that type; all `required: false`; a
  non-empty value becomes the parameter's `examples.sample` (summary "The sample").
- Schemas (`SchemaBuilder`): an object becomes a named schema in `components.schemas` and a `$ref` to it. Names:
  the body is `<OperationId capitalised>Request` / `...Response`; a nested object is the parent's name plus the
  capitalised field name; an array's items are `<name>Item`; a taken name gets `2`, `3`, .... Properties with a
  non-null value are `required`. `null` becomes `{type: string, nullable: true}` and is noted. Strings shaped like
  an ISO date-time or date get `format: date-time` / `date`. Numbers are `integer` when whole. An array uses its
  first non-null element; when all non-null elements are objects (two or more), they are merged first and a field
  missing from any of them becomes nullable. An empty array has `items: {}`.
- The body sample is stored twice: as the media type's `examples.sample` and as the top data type's `example`
  (which is what lets other responses that are later set to the same type get the example too, sections 18.1 and
  18.2).
- A whole new spec keeps the current spec's `info` and `servers` (so the title and Base Path survive).
- Adding to a spec (`addOperations(json, ops, dropReplacedTypes)`): an existing operation at the same place is
  replaced but keeps its operationId (so its route stays); with `dropReplacedTypes` (samples dialog) the data types
  only the replaced operation used are deleted first. Missing ids are filled.

### 18.9 Import from Jira using AI

`JiraImportModal`, three steps:

1. **Link** (small; title "Import from Jira using AI"; description "ECHO reads the story and its comments, finds
   the example payloads, calls and query parameters in them, and shows you what it found before adding anything."
   plus, when an AI engine is configured, " The story's text is sent to the AI engine (<model>) to pair the
   examples."). Field "Story link" (placeholder "https://acme.atlassian.net/browse/PAY-142, or PAY-142"), button
   "Read Story", spinner "Reading the story and its comments…". Errors from the server are shown under the field.
2. **Confirm** (large; title "<KEY>: <summary>"; description "Found N example payload(s) in the description and M
   comment(s), paired by the AI engine (<model>). Check each operation before ECHO adds it to the spec." or "No
   example payloads were found in ..." and a link "Open <KEY> in Jira"). The server's notes are warnings. One card
   per operation the server proposed: checkbox "Import", "Remove", an "AI: <reason>" line when given, Method, Path
   (the flow's Base Path is cut from the front of the proposed path), and for each of "Request body" and "Response
   body" a select of the story's examples ("No request body", then "Example <n> · <source> · called the <role>",
   the ones near this operation first) above an editable JSON text area. Warnings: "The story has several request
   examples here: the newest is picked. Pick another if it is wrong." (without ": the newest is picked" when the AI
   paired them). Labels: orange "Already in the spec: importing replaces it", red "Two operations are METHOD path".
   "Add another operation" adds an empty card. Button "Add To Spec" or "Add N Operations".
3. **Review** (medium; title "Check what was added"; description "From <KEY>. Nothing is saved yet: Save keeps it,
   Undo takes it out again."): lists "Paths" (with an orange "replaced" label), "Data types" ("<name> · N fields",
   or "None: the operations have no JSON bodies."), "Worth checking" (notes such as "<Type>.<field> was null in the
   example, so it is an optional string." and "METHOD path had no response example: its 200 response has no
   body."), and "Each new operation has a route in the flow. Required fields are the ones with a value in the
   example.". Buttons "Keep" and "Undo" (puts back the spec as it was before and removes the routes it added).

Status after applying: "Added N operation(s) from Jira: save to keep it/them.".

---

## 19. Builder UI: DataMapper support

Kaoto's DataMapper maps JSON (and XML) bodies with a generated XSLT 3.0 file, `kaoto-datamapper-<id>.xsl`, run by
an `xslt-saxon` step. It keeps, per DataMapper step id, an entry in the flow's `.kaoto` file:

```json
{ "<step id>": { "xsltPath": "<step id>.xsl", "sourceParameters": {}, "namespaceMap": {},
                 "sourceBody": { "type": "JSON Schema", "filePath": ["<schema file>"], "fieldTypeOverrides": [] },
                 "targetBody": { "type": "Primitive", "filePath": [], "fieldTypeOverrides": [] } } }
```

A side with no schema is `{type: 'Primitive', filePath: []}`. Kaoto can attach only standalone `.json` (JSON Schema)
and `.xsd`/`.xml` files, not a schema inside an OpenAPI document. Everything in this section is ECHO working around
that by writing schema files and `.kaoto` entries itself (`src/datamapper/`).

### 19.1 Schema files made from the flow's own spec

`specSchemaParts(spec)` lists every body of the spec that has a JSON schema: for each operation, the request body
and each response status. For OpenAPI 3 the schema is that of the `application/json` media type (else the first
`*/json`, `+json` or `*/*` one); for Swagger 2.0 the `in: body` parameter's schema and the response's `schema`.
Labels: "METHOD /path: Request body" and "METHOD /path: Response <status>".

`makeJsonSchema(spec, source)` turns one into a standalone JSON Schema:

- `$schema: https://json-schema.org/draft/2020-12/schema`, `title` = the label, and the marker
  `"x-echo-openapi": {"method": "<lower case>", "path": "...", "part": "request"|"response", "status": "..."}`.
- The body schema is dereferenced at the top; every other `$ref` into the document (`#/...`) becomes
  `#/$defs/<last segment>` (numbered when two refs end the same) with the target converted the same way into
  `$defs`. External refs are left as they are.
- Keys `nullable`, `discriminator`, `xml`, `externalDocs`, `example` and every `x-...` key are dropped.
- Printed with 2-space indent and a trailing newline.

File name (`schemaFileName`): an existing generated file with the same marker is reused; otherwise
`openapi-<path made safe>-<method>-request.schema.json` or `...-response-<status>.schema.json` (path: runs of
characters outside `[A-Za-z0-9_.]` become `-`, trimmed of `-` and `.`, `root` when empty), with `-2`, `-3`, ...
when taken. A "generated schema" is a file in the flow's top folder named `openapi-*.schema.json`.

**Attach Schema in the DataMapper.** When Kaoto asks for a file and JSON is allowed, `SpecSchemaPickerModal`
(title "Attach a schema", description "Pick a body from this flow's Openapi spec, or upload a JSON Schema or XSD
file.") lists the spec's operations, each with radios "Request body" / "Response <status>". "Attach" writes the
generated schema file and gives its name to Kaoto; "Upload File" opens the plain file input; "Cancel". Empty
texts: "This flow has no Openapi spec yet." and "This flow's Openapi spec has no JSON request or response
bodies.". The spec read is the unsaved one on screen when there is one.

**Following the spec** (`useSpecMappingReview`). The review runs when the flow opens, whenever the spec is stored
or copied, and 1.5 s after Kaoto writes an `.xsl`, `.kaoto` or `.schema.json` file:

1. (When the spec may have changed.) Each generated schema file is made again from the saved spec and rewritten
   if different. A file whose body is no longer in the spec is kept and noted "<METHOD path request body /
   response N> is no longer in the Openapi spec".
2. For every `.kaoto` entry that uses a generated schema on its source body, target body or a parameter, the
   fields the `.xsl` uses are checked against the schema (`mappingCheck.ts`). The XSLT is parsed; paths of the
   JSON-as-XML form `fn:map[@key='a']/fn:string[@key='b']` are read from every `select`, `test` and `group-by`
   attribute (relative paths inside `xsl:for-each` are joined to the loop's path; `$param/...` paths belong to
   that parameter), and target paths from the `fn:*` elements under the `mapped-xml` variable. A path is a problem
   when a key is "not in the schema" (only where the schema declares `properties`), or when the type differs
   ("<field> is <schema type> in the schema; the mapping uses it as <type>"). `allOf`/`oneOf`/`anyOf` and `$ref`
   are followed; `null` types are ignored.
3. Warnings are shown above the canvas (`data-testid="spec-mapping-warnings"`): "Review this DataMapper step: it no
   longer matches the Openapi spec" or "Review these N DataMapper steps: they no longer match the Openapi spec",
   each line "**Route <route>, step <step id>**, <source body | target body | parameter x> (<schema file>):
   <problems joined with ';'>.". Closable; it comes back when the warnings change. A failed check shows "Could not
   check the DataMapper steps against the Openapi spec: <message>".

### 19.2 Scaffold DataMappers prefilled from the spec

`attachScaffoldSchemas(files, operations)` (when scaffold routes are made or refreshed), for each operation and
only while the DataMapper's `.xsl` has no mapping (no `<xsl:template`):

- request DataMapper `kaoto-datamapper-request-<op>-1` (POST, PUT, PATCH): its **source** is the operation's
  request body schema;
- reply DataMapper `kaoto-datamapper-<op>`: its **target** is the operation's response schema.

It writes the schema file (named as in 19.1), an empty stylesheet when the `.xsl` does not exist yet:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- This file is generated by Kaoto DataMapper. Do not edit. -->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
</xsl:stylesheet>
```

and the `.kaoto` entry. When the operation no longer has that schema, an ECHO-made entry is removed.
`forgetScaffoldSchemas(files, operationIds)` (routes removed) deletes the entries, the `.xsl` files and the schema
files no other entry uses, again only for DataMappers with nothing mapped.

### 19.3 Schemas of the called operations

Run by the editor page after the route changes (section 18.6), with the approved APIs' specs:

- **Request DataMapper target** (`attachCallTargets`). A scaffold request DataMapper is a `step` whose id matches
  `/^kaoto-datamapper-request-.+-\d+$/` directly followed by a `to` with `uri: rest-openapi`. When that call has a
  `specificationUri` and `operationId`, the operation's request body schema is written as
  `api-<api>-<operationId>-request.schema.json` (`<api>` is the URI without `.openapi.json` or its last extension,
  made safe) and set as the entry's `targetBody`. It follows a later change of operation and is cleared when the
  call picks nothing. A target the user attached (a file not starting `api-`) is never replaced, and nothing
  changes once something is mapped.
- **Reply DataMapper source** (`attachReplySources`). A reply DataMapper is a `step` with id
  `kaoto-datamapper-<not request-...>` that follows a `multicast` in the same step list. Its source becomes
  `api-replies-<step id without kaoto-datamapper->.schema.json`: an object schema, title "Replies of the calls",
  with one property per labelled branch (`"<label>": ${body}`) whose call picks an operation with a response body
  (status 200, else first 2xx, else default), typed by that body; each reply's `$defs` are kept, prefixed
  `<label>.`. With no such branch the source goes back to none. Same rules about user-attached files and mapped
  stylesheets.
- When ECHO sets or clears a JSON source, the route step is changed the way Kaoto itself would
  (`withJsonSources`): with a JSON source, the `setBody ${null}` before the XSLT is removed and the XSLT gets
  `useJsonBody: true`; without, the other way round.
- A DataMapper that should get a schema but whose `to` is still plain `xslt-saxon` gets its file name
  (`xslt-saxon:<step id>.xsl`) in the route (`withXsltFile`), and the metadata is written on the next pass.

---

## 20. Themes and styling

### 20.1 Principles

- Every colour of the Builder comes from **one file**, `builder-ui/src/theme/themes.css`, as `--echo-*` custom
  properties on `:root[data-echo-theme='<name>']`. No other file contains a colour value.
- `kaoto-mapping.css` maps PatternFly's and Kaoto's own variables and classes onto those tokens;
  `apicurio-mapping.css` does the same for the Apicurio editor (PatternFly 3/4 and Bootstrap classes) and is
  injected into the iframe together with `themes.css`. `echo.css` holds ECHO's own layout rules. Component CSS
  files (`FlowEditorPage.css`, `RunPanel.css`, `ApiSpecPanel.css`, `KaotoEditorHost.css`, ...) use the tokens.
- The install's `echo.branding` picks the theme and may override six tokens (section 12.4, 15.6).
- The font is Inter (variable) for every theme.
- Test `themes.test.ts` checks that every theme defines every token and that the mapping files contain no colour
  literals.

### 20.2 Tokens

Shared by every theme (`:root:root[data-echo-theme]`; the doubled `:root` outranks PatternFly's own tokens
whatever the load order):

| Token | Value | Use |
|---|---|---|
| `--echo-brand` | `#ffe600` | Brand colour; install may replace |
| `--echo-brand-hover` | `#e6cf00` | Install may replace |
| `--echo-on-brand` | `#2e2e38` | Text on brand-coloured buttons; install may replace |
| `--echo-accent-text` | `#2e2e38` | Text drawn in the brand colour on light backgrounds; install may replace |
| `--echo-ey-yellow` | `#ffe600` | "EY" in the product name, always |
| `--echo-diagram-node` | `#ffffff` | Download As Image always draws light on white |
| `--echo-diagram-node-border` | `#dadde3` | |
| `--echo-diagram-node-label` | `#2e2e38` | |
| `--echo-diagram-edge` | `#6b7180` | |

Per theme (studio: light, dot-grid canvas, cards with a brand-colour top edge; graphite: dark throughout, deeper
canvas, brand-coloured accents; blueprint: light app, dark grid canvas, brand connectors and card edges; navy, the
default: muted corporate navy, quiet line-grid canvas, cards with a navy left edge; slate: neutral greys, plain
canvas, flat outlined cards; contrast: black on white, heavy outlines, WCAG AAA text):

| Token | studio | graphite | blueprint | navy | slate | contrast |
|---|---|---|---|---|---|---|
| `--echo-masthead-background` | `#2e2e38` | `#2e2e38` | `#2e2e38` | `#172a4a` | `#343a43` | `#000000` |
| `--echo-masthead-text` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--echo-background` | `#eef0f3` | `#16171d` | `#f2f2f2` | `#eef1f6` | `#f1f2f4` | `#ffffff` |
| `--echo-surface` | `#ffffff` | `#1e2028` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--echo-floating` | `#ffffff` | `#262832` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--echo-text` | `#151515` | `#ffffff` | `#151515` | `#17213a` | `#1c1f24` | `#000000` |
| `--echo-text-subtle` | `#4d4d4d` | `#c7c7c7` | `#4d4d4d` | `#4a5672` | `#535a65` | `#262626` |
| `--echo-border` | `#e0e0e0` | `#4d4d4d` | `#e0e0e0` | `#d3d9e4` | `#dcdfe4` | `#595959` |
| `--echo-shadow` | `#141824` | `#000000` | `#141824` | `#0f1a33` | `#1c1f24` | `#000000` |
| `--echo-outline` | `var(--echo-brand)` | `var(--echo-brand)` | `var(--echo-brand)` | `var(--echo-ink)` | `var(--echo-ink)` | `#000000` |
| `--echo-ink` | `var(--echo-masthead-background)` | `#e6e7eb` | `var(--echo-masthead-background)` | `#1f3a63` | `#3d4450` | `#000000` |
| `--echo-on-ink` | `var(--echo-masthead-text)` | `#16171d` | `var(--echo-masthead-text)` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--echo-brand-text` | `var(--echo-accent-text)` | `var(--echo-brand)` | `var(--echo-accent-text)` | `#1f3a63` | `#3d4450` | `#000000` |
| `--echo-selected` | `var(--echo-ink)` | `var(--echo-brand)` | `var(--echo-ink)` | `#1f3a63` | `#3d4450` | `#000000` |
| `--echo-on-selected` | `var(--echo-on-ink)` | `var(--echo-on-brand)` | `var(--echo-on-ink)` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--echo-canvas` | `#f7f8fa` | `#121318` | `#1f2433` | `#f6f8fb` | `#fafafb` | `#ffffff` |
| `--echo-canvas-grid` | `#c9cdd6` | `#2c2f3a` | `rgb(255 255 255 / 5%)` | `#e3e8f0` | `#dfe2e7` | `#c4c4c4` |
| `--echo-node` | `#ffffff` | `#f4f5f7` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--echo-node-border` | `#dadde3` | `#3a3d4a` | `transparent` | `#cdd5e2` | `#c9cdd4` | `#000000` |
| `--echo-node-border-hover` | `#b8bdc7` | `#5a5e6e` | `transparent` | `#8d9bb5` | `#8b929e` | `#000000` |
| `--echo-node-label` | `var(--echo-text)` | `#e6e7eb` | `#e9ecf2` | `#17213a` | `#1c1f24` | `#000000` |
| `--echo-edge` | `#6b7180` | `#8a8f9e` | `var(--echo-brand)` | `#5a6b8a` | `#7a818c` | `#000000` |
| `--echo-group` | `rgb(255 255 255 / 70%)` | `rgb(255 255 255 / 3%)` | `rgb(255 255 255 / 3%)` | `rgb(255 255 255 / 75%)` | `rgb(255 255 255 / 60%)` | `#ffffff` |
| `--echo-group-border` | `#dadde3` | `#2e313c` | `rgb(255 255 255 / 25%)` | `#c3cddd` | `#d0d4da` | `#000000` |
| `--echo-code-key` | `#1f4e8c` | `#8cb4f0` | `#1f4e8c` | `#1f3a63` | `#384c6b` | `#002f6c` |
| `--echo-code-string` | `#2f6b3b` | `#9fd49a` | `#2f6b3b` | `#2c6a4f` | `#3d6340` | `#00450f` |
| `--echo-code-number` | `#8a4b08` | `#f0b37e` | `#8a4b08` | `#8a4b08` | `#7d4a1c` | `#6b2600` |
| `--echo-canvas-pattern-size` | `18px 18px` | `20px 20px` | `24px 24px` | `32px 32px` | `24px 24px` | `20px 20px` |
| `--echo-node-radius` | `12px` | `12px` | `6px` | `8px` | `6px` | `4px` |
| `--echo-node-accent-top` | `4px solid var(--echo-brand)` | `2px solid var(--echo-node-border)` | `1px solid var(--echo-node-border)` | `1px solid var(--echo-node-border)` | `1px solid var(--echo-node-border)` | `2px solid var(--echo-node-border)` |
| `--echo-node-accent-left` | `1px solid var(--echo-node-border)` | `2px solid var(--echo-node-border)` | `5px solid var(--echo-brand)` | `4px solid var(--echo-ink)` | `1px solid var(--echo-node-border)` | `2px solid var(--echo-node-border)` |
| `--echo-node-shadow` | `0 2px 6px rgb(20 24 36 / 10%)` | `0 0 0 4px var(--echo-surface)` | `0 4px 12px rgb(0 0 0 / 35%)` | `0 1px 3px rgb(15 26 51 / 12%)` | `none` | `none` |
| `--echo-group-border-style` | `solid` | `solid` | `dashed` | `solid` | `solid` | `solid` |

`--echo-canvas-pattern`: studio, slate and contrast use dots,
`radial-gradient(var(--echo-canvas-grid) 1px, transparent 1px)` (graphite the same with `1.2px`); blueprint and
navy use lines, `linear-gradient(var(--echo-canvas-grid) 1px, transparent 1px), linear-gradient(90deg,
var(--echo-canvas-grid) 1px, transparent 1px)`.

Only `graphite` is a dark theme (it also gets PatternFly's `pf-v6-theme-dark` class). To add a theme: copy a
block, rename it, and add the name to `THEMES` (and `DARK_THEMES` if dark) in `branding/applyBranding.ts`.

### 20.3 Mapping onto PatternFly 6 and Kaoto (`kaoto-mapping.css`)

On `:root:root[data-echo-theme]`:

| PatternFly token | ECHO token |
|---|---|
| `--pf-t--global--background--color--primary--default` | `--echo-surface` |
| `--pf-t--global--background--color--secondary--default` | `--echo-background` |
| `--pf-t--global--background--color--floating--default` | `--echo-floating` |
| `--pf-t--global--text--color--regular` / `--subtle` | `--echo-text` / `--echo-text-subtle` |
| `--pf-t--global--border--color--default` | `--echo-border` |
| `--pf-t--global--color--brand--default` / `--hover` / `--clicked` | `--echo-brand` / `--echo-brand-hover` / `--echo-brand-hover` |
| `--pf-t--global--text--color--on-brand--*` | `--echo-on-brand` |
| `--pf-t--global--text--color--brand--*` | `--echo-brand-text` |
| `--pf-t--global--border--color--brand--*` (secondary button outlines) | `--echo-outline` |
| `--pf-t--global--text--color--link--default` / `--hover` / `--visited` | `--echo-ink` |
| `--pf-t--global--color--brand--subtle--default` / `--hover` / `--clicked` | `color-mix(in srgb, var(--echo-brand) 22% / 32% / 40%, transparent)` |
| `--pf-t--global--text--color--on-brand--subtle--default` | `--echo-text` |
| `--pf-t--global--border--color--brand--subtle--*` | `--echo-ink` |

Further rules: the masthead uses the masthead tokens and outlines its secondary button in the brand colour; the
body's colour and font are reset (Kaoto pulls in IBM Carbon styles that set them globally); blue labels (Draft,
Kaoto's catalog types) are outlined and neutral; a selected toggle uses `--echo-selected` / `--echo-on-selected`;
Kaoto's non-canvas views (Datamappers, About, Beans) are drawn on the surface colour.

Kaoto's canvas, by Kaoto's class names: `.pf-topology-visualization-surface` gets `--echo-canvas` with
`--echo-canvas-pattern` at `--echo-canvas-pattern-size`; `.custom-node__container__image` (a step's card) gets
`--echo-node`, border `--echo-node-border`, the top and left accents, `--echo-node-radius`, `--echo-node-shadow`;
a selected step is ringed in the brand colour; `.custom-node__label__text` uses `--echo-node-label` on a
canvas-coloured background so labels stay readable over connectors; `.custom-group__container` (a route's box)
uses `--echo-group`, `--echo-group-border`, `--echo-group-border-style`; `.custom-edge__connector` uses
`--echo-edge`. Kaoto's off-screen copy of the canvas (`.hidden-canvas`, used for Download As Image) is excluded
from the theme and uses the `--echo-diagram-*` tokens.

### 20.4 Shared look (`echo.css`)

- `--echo-font: 'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif` for PatternFly's
  body and heading font tokens; body `letter-spacing: -0.005em`, `line-height: 1.5`, `height: 100vh` (both undo
  Carbon's reset).
- Squarer corners: PatternFly's radius tokens pill 6px, large 10px, medium 6px.
- Alert titles are body-size bold. A focused text box has a 3px ring of `color-mix(in srgb, var(--echo-brand) 45%,
  transparent)` and an ink border instead of the browser outline.
- Links (and `.echo-text-link` buttons) are ink-coloured with a 2px brand-colour underline, offset 3px; not in the
  masthead.
- Buttons are weight 600. Labels are 11px, weight 600, upper case, `letter-spacing: 0.04em`, radius 4px.
- Kaoto's tab bar: no icons, bold labels. Step names 12px weight 600; connectors `stroke-width: 1.5`.
- `.echo-flow-id` (the "ID: ..." line on the flows page) is small and subtle.
- Printing: elements with `.echo-no-print` are hidden and the page grows to its content.

### 20.5 Apicurio (`apicurio-mapping.css`)

Apicurio is an Angular app on PatternFly 3 (Bootstrap) with hard-coded colours, many in component styles Angular
adds later with long selectors. So this file selects its parts by class name, starts every rule with
`:root[data-echo-theme]`, and uses `!important` where it must win. Besides recolouring (page, links, title bar,
outline, detail pane, tabs, buttons, fields, dialogs, Ace code editor with the `--echo-code-*` colours, wells,
dividers, method tabs, expanding rows, pop-up panels), it makes the structural changes described in sections 18.3
and 18.4: hides the API's name in the title bar (ECHO's bar lies over it), the Apicurio logo, the outline's
search box, Contact, License and Security sections, Operation ID fields and Vendor Extensions; starts full-page
dialogs below the title bar; presents Servers as the Base Path field (Apicurio's words are sized to zero and ECHO's
written with `::before`); turns the outline into plain items with the picked list laid over the right pane; styles
ECHO's delete and back buttons and the Source toolbar order; and makes "Choose Type" bold.

---

## 21. Runtime template (`runtime-template/`)

What every flow image is built with. `build-flow.sh` reads all three parts. A buyer copies this folder and
`pipeline/` into the root of their flow repository.

### 21.1 `versions.properties`

```properties
camel.version=4.22.1
quarkus.version=3.36.0
swagger-ui.version=5.33.1
jib.version=3.5.2
base.image=eclipse-temurin:21-jre
```

### 21.2 `application.properties` (runtime defaults; a flow's own file is appended after it and wins)

```properties
server.port=8080
spring.main.banner-mode=off
camel.main.name=${ECHO_FLOW_NAME:echo-flow}
spring.application.name=${ECHO_FLOW_NAME:echo-flow}
camel.rest.component=platform-http
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.probes.enabled=true
management.metrics.tags.application=${spring.application.name}
management.metrics.distribution.percentiles-histogram.http.server.requests=true
camel.opentelemetry2.enabled=false
logging.structured.format.console=ecs
```

followed by the commented defaults of `echo.http-log.*`. `build-flow.sh` replaces the literal
`${ECHO_FLOW_NAME:echo-flow}` with the app's name and appends `echo.swagger-ui.version=<version>`.

### 21.3 HTTP log (`java/com/ey/echo/runtime/HttpExchangeLog.java`, `HttpExchangeLogConfiguration.java`)

The same source is compiled into every flow app and into the Builder (for Run, section 11). It logs every HTTP
exchange a flow takes part in, with no Log steps in the flow.

`HttpExchangeLog extends EventNotifierSupport implements HttpActivityListener` (camel-http's listener).
It only looks at exchange events.

| Record | When | Level | Message |
|---|---|---|---|
| Incoming request | `ExchangeCreatedEvent` of an exchange whose from-endpoint is a `PlatformHttpEndpoint`, that is not a copy made by multicast or split (no Camel correlation id property), and whose route id does not start with `echo-docs-` or `echo-api-docs` | INFO | `Request in: <METHOD> <url>` |
| Incoming response | `ExchangeCompletedEvent` / `ExchangeFailedEvent` of that same exchange | INFO, or WARN on failure | `Response out: <status> to <METHOD> <url> (<ms> ms)` plus `: <error>` on failure. Status is 500 on an exception, else the `CamelHttpResponseCode` header, default 200 |
| Outgoing request | `onRequestSubmitted` of the http component (so the headers the client adds are included); for a call that never got sent (connection refused), from an exec interceptor `echo-http-log` added first to the client | INFO | `Call out [<call id>]: <METHOD> <url>` |
| Outgoing response | `onResponseReceived` | INFO, or WARN for status 500 and above | `Call answered [<call id>]: <status> <METHOD> <url> (<ms> ms)` |
| Outgoing failure | `ExchangeSentEvent` or the exchange finishing while a call is still open | WARN | `Call failed [<call id>]: <METHOD> <url> (<ms> ms): <error or 'no answer'>` |

Fields of each record (SLF4J key-value pairs on logger `echo.http`; Spring Boot's ECS format makes them JSON
fields): `event.kind` = `http`, `echo.direction` (`inbound` / `outbound`), `echo.phase` (`request` /
`response`), `echo.app`, `echo.route`, `echo.correlation_id`, `trace.id` (when tracing set one),
`echo.call_id` (first 8 characters of a random UUID; pairs a call with its answer), `http.request.method`,
`url.full`, `http.response.status_code`, `event.duration_ms`, `http.headers` (a map; Camel's own `Camel*` headers
left out), `http.body`, `error.message` (root cause's message). A field whose value the MDC already holds is not
written twice.

Correlation id: the caller's `X-Correlation-ID`, else the trace id of its `traceparent` (pattern
`^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$`), else a new UUID; kept as exchange property
`EchoCorrelationId`. Outgoing calls get `X-Correlation-ID` unless the flow set one, and the caller's `traceparent`
and `tracestate` unless something else set a `traceparent`. Both happen even with the log switched off.

Settings (`echo.http-log.*`, read from the environment's properties):

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` writes no records |
| `bodies` | `true` | `false` leaves bodies out |
| `max-body` | `8192` | Characters of a body logged; the rest is cut ("... [cut at N of M characters]") |
| `masked-headers` | `Authorization,Proxy-Authorization,Cookie,Set-Cookie,X-Api-Key` | Header values replaced by `****`; a scheme word before the first space (within 20 characters) is kept, e.g. `Bearer ****` |
| `secret-names` | `*password*,*passwd*,*pwd*,*secret*,*token*,*key*,*credential*` | Globs (any case). The **values** of all settings whose names match, when at least 4 characters long, are replaced by `****` wherever they appear (URLs, headers, bodies, errors), longest first |

Bodies: an incoming stream body is read into bytes first so logging does not use it up. A streamed outgoing
request entity is read into memory and replaced by a repeatable copy. A streamed answer is read once and handed to
Camel as a new stream. gzip and deflate answers are decompressed for the log. Non-text content types are logged as
`[<type>, <n> bytes]` (text is `text/*`, anything with `json`, `xml`, `yaml` or `x-www-form-urlencoded`, or no
type). Unreadable bodies are `[body not readable]`.

`Entry.text()` (used by the Run panel): the message, then each header as `  name: value` on its own line, then
the body.

`HttpExchangeLogConfiguration` (a Spring auto-configuration, listed by `build-flow.sh` in
`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`) creates the log with the
app name (`camel.main.name`, else `spring.application.name`), gives it every property value of the environment
for masking, registers it on each `HttpComponent` (`ComponentCustomizer`) and as an event notifier before the
Camel context starts.

### 21.4 Metrics, tracing and log context (`ObservabilityConfiguration.java`, images only)

- **Metrics** need no code: `camel:micrometer` and `micrometer-registry-prometheus` are added to the export, and
  `/actuator/prometheus` serves them (`http_server_requests_seconds_*` with histograms, `camel_*`, JVM, process),
  tagged `application=<app>`.
- **Tracing** (OpenTelemetry through `camel-opentelemetry2`, whose own auto-configuration is switched off) is on
  only when `otel.sdk.disabled` is set and not `true`, or when `otel.exporter.otlp.traces.endpoint` or
  `otel.exporter.otlp.endpoint` is set (all readable as `OTEL_*` environment variables). `otel.sdk.disabled=true`
  always keeps it off. When on, the SDK is built with `AutoConfiguredOpenTelemetrySdk` and these defaults, which
  any `otel.*` property overrides: `otel.service.name` = the app, `otel.metrics.exporter=none`,
  `otel.logs.exporter=none`, `otel.exporter.otlp.protocol=http/protobuf`. Camel's `OpenTelemetryTracer` is
  initialised with the SDK's tracer and propagators bound in the registry. Log lines: "Tracing off (set
  OTEL_EXPORTER_OTLP_ENDPOINT to send traces)" or "Tracing on: OpenTelemetry spans of service <app> go to
  <endpoint>". The SDK is closed (spans flushed) when the app stops.
- **Log context**: an `InterceptStrategy` wraps every step and puts `echo.correlation_id`, `echo.route` and, with
  tracing on and a valid current span, `trace.id` and `span.id` in the MDC for the duration of the step
  (restoring the previous MDC after). It also stores the trace id on the exchange (`EchoTraceId`) for the HTTP
  log's records written outside a step.

The Builder does not compile this class: Run has no tracing.

---

## 22. Pipeline (`pipeline/`)

Nothing here is tied to a CI product. Requirements on the agent: Java 21, Maven, curl, git; Docker only for
`--local-image` and the smoke test.

### 22.1 `build-flow.sh`

```
pipeline/build-flow.sh <folder>... [options]
```

Each `<folder>` is a flow folder (it contains `<folder name>.camel.yaml`) or a folder of flow folders.

| Option (environment variable) | Meaning |
|---|---|
| `--mode bundle\|per-flow` (`BUILD_MODE`, default `bundle`) | All flows in one image, or one image per flow |
| `--name <n>` (`BUNDLE_NAME`, default `echo-flows`) | Bundle image and app name |
| `--version <v>` (`FLOW_VERSION`) | Image tag and Maven version. Default `1.0.0`; in per-flow mode `1.0.<version from echo-flow.json>` when the file has one |
| `--registry <url>` (`REGISTRY_URL`) | Push to `<url>/<image>:<v>`; credentials from the Docker config or `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` |
| `--local-image` | Build into the local Docker daemon instead |
| `--jar-only` | Stop after `mvn package` |
| `--manifests-only` | Only check the flows and write the Kubernetes manifests |
| `--out <dir>` | Working folder, default `./build`; each app goes in `<dir>/<app>` |
| `--k8s-config <f>` (`K8S_CONFIG`, default `pipeline/k8s.properties`) | Manifest settings |
| `--env-values <f>` (`ENV_VALUES`) | A `.properties` file with the placeholders' values for one environment |

Other environment variables: `ECHO_RUNTIME_TEMPLATE` (default `../runtime-template`), `CAMEL_LAUNCHER_JAR`
(default `~/.echo/camel-launcher-<version>.jar`, downloaded once from `MAVEN_REPO_URL` or Maven Central),
`CAMEL_CMD` (another Camel CLI to use instead).

Errors: "--mode must be bundle or per-flow", "No flow folder given", "No registry given: use --registry,
--local-image or --jar-only" (when it would push with no registry), "Values file not found: <f>", "Flow folder not
found: <f>", "Missing <name>.camel.yaml in <dir>". No flows left: "No flows to build." and exit 0.

Which flows are built: a folder directly under a folder named `templates` is skipped ("Skipping <dir>: templates
are not built into images."); a flow whose `echo-flow.json` matches `"disabled"\s*:\s*true` is skipped ("Skipping
<dir>: the flow is disabled.").

`copy_flow(dir, src, suffix)` copies into the app's source folder: `*.camel.yaml`, `*.xsl`, every `*.json` except
`echo-flow.json`, and every `*.yaml` / `*.yml` that is not a route file and has a line starting `openapi:` or
`swagger:`. With a suffix (bundle), the line `id: echo-openapi` in the flow's route file becomes
`id: echo-openapi-<flow>` so each generated REST service has its own id.

`build_app(name, version, out, imageName)`:

1. Puts the app name into `application.properties` and appends `echo.swagger-ui.version`.
2. Exports, in the source folder:

   ```
   camel export ./* --runtime=spring-boot \
     --dep="camel:openapi-validator,org.webjars:swagger-ui:<v>,camel:http,camel:platform-http,camel:micrometer,io.micrometer:micrometer-registry-prometheus,camel:opentelemetry2,io.opentelemetry:opentelemetry-sdk-extension-autoconfigure,io.opentelemetry:opentelemetry-exporter-otlp" \
     --quarkus-version=<v> --gav="com.ey.echo.flows:<name>:<version>" --directory=<out>/app
   ```

   (`camel` is `java -jar <launcher jar>`.)
3. Copies `runtime-template/java/com/ey/echo/runtime/*.java` into the exported app's `src/main/java` (as source
   after the export, because JBang would try to compile them as routes) and appends both configuration class
   names to `src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.
4. `mvn -B -q package -DskipTests`; the jar is `target/<name>-<version>.jar`.
5. Image with `com.google.cloud.tools:jib-maven-plugin:<jib.version>`: `-Djib.from.image=<base.image>`,
   `-Djib.container.ports=8080`, labels `org.opencontainers.image.title` and `.version`; goal `dockerBuild`
   (local, image `<imageName>:<version>`) or `build` (push, image `<registry>/<imageName>:<version>`, optional
   `-Djib.to.auth.username/password`). The image reference is written to `<out>/image.txt`.

**Per-flow mode**, for each flow: output `<out>/<flow>`; `application.properties` = template then
`# --- flow <name> ---` and the flow's own; manifests for `echo-flow-<flow>`; app name `<flow>`, image
`echo-flow-<flow>`.

**Bundle mode**: prints "==> Bundling N flow(s) into <name>: a b c"; runs `BundleCheck`; `application.properties`
= template then every flow's own in order; copies every flow with its name as the id suffix; runs `ApiDocsPage`
to write `echo-api-docs.camel.yaml`; manifests (with `--api-docs` when that file was written) and one app and
image named `<bundle name>`.

The Java helpers are single-file programs run as `java -cp <snakeyaml jar> pipeline/<Name>.java ...`. The
SnakeYAML jar is taken out of the Camel launcher jar (`BOOT-INF/lib/snakeyaml-*.jar`, extracted once into
`<out>/.yaml`), so nothing else is downloaded.

### 22.2 `BundleCheck.java`

Bundled flows run in one Camel app on one port. For each flow it collects, and then reports every one used by more
than one flow:

| Kind | From |
|---|---|
| `id` | Every `id` value anywhere in the route file, except inside the `rest` entry (renamed per flow) |
| `Base Path or path` | The Base Path (the `restConfiguration.contextPath` if set, else the path of the spec's last server URL, or Swagger 2 `basePath`) when the flow has `rest.openApi.specification`; and every `platform-http:` consumer path (query cut, normalised to a leading `/`, no trailing `/`) |
| `direct: endpoint` | Every `from` URI `direct:<name>` (once per flow) |
| file | A file name (other than `echo-flow.json`, `application.properties`) present in several flows with different content |
| property | A key of `application.properties` with different values |
| REST configuration | The `restConfiguration` maps of the flows that have one, when they differ |

Messages: "<kind> <key> is used by more than one flow: a, b"; "file <f> differs between flows: a, b"; "property
<k> has different values in flows: a, b"; "Base Path or path <p> is used by <flows>, but /api-docs is the bundle's
combined API docs page" (for `/api-docs` and anything under it); "the REST configuration (Client Request
Validation, Enable CORS) differs between flows: a, b". Output on stderr: "These flows cannot share one bundle
image, because they run in one app on one port:", each problem as "  - ...", then "Give each flow its own Base Path
(Openapi Design) or path and rename the clashing items, or build with --mode per-flow."; exit code 1.

### 22.3 `ApiDocsPage.java`

Writes the routes of the bundle's combined Swagger UI page, or nothing when no flow has a spec. A flow has a spec
when its route file has the route `echo-docs-<flow>-spec` (made by `RestFromSpec`); the path of that route's
`platform-http:` consumer is where the flow serves its spec. Entries are sorted by flow name, case-insensitively
(then exactly). Four routes, each `platform-http:<path>` with `httpMethodRestrict: GET`, a `Content-Type` header
and a constant body, description "Made by EY ECHO; Swagger UI for every flow in this image":

| Route id | Path | Body |
|---|---|---|
| `echo-api-docs` | `/api-docs` | The HTML page, on one line |
| `echo-api-docs-script` | `/api-docs/swagger-ui-bundle.js` | `resource:classpath:META-INF/resources/webjars/swagger-ui/{{echo.swagger-ui.version}}/swagger-ui-bundle.js` |
| `echo-api-docs-preset` | `/api-docs/swagger-ui-standalone-preset.js` | same folder, `swagger-ui-standalone-preset.js` |
| `echo-api-docs-style` | `/api-docs/swagger-ui.css` | same folder, `swagger-ui.css` |

The page: title "API docs", stylesheet `api-docs/swagger-ui.css`, scripts `api-docs/swagger-ui-bundle.js` and
`api-docs/swagger-ui-standalone-preset.js` (all relative, so it works behind a proxy), and

```js
window.ui = SwaggerUIBundle({
  urls: [{url: '<spec path without leading slash>', name: '<flow>'}, ...],
  dom_id: '#swagger-ui', deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  plugins: [SwaggerUIBundle.plugins.DownloadUrl], layout: 'StandaloneLayout',
  requestInterceptor: function (request) {   // "Try it out" always calls this host
    var url = new URL(request.url, window.location.href);
    if (url.origin !== window.location.origin) request.url = window.location.origin + url.pathname + url.search;
    return request;
  }
});
```

Names and URLs are escaped for a single-quoted JavaScript string (`\`, `'`, `<` as `\x3c`, `{` as `\x7b`, so the
page never contains `{{` for Camel to read as a placeholder). Each flow's spec is loaded only when picked in the
"Select a definition" drop-down, so data types of the same name in different flows never meet.

### 22.4 `K8sManifests.java` and `k8s.properties`

```
java -cp snakeyaml.jar pipeline/K8sManifests.java <k8s.properties> <app> <image> <out> [--values <file>] [--api-docs] <flow-folder>...
```

Writes `<out>/k8s/`. `k8s.properties` keys and defaults:

| Key | Default | Meaning |
|---|---|---|
| `k8s.enabled` | `true` | `false` writes nothing |
| `k8s.routing` | `ingress` | `ingress`, `httproute` or `none`; anything else is an error |
| `k8s.namespace` | empty | Namespace of every object |
| `k8s.host` | empty | Host name; empty matches any |
| `k8s.ingress-class` | empty | `ingressClassName` |
| `k8s.tls-secret` | empty | Adds a `tls` section (with the host when set) |
| `k8s.gateway` | empty | `<name>` or `<namespace>/<name>`; required for `httproute` |
| `k8s.replicas` | `1` | |
| `k8s.annotation.<key>` | none | Ingress annotations, sorted |
| `k8s.secret-names` | `*password*,*passwd*,*pwd*,*secret*,*token*,*key*,*credential*` | Sensitive placeholder names |

Object names: the app name in lower case, other characters as `-`, trimmed, at most 63 characters. Labels on
everything: `app.kubernetes.io/name: <app>`, `app.kubernetes.io/part-of: ey-echo`, and on the Deployment
`app.kubernetes.io/version` (the image tag, when it is a valid label value). All string values are YAML
single-quoted. Every file starts with a "# Made by EY ECHO (pipeline/K8sManifests.java)" comment.

**Paths** (`rules(flowDir)`), each a `Rule(path, prefix)`:

- every path of the flow's spec under its Base Path: exact when it has no `{param}`, otherwise a prefix up to the
  segment before the first `{` (`/orders/{id}` under `/shop` gives prefix `/shop/orders`);
- every `platform-http:` consumer of the route file: a prefix when it has `matchOnUriPrefix=true` (in the URI or
  the parameters) or a `{param}`, else exact;
- the route `echo-docs-<flow>` (Swagger UI) as a prefix, covering the page, spec, script and style;
- `/api-docs` as a prefix when `--api-docs` is given.

Rules already covered by a prefix rule are dropped (a prefix covers the same path and anything under it by whole
segments; `/` covers all). The rest are sorted by path.

**`deployment.yaml`**: `apps/v1` Deployment, `replicas`, selector on the name label, pod annotations
`prometheus.io/scrape: "true"`, `prometheus.io/path: /actuator/prometheus`, `prometheus.io/port: "8080"`, one
container named after the app with the image, port `http` 8080, `envFrom` the ConfigMap `<app>-env` and the Secret
`<app>-env` (both `optional: true`; the Secret wins on a clash), a commented example of the `OTEL_*` variables,
`livenessProbe` GET `/actuator/health/liveness` (`initialDelaySeconds: 20`) and `readinessProbe` GET
`/actuator/health/readiness` (`initialDelaySeconds: 10`).

**`service.yaml`**: `v1` Service, selector on the name label, port `http` 80 to `targetPort: http`.

**`ingress.yaml`** (`networking.k8s.io/v1`): annotations, `ingressClassName`, `tls`, one rule (with `host` when
set) listing each path with `pathType: Prefix` or `Exact` and backend service `<app>` port `http`.

**`httproute.yaml`** (`gateway.networking.k8s.io/v1`): `parentRefs` to the gateway (with its namespace when
given), `hostnames`, one rule whose `matches` are the paths (`PathPrefix` / `Exact`) and whose `backendRefs` is
`<app>` port 80. Without `k8s.gateway`: "k8s.routing=httproute needs k8s.gateway (<name> or <namespace>/<name>)",
exit 1.

With no HTTP paths, neither file is written ("<app>: no HTTP paths, so no <routing> is written"). Old
`ingress.yaml` / `httproute.yaml` / `configmap.yaml` / `secret.yaml.example` are deleted first.

**Placeholders.** Every `{{name}}` and `{{name:default}}` (an optional leading `?` ignored) in the flows' route
files, except Camel's property functions (`env`, `sys`, `sysenv`, `service`, `service.host`, `service.port`,
`bean`, `ref`, `configmap`, `secret`, `configmap-binding`, `secret-binding`) and names starting `echo.`, becomes
an environment variable: the name with every character outside `[A-Za-z0-9_]` as `_`, in upper case
(`inventory.host` gives `INVENTORY_HOST`, which Spring's relaxed binding reads back as `inventory.host`).

- A name matching `k8s.secret-names` goes in **`secret.yaml.example`**: a Secret `<app>-env`, `type: Opaque`,
  `stringData` with each variable as `''` and a comment naming the placeholder and the flows using it; its header
  explains that the pipeline never writes the values, that `kubectl apply` skips the file because of its
  extension, and shows the `kubectl create secret generic <app>-env --from-literal=NAME=...` command. A value for
  it in the values file is ignored with a warning.
- Every other name goes in **`configmap.yaml`**: ConfigMap `<app>-env`, `data` with `NAME: '<value>'  # {{name}} in
  <flows>`. The value is the values file's (looked up by the placeholder name, then by the variable name), else
  the flow's `application.properties` value (the last flow wins in a bundle). With no value the line is commented
  out (an empty variable would override the value built into the image) and ends ", its default is used" or ", no
  value set"; names with no value and no default are reported on stderr.

### 22.5 `Jenkinsfile` (sample)

Declarative pipeline, `agent any`, options `disableConcurrentBuilds()` and `timestamps()`. Parameters:
`BUILD_MODE` (`bundle` | `per-flow`), `REGISTRY_URL` (default `registry.example.com/echo`),
`REGISTRY_CREDENTIALS_ID` (`echo-registry`), `BUILD_ALL` (false), `DEPLOY` (false), `ENV_VALUES` (empty),
`KUBECONFIG_CREDENTIALS_ID` (`echo-kubeconfig`). Stages:

1. **Find changed flows**: the folders under `flows/` changed since `GIT_PREVIOUS_SUCCESSFUL_COMMIT` (all of them
   with `BUILD_ALL` or on the first build), keeping only those that still have a route file. In bundle mode any
   change (a deleted flow too) sets `FLOWS=ALL`.
2. **Build and push images** (when there is something to build): `rm -rf build`, then with the registry
   credentials either `pipeline/build-flow.sh flows --mode bundle --version 1.0.<BUILD_NUMBER> --registry <url>` or,
   per flow, `pipeline/build-flow.sh flows/<flow> --mode per-flow --registry <url>`.
3. **Deploy to Kubernetes** (only with `DEPLOY`): with the kubeconfig credential,
   `for dir in build/*/k8s; do kubectl apply -f "$dir"; done`.

Post: archive `build/*/image.txt`, `build/*/k8s/*.yaml`, `build/*/k8s/*.example`. Promotion between environments
is the buyer's own process.

### 22.6 `smoke-test-orders.sh [image] [--bundle]`

Default image `echo-flow-orders:1.0.0`, or `echo-flows:1.0.0` with `--bundle`. It starts the mock fulfilment
service with Camel JBang on port 9090, runs the image with `--network host`, waits for
`/actuator/health/readiness` (120 s), then checks:

- `POST /orders` with `samples/flows/orders/sample-request.json` answers exactly
  `{"orderId":"A100","fulfilmentId":"FUL-A100","status":"ACCEPTED"}`, and the mock's log holds
  `"lines":[{"product":"SKU-1","quantity":2}` (the request was mapped);
- the container's log is JSON (`"@timestamp"`);
- `/actuator/prometheus` has `http_server_requests_seconds_count{...uri="/orders"` and `camel_exchanges_total{`;
- the log says `Tracing off`;
- with `--bundle`: `GET /greetings/Ann` answers `{"greeting":"Hello Ann"}`; `DELETE /greetings/Ann` answers 404;
  `POST /greetings/` with `{"nam":"Ann"}` answers 400 with a body naming the missing required property `"name"`;
  `/greetings/docs` contains `SwaggerUIBundle`, its script loads, `/greetings/docs/openapi` contains
  `operationId: getGreeting`; `/api-docs` contains `urls: [{url: 'greetings/docs/openapi', name: 'greetings'}]` and
  its preset script loads.

It ends with "Smoke test passed".

---

## 23. Samples, mock server, presentation

### 23.1 `samples/`

Golden flows used by tests at every level.

**`flows/orders/`** (a route written by hand around two DataMappers; no spec):

- `orders.camel.yaml`: route `orders`, `from platform-http:/orders` (`httpMethodRestrict: POST`), steps: DataMapper
  step `kaoto-datamapper-order-request` (`to xslt-saxon:kaoto-datamapper-order-request.xsl`, `useJsonBody: true`);
  `removeHeaders "*"`; `setHeader CamelHttpMethod = POST`; `setHeader Content-Type = application/json`;
  `to "{{fulfilment.url}}"` with `bridgeEndpoint: true`; DataMapper step `kaoto-datamapper-order-response`;
  `removeHeaders "*"`; `setHeader Content-Type = application/json`.
- `application.properties`: `fulfilment.url=http://localhost:9090/fulfilment`.
- Schemas (draft-07, all objects of plain properties): `order-request.schema.json` (`orderId`, `customer {name,
  email}`, `items [{sku, qty: number}]`, `notes`), `fulfilment-request.schema.json` (`reference`, `customerName`,
  `lines [{product, quantity: number}]`), `fulfilment-response.schema.json` (`id`, `reference`, `state`,
  `lineCount: number`), `order-response.schema.json` (`orderId`, `fulfilmentId`, `status`).
- `kaoto-datamapper-order-request.xsl` maps `orderId` to `reference`, `customer.name` to `customerName`, and each
  `items[]` entry to a `lines[]` entry (`sku` to `product`, `qty` to `quantity`);
  `kaoto-datamapper-order-response.xsl` maps `reference` to `orderId`, `id` to `fulfilmentId`, `state` to
  `status`. Both are Kaoto's JSON form: an `xsl:variable name="mapped-xml"` holding `fn:map` / `fn:string` /
  `fn:array` / `fn:number` elements with `key` attributes, `xsl:output method="text"`, and a template that emits
  `xml-to-json($mapped-xml)`.
- `.kaoto`: an entry per DataMapper with `sourceBody` / `targetBody` of type `JSON Schema` pointing at those
  schema files, `xsltPath`, and the `xs`, `fn`, `xsl` namespace map.
- `sample-request.json`:
  `{"orderId":"A100","customer":{"name":"Jane Doe","email":"jane@example.com"},"items":[{"sku":"SKU-1","qty":2},{"sku":"SKU-2","qty":1}],"notes":"leave at door"}`

**`flows/greetings/`** (a contract-first flow exactly as the Builder publishes it):

- `greetings-api.yaml`: OpenAPI 3.0.3, title Greetings, server `/greetings`; `POST /` `createGreeting` (required
  JSON body, object with required string `name`); `GET /{name}` `getGreeting` (200: object with string
  `greeting`); `DELETE /{name}` `deleteGreeting` (204).
- `greetings.camel.yaml`: `restConfiguration.clientRequestValidation: true`; route `greeting` from
  `direct:getGreeting` (sets Content-Type and the body `{"greeting":"Hello ${header.name}"}`); route
  `create-greeting` from `direct:createGreeting` (body `{"created":true}`); then everything `RestFromSpec`
  generates (section 8): the `rest` entry `echo-openapi` with `specification: 'greetings-api.yaml'` and
  `missingOperation: ignore`, the 404 route `echo-missing-deleteGreeting`, and the four `echo-docs-greetings*`
  routes.

**`mock-downstream/fulfilment-mock.camel.yaml`**: route from `platform-http:/fulfilment` that logs
`fulfilment-mock received: ${body}` and answers
`{"id":"FUL-${jq(.reference)}","reference":"${jq(.reference)}","state":"ACCEPTED","lineCount":${jq(.lines | length)}}`
as JSON.

### 23.2 `mock-server/` (demo aid, not part of the product or its tests)

`node mock-server.js <spec.yaml|json> [port]` (port from the argument, else `PORT`, else 4010; YAML specs need the
`yaml` npm package). One Node script with no build. For each request it finds the operation by method and path
(with or without the spec's base path) and answers its 200 response, or the first other 2xx:
`responses/<operationId>.json` if present (read on every call; `{{name}}` replaced by the path or query parameter),
else the response's `example` (or first of `examples`), else a dummy generated from the response schema. A 204
operation answers 204. No match: 404 `{"error": "No matching operation in spec"}`. Nothing is validated, any
token works, CORS is open. The operation `getResources` always answers a recorded Blue Planet Device with every
`AVDLAZRH4P001` replaced by the request's `?name=`. Call log: `GET /__ui` (live page, newest first, Clear),
`GET /__calls` (JSON, last 500), `DELETE /__calls`, and the console. The folder also holds the Blue Planet specs
(the same files as `config/apis/blueplanet.yaml` and `blueplanet.original.yaml`), `run.bat` (opens the log in
Chrome and starts the mock on port 4020), `runAsJar.properties` and `runAsContainer.properties` (test values for
Run With: the mock at `http://localhost:4020` or `http://host.docker.internal:4020`, and a dummy token), and
`samplerequests.txt`.

### 23.3 `docs/presentation/`

The "ECHO Presentation v2" deck kept in Git: `deck/deck.json` and `deck/slides/<id>.html` (1920×1080 slides with
inline styles), `deck/images/`, `diagrams/*.svg` with the Python scripts that write two of them, and the built
`ECHO-Presentation-v2.html` and `.pdf` (made by `build-html.js` and `render-pdf.js`). It is documentation, not
part of the application.

---

## 24. Builder image, docker-compose, CI

### 24.1 `Dockerfile` (repository root, three stages)

1. **ui** (`node:22-bookworm-slim`): `corepack enable`, copy `builder-ui/package.json` and `pnpm-lock.yaml`,
   `pnpm install --frozen-lockfile` (the postinstall copies the Camel catalog), copy `builder-ui/` and `samples/`
   (the playground imports a sample), `pnpm build`.
2. **backend** (`maven:3.9-eclipse-temurin-21`): copy the pom, `mvn dependency:go-offline`, copy the backend
   source, `runtime-template/java` (the HTTP log is compiled into the Builder) and the UI's `dist`, then
   `mvn -Pwith-ui package -DskipTests` (the `with-ui` profile puts `dist/` and the Camel catalog into the jar's
   static resources).
3. **runtime** (`eclipse-temurin:21-jre`): user `echo` (uid 10001), the jar as `/app/echo-builder.jar`, volume
   `/data`, `ENV ECHO_DATA_DIR=/data ECHO_BRANDING_DIR=/config/branding`, `EXPOSE 8080 8081-8090`,
   `HEALTHCHECK` with `curl -f http://localhost:8080/actuator/health`, and

   ```
   ENTRYPOINT ["java", "-jar", "/app/echo-builder.jar", "--spring.config.additional-location=optional:file:/config/"]
   ```

### 24.2 `docker-compose.yml`

One service, `echo-builder`, built from the Dockerfile:

- ports `8080:8080` and `8081-8090:8081-8090` (the Run test ports);
- environment passed through from the host: `ECHO_GIT_TOKEN`, `ECHO_S3_ACCESS_KEY`, `ECHO_S3_SECRET_KEY`,
  `ECHO_JIRA_TOKEN`, `ECHO_AI_KEY`; and `SPRING_CONFIG_IMPORT=optional:file:/config/apis/approved-apis.yaml`;
- volumes `echo-data:/data` (the H2 database and Git working copies) and `./config:/config:ro`;
- `restart: unless-stopped`.

`config/application.yaml` (git-ignored; copied from `application.example.yaml`) overrides the defaults inside the
jar; `docker compose restart` applies a change.

### 24.3 CI (`.github/workflows/ci.yml`)

Triggers: push to `Version1`, `Version2`, `release/1.0.0`, `main`, and every pull request.

| Job | Runs |
|---|---|
| `backend` | Java 21; `mvn -B verify` in `builder-backend` |
| `ui` (`ubuntu-24.04`, pinned because Playwright 1.56.1 cannot install Chromium on the newer image) | Node 22, pnpm; `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `mvn -Pwith-ui package`, `playwright install chromium`, `ECHO_E2E_BUNDLED=1 pnpm e2e` |
| `pipeline-modes` (matrix `bundle`, `per-flow`) | `pipeline/build-flow.sh samples/flows --mode <m> --local-image`, the smoke test, and checks of the manifests: the Ingress paths, an HTTPRoute build, ConfigMap and Secret example from a values file, a bundle of two flows with the same Base Path failing with "Base Path or path /greetings is used by more than one flow: greetings, hello", the combined API docs sorted A to Z, a flow on `/api-docs` refused with "/api-docs is the bundle's combined API docs page", and a disabled flow skipped with "hello: the flow is disabled" |
| `pipeline` | An aggregate job that requires both matrix legs (the required status check) |
| `image` | `docker build` of the Builder image, start it, wait for health, and check that `/login` serves the page with `<div id="root">` |

---

## 25. Tests

Rule of the project: every milestone's "done when" becomes an automated test, and tests run offline. Git is a
local bare repository (`GitTestRepo`), S3 is an in-memory fake HTTP server (`FakeS3`), Jira and the AI engine are a
fake Node server (`e2e/fake-jira.mjs`) or mocked HTTP, downstream HTTP is mocked.

**Backend** (JUnit 5, Spring Boot Test, `mvn verify`; `src/test/java/com/ey/echo/builder/`):
`BuilderApplicationTest`, `VersionAlignmentTest` (Camel and Swagger UI versions agree between the pom, the UI
script and the runtime template), `ai/OpenAiCompatibleProviderTest`, `apis/ApiCatalogTest`,
`apis/ApprovedApiFlowTest`, `branding/BrandingTest`, `db/PublishTargetsMigrationTest`, `editor/CamelCatalogTest`,
`editor/EditorSettingsTest`, `flow/FlowArchiveTest`, `flow/FlowControllerTest`, `flow/FlowNamesTest`,
`flow/FlowPersistenceTest`, `flow/OperationIdsTest`, `flow/RestFromSpecTest`, `jira/AiExampleLabelerTest`,
`jira/ExampleFinderTest`, `jira/JiraImportTest`, `jira/StoryKeysAndTextTest`, `publish/ApiPathsTest`,
`publish/EndpointClashesTest`, `publish/JGitPublisherTest`, `publish/MultiTargetPublishTest`,
`publish/PublishControllerTest`, `publish/PublishedFlowControllerTest`, `publish/S3ClientTest`,
`publish/S3OnlyPublishTest`, `publish/S3PublisherTest`, `publish/SaveAsAndTemplatesTest`, `run/FlowRunnerTest`,
`run/RunControllerTest`, `run/RunValuesTest`, `security/AuthControllerTest`,
`security/EchoSecurityPropertiesTest`, `validation/ApprovedApisValidationTest`, `validation/FlowValidatorTest`,
`web/SpaForwardControllerTest`. Test resources: `config/application.yaml` (test users and settings),
`apis/inventory.yaml` and `apis/orders-swagger2.json` (approved API fixtures), `flows/*.camel.yaml` (one invalid
flow per validation rule: bad expression, disallowed component, disallowed language, malformed, missing mapping,
unknown step), a cut-down `test-camel-catalog/`, and a stub `static/index.html`.

**UI unit tests** (Vitest + Testing Library, jsdom; 39 files next to their sources, `*.test.ts(x)`): the pure
functions (operationIds, apiSpec serialisation, specFromSamples, jiraImport, callSchemas, specSchemas,
mappingCheck, stepProblems, restSettings, canvasZoom, canvasScrollbars, themes, ...) and the dialogs and pages
(flows page, name dialogs, publish, Run panel, Run With, samples, Jira import, spec panel).

**End to end** (Playwright, Chromium only, `builder-ui/e2e/`; viewport 1400×900, test timeout 120 s, expect
timeout 30 s, on CI 1 retry and 2 workers, trace kept on failure). `playwright.config.ts` starts the real backend
jar (`../builder-backend/target/echo-builder-backend-0.1.0-SNAPSHOT.jar`) on port 8080 with a temporary data
folder, a new bare Git repository (`flows.git`, branch `main`) as the publish target, `--echo.editor.autosave-seconds=0`,
the fake Jira on port 8199 (which also plays the AI engine at `/v1`), and two approved APIs (Blue Planet limited to
tags TMF638 and TMF639, and `inventory` from the backend's test resources). With `ECHO_E2E_BUNDLED=1` the tests
use the UI inside the jar on 8080; otherwise Vite on 5173 (`--strictPort`). Specs: `api-spec`, `canvas-scrollbars`,
`canvas-zoom`, `catalog`, `choose-type`, `datamapper-spec-schemas`, `datamappers-list`, `demo` (the whole demo
script), `editor-layout`, `editor-spike` (the playground), `enrich-api`, `flows`, `interface-list-delete`,
`interface-path-delete`, `jira-import`, `login`, `menus`, `new-flow-lands-on-interface`, `operation-routes`,
`operation-tags`, `path-clashes`, `publish`, `rest-from-spec`, `route-scaffold`, `run-with`, `samples-examples`,
`scaffold-datamapper`, `scaffold-schemas`, `step-problems`, `templates`, `themes`. `helpers.ts` holds the login
and `createFlow` helpers (`createFlow` adds a starter `platform-http:/<flow>` route through the API unless called
with `{route: false}`, because new flows start with no routes).

**Pipeline**: the CI job of section 24.3 is its test.

---

## 26. Edge cases and rules worth remembering

These are the rules that are easy to get wrong in a rebuild. Each is described in full in the section
named.

Names and identity
- A flow has a display name (any text) and an ID made from it (`FlowNames.idFor`, section 7.2). The ID
  is the folder name, the route file name and the URL part; renaming changes the display name only.
- A new name is refused when its name or its ID is that of another Builder flow or of a published
  flow in Git, ignoring case. The answer carries the flow to open, and the UI offers "Open <name>".
  There are no `-2` IDs.
- Nothing can be worked on before the flow has a name. Login lands on the start page, never on a canvas.
- The spec file keeps the name it was uploaded with. The default for a new spec is
  `<flow id>-api.yaml` (or `.json`). Only one spec per flow; older flows may have `openapi.json`.

Saving and publishing
- Save, autosave and Upload write H2 only. Git and S3 are written by Publish, Delete, Disable/Enable
  and Save As Template only.
- Upload never overwrites: a zip whose flow name is taken is refused.
- File saves to one flow are serialized on the backend (a lock per flow, and up to three attempts on an
  optimistic lock failure), because the editor writes several side files at once. The UI queues
  `.kaoto` writes.
- The generated REST part (`RestFromSpec`) is added whenever the flow leaves the editor (publish,
  download, run, validate, template) and stripped whenever a flow comes back in. It is never stored
  in the draft and never shown on the canvas.
- A publish that changes nothing on any target tells the user "Nothing changed since the last publish."
  (section 9 has what is recorded).
- Publish order of checks: validation errors (422), clashes with other published flows (409), spec
  operations without a route (409 with `missingRoutes`, skipped by "Publish Anyway"), then the write.
- "Edit as draft" copies a published flow into the Builder as a draft linked to it; the flows page
  shows the published row and the draft state together (sections 9, 16.3).
- A flow disabled on the flows page stays disabled when a new version is published.
- Delete removes the flow from H2 and from every enabled target.

Paths and operations
- A path belongs to one flow. Base Path + spec path is compared with `{param}` tails removed, so
  `/x` and `/x/{id}` are one path, whatever the method. Interface offers to switch flow, uploads with
  such paths are refused, save refuses new clashing paths (existing ones are tolerated).
- Two published flows with the same Base Path always clash, through `<Base Path>/docs`.
- operationIds: ECHO makes `<method><Path words>` for operations without one and hides the field.
  Uploaded specs keep their own ids and their YAML comments. When a path or method is renamed, an id
  ECHO made moves with it and the route's `direct:` name follows; an id the user's file brought stays.
- An operation without a route answers 404 with a JSON body, as does a switched-off route
  (`autoStartup: false`). They are shown as deprecated on the combined `/api-docs` page.
- REST always runs on `platform-http`. Validate rejects another component, a binding mode, or
  generated API docs.
- New flows start with `restConfiguration` holding `clientRequestValidation: true` and
  `enableCORS: true` and no routes. With validation on, a missing required or an unknown query
  parameter gives 400.

The route scaffold
- A method added in Interface, uploaded, copied or made from samples gets a route at once. Discarding
  the spec change removes the routes it made.
- Deleting an operation removes its route silently when the route is still the untouched scaffold of
  any era, and asks Keep or Remove when it was worked on.
- Scaffolds are compared era by era (section 18): a route counts as untouched when it equals what any
  earlier version of ECHO would have made for the operation, so old flows are still recognised.
- When an operation's parameters or body schemas change and its route is still an untouched scaffold,
  the scaffold is made again in the same era, keeping its description, API and host. A worked-on
  route is left alone.
- Request DataMappers exist for POST, PUT and PATCH only.
- A DataMapper with a mapping (`.xsl` holding more than the empty template) is never overwritten or
  re-prefilled by ECHO.

Run
- Run uses ports from `echo.run.port-range` (8081 to 8090), one per flow and user, stopped after the
  idle time. No free port gives 409, a flow that does not start gives 422 with the step named.
- Test values for `{{placeholders}}` come from a properties file picked in the browser, kept in
  memory per flow and user, and are never saved or published.
- The Builder calls the run port over HTTP/1.1 only.
- A step with an empty expression (for example a Set Headers entry without a value) is refused by
  Run with the step's name and flagged by Validate.

Editors
- Kaoto and Apicurio are never modified. Everything ECHO adds is injected around them: slots found by
  DOM selectors, a `MutationObserver` that re-applies after each render, CSS mapped onto theme tokens.
  Each of these breaks silently when the embedded version changes, so every one has an e2e test.
- Kaoto runs in its own React root (it brings its own router). Apicurio runs in a same-origin iframe
  and talks through `postMessage`.
- The catalog Kaoto sees is the backend's cut-down one. A component must be both in
  `echo.validation.allowed-components` and on the backend's class path, or Run cannot start it.
- Colours live only in `themes.css`. The mapping files may not contain colour values (a unit test
  checks this).

Pipeline and runtime
- Publish never builds anything and never writes Kubernetes manifests. The pipeline does both.
- `"disabled": true` in `echo-flow.json` makes `build-flow.sh` skip the flow. Templates are never built.
- Bundle mode fails the build (`BundleCheck`, section 22.2) when flows share a route id, a path or
  Base Path, or a property key with different values, when their REST configuration differs, or
  when one uses `/api-docs`, which the bundle reserves.
- The Ingress or HTTPRoute lists only the flows' own paths, so other apps on the same host keep theirs.
- Secret values are never written by the build: names matching `k8s.secret-names` go, empty, into
  `secret.yaml.example`; everything else goes into `configmap.yaml`.
- Tracing is off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Metrics are always on.
- The HTTP log replaces the values of the masked headers (`Authorization`, cookies, `X-Api-Key` and
  configured names) by `****` and cuts bodies at `max-body` characters (section 21).

Security and seams
- Session login with users from configuration; CSRF token in a cookie the UI echoes back. Open
  without a session: `/api/auth/login`, `/api/auth/csrf`, `/api/branding`, `/api/camel-catalog/**`,
  `/actuator/health` and `/actuator/info`, and the UI's static files. Everything else under `/api/**`
  and `/actuator/**` needs a session.
- Auth, Git provider, CI, secrets and database stay swappable: JGit over plain Git URLs, an S3 client
  written against the HTTP API (no cloud SDK), no provider API calls anywhere.
- Tests run offline: Git is a local bare repository, S3 is `FakeS3`, Jira and the AI engine are local
  fakes, downstream HTTP is mocked.

---

## Appendix A: file formats ECHO writes

**The flow folder** (in H2 as `flow_file` rows, in Git as `flows/<id>/`, in a zip at the top level):

| File | Made by | Content |
|---|---|---|
| `<id>.camel.yaml` | Kaoto, ECHO | The route file: a YAML list. A new flow holds one entry, `restConfiguration` with `clientRequestValidation: true` and `enableCORS: true`. Then one `route` per operation or hand-drawn route. Outside the editor the generated `rest` entry and the `echo-missing-*`, `echo-disabled-*` and `echo-docs-*` routes are added (section 8.3) |
| `<name>.yaml` / `.json` | Apicurio, upload | The flow's OpenAPI 3 spec, under its own file name |
| `kaoto-datamapper-<uuid>.xsl` | Kaoto DataMapper | The mapping as XSLT 3; the step's id is the file name without `.xsl` |
| `*.schema.json`, `*.xsd` | user, ECHO | Schemas attached to DataMappers |
| `openapi-<path>-<method>-request.schema.json`, `openapi-<path>-<method>-response-<status>.schema.json` | ECHO | A body schema of the spec, self-contained (`$defs` for referenced types), marked with `"x-echo-openapi": {"method", "path", "part", "status"}`. Rewritten when the spec changes (section 19) |
| `api-<api>-<operationId>-request.schema.json` | ECHO | The request body of a picked approved API operation, the target of the request DataMapper |
| `api-replies-<step>.schema.json` | ECHO | An object with one property per call label, each the reply schema of that call; the source of the reply DataMapper |
| `.kaoto` | Kaoto, ECHO | DataMapper metadata, a JSON object keyed by step id: `sourceBody` and `targetBody` (`{"type": "JSON Schema", "filePath": ["<file>"]}`), `sourceParameters`, `xsltPath`, `namespaceMap` |
| `.echo-done.json` | ECHO | JSON array of step ids whose red circle was marked as done; 2-space indent, trailing newline |
| `application.properties` | user | Defaults for the flow's `{{placeholders}}`; read by the pipeline for `configmap.yaml` |

**`echo-flow.json`** (added by Publish, never in the draft):

```json
{
  "name": "orders",
  "displayName": "Orders",
  "description": "What the publisher typed in the dialog",
  "version": 3,
  "author": "demo",
  "publishedAt": "2026-11-03T10:15:30Z",
  "disabled": true
}
```

`disabled` is present only when true. Keys are written in this order, 2-space indent.

**`echo-template.json`** (added by Save As Template, in `templates/<id>/`):

```json
{
  "name": "orders-template",
  "displayName": "Orders Template",
  "description": "",
  "savedBy": "demo",
  "savedAt": "2026-11-03T10:15:30Z"
}
```

**Flow zip** (Download Flow, Upload Flow): `<id>.zip` holding a folder `<id>/` with the flow's
files. The generated REST part is included on download and stripped on upload. On upload a single
top-level folder is removed, and exactly one top-level `*.camel.yaml` must remain; it names the flow
(section 7.6).

**Pipeline output**, per app, under `build/<app>/`: the exported Spring Boot project, the jar, the
image (pushed, or loaded locally with `--local-image`), and `k8s/` with `deployment.yaml`,
`service.yaml`, `ingress.yaml` or `httproute.yaml`, `configmap.yaml` and `secret.yaml.example`
(section 22).

## Appendix B: user-visible texts

The exact wording of labels, dialogs and messages is given where each screen is described. This is
the index:

| Texts | Section |
|---|---|
| Login page, masthead, "User: <name>", About page | 15.6, 17.1 |
| Start page actions, name dialogs, "taken name" alerts | 16 |
| Manage Flows page: columns, filters, row actions, confirmations | 16 |
| Tab line and menus (File, Interface Specs, Flow, Datamappers, Run, Advanced, About) | 17.1, 17.3 |
| Canvas toolbar, REST checkboxes, Fit Route, Maximize | 17.1, 17.4 |
| Validation messages (backend) | 10 |
| Red circles, "N problems", Mark as done, Clear | 17.5 |
| Publish dialog, "Published Successfully", clash and missing-route messages | 9, 17.6 |
| Run dialog, test panel, run errors | 11, 17.7 |
| Interface Specs bar, Base Path section, dialogs (Samples, Jira, Copy, Rename, path clash, Keep/Remove) | 18 |
| Scaffold step descriptions ("Attention ...", "BluePlanet Call", "Parallel Processor") | 18 |
| DataMapper Attach Schema additions and review warnings | 19 |
| Problem responses of the API (titles, details) | 7, 9, 14 |
| 404 bodies of missing and disabled operations | 8.3 |

Two fixed texts not tied to a screen: the product name is always "EY ECHO" with "EY" in `#FFE600`,
and the About page reads "EY ECHO (V2.0)." and "Developed By : Sony Antony".

## Appendix C: build order for a rebuild

Each step ends with the tests of section 25 for that area passing.

1. **Skeleton.** Maven project with the pinned versions (section 2), `application.yaml` defaults
   (section 4), Flyway migrations and entities (section 5), security and login (section 6). Vite
   project with the pinned dependencies, the api client, auth, branding and layout (section 15).
2. **Flows in H2.** `FlowNames`, `FlowService`, `FlowController`, zip archives (section 7); start
   page, name dialogs, Manage Flows (section 16).
3. **Kaoto embedded.** The catalog endpoint cut down to the allow list (section 12), the Kaoto host
   in its own React root, file bridge, Save, autosave, the tab line and menus (sections 17.1 to 17.4).
4. **Validation and Run.** `FlowValidator` (section 10), `FlowRunner` (section 11), the circles, Run
   dialog and test panel (sections 17.5, 17.7).
5. **Publishing.** `FlowPublisher`, Git and S3 targets, events, published flows, templates
   (section 9); Publish dialog, History, Save As, templates (sections 16, 17.6).
6. **The spec.** `ApiSpecFiles`, `OperationIds`, `RestFromSpec`, `ApiPaths`, `EndpointClashes`
   (section 8); the Apicurio host and everything in section 18 up to the path clash dialog.
7. **Routes from operations.** The scaffold and its eras, Add Route For Operation, Keep/Remove
   (sections 17.9, 18).
8. **Approved APIs.** `ApiCatalog`, the catalog's drop-downs, Tag filter, Enrich picker
   (sections 12, 17.8).
9. **DataMapper support.** Spec schemas, review, prefill, call schemas, the Datamappers list
   (section 19).
10. **Samples and Jira.** Schema inference, the Samples dialog, Jira client, AI labelling
    (sections 13, 18).
11. **Themes and polish** (section 20).
12. **Runtime and pipeline.** Runtime template, `build-flow.sh`, `BundleCheck`, `ApiDocsPage`,
    `K8sManifests`, smoke test (sections 21, 22), then samples, mock server, the Builder image,
    compose and CI (sections 23, 24).
