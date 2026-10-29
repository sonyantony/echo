# Approved downstream APIs

Flows call downstream systems with a **REST OpenApi** step (Camel's `rest-openapi` component). The
step names a spec and an operation, not a URL. The HTTP method, path, base path, path and query
parameters and content type all come from the spec. Each install lists the specs its flows may
call in `echo.apis`. A buyer adds their own specs (a vendor's TMF APIs, for example) as files in
`config/apis/`, without a rebuild. Nothing about any one vendor is in ECHO's code.

With docker compose, `config/apis/` is kept in Git: `config/apis/approved-apis.yaml` holds the
`echo.apis` settings and docker-compose.yml loads it on top of `config/application.yaml`
(`SPRING_CONFIG_IMPORT`), so its `echo.apis` wins over any there. This install approves the Blue
Planet spec (`config/apis/blueplanet.yaml`) for its TMF638 Service, TMF639 Resource Typed,
TMF634 Resource Catalog and Lumen Custom Numbers, Device Template and Name Generation
operations only (45 of the spec's 66).

```yaml
echo:
  apis:
    only: true                          # flows may call nothing else (no plain http/https steps)
    specs:
      - id: blueplanet                  # lower case; the flow's copy is blueplanet.openapi.json
        name: Blue Planet               # used in messages
        file: /config/apis/blueplanet.yaml
        allowed-tags:                   # operations with one of these tags may be called
          - TMF638 Service Controller
          - TMF639 Resource Typed Controller
          - TMF634 Resource Catalog Controller
          - Lumen Custom Numbers API Controller
          - Lumen Device Template API Controller
          - Lumen Name Generation API Controller
        allowed-operations: []          # operationIds allowed whatever their tags
```

With both `allowed-tags` and `allowed-operations` left out, every operation in the spec may be
called. Specs may be OpenAPI 3 or Swagger 2.0, in YAML or JSON. Swagger 2.0 is converted to OpenAPI 3
when the Builder starts, because Camel reads only OpenAPI 3. A spec that cannot be loaded is logged
and reported by Validate on the flows that use it. It does not stop the Builder. Restart the Builder
after changing a spec (`docker compose restart`).

## In a flow

1. Add a **REST OpenApi** step. In its **All** tab, pick **Specification Uri** and **Operation Id**.
   Both are drop-downs of the approved specs and their allowed operations. With `only: true` the
   catalog also has no HTTP steps. Reload the browser page after restarting the Builder.
   The **Tag** drop-down above Operation Id lists the spec's tags that have allowed operations
   (A to Z, with how many); picking one leaves only its operations in the Operation Id drop-down.
   It is only a filter, ECHO's own control in Kaoto's form: nothing of it is saved in the flow. A
   step whose operation is set opens on that operation's tag.
2. Set **Host** to the API's address, for example `{{blueplanet.base-url}}`, when the spec has no server
   host (relative `servers`). Set the value in the flow's `application.properties`, or supply it
   when the container starts.
3. Path and query parameters come from headers with the same names. For example, set a header `id`
   for `/v1/service/{id}`. The request body is the message body.
4. Add a **Remove Headers** step with pattern `*` before the call, so the incoming request's headers
   don't change the URL. Then set what the API needs, such as
   `Authorization: Bearer {{blueplanet.token}}`. Secrets stay as placeholders and never go into Git.

A route ECHO makes for a new operation of the flow's spec already has this shape: Set Variable
steps for the operation's parameters, Remove Headers `*`, and a REST OpenApi step inside a
multicast. A Set Headers step "SetAuthorizationHeaders" before the multicast sets
`Authorization: Bearer {{<id>.token}}`, and one just before the call sets a header per variable
(`id` from `${variable.id}`) plus `Accept`. With exactly one approved API, its Specification Uri
(and Host placeholder) are filled in; pick the Operation Id, then adjust the Set Headers rows to the
parameters it takes. Every step that needs the user (that Set Headers, the REST OpenApi step, the
pipeline's last Set Body and the DataMapper after the reply) reads Attention on the canvas.

The step is saved as:

```yaml
- to:
    uri: rest-openapi
    parameters:
      specificationUri: blueplanet.openapi.json
      operationId: createService
      host: "{{blueplanet.base-url}}"
```

## What the Builder checks

Validate (and so Run and Publish) rejects:

- a REST OpenApi step calling an operation that isn't in the spec, or isn't allowed;
- a step without Host when the spec names no server host;
- a REST OpenApi step without Remove Headers before it in a route started by an HTTP request;
- with `only: true`: plain `http`/`https` steps, and REST OpenApi steps naming a spec that isn't approved.

## Run and Publish

The flow refers to the spec by its file name. Run and Publish add a current copy of the approved
spec, converted to OpenAPI 3 JSON, to the flow's files. Run finds it on the classpath. Publish
writes it to the flow folder, and `pipeline/build-flow.sh` copies it into the image. A published
flow keeps the spec version it was published with, until it is published again.

## Limits

- Camel's `requestValidationEnabled` only checks that a body is present and is JSON, and that
  required parameters are set. It doesn't check the body against the schema.
- A spec that uses a path parameter without declaring it sends the literal `{name}`. Fix the spec.
