# Openapi Design: a flow's OpenAPI spec

Version 2 makes flows contract-first: each flow can carry an OpenAPI spec describing the REST API
it offers. This page covers the editor and what the spec does when the flow runs (REST service,
request validation, Swagger UI).

## Editing

In the flow editor, **Interface Specs** (called Openapi Design, then Openapi, then Interface, before; on the tab line, right after File: API-first flows start
from the spec, then Flow Design) opens the flow's spec in the Apicurio OpenAPI editor
(visual designer plus a Source tab), in place of Kaoto's views. Like Flow Design it is also a menu:

- **Upload**: picks a `.yaml`, `.yml` or `.json` OpenAPI (or Swagger 2.0) file and stores it in the
  flow as it is: same file name, same text, comments and operationIds; only operations without an
  operationId get one added (docs/decisions/0013). A name with characters a flow file cannot
  have (spaces, for example) is asked for again. If the flow already has a spec, or there are
  unsaved edits, it asks before replacing them. A file with a path another flow has is refused
  (docs/decisions/0015).
- **Copy From Another Flow**: lists every other flow's spec; the picked one is copied into this
  flow under the same name (`POST /api/flows/{id}/api-spec/copy-from/{sourceId}`) and is this
  flow's own from then on. A flow has one spec, so it says first that it replaces the one the flow
  has (and any unsaved edits). Its paths are the other flow's, so it is refused unless that
  flow's paths are gone or changed (a path is in one flow only, decision 0015).
- **Interface Specs from Samples** (called New From Samples, then New Interface Specs from Samples,
  before): a method, a path (with an optional sample `?query`) and a sample request and response,
  from which ECHO writes the operation, its parameters and its data types. With no spec yet it
  makes the spec (**Create**). When the flow has one, **Add to this spec** keeps everything it has
  and adds the method, under the path the spec has already (whatever its `{names}`) or a new one,
  with its data types (names not taken yet), its samples as examples and its route. When the spec
  has that method on that path, the button reads **Replace GET /path** instead: the method made
  from the samples takes the old one's place under the same operationId (so its route stays), and
  the data types only the old one used go; **Cancel** keeps it. **Replace Whole Spec** throws the spec
  away and makes a new one.
  A new path another flow has is asked about, as when typed in (decision 0015).
- **Download Openapi File As Yaml** / **As Json**: the spec on screen, unsaved edits included,
  named after the spec (or the flow while the spec has no name).

The bar above the editor holds the format (**Yaml** or **Json** radio buttons; Yaml for a new spec),
**Interface Specs from Samples** (the same dialog as the menu item), **Save**, **Rename** and **Discard**. It takes the place of Apicurio's title bar with the API's name
(hidden by `theme/apicurio-mapping.css`); Apicurio's undo, redo and Issues stay at its right.

Apicurio's list on the left is plain items (`apispec/overviewNav.ts`): **Info**, **Tag Definitions**,
**Paths**, **Data Types**, **Responses** (with their counts) and **Source** (the whole spec's source,
Upload on its toolbar). None of them folds open; each shows its content in the right pane. Paths, Data
Types and Responses show Apicurio's own list there (Add, right-click Rename / Clone / Delete), and an
entry picked from it opens in its place. Until something is picked the right pane is empty (Interface >
Design opens it that way). Apicurio's search box, which only filtered the left lists, is hidden. Info
holds Version, Description and Base Path. Contact, License and Security are hidden, though a spec that
has them keeps them and Source shows them; Vendor Extensions is hidden on every page, the same way.

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
  `echo.editor.autosave-seconds`. A spec not named yet is autosaved as `<flow>-api.yaml` once it
  has a path, since its operations have routes on the canvas already (Rename changes the name).
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

- **operationIds are ECHO's business** (docs/decisions/0013). Every operation without one is named
  after its method and path in camelCase (`GET /cards/{cardId}` is `getCardsCardId`) as soon as it
  is added (before any Save), and Openapi hides the Operation ID field; ids an uploaded spec came
  with stay. Saving writes only what changed into the stored file, so its comments stay. Renaming a
  path or changing a method renames the operation, and the flow's routes for it follow (`direct:` endpoints, and the route's ECHO-made
  id and label). **Flow > Add Route For Operation** lists the operations by method and path and
  adds a route for each one picked, so nobody types an id.
