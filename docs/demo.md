# EY ECHO Version 1 demo

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

1. Choose **New flow**, name it `orders` and add a description.
2. The editor opens with a starter route (`platform-http` → `log`). Build the route on the
   canvas: a `platform-http` consumer on `/orders`, a **Kaoto DataMapper** step, an `http`
   call to `{{fulfilment.url}}`, and a second DataMapper step for the response.
3. In each DataMapper step, attach the JSON schemas from `samples/flows/orders/`
   (`order-request` → `fulfilment-request`, `fulfilment-response` → `order-response`), then
   drag fields from the source to the target. Incoming JSON is never passed through verbatim.
4. Choose **Save**. The editor warns you before you leave a page with unsaved changes.
   The editor also autosaves the draft every 10 seconds when something has changed since the
   last save (the header shows "Autosaved at ..."). Change the interval, or set 0 to turn it off,
   with `echo.editor.autosave-seconds` in `config/application.yaml` (or the environment variable
   `ECHO_EDITOR_AUTOSAVESECONDS`) and restart the container; no rebuild needed.

To skip the drawing, zip the `samples/flows/orders/` folder and choose **Upload flow** on the
Flows page, or load the files through the API (`PUT /api/flows/{id}/files/{path}`), as
`demo.spec.ts` does.

**Download .zip** (in the editor header, or Download in a flow's menu on the Flows page) saves the flow folder to your
computer as `<name>.zip`; **Upload flow** opens such a zip again as a new draft. An upload never
overwrites an existing flow: give it a new name if the name is taken.

**Download diagram (.png)** saves a picture of the whole flow as `<name>.png`, as it is on the
canvas (unsaved edits included).

## 3. Validate

Choose **Validate**. The Builder loads the flow with Camel and checks that it stays within
the Version 1 scope (HTTP and JSON components, allowed expression languages, and existing
DataMapper files). Errors appear in the panel with the line they refer to. A valid flow shows
"The flow is valid."

## 4. Publish

Choose **Publish**, describe the change and confirm. The Builder validates the flow again,
then commits `flows/orders/` to the configured branch as you. The commit holds the route,
the DataMapper XSLT, the schemas, `application.properties` and `echo-flow.json`. **History**
lists earlier publishes with their commit ids.

## 5. Build the image (the buyer's pipeline)

The buyer's pipeline does this step, not EY ECHO. `pipeline/Jenkinsfile` is a sample.
Locally:

```bash
git clone <flow repo> /tmp/flows
pipeline/build-flow.sh /tmp/flows/flows/orders --local-image          # echo-flow-orders:1.0.0
# or push: pipeline/build-flow.sh <folder> --registry registry.example.com/echo
```

The script exports the flow to a Spring Boot app with Camel JBang, packages it with Maven
and builds the image with Jib.

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
`-e SERVER_PORT=8081`, because both use port 8080. Set `-e FULFILMENT_URL=...` to point the
flow at a real service. The flow logs JSON (ECS), and its health endpoint is
`/actuator/health`.
