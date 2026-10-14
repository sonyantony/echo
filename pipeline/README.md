# Sample pipeline

Turns a published flow folder into a container image. ECHO's job ends at a runnable image;
where it runs and how it is promoted is up to you.

| File | What |
|---|---|
| `build-flow.sh` | `camel export --runtime=spring-boot` → `mvn package` → image with Jib. Works in any CI. |
| `Jenkinsfile` | Sample Jenkins pipeline: builds every changed `flows/*` folder and pushes to a registry. |
| `smoke-test-orders.sh` | Runs the golden `orders` image against a mock downstream and checks the response. |

## Use it in your flow repository

1. Copy `pipeline/` and `runtime-template/` into the root of the flow repository the Builder
   publishes to.
2. Create a pipeline job on `pipeline/Jenkinsfile` with your registry URL and credentials, or call
   the script from your own CI:

```bash
# Push to a registry (no Docker daemon needed)
REGISTRY_USERNAME=... REGISTRY_PASSWORD=... pipeline/build-flow.sh flows/orders --registry mycompany.jfrog.io/echo-docker

# Or build into the local Docker daemon, or just the jar
pipeline/build-flow.sh flows/orders --local-image
pipeline/build-flow.sh flows/orders --jar-only
```

The image is `echo-flow-<flow>:<version>`; the version is `1.0.<n>` where `n` is the publish
number in `echo-flow.json`, or `--version`. Images listen on port 8080 and expose
`/actuator/health/liveness` and `/actuator/health/readiness`. Flow settings come from the flow's
`application.properties`; override them at run time with environment variables
(for example `FULFILMENT_URL=https://...` overrides `fulfilment.url`).

## Try the golden flow locally

```bash
pipeline/build-flow.sh samples/flows/orders --local-image
pipeline/smoke-test-orders.sh
```
