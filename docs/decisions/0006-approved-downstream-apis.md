# 0006. Downstream calls go through approved API specs

Date: 2026-10-17
Status: Accepted

A buyer (the first one: Blue Planet's TMF APIs) wants flows to call only the operations of their
vendor's OpenAPI spec, and only some of those operations.

- **No custom Camel component.** Camel's `rest-openapi` already calls an operation by its
  operationId and takes the method, path and parameters from the spec. A component per vendor would
  be code ECHO has to maintain for each buyer.
- **Approved specs are per-install config** (`echo.apis`): spec files in /config/apis, with the
  operations allowed by tag or operationId. ECHO's code holds nothing vendor-specific.
- **The Builder enforces it.** Validate checks every REST OpenApi step (spec approved, operation
  allowed, host set). `only: true` also rejects plain http/https and hides them from the catalog. In
  the served catalog, the step's Specification Uri and Operation Id become drop-downs.
- **The flow carries the spec.** Run and Publish add the approved spec, as OpenAPI 3 JSON, to the
  flow's files under `<id>.openapi.json`. The image is then self-contained, and a published flow
  is pinned to the spec it was tested against.
- **Not chosen (yet):** one Kamelet per operation, which would give typed forms per operation. It
  can be built on top of this later.
