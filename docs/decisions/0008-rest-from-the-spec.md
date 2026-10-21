# 0008. A flow's REST service comes from its OpenAPI spec

Date: 2026-10-21
Status: Accepted

Flows are contract-first: the API a flow offers is its OpenAPI spec (Openapi Design), and Camel's
contract-first REST sends each operation to `direct:<operationId>`. Users asked to stop writing the
REST part by hand, so the editor has no Rest tab.

- **ECHO makes the REST part when the flow leaves the editor, not in the draft.** Run, Validate,
  Publish, Download and Save As Template get the route file with it added (`RestFromSpec`, through
  `FlowService.files`): one `rest` with `openApi.specification: <the flow's spec>` and
  `missingOperation: ignore`. The draft keeps only what the user designs, so the REST part always
  follows the spec as it is at that moment (renamed, replaced by Upload or Copy From Another Flow)
  without the editor reloading anything. The published flow is complete, so the buyer's pipeline
  is unchanged. Upload, Edit as draft and Open Template take the generated part out again
  (`RestFromSpec.strip`).
- **Base Path is the spec's server URL.** Camel serves the operations under the path of the spec's
  server URL (checked in Run and in a pipeline-built jar). Openapi Design shows Apicurio's Servers
  section as Base Path, cut down to the one field. A REST configuration Context Path would replace
  it, so ECHO drops an old one when the spec has a Base Path.
- **An operation without a route answers 404.** With `missingOperation: ignore` the flow starts
  without routes for every operation, but Camel then answers those with an empty 204. ECHO adds a
  small route per missing operation (`echo-missing-<operationId>`) that answers 404 with a JSON
  message; it disappears as soon as the flow has its own `direct:<operationId>` route.
- **The two REST settings are in the Flow Design menu.** Client Request Validation and Enable CORS
  are written to the route's `restConfiguration` (where Camel reads them and older flows have
  them) by loading the changed YAML into Kaoto, so they are saved like any other edit. Camel's
  client request validation checks content type and required body, query parameters and headers;
  it does not check a body against its schema.
- **Hand-written REST still works.** A `rest` with its own verbs (code-first) is left alone. A
  contract-first `rest` the old Rest tab wrote is replaced by the generated one.
