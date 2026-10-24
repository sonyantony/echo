# Sample pipeline

Turns published flow folders into container images. EY ECHO's job ends at a runnable image;
where it runs and how it is promoted is up to you.

| File | What |
|---|---|
| `build-flow.sh` | `camel export --runtime=spring-boot` → `mvn package` → image with Jib. Works in any CI. Adds the two dependencies export cannot see in the routes: `camel-openapi-validator` (request bodies checked against the spec when Client Request Validation is on) and the Swagger UI webjar (`<Base Path>/docs`). |
| `BundleCheck.java` | Run by `build-flow.sh` in bundle mode: fails the build if flows clash (see below). |
| `Jenkinsfile` | Sample Jenkins pipeline: builds `flows/*` and pushes to a registry. |
| `smoke-test-orders.sh` | Runs the golden `orders` image (or the bundle, with `--bundle`) against a mock downstream and checks the responses. |

## Build mode

| Mode | Image | When the Jenkinsfile builds |
|---|---|---|
| `bundle` (default) | `echo-flows:<version>`: every flow in `flows/`, one app on port 8080 | When any flow changes; tagged `1.0.<build number>` |
| `per-flow` | `echo-flow-<flow>:<version>`, one per flow | For each flow changed since the last successful build |

Set it with the Jenkinsfile's `BUILD_MODE` parameter, or `--mode` / `BUILD_MODE` for the script.
Bundle is lighter for a small install. Per-flow lets you release, roll back and scale each flow on
its own, keeps a broken flow from affecting the others, and gives each container only that flow's
secrets. `templates/` is never built, nor is a flow disabled on the Builder's Open Flow page
(`"disabled": true` in its `echo-flow.json`).

Bundled flows run in one app on one port, so before exporting, the build lists every clash and
stops:

- two flows on the same **Base Path** (the spec's server URL in Openapi Design; none counts as `/`)
  or the same `platform-http` path (each flow with a spec also serves Swagger UI at `<Base Path>/docs`,
  so two flows without a Base Path clash on `/docs`);
- the same `direct:` endpoint: contract-first operations go to `direct:<operationId>`, so
  operationIds must differ between flows too;
- the same route or step id, a file name with different content, a property with different values,
  or different REST configurations (Client Request Validation, Enable CORS: Camel has one per app).
- a Base Path or path of `/api-docs` or under it: a bundle serves one Swagger UI page for all its flows
  there, with a drop-down that picks the flow (A to Z, ignoring case; `ApiDocsPage.java` writes it).

Fix the flows, or use `per-flow`.

## Use it in your flow repository

1. Copy `pipeline/` and `runtime-template/` into the root of the flow repository the Builder
   publishes to.
2. Create a pipeline job on `pipeline/Jenkinsfile` with your registry URL and credentials, or call
   the script from your own CI:

```bash
# All flows in one image, pushed to a registry (no Docker daemon needed)
REGISTRY_USERNAME=... REGISTRY_PASSWORD=... pipeline/build-flow.sh flows --version 1.0.7 --registry mycompany.jfrog.io/echo-docker

# One image per flow
pipeline/build-flow.sh flows --mode per-flow --registry mycompany.jfrog.io/echo-docker
pipeline/build-flow.sh flows/orders --mode per-flow --registry mycompany.jfrog.io/echo-docker

# Or build into the local Docker daemon, or just the jar
pipeline/build-flow.sh flows --local-image
pipeline/build-flow.sh flows --jar-only
```

A folder argument is either one flow folder or a folder of flows. In per-flow mode the version is
`1.0.<n>`, where `n` is the publish number in `echo-flow.json`, or `--version`; in bundle mode it is
`--version` (default `1.0.0`). Images listen on port 8080 and expose `/actuator/health/liveness`
and `/actuator/health/readiness`. Flow settings come from the flows' `application.properties`;
override them at run time with environment variables (for example `FULFILMENT_URL=https://...`
overrides `fulfilment.url`).

## Try the golden flows locally

```bash
pipeline/build-flow.sh samples/flows --local-image                  # echo-flows:1.0.0 (orders + greetings)
pipeline/smoke-test-orders.sh --bundle

pipeline/build-flow.sh samples/flows --mode per-flow --local-image  # echo-flow-orders:1.0.0, echo-flow-greetings:1.0.0
pipeline/smoke-test-orders.sh
```