- **Routes follow the methods edited in Interface.** A method added there gets its route on the
  canvas at once (`direct:<operationId>` and a scaffold, as Add Route For Operation makes it: a
  Set Variable per parameter, Remove Headers `*`, Set Headers "SetAuthorizationHeaders", a
  multicast with one pipeline: Set Headers, for POST, PUT and PATCH a Kaoto DataMapper for the
  request, and a REST OpenApi step whose operation the user picks, and a JSON reply, a Kaoto
  DataMapper for it and Set Headers "SetResponseHeaders", which sets Content-Type `application/json`
  and response code 200; see decision 0013). The DataMappers start from the spec's schemas: the
  request DataMapper's source is the request body, and (for GET, POST, PUT and PATCH) the reply
  DataMapper's target is the response (200, else another 2xx, else `default`). ECHO writes them as
  the `openapi-*.schema.json` files Attach Schema makes, so they follow the spec on Save; a method
  added before it has a body gets them when it does, while its route is still as ECHO made it.
  Once the REST OpenApi step picks an Operation Id of an approved API, the request DataMapper's
  target is that operation's request body (`api-<api>-<operationId>-request.schema.json`); it
  follows a change of operation while nothing is mapped, and a target the user attached stays.
  The pipeline's Set Body then labels the reply with the operation's id (`"createService": ${body}`
  instead of `"result": ${body}`), following a change of operation unless the user named it.
  The reply DataMapper's source is then the multicast's joined replies, `{"<label>": <reply>, ...}`:
  an object with a property per pipeline whose call picks an operation with a response body (200,
  else another 2xx, else `default`), typed by that body (`api-replies-<operationId>.schema.json`,
  each reply's `$defs` kept under `<label>.`). ECHO reads the body as JSON for it (no Set Body
  `${null}`, `useJsonBody: true`, as Kaoto sets it), follows picks, labels and added pipelines while
  nothing is mapped, and goes back to no source when nothing is picked; a source the user attached stays.
  The steps the user still has to work on get a red circle on the canvas, which
  opens what is left to do: the pipeline's Set Headers (until its rows are changed), DataMapper
  (until something is mapped), REST OpenApi (until an operation is picked) and last Set Body (until
  "result" is renamed), and the reply's DataMapper (until something is mapped). Validate reports each
  DataMapper, with a red circle on its step, until something is mapped. **Mark as done** in a circle's
  box takes a thing to do away for good (the step ids are kept in the flow's `.echo-done.json`); **Clear**
  takes Validate's problems on a step away until the next Validate. Routes made while these steps
  read **Attention** lose that label when opened. Parameters
  added or removed later change its Set Variable steps while the route is still as ECHO made it. A
  method deleted there takes its route away without asking while the route is still as ECHO made
  it (so undoing an add leaves nothing behind); a route somebody worked on is kept unless the user
  picks **Remove Route** in the dialog that asks, and Undo in Interface brings it back as it was.
  Upload gives each operation of the file a route under its own operationId (one with a route
  keeps it) and treats the old spec's operations it lacks as deleted. Interface Specs from Samples and Copy
  From Another Flow do the same with the spec they bring. Discard treats every operation on screen
  as deleted, so no route made for them is left behind (one somebody worked on is asked about).
- **Samples are kept as examples.** Interface Specs from Samples (and Import From Jira) saves each sample as
  the named example (`examples.sample`) of its body, which Apicurio lists (it does not list a bare
  `example`), and keeps it as the `example` of the data type it makes. Picking such a data type
  for a body or response without an example of its own, e.g. one under Responses, adds the
  sample as its example at once (ECHO clicks Add an example in the editor, so undo takes it
  back; `sampleExampleFiller.ts`). Save does the same for any it missed. Upload is kept as it is.
  Apicurio drops `null` fields from example values.
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
- Upload, Edit as draft and Open Flow Template take the generated part out again, so it never shows up
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

### Import From Jira

When the install has a Jira (`echo.jira`, below), the Interface bar has **Import From Jira**. It
asks for a story's link (or its key, `PAY-142`), reads the story's description and comments, and
finds the example payloads, calls and query parameters written in them: JSON in code blocks or in
the text, `POST /accounts/{accountId}/payments`, `GET https://api.acme.com/v1/payments?status=OPEN`,
"Endpoint: /cards", "Query parameters: type=DEBIT, active=true".

With an AI engine (`echo.ai`, below), the engine pairs them: it reads the story with each example
replaced by `[Example n]`, and answers which example is the request and which the response of which
operation, its path and query, and why, in a sentence. It only picks among the examples ECHO found;
it never writes a payload, and its answer is checked (unknown example numbers, methods and paths are
dropped, with a note). Without an engine, or when it cannot be reached or answers nothing usable,
ECHO's own guess is used (and the user told why): an example belongs to the call written before it,
and "request" or "response" just before it says which it is.

It then shows one card per operation, for the user to check and correct before anything
changes: method, path (with its sample query; the spec's Base Path is taken off), and the request
and response bodies. Each body is picked from the story's examples ("Example 4 · Comment by Priya
Shah, 14 Oct 2026 · called the response") and can be edited. The engine's reason is shown on the
card. When the story has several examples for the same thing (a corrected response in a later
comment), the card says so; ECHO's own guess picks the newest. Cards can be left out, removed or added; one whose method and path the spec has already says
that importing replaces it (keeping its operationId, so its route stays).

**Add To Spec** adds the operations and their data types to the spec on screen, unsaved, keeping
everything it has. Schemas are made as Interface Specs from Samples makes them (named after method and path,
`PostAccountsAccountIdPaymentsRequest`, numbered when the spec has the name; fields with a value are
required, null ones are optional strings). New operations get a route at once, and a new path
another flow has is asked about, as when typed in. A last dialog lists the paths and data types it
made and what is worth checking; **Undo** there takes it all out again. Save keeps it.

Code: `builder-backend/.../jira/` (reading the story, `ExampleFinder`, `AiExampleLabeler`),
`builder-backend/.../ai/` (the engines), `builder-ui/src/apispec/` `JiraImportModal.tsx` and
`jiraImport.ts`. See decision 0016.

#### Setting up Jira

ECHO reads stories with one shared, read-only Jira account. In `config/application.yaml` (or the
environment):

```yaml
echo:
  jira:
    base-url: https://acme.atlassian.net   # ECHO_JIRA_URL; only links on this site are read
    deployment: cloud                      # cloud | data-center (Jira Server too)
    username: echo-bot@acme.com            # ECHO_JIRA_USERNAME; Cloud only
    token: ${ECHO_JIRA_TOKEN}              # never in Git
    read-comments: true
```

- **Jira Cloud:** sign in as the account and create an API token at id.atlassian.com (Security >
  API tokens). ECHO sends the email and token as Basic auth (REST API 3).
- **Jira Data Center / Server:** create a personal access token in the account's profile and leave
  `username` empty: ECHO sends it as a Bearer token (REST API 2). With a username, the token is sent
  as its password with Basic auth instead.

Import From Jira is hidden until `base-url` and `token` are set. A link to another site is refused,
so the token is only ever sent to the configured Jira; it is never logged or sent to the browser.

#### Setting up the AI engine

Optional. The story's text is sent to the engine, so use one your company has approved for that;
the dialog says which engine it is before the story is read. Any engine that speaks the OpenAI chat
completions protocol works, chosen by its endpoint:

```yaml
echo:
  ai:
    provider: openai-compatible            # none (default): ECHO's own guess, no AI
    timeout-seconds: 60
    openai-compatible:
      base-url: https://acme.openai.azure.com/openai/v1   # without /chat/completions
      api-key: ${ECHO_AI_KEY}              # never in Git
      key-header: api-key                  # Azure: api-key; OpenAI and most others: Authorization (Bearer)
      model: gpt-4.1                       # Azure: the deployment name
      # api-version: 2024-10-21            # only for older Azure OpenAI endpoints
```

| Engine | `base-url` | `key-header` |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `Authorization` |
| Azure OpenAI / Azure AI Foundry | `https://<resource>.openai.azure.com/openai/v1` | `api-key` |
| Ollama (local, no key) | `http://ollama:11434/v1` | (leave `api-key` empty) |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | `x-api-key` |
| LiteLLM or another gateway | its URL | as it needs |

ECHO asks for a JSON answer (`response_format: json_object`) at temperature 0. Another protocol (a
native Claude or Copilot engine) is one more class behind `ai/AiProvider`.

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
4. **More AI engines.** Import From Jira speaks the OpenAI protocol only; native Claude or GitHub
   Copilot engines would each be one class behind `AiProvider` (decision 0016).

## A path in one flow only

A path added in the editor is checked against every other flow, in the Builder and published
(`/x` and `/x/{id}` count as one path, whatever the methods). If another flow has it, "This path is
in another flow" offers **Switch to <flow>** (the path is taken out, this flow is saved and the
other one opens) or **Remove the path here**. Upload refuses such files, and Save refuses a spec
with a new path another flow has. See docs/decisions/0015-a-path-in-one-flow-only.md.
