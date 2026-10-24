# 0012. One Swagger UI page for all the flows of a bundle

Date: 2026-10-24
Status: Accepted

Each flow serves Swagger UI at `<Base Path>/docs` (decision 0010). Users wanted one page for all the
flows in a bundle image. Specs of different flows may have data types (component schemas) of the
same name with different definitions.

- **One page with Swagger UI's "Select a definition" drop-down, not a merged spec.** The page at
  `/api-docs` lists every bundled flow that has a spec, by flow name, sorted A to Z ignoring case.
  Picking a flow loads the spec that flow already serves at `<Base Path>/docs/openapi`, so only one
  spec is shown at a time and same-named data types never meet. Considered: merging the specs into
  one, which would need every data type renamed per flow (and every `$ref` rewritten) and every
  path prefixed with its flow's Base Path, so the names on the page would no longer match the specs.
- **Made by the pipeline, in bundle mode only.** `build-flow.sh` runs `pipeline/ApiDocsPage.java`,
  which finds each flow's `echo-docs-<flow>-spec` route and writes `echo-api-docs.camel.yaml` (the
  page, Swagger UI's script, standalone preset and style, from the same webjar as each flow's page).
  The links are relative, and Try it out calls the host the page came from, as on each flow's page.
  A per-flow image has one flow, so it keeps only its own `<Base Path>/docs`; combining per-flow
  containers is a job for the buyer's gateway. Not in the Builder: Try it out there would call the
  Builder, not the flows.
- **`/api-docs` is kept for the page.** BundleCheck fails a bundle whose flow uses `/api-docs` or a
  path under it as its Base Path or `platform-http` path.
- **Disabled flows are not listed**: the pipeline leaves them out of the image (decision 0011).
- **A switched-off route's operation is shown as deprecated.** It answers 404 (decision 0011), so
  `RestFromSpec` serves a JSON copy of the spec with `deprecated: true` on that operation (Swagger UI
  greys it out and strikes its path through) at `<Base Path>/docs/openapi`, on the flow's own page
  and on the combined one. The spec file is not changed. The copy is read the way Swagger UI reads
  YAML, so dates and `on`/`off` stay text.
