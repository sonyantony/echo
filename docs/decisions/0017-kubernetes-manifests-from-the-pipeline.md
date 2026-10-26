# 0017. Kubernetes manifests made by the pipeline, routing only the flows' paths

Date: 2026-10-26
Status: Accepted

Buyers want to run the flow images on Kubernetes next to their existing (legacy) apps, on the same
host, without changing those apps: a request must reach the flow that serves its path, and every
other path must still reach the app that serves it today.

- **Made by the pipeline at build time, not by Publish.** `pipeline/build-flow.sh` runs
  `pipeline/K8sManifests.java` for each app it builds and writes `build/<app>/k8s/`:
  `deployment.yaml`, `service.yaml` and `ingress.yaml` (or `httproute.yaml`). Only the build knows
  everything the files need together: the build mode (one bundle app or one app per flow), the image
  tag it just pushed, and the final set of flows (disabled ones left out). Considered: Publish
  writing `ingress-<flow>.yaml` and `service-<flow>.yaml` into the flow's Git folder. The Builder
  knows neither the image tag nor the build mode (a bundle has one Service for all flows, not one per
  flow), and Kubernetes files in the flow repository would tie the Builder to one way of running
  the flows. The flow repository stays free of deployment files; image and manifests come from the
  same build, so they cannot drift apart.
- **Only the flows' own paths, not a whole Base Path.** Each operation of the flow's OpenAPI spec
  becomes a rule under the Base Path: an `Exact` path, or a `Prefix` up to the first `{param}`
  (`/orders/{id}/items` -> prefix `/orders`). Each `platform-http` path is a rule too (a prefix with
  `matchOnUriPrefix=true`), and so are the flow's Swagger UI (`<Base Path>/docs`) and, for a bundle,
  `/api-docs`. Rules another prefix already covers are dropped. A legacy app can keep serving other
  paths under the same prefix as a flow; controllers pick the longest matching path across Ingresses.
  A flow without a Base Path claims only its own paths, not `/`. Decision 0015 already keeps a path in
  one flow, so the flows' rules never overlap each other; overlaps with legacy apps are not checked.
- **One template file for the install, `pipeline/k8s.properties`.** Host, ingress class, TLS secret,
  namespace, replicas and Ingress annotations (`k8s.annotation.<key>`) are set there by the buyer, so
  the output fits any controller or cloud. `k8s.routing` picks `ingress` (default: supported by every
  controller), `httproute` (Gateway API, needs `k8s.gateway`) or `none`; `k8s.enabled=false` writes
  nothing. Considered Helm or Kustomize: more than a demo needs, and plain YAML still works as a
  Kustomize base or in Argo CD / Flux.
- **Bundle and per-flow.** Bundle: one Deployment, Service and Ingress named after the bundle
  (`echo-flows`) listing every flow's paths. Per-flow: one set per flow, named `echo-flow-<flow>`, so
  each flow is rolled out and rolled back on its own.
- **Applying them stays with the buyer.** The sample Jenkinsfile keeps `build/*/k8s/*.yaml` as build
  artifacts, and its `DEPLOY` parameter (off by default) runs `kubectl apply` with a kubeconfig from
  Jenkins credentials. `kubectl apply` does not delete: a flow that is disabled or deleted keeps its
  objects until the buyer removes them. The pods read flow settings and secrets (`{{placeholders}}`)
  from an optional Secret and ConfigMap named `<app>-env`.
- `build-flow.sh --manifests-only` checks the flows and writes only the manifests (no export, jar or
  image), which CI uses to test the rules.
