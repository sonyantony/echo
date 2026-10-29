# Sample pipeline

Turns published flow folders into container images. EY ECHO's job ends at a runnable image;
where it runs and how it is promoted is up to you.

| File | What |
|---|---|
| `build-flow.sh` | `camel export --runtime=spring-boot` → `mvn package` → image with Jib. Works in any CI. Adds the two dependencies export cannot see in the routes: `camel-openapi-validator` (request bodies checked against the spec when Client Request Validation is on) and the Swagger UI webjar (`<Base Path>/docs`). |
| `K8sManifests.java` | Run by `build-flow.sh` for each app: writes its Kubernetes manifests (see below). |
| `k8s.properties` | Your cluster's settings for those manifests (host, ingress class, TLS, namespace, ...). |
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

## Kubernetes manifests

Next to each image, the build writes `build/<app>/k8s/` (`<app>` is `echo-flows` in bundle mode, the
flow name in per-flow mode):

| File | What |
|---|---|
| `deployment.yaml` | The image on port 8080, with liveness/readiness probes. Flow settings and secrets come from an optional ConfigMap and Secret named `<app>-env` (e.g. `FULFILMENT_URL`). |
| `configmap.yaml` | The flows' `{{placeholders}}` as environment variables, with values for this environment (see below). |
| `secret.yaml.example` | The sensitive placeholders, with empty values: the Secret you create yourself. `kubectl apply` skips it. |
| `service.yaml` | Port 80 to the pods. |
| `ingress.yaml` | Only the paths the app's flows serve, so other apps on the same host keep theirs (see below). `httproute.yaml` (Gateway API) instead with `k8s.routing=httproute`. |

The paths come from the flows: each operation in the flow's OpenAPI spec under its Base Path, exact,
or a prefix up to its first `{param}` (`/orders/{id}/items` becomes prefix `/orders`); each
`platform-http` path; the flow's Swagger UI at `<Base Path>/docs`; and the bundle's `/api-docs`. So
an unchanged legacy app can keep serving `/` and every other path on the same host through its own
Ingress: controllers send each request to the longest matching path.

Set the host, ingress class, TLS secret, namespace, replicas and annotations in `k8s.properties` (or
point `--k8s-config` / `K8S_CONFIG` at another file). The sample Jenkinsfile keeps the files as build
artifacts, and with `DEPLOY` ticked it runs `kubectl apply` on them (kubeconfig from the
`KUBECONFIG_CREDENTIALS_ID` secret file). Otherwise hand them to your own release process or GitOps
tool. `kubectl apply` never deletes: remove a disabled or deleted flow's objects yourself.

```bash
pipeline/build-flow.sh flows --manifests-only    # just check the flows and write the manifests
```

### Flow settings and secrets

The build finds every `{{placeholder}}` the app's flows use and turns it into the environment
variable Spring reads as that property: dots and dashes become underscores, upper case
(`inventory.base-url` -> `INVENTORY_BASE_URL`). Give each environment its own values in a `.properties` file
that you keep outside the flow repository, and pass it to the build:

```properties
# /etc/echo/prod.properties
inventory.base-url=https://inventory.prod.example.com
fulfilment.url=https://fulfilment.prod.example.com/api
```

```bash
pipeline/build-flow.sh flows --registry ... --env-values /etc/echo/prod.properties   # or ENV_VALUES=...
```

`configmap.yaml` (ConfigMap `<app>-env`) gets each placeholder's value from that file, or else from
the flow's own `application.properties`. A placeholder with no value is left as a comment and named
in the build log, because an empty variable would replace the value in the image with nothing.

Names that match `k8s.secret-names` in `k8s.properties` (by default `*password*`, `*token*`, `*key*`,
`*secret*`, ...) are sensitive. The build never writes their values. It lists them in
`secret.yaml.example`, ignores them in the values file, and tells you to create the Secret once per
cluster:

```bash
kubectl create secret generic echo-flows-env --from-literal=BLUEPLANET_TOKEN=...
```

You can also create it from your vault (External Secrets, Sealed Secrets, ...). The pods read the
ConfigMap and then the Secret, so the Secret wins if a name is in both.

## Use it in your flow repository

1. Copy `pipeline/` and `runtime-template/` into the root of the flow repository the Builder
   publishes to, and set `pipeline/k8s.properties` for your cluster if you run the flows on Kubernetes.
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
