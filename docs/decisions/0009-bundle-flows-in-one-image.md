# 0009. All flows in one image by default

Date: 2026-10-21
Status: Accepted (changes the build output decided on 2026-10-14)

The sample pipeline used to build one image per flow (`echo-flow-<flow>`). Buyers asked for one
image for all their flows, which is lighter for a small install. The build mode is a pipeline
setting, so each buyer chooses it for their own pipeline and the Builder does not change.

- **`bundle` is the default.** `pipeline/build-flow.sh` (`--mode`, or `BUILD_MODE`) and the sample
  Jenkinsfile (`BUILD_MODE` parameter) build every flow in `flows/` into one Spring Boot app and
  one image, `echo-flows:<version>`. The Jenkinsfile rebuilds it when any flow changes and tags it
  `1.0.<build number>`.
- **`per-flow` is still there:** one image per flow, as before. It keeps the old benefits:
  a flow is released and rolled back on its own, a broken or busy flow only affects itself, and
  each container gets only that flow's secrets.
- **Bundled flows share one port, so clashes fail the build.** Before exporting, `BundleCheck.java`
  lists every clash and stops: two flows on the same Base Path (the spec's server URL; an empty
  one counts as `/`) or `platform-http` path, the same `direct:` endpoint (contract-first
  operations go to `direct:<operationId>`, so operationIds must differ too), the same route or
  step id, a file name with different content, a property with different values, or different
  REST configurations (Camel has one per app). It reads YAML with the SnakeYAML jar inside the
  pinned Camel launcher, so the pipeline needs nothing new.
- **The generated REST service gets a per-flow id in a bundle.** Every published flow's
  contract-first `rest` is `echo-openapi` (decision 0008); the bundle renames it
  `echo-openapi-<flow>`.
- Templates (`templates/`) are never built, in either mode.
