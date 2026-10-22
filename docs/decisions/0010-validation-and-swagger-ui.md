# 0010. Request body validation and Swagger UI come with the flow's spec

Date: 2026-10-22
Status: Accepted

The requirements ask the runtime to reject requests that do not fit their schema and to show a
Swagger UI. Flows already serve their REST service from their OpenAPI spec (0008), with a Client
Request Validation checkbox that only checked content type and that required parts are there.

- **Body validation is Camel's own, made complete by `camel-openapi-validator`.** With that jar on
  the classpath, Camel's client request validation for a contract-first service uses Atlassian's
  swagger-request-validator, which checks the body against the operation's schema (and parameters,
  headers, content type), and answers 400 listing each problem with the field's JSON path. No step
  in the flow, no custom code, no new allowed component. The Builder has it as a dependency (Run);
  `pipeline/build-flow.sh` adds it to every export (`--dep camel:openapi-validator`), bundle or
  per-flow.
- **It stays tied to the Client Request Validation checkbox.** That is where Camel switches it,
  bundled flows must agree on it anyway (one REST configuration per app), and a flow can still
  turn it off. Every flow made from a spec can now validate fully; ticking the box is the choice.
  The cost: a hand-written code-first `rest` (no spec) gets no checks from the box any more, since
  Camel uses this validator for every service and it needs a spec. The editor has made no
  code-first services since 0008.
- **Swagger UI is served by the flow, from a webjar.** `RestFromSpec` adds four routes next to the
  REST service: the page at `<Base Path>/docs`, the spec at `<Base Path>/docs/openapi` (read from the
  classpath, as rest-openapi reads it) and Swagger UI's script and style, read from the
  `org.webjars:swagger-ui` jar (`resource:classpath:` constants, loaded once when the flow starts).
  Only platform-http and core steps, so the same YAML works in Run (Vert.x) and in Spring Boot
  images, and each bundled flow has its own page under its own Base Path. Nothing comes from a CDN,
  since buyers' networks may not allow it. Considered: Camel's `camel-openapi-java` (code-first API
  docs only; Validate already rejects `apiContextPath`) and Spring Boot's `/webjars/**` (not in Run,
  and one shared path in a bundle).
- **The Swagger UI version is a property.** The routes read
  `webjars/swagger-ui/{{echo.swagger-ui.version}}/`; Run sets it from the webjar in the Builder,
  build-flow.sh from `runtime-template/versions.properties`. Published flows therefore do not pin a
  version, and `VersionAlignmentTest` keeps the Builder's pom and the template the same.
- **Try it out tests this flow.** The page sends every call to the host it was loaded from, so a
  spec whose server URL names another host (production, say) still calls the running flow.
