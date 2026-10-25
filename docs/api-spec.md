# Openapi Design: a flow's OpenAPI spec

Version 2 makes flows contract-first: each flow can carry an OpenAPI spec describing the REST API
it offers. This page covers the editor and what the spec does when the flow runs (REST service,
request validation, Swagger UI).

## Editing

In the flow editor, **Interface** (called Openapi Design, then Openapi, before; on the tab line, right after File: API-first flows start
from the spec, then Flow Design) opens the flow's spec in the Apicurio OpenAPI editor
(visual designer plus a Source tab), in place of Kaoto's views. Like Flow Design it is also a menu:

- **Upload**: picks a `.yaml`, `.yml` or `.json` OpenAPI (or Swagger 2.0) file and stores it in the
  flow exactly as it is: same file name, same text. A name with characters a flow file cannot
  have (spaces, for example) is asked for again. If the flow already has a spec, or there are
  unsaved edits, it asks before replacing them.
- **Copy From Another Flow**: lists every other flow's spec; the picked one is copied into this
  flow under the same name (`POST /api/flows/{id}/api-spec/copy-from/{sourceId}`) and is this
  flow's own from then on. A flow has one spec, so it says first that it replaces the one the flow
  has (and any unsaved edits).
- **Download Openapi File As Yaml** / **As Json**: the spec on screen, unsaved edits included,
  named after the spec (or the flow while the spec has no name).

The bar above the editor holds the format (**Yaml** or **Json** radio buttons; Yaml for a new spec), **Save**,
**Save As** and **Discard**. It takes the place of Apicurio's title bar with the API's name
(hidden by `theme/apicurio-mapping.css`); Apicurio's undo, redo and Issues stay at its right, and
**API Overview** opens the spec's own details (Info, Tag Definitions and Base Path; Contact,
License and Security are hidden, though a spec that has them keeps them and Source shows them;
Vendor Extensions is hidden on every page, the same way), which a click on that
title used to do.

**Base Path** is Apicurio's Servers section under another name: the path the flow serves its
operations under, e.g. `/customers/v1` (the spec's `/orders` is then called as
`/customers/v1/orders`). It is stored as the spec's server URL (`servers: [{url: /customers/v1}]`),
which is where Camel takes it from. Its dialog has just the one field (no Apply button, description
or server variables; `basePath.ts` presses Apply as you type), and once there is a base path the
add button goes. Without one the operations are served from the root.

- **Save** stores the spec as a draft in the flow, in the chosen format. The first time it asks
  for a file name (a name typed without extension gets the format's). Picking the other format
  and saving rewrites the file with the other extension (`customer.json` becomes
  `customer.yaml`). File > Save and Ctrl+S save the spec too, from any view; autosave follows
  `echo.editor.autosave-seconds` once the spec has a name.
- **Save As** always asks for the name.
- **Discard** (after asking, if there are unsaved edits) starts again from a blank spec without
  a name. The saved spec stays in the flow until something is saved over it.

While Openapi Design is open, the breadcrumb reads **Openapi / &lt;file name&gt;**, or
**Openapi / &lt;new&gt;** before the spec has a name.

### Where the spec is stored

A flow has **one** spec, a side file in its folder next to `<flow>.camel.yaml`, under its own
name and format: `flows/<flow>/customer-api.yaml` in Git, and the same file in the draft. It is
published, downloaded and uploaded (.zip), and copied by Save As and templates, like any other
side file. Saving it under another name replaces the old file. Flows made before specs kept their
names have `openapi.json`, which still opens. The backend finds the spec by its content
(`ApiSpecFiles`): the top-level `.json`/`.yaml`/`.yml` file with an `openapi` or `swagger` field,
other than the route, `*.schema.json` files and copies of approved APIs (`<id>.openapi.json`,
docs/apis.md); `FlowDetail.apiSpec` names it, and `PUT /api/flows/{id}/api-spec/{name}` saves it.
A `rest-openapi` endpoint points at the spec by its file name, e.g. `customer-api.yaml`.

### The flow's REST service

There is no Rest tab: the spec **is** the flow's REST service. Whenever the flow leaves the editor
(Run, Validate, Publish, Download, Save As Template) ECHO adds to the route file a contract-first
`rest` whose `openApi.specification` is the flow's spec (`RestFromSpec`, docs/decisions/0008), so
Camel sends each operation to the route `direct:<operationId>` under the Base Path. The draft
itself keeps only what is designed, so the service always follows the spec's current name.

- **operationIds are ECHO's business** (docs/decisions/0013). Every operation is named after its
  method and path in camelCase (`GET /cards/{cardId}` is `getCardsCardId`) as soon as it is added
  (before any Save), and Openapi hides the Operation ID field. Renaming a path or changing a method renames the
  operation, and the flow's routes for it follow (`direct:` endpoints, and the route's ECHO-made
  id and label). **Flow > Add Route For Operation** lists the operations by method and path and
  adds a route for each one picked, so nobody types an id.
