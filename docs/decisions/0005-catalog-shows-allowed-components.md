# 0005. The editor's catalog shows only what flows may use

Date: 2026-10-17
Status: Accepted

Kaoto showed the whole Camel catalog (about 366 components, 64 processors, 156 Kamelets), but
Validate only accepts the components in `echo.validation.allowed-components`. Run can only start
flows whose components are bundled in the Builder. So most of the catalog could not be used.

- **The Builder serves Kaoto's catalog** (`CamelCatalogController`, `/api/camel-catalog/**`)
  instead of the UI's static copy. It cuts components down to `allowed-components` and expression
  languages down to `allowed-languages`. It also drops the processors in
  `echo.catalog.hidden-processors`, which need jars the Builder does not bundle (circuit breaker,
  marshal/unmarshal and the like). Kamelets are dropped unless `kamelet` is an allowed component.
  Every other catalog file is passed through unchanged. The filtered files are built on first
  request and cached.
- **One list per install.** A buyer who narrows `allowed-components` in /config/application.yaml
  also narrows the catalog, without a rebuild. Widening it also needs the component's jar in
  `builder-backend/pom.xml`, or Run cannot start flows that use it. The flow image needs nothing
  extra, because `camel export` adds the dependencies a flow uses.
- **rest-openapi is allowed** (camel-rest-openapi is bundled). A flow calls an operation of an
  OpenAPI spec kept in the flow folder (`rest-openapi:<spec>.json#<operationId>`).
  `pipeline/build-flow.sh` copies the flow's JSON files into the image so the spec is on the
  classpath.
- **Not chosen:** opening every component. Run would have to download jars from Maven while it
  runs, which buyers' networks often block, and the allowed list would stop limiting what flows
  can call.
