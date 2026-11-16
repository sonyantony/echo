# Mock server

A stand-in for a downstream API, for demos and for trying flows without the real system. It reads an
OpenAPI spec and answers every operation in it, and it shows each call it receives, so you can see
exactly what a flow sent. Here it plays Blue Planet, the API this install approves in
`config/apis/` ([docs/apis.md](../docs/apis.md)).

It is a demo aid: not part of the Builder, the flow images or the tests, and not for production.

## Files

| File | What |
|---|---|
| `mock-server.js` | The server. One Node script, no build |
| `run.bat` | Windows: opens the call log in Chrome and starts the server for Blue Planet on port 4020 |
| `BPI-api-docs-latest-modified.yaml` | The Blue Planet spec the mock serves. The same file as `config/apis/blueplanet.yaml` |
| `BPI-api-docs-latest.yaml` | The spec as received, for reference. The same file as `config/apis/blueplanet.original.yaml` |
| `runAsJar.properties`, `runAsContainer.properties` | Test values that point a flow at the mock (see [Pointing a flow at it](#pointing-a-flow-at-it)) |
| `samplerequests.txt` | Real Blue Planet requests and responses, kept as examples |
| `responses/` (optional, you create it) | Your own answers per operation (see [Changing an answer](#changing-an-answer)) |

## Starting it

You need Node.js. A YAML spec also needs a YAML parser, once:

```bash
npm install -g yaml        # or, in this folder: npm install yaml
```

Then, in this folder:

```bash
node mock-server.js BPI-api-docs-latest-modified.yaml 4020
```

On Windows, `run.bat` does the same and opens the call log. The general form is
`node mock-server.js <spec.yaml or .json> [port]`; without a port it uses the `PORT` environment
variable, or 4010. Any OpenAPI 3 spec works, so the same script can mock another API.

At start it lists every operation it serves, with its operationId.

## What it answers

For each request it finds the operation by method and path (the spec's base path may be left out
or included) and answers its 200 response, or the first other 2xx:

1. `responses/<operationId>.json`, if you made one;
2. else the `example` (or first of `examples`) the spec gives for that response;
3. else a dummy made from the response's schema: property names and types as the spec has them,
   with placeholder values. A response the spec only calls `type: object` is filled with the path
   parameters and `href`, so the caller gets something.

A 204 operation answers 204 with no body. A path or method the spec does not have answers 404 with
`{"error": "No matching operation in spec"}`. Requests are not validated and no login is checked:
any token works. CORS is open, so Swagger UI and browser pages can call it.

One operation is special: **`getResources`** always answers a real Blue Planet Device (taken from
a Lumen call), with every `AVDLAZRH4P001` in it replaced by the request's `?name=`.

### Changing an answer

Create a `responses` folder here and put a file named after the operation in it, for example
`responses/getResource.json`. Its content is sent as the answer. `{{name}}` in it is replaced by the
path or query parameter of that name (`"id": "{{id}}"`). The file is read on every call, so you can
edit it while the server runs. A file that is not valid JSON is reported on the console and skipped.

## Seeing the calls

| Where | What |
|---|---|
| `http://localhost:4020/__ui` | Live call log in the browser, newest first, with **Clear** |
| The console | The same, as each call arrives |
| `GET /__calls` | The log as JSON (the last 500 calls); `DELETE /__calls` clears it |

Each call shows its method and path, the operation it matched, path and query parameters, the body,
the answer, and the headers worth seeing (`Authorization`, `Content-Type`, `Accept`, `X-...`, API
keys). This is the quickest way to check that a flow sends the parameters, headers and body the
API expects.

## Pointing a flow at it

A flow reaches a downstream API through `{{placeholders}}` (its address and token). For a test run
in the Builder, choose **Run > Run <flow> With...** and pick a properties file that sets them
([docs/decisions/0019](../docs/decisions/0019-run-with-a-properties-file.md)):

| The Builder runs | File | Address of the mock |
|---|---|---|
| as a jar on the same computer | `runAsJar.properties` | `http://localhost:4020` |
| in Docker (`docker compose`) | `runAsContainer.properties` | `http://host.docker.internal:4020` (inside the container, `localhost` is the container) |

The file must set every placeholder the flow uses, or Run With... says which one is missing. The
two files set `blueplanet.base-url` and a token. Routes ECHO makes for a spec's operations use
`{{api.base-url}}` and `{{api.token}}` instead, so for those add:

```properties
api.base-url=http://localhost:4020
api.token=dummy
```

(with `host.docker.internal` when the Builder runs in Docker). The token can be anything; never put
a real one in these files, since they are in Git.

For a flow image, pass the same values as environment variables, for example
`-e API_BASE_URL=http://host.docker.internal:4020 -e API_TOKEN=dummy`.