- **Routes follow the methods edited in Interface.** A method added there gets its route on the
  canvas at once (`direct:<operationId>` and a log step, as Add Route For Operation makes it). A
  method deleted there takes its route away without asking while the route is still as ECHO made
  it (so undoing an add leaves nothing behind); a route somebody worked on is kept unless the user
  picks **Remove Route** in the dialog that asks, and Undo in Interface brings it back as it was.
  Upload, Copy From Another Flow, New From Samples and Discard replace the whole spec and leave
  the routes alone.
- **An operation without a route** answers **404** with a JSON message naming the operation. The
  service has `missingOperation: ignore` (so the flow starts), and ECHO adds a small
  `echo-missing-<operationId>` route for each such operation; add a route for it and it takes
  over. A path that is not in the spec is a 404 too. **Publish** lists such operations (and ones
  whose route is switched off) and publishes only after **Publish Anyway**.
- The **Client Request Validation** and **Enable CORS** checkboxes, stacked just before Publish on
  the Flow Design toolbar, turn the REST configuration's
  settings on and off (`restConfiguration` in the route file). They need a spec. See
  [Request validation](#request-validation) below.
- **Swagger UI** for the spec is at **`<Base Path>/docs`** of the running flow (below).
- The Run panel lists the spec's paths, Base Path included, to call, and links the flow's Swagger UI.
- Upload, Edit as draft and Open Template take the generated part out again, so it never shows up
  in the draft. A flow with its own hand-written (code-first) `rest` keeps it.

### Request validation

With **Client Request Validation** ticked, every request is checked against the spec before the
flow's route sees it, and a request that does not fit gets **400** with what is wrong:

- the request body against the operation's schema: required fields, types, formats, enums,
  lengths, and fields the schema does not have (Atlassian's swagger-request-validator rejects
  those unless the schema allows them with `additionalProperties`);
- required query parameters, path parameters and headers, and their types;
- the Content-Type the operation takes and the Accept it can answer.

The answer names each field by its JSON path, for example:

```
Validation failed.
[ERROR][REQUEST][POST /orders @body] [Path '/qty'] Instance type (string) does not match any allowed primitive type (allowed: ["integer"])
[ERROR][REQUEST][POST /orders @body] Object has missing required properties (["sku"])
```

A caller that sends `Accept: application/json` gets the same as a JSON report (`messages`, each
with a `key`, `message` and `context.pointers.instance`, e.g. `/qty`). The plain report is sent
with the request's Content-Type, so Swagger UI shows it under "can't parse JSON".

This is Camel's own client request validation with `camel-openapi-validator` on the classpath
(docs/decisions/0010): in the Builder (Run) as a dependency, in flow images through
`pipeline/build-flow.sh`, in both build modes. It is not a step in the flow, so there is nothing to
add in the editor and nothing to allow in `echo.validation.allowed-components`. Untick the
checkbox and nothing is checked. A flow with its own hand-written (code-first) `rest` gets no
checks at all from the checkbox, since this validator works from a spec.

### Swagger UI

Every flow with a spec serves Swagger UI at **`<Base Path>/docs`** (`/docs` without a Base Path),
in Run and in flow images, so the flow documents itself wherever it runs. It shows the operations
and their schemas, and **Try it out** calls the same flow: requests go to the server the page came
from, whatever host the spec's server URL names. With Client Request Validation ticked, a body
that does not fit gets the 400 above, which makes Swagger UI an easy way to show it.

| Path | What |
|---|---|
| `<Base Path>/docs` | the page |
| `<Base Path>/docs/openapi` | the flow's spec, as it is in the flow |
| `<Base Path>/docs/swagger-ui-bundle.js`, `swagger-ui.css` | Swagger UI itself |

`RestFromSpec` adds four small routes for these (`echo-docs-<flow>`, `-spec`, `-script`, `-style`)
next to the REST service, and takes them out again like the rest of the generated part. They read
Swagger UI from the `org.webjars:swagger-ui` jar on the classpath (version
`echo.swagger-ui.version`, from `runtime-template/versions.properties` in images and the Builder's
own jar in Run), so nothing is fetched from the internet. In a bundle image every flow has its own
page under its own Base Path; two bundled flows without a Base Path would both want `/docs`, and
the bundle check stops the build.

Run panel: **Open API docs (Swagger UI)** opens the page of the running draft in a new tab, at the
run port (`echo.run.public-url`).

### A schema from a sample JSON

Apicurio does this itself: under **Data Types** choose **Add a data type**, enter a name and paste
a sample request or response into **JSON Example**. Saving generates the schema: field names,
types (string, integer, number, boolean), nested objects and arrays. The dialog can also create a
REST resource (paths and operations) for the type. Then refine it: mark required fields, add
formats, enums and descriptions. The sample is kept as the schema's `example`.

### DataMapper schemas from the spec

Kaoto's DataMapper reads only standalone JSON Schema (or XSD) files: it never looks inside an
OpenAPI document (`components/schemas` is not one of the places it reads, and a YAML spec cannot
even be picked). So when the DataMapper's **Attach Schema** asks for a JSON file, ECHO first shows
**Attach a schema**: the request and response bodies of the flow's spec (unsaved edits included),
grouped by operation (`POST /orders (createOrder)`: Request body, Response 200, ...), with
**Upload File** for a file from the computer instead (`datamapper/SpecSchemaPickerModal.tsx`).

The picked body is written into the flow as a JSON Schema file named after its endpoint, method
and part: `openapi-orders-post-request.schema.json`, `openapi-orders-post-response-200.schema.json`,
`openapi-orders-id-put-request.schema.json` (`/` and `{}` become `-`, the path's case is kept, and
`-2` is added if another file has the name). The body's schema is at the top of the file, the
schemas it refers to are in its `$defs`, OpenAPI-only keywords (`nullable`, `example`, `x-...`)
are left out, and `x-echo-openapi` records which body it came from (`datamapper/specSchemas.ts`).
Attaching the same body again reuses the file.

Each time the spec is stored (Save, autosave, rename, Upload, Copy From Another Flow) and when the
flow opens, ECHO makes these `openapi-*` files again from the spec; uploaded schemas are never
touched. It then reads each DataMapper step's `.xsl` (Kaoto names every field it reads and writes)
against the step's `openapi-*` schemas (from `.kaoto`), and lists, above the editor, the steps that
map a field the schema no longer has or has with another type, or whose body is gone from the spec:
"Route orders, step kaoto-datamapper-order-request, source body (...): customer is not in the
schema." A renamed field shows as missing under its old name. The list is checked again as the
DataMapper changes the mapping, and clears once nothing is left to review
(`datamapper/specMappings.ts`, `mappingCheck.ts`).

## How it is embedded

Apicurio's editor is an Angular app, so it cannot render inside the Builder's React tree. The
Builder ships Apicurio's own prebuilt editor (from the Apicurio Registry UI image, Apache 2.0) in
`builder-ui/public/apicurio-editor/` and shows it in a same-origin frame; see the README there and
`builder-ui/src/apispec/`. The Builder therefore sends `X-Frame-Options: SAMEORIGIN` instead of
Spring Security's default `DENY`.

Being same-origin also lets the Builder theme the editor without changing the vendored copy:
`ApicurioEditorHost` injects the theme file (`src/theme/themes.css`) and Apicurio's mapping onto it
(`src/theme/apicurio-mapping.css`) into the frame, with the theme's name and the install's brand
colours (`apicurioTheme.ts`). It restyles the font (Inter), title bar, outline, links, Design/Source
tabs, buttons, fields, dialogs, wizards and the code editor in the theme's colours, so under graphite
the editor is dark too. Apicurio is built on PatternFly 3, which has no colour variables, so the
mapping targets Apicurio's class names: after refreshing the editor with `update-apicurio-editor.sh`,
run the `themes` e2e test, which fails on text left unreadable in any theme and attaches a
screenshot of each screen per theme (see [branding.md](branding.md#themes)).

## Not built yet

1. **Validate and missing routes.** Validate could list the operations without a route before Run
   (today they answer 404).
2. **Response validation.** Camel can check the flow's responses against the spec too
   (`clientResponseValidation`); there is no checkbox for it.
3. **Build checks.** Validation should report an invalid spec, and Publish should refuse one.
