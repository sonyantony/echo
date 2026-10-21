# API spec (OpenAPI) for a flow

Version 2 makes flows contract-first: each flow can carry an OpenAPI spec describing the REST API
it offers. This page covers the editor; using the spec at runtime is the next step (below).

## Editing

In the flow editor, **API spec** (on the tab line, after DataMapper) opens the flow's spec in the
Apicurio OpenAPI editor (visual designer plus a Source tab), in place of Kaoto's views; the tab line
stays, so File, Flow Design, Rest and the rest are one click away, and unsaved spec edits are kept
while another view is open. **Save API spec**, or File > Save and Ctrl+S from any view, stores it
as `openapi.json` in the flow's folder, next to
`<flow>.camel.yaml`, so it is published, downloaded and uploaded with the flow like any other side
file. A flow without a spec starts from an empty OpenAPI 3.0.3 document named after the flow.
Autosave follows `echo.editor.autosave-seconds`, as in the flow editor.

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
check the API spec view in each theme (the `api-spec` e2e test checks the theme is applied).

## Next step: using the spec at runtime (not built yet)

1. **Generate or check the REST DSL from the spec.** Camel's `rest-openapi` (contract-first) binds
   each `operationId` in the spec to a `direct:<operationId>` route, so the flow implements
   operations instead of declaring paths by hand. The Builder would offer "Create routes from the
   spec" and validation would report operations without a route.
2. **Request validation.** With `rest-openapi`, set `clientRequestValidation=true` so requests that
   break the spec (missing required fields, wrong types) get a 400 before the flow runs. The flow
   image needs `camel-rest-openapi` (and its validator dependency) added by the export in
   `pipeline/build-flow.sh`, and the in-Builder Run needs the same.
3. **Swagger UI on the runtime.** Serve `openapi.json` from the flow image (e.g. `/openapi.json`)
   plus Swagger UI (`camel-openapi-java` or a static Swagger UI bundle) at `/api-docs`.
4. **Build checks.** Validation should report an invalid spec, and Publish should refuse one.
