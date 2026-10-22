# Openapi Design: a flow's OpenAPI spec

Version 2 makes flows contract-first: each flow can carry an OpenAPI spec describing the REST API
it offers. This page covers the editor; using the spec at runtime is the next step (below).

## Editing

In the flow editor, **Openapi Design** (on the tab line, right after File: API-first flows start
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

- **An operation without a route** answers **404** with a JSON message naming the operation. The
  service has `missingOperation: ignore` (so the flow starts), and ECHO adds a small
  `echo-missing-<operationId>` route for each such operation; add a route from
  `direct:<operationId>` and it takes over. A path that is not in the spec is a 404 too.
- The **Client Request Validation** and **Enable CORS** checkboxes, stacked just before Publish on
  the Flow Design toolbar, turn the REST configuration's
  settings on and off (`restConfiguration` in the route file). They need a spec. Camel's request
  validation answers 400 when a body, query parameter or header the spec requires is missing, and
  415/406 for a content type the operation does not take or give; it does not check a body against
  its schema.
- The Run panel lists the spec's paths, Base Path included, to call.
- Upload, Edit as draft and Open Template take the generated part out again, so it never shows up
  in the draft. A flow with its own hand-written (code-first) `rest` keeps it.

### A schema from a sample JSON

Apicurio does this itself: under **Data Types** choose **Add a data type**, enter a name and paste
a sample request or response into **JSON Example**. Saving generates the schema: field names,
types (string, integer, number, boolean), nested objects and arrays. The dialog can also create a
REST resource (paths and operations) for the type. Then refine it: mark required fields, add
formats, enums and descriptions. The sample is kept as the schema's `example`.

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

1. **Body validation.** Checking request bodies against their schema (Camel's client request
   validation does not), and Validate reporting operations without a route before Run.
2. **Swagger UI on the runtime.** Serve the flow's spec from the flow image (e.g. `/openapi.json`)
   plus Swagger UI (`camel-openapi-java` or a static Swagger UI bundle) at `/api-docs`.
3. **Build checks.** Validation should report an invalid spec, and Publish should refuse one.
