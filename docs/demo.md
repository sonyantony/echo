# EY ECHO demo

This walkthrough goes from an empty Builder to a running flow image. The flow is the golden
`orders` flow in `samples/flows/orders/`. It receives `POST /orders`, maps the request with
the DataMapper, calls a fulfilment service and maps that service's reply into the response.

`builder-ui/e2e/demo.spec.ts` automates steps 2 to 4. CI builds and smoke tests the step 5
image (the `pipeline` job).

## 1. Start the Builder

You need Docker and a Git repository for the flows. An empty repository is enough.

```bash
cp config/application.example.yaml config/application.yaml   # set echo.git.url, users
export ECHO_GIT_TOKEN=<token with push rights>
docker compose up -d --build
```

Open http://localhost:8080 and sign in as `designer` / `designer`. Change this user in
`config/application.yaml` before anyone else uses the install.

If you don't have a Git server, run the Builder from source and point it at a local bare
repository instead:

```bash
git init --bare /tmp/echo-flows.git
cd builder-ui && pnpm install && pnpm build
cd ../builder-backend && mvn -q -Pwith-ui package -DskipTests
java -jar target/echo-builder-backend-*.jar --echo.git.url=file:///tmp/echo-flows.git
```

## 2. Create the flow

1. After logging in you land on the start page. Choose **New Flow**, name it `orders` and add a description.
2. The new flow opens on **Interface Specs > Design**, because API-first flows start from their
   OpenAPI spec and get a route per operation from it ([api-spec.md](api-spec.md)). The orders flow
   is drawn by hand instead: choose **Flow > Design** to open the canvas, which has no routes yet, and
   use the canvas's **New**. Build the route: a `platform-http` consumer on `/orders`, a **Kaoto DataMapper** step, an `http`
   call to `{{fulfilment.url}}`, and a second DataMapper step for the response.
3. In each DataMapper step, attach the JSON schemas from `samples/flows/orders/`
   (`order-request` → `fulfilment-request`, `fulfilment-response` → `order-response`), then
   drag fields from the source to the target. Incoming JSON is never passed through verbatim.
4. Choose **Save**. The editor warns you before you leave a page with unsaved changes.
   The editor also autosaves the draft every 10 seconds when something has changed since the
   last save (the header shows "Autosaved at ..."). Change the interval, or set 0 to turn it off,
   with `echo.editor.autosave-seconds` in `config/application.yaml` (or the environment variable
   `ECHO_EDITOR_AUTOSAVESECONDS`) and restart the container; no rebuild needed.

To skip the drawing, zip the `samples/flows/orders/` folder and choose **Upload Flow** on the
start page (or in the File menu, or **Upload flow** on the Flows page), or load the files through the API (`PUT /api/flows/{id}/files/{path}`), as
`demo.spec.ts` does.

