# Openapi Design: a flow's OpenAPI spec

Version 2 makes flows contract-first: each flow can carry an OpenAPI spec describing the REST API
it offers. This page covers the editor; using the spec at runtime is the next step (below).

## Editing

In the flow editor, **Openapi Design** (on the tab line, right after File: API-first flows start
from the spec, then Rest, then Flow Design) opens the flow's spec in the Apicurio OpenAPI editor
(visual designer plus a Source tab), in place of Kaoto's views. Like Flow Design it is also a menu:

- **Upload**: picks a `.yaml`, `.yml` or `.json` OpenAPI (or Swagger 2.0) file and stores it in the
  flow exactly as it is: same file name, same text. A name with characters a flow file cannot
  have (spaces, for example) is asked for again. If the flow already has a spec, or there are
  unsaved edits, it asks before replacing them.
- **Download Openapi File As Yaml** / **As Json**: the spec on screen, unsaved edits included,
  named after the spec (or the flow while the spec has no name).

The bar above the editor holds the format (**Yaml** or **Json** radio buttons; Yaml for a new spec), **Save**,
**Save As** and **Discard**. It takes the place of Apicurio's title bar with the API's name
(hidden by `apicurioTheme.css`); Apicurio's undo, redo and Issues stay at its right, and
**API Overview** opens the spec's own details (Info and Tag Definitions; Contact,
License, Servers and Security are hidden, though a spec that has them keeps them and Source shows them;
Vendor Extensions is hidden on every page, the same way), which a click on that
title used to do.

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

### Openapi Specification in the Rest tab

A Rest service's Open Api section (contract-first: `rest: openApi: specification: <file>`) shows
**Openapi Specification** as a drop-down instead of Kaoto's text field (`SpecificationPicker`,
put in place of Kaoto's input through `KaotoEditorHost`'s `formFields`; the label comes from the
catalog, `CamelCatalogController`). It lists:

- **`<new>`**: asks for a file name and stores an empty spec (`openapi: 3.0.3`, no paths) as this
  flow's spec, to design in Openapi Design.
- **This flow's spec**, if it has one: picked as it is.
- **Every other flow's spec** in the Builder's database (`GET /api/flows/api-specs`), labelled
  with its flow. Picking one copies the file into this flow under the same name
  (`POST /api/flows/{id}/api-spec/copy-from/{sourceId}`); the copy is this flow's own from then
  on, and editing it leaves the other flow's spec alone.

A flow has one spec, so `<new>` and a copy replace the spec the flow had, after asking. The spec
file is stored in the draft straight away (like Upload); the field itself is saved with the flow.
Run and the pipeline both serve the operations of the spec named here (each `operationId` goes to
`direct:<operationId>`); `pipeline/build-flow.sh` copies YAML specs as well as JSON ones.

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
`ApicurioEditorHost` injects `src/apispec/apicurioTheme.css` into the frame and copies the active
theme's colours onto it (`apicurioTheme.ts`). It restyles the font (Inter), title bar, outline
selection, links, Design/Source tabs, buttons, fields, dialogs and the code editor. Apicurio is
built on PatternFly 3, which has no dark mode, so under graphite the editor stays light. The CSS
targets Apicurio's class names: after refreshing the editor with `update-apicurio-editor.sh`,
check the Openapi Design view in each theme (the `api-spec` e2e test checks the theme is applied).

## Next step: using the spec at runtime (not built yet)

1. **Generate or check the REST DSL from the spec.** Camel's `rest-openapi` (contract-first) binds
   each `operationId` in the spec to a `direct:<operationId>` route, so the flow implements
   operations instead of declaring paths by hand. The Builder would offer "Create routes from the
   spec" and validation would report operations without a route.
2. **Request validation.** With `rest-openapi`, set `clientRequestValidation=true` so requests that
   break the spec (missing required fields, wrong types) get a 400 before the flow runs. The flow
   image needs `camel-rest-openapi` (and its validator dependency) added by the export in
   `pipeline/build-flow.sh`, and the in-Builder Run needs the same.
3. **Swagger UI on the runtime.** Serve the flow's spec from the flow image (e.g. `/openapi.json`)
   plus Swagger UI (`camel-openapi-java` or a static Swagger UI bundle) at `/api-docs`.
4. **Build checks.** Validation should report an invalid spec, and Publish should refuse one.
