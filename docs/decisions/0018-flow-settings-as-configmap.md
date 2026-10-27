# 0018. The flows' placeholders as a ConfigMap, and a Secret the buyer creates

Date: 2026-10-27
Status: Accepted

Flows read settings and secrets through Camel `{{placeholders}}` (e.g. `{{inventory.host}}` in an
https step, `{{blueplanet.token}}` in a header). Validate needs each one set in the flow's
`application.properties`, and that value is built into the image. Each environment needs its own
values. The Deployment from decision 0017 already reads an optional ConfigMap and Secret
`<app>-env` as environment variables, but nothing created them, so the buyer had to find every
placeholder by hand.

- **The pipeline lists the placeholders.** `K8sManifests.java` scans each app's route files
  (`<flow>.camel.yaml`) for `{{name}}` and `{{name:default}}`. It skips Camel's functions
  (`{{env:X}}`, `{{sys:X}}`, ...) and ECHO's own `echo.*` settings, which the build sets. Each name
  becomes the environment variable Spring reads as that property: dots and dashes to underscores,
  upper case (`inventory.host` -> `INVENTORY_HOST`, `fulfilment.api-token` -> `FULFILMENT_API_TOKEN`).
- **Values come from a file per environment that the buyer keeps.** `build-flow.sh --env-values
  <file>` (or `ENV_VALUES`, a parameter of the sample Jenkinsfile) is a `.properties` file keyed by
  placeholder name (the variable name works too). A name it doesn't set takes the flow's own value
  from `application.properties` (in a bundle the last flow wins, as in the image). `build/<app>/k8s/configmap.yaml` holds them all.
  A name with no value anywhere is written as a comment and named in the build log. An empty variable
  would replace the value in the image with nothing.
- **Sensitive names go in a Secret the pipeline never fills.** Names matching `k8s.secret-names`
  (globs in `k8s.properties`, default `*password*,*passwd*,*pwd*,*secret*,*token*,*key*,*credential*`)
  are never written to the ConfigMap. They are listed in `secret.yaml.example` with empty values and a
  `kubectl create secret` line. The build ignores their values in the values file and says so. The
  `.example` extension keeps `kubectl apply -f build/<app>/k8s` from applying an empty Secret over the
  real one. The buyer creates the Secret once per cluster, by hand or from their vault (External
  Secrets, Sealed Secrets, ...), so no secret value ever reaches Git, build artifacts or logs.
  A sensitive name the patterns miss would land in the ConfigMap, so the patterns are the buyer's to
  change. Considered: a flag per placeholder in the Builder. It needs UI and is easy to forget, while
  a name pattern catches most cases with no work from flow designers.
- **The Secret wins.** The Deployment's `envFrom` lists the ConfigMap first and the Secret last, so
  a name in both takes the Secret's value.
- The ConfigMap is written again on each build, so values are changed in the values file, not in the
  cluster.