The editor's controls sit on one line, the tab line: **File** (New Flow, Open Flow Template, Open
Flow, Manage Flows, Upload Flow, Save, Save As, Save As Template, Publish Flow), **Interface Specs** (the flow's
OpenAPI spec: Design, Upload, Copy From Another Flow, Interface Specs from Samples and the downloads),
**Flow** (Design opens the canvas; Add Route For Operation, History, Download <flow> and Download <flow> As Image),
**Datamappers** (the flow's DataMapper steps by name; click one to open it), **Run** (Run <flow>, Run <flow> With...),
**Advanced** (Java Beans) and **About**. At the right end are the **Publish Flow** button, the Draft or
Published label, the save state ("Unsaved changes" or "Autosaved at ...") and "Flow: <name>".
The canvas toolbar has Download Flow, Download As Image, **Validate** and the Client Request
Validation and Enable CORS checkboxes; the canvas controls include **Fit Route** and **Maximize**.
**Ctrl+S** saves and **Ctrl+O** opens Open Flow Template (Cmd on a Mac).
**Open Flow** goes to the Flows list (asking first about unsaved changes) to pick another flow.
**Manage Flows** opens the same list, titled Manage Flows, to delete, rename or open flows.

**Download <flow>** (in the Flow menu, or Download in a flow's menu on the Flows page) saves the flow folder,
every file of the flow, to your computer as `<name>.zip`; **Upload Flow** (in the editor's File menu) opens such a zip again as a new draft. An upload never
overwrites an existing flow: give it a new name if the name is taken.

**Save As** (in the File menu) saves what is on screen as a draft with another name and
opens it; the original keeps its last saved version. **Save As Template** saves it to the
`templates/` folder of the flow repository (next to `flows/`). **Open Flow Template** (on the Flows
page or in the editor's File menu) starts a new draft from one of those templates. Both Save As choices warn and ask before
replacing an existing draft or template. Pipelines build only `flows/`, so templates never become
images.

**Download <flow> As Image** (also in the Flow menu) saves a picture of the whole flow as `<name>.png`, as it is on the
canvas (unsaved edits included).

## 3. Validate

Choose **Validate** on the canvas toolbar (Flow > Design). The Builder loads the flow with Camel and checks that it stays within
the Version 1 scope (HTTP and JSON components, allowed expression languages, and existing
DataMapper files). Each step with a problem gets a red circle at its top right counting them; click it to
see them (**Clear** in that box hides them until the next Validate). A red "N problems" button next to Validate lists the problems no step shows (another file, or no
line), opening by itself when there are any, and **Clear the problems** removes the circles. A valid flow
shows "The flow is valid."

## 3a. Run it and send it a request

Choose **Run > Run <flow name>** in the editor. The Builder saves and validates the draft, then starts it
inside the Builder on its own port (8081 for the first running flow, up to 8090). A panel below
the header shows:

- the URL to call from your own tools, e.g. `http://localhost:8081/orders`;
- a box to send a test request (method, path, JSON body) and the reply;
- the flow's log: each request, its `log` steps, and errors.

**Restart** runs your latest changes; **Stop** ends the run. A run stops by itself after 30
minutes without requests.

A flow that uses `{{placeholders}}` (the orders flow's `{{fulfilment.url}}`) runs with the values of a
properties file you choose. The first **Run <flow name>** opens **Run <flow name> With...**: it lists
the values the flow uses and checks that the file you pick with **Browse...** sets each one (a
placeholder with a default, `{{name:default}}`, needs none). Later runs reuse that file; choose
**Run > Run <flow name> With...** to pick another. The file is only for test runs: the Builder keeps
it in memory for you and that flow, never saves it with the flow or publishes it, and asks again
after a restart or when the flow uses a value the file does not set. The image's values still come
from the flow's `application.properties` and the pipeline's ConfigMap.

Things to know:

- The flow runs inside the Builder container, so `localhost` in an `http` step is the container.
  To call a service on your own computer, use `http://host.docker.internal:<port>`.
- The incoming request's headers travel with the message. Add a **Remove Headers** step (pattern
  `*`) before calling other services, as the orders flow does, or the incoming path changes the
  URL called. Validate (and so Run and Publish) reports a flow that does neither.
- A test run uses the same Camel version and components as the flow image, but not the image's
  Spring Boot packaging, so build the image (step 5) as the final check.
- Settings: `echo.run.enabled`, `first-port`, `last-port`, `idle-minutes` and `public-url` (the
  host users call, shown in the panel) in `config/application.yaml`. docker-compose publishes
  ports 8081 to 8090.

## 4. Publish

Choose **Publish Flow** (the button before Draft at the right of the tab line, or **File > Publish Flow**), describe the change and confirm. The Builder validates the flow again,
then commits `flows/orders/` to the configured branch as you. The commit holds the route,
the DataMapper XSLT, the schemas, `application.properties` and `echo-flow.json`. **History**
lists earlier publishes with their commit ids.

## 5. Build the image (the buyer's pipeline)

The buyer's pipeline does this step, not EY ECHO. `pipeline/Jenkinsfile` is a sample.
Locally:

```bash
git clone <flow repo> /tmp/flows
pipeline/build-flow.sh /tmp/flows/flows --mode per-flow --local-image   # echo-flow-orders:1.0.0
# or all flows in one image (the default mode): pipeline/build-flow.sh /tmp/flows/flows --local-image  # echo-flows:1.0.0
# or push: pipeline/build-flow.sh <folder> --registry registry.example.com/echo
```

The script exports the flows to a Spring Boot app with Camel JBang, packages it with Maven
and builds the image with Jib. By default (`--mode bundle`) every flow goes into one image; flows
then share port 8080, so each needs its own Base Path, and the build lists any clash and stops.
`--mode per-flow` builds one image per flow. The sample Jenkinsfile has the same `BUILD_MODE` setting.

## 6. Run and call it

`pipeline/smoke-test-orders.sh` starts the mock fulfilment service on port 9090, runs the
image and checks the reply. By hand:

```bash
java -jar ~/.echo/camel-launcher-4.22.1.jar run --quarkus-version=3.36.0 \
  samples/mock-downstream/fulfilment-mock.camel.yaml &
docker run --rm --network host echo-flow-orders:1.0.0 &
curl -s -X POST localhost:8080/orders -H 'Content-Type: application/json' \
  -d @samples/flows/orders/sample-request.json
# {"orderId":"A100","fulfilmentId":"FUL-A100","status":"ACCEPTED"}
```

Stop the Builder container first, or run the flow on another port with
`-e SERVER_PORT=8091`, because both use port 8080 (and the Builder keeps 8081 to 8090 for Run). Set `-e FULFILMENT_URL=...` to point the
flow at a real service. The flow logs JSON (ECS), including every request and response
([http-log.md](http-log.md)); its health endpoint is `/actuator/health` and its metrics are at
`/actuator/prometheus` ([observability.md](observability.md)).

## 7. Kubernetes

Each build also writes Kubernetes manifests next to the image, in `build/<app>/k8s/`: a Deployment,
a Service, an Ingress (or HTTPRoute) for only the flows' paths, and a ConfigMap made from the flows'
`{{placeholders}}`. See `pipeline/README.md` and decisions 0017 and 0018.
