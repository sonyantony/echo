# 0011. Disabling a published flow, and a route inside a flow

Date: 2026-10-23
Status: Accepted

Users wanted to switch a published flow off without deleting it from Git, and to switch off one
route of a flow.

## A published flow

- **A flag in ECHO's metadata file, not a marker file.** Disable (Open Flow page, a published
  row's menu) sets `"disabled": true` in the flow's `echo-flow.json` in every enabled publish
  target that has the flow (in Git a normal commit, "Disable flow <name>"); Enable takes it out.
  The flow's own files do not change.
  - `echo-flow.json` is already ECHO's own file: Edit as draft and Download leave it out, and the
    pipeline already reads it (the per-flow version). A separate marker file would have needed the
    same handling in each of those places, and could have been copied into a draft by mistake.
  - It is still easy to see and change by hand in Git.
- **The pipeline skips a disabled flow.** `build-flow.sh` leaves it out in both build modes,
  like `templates/`, and says so. A disabled flow therefore stops running when the buyer's next
  image is deployed; nothing switches it off in a container that is already running (that would
  need Camel's route controller exposed by the runtime, a bigger and security-sensitive change).
- **Publishing again keeps it disabled.** A new version of a disabled flow stays out of images
  until someone enables it, so publishing a fix never deploys a flow that was switched off on
  purpose.
- **A disabled flow still holds its endpoints.** Publish's clash check (and BundleCheck when it
  is enabled again) still counts it, so enabling it never clashes with a flow published since.

## A route inside a flow

- Camel's own `autoStartup: false` (Kaoto's on/off switch on the route, or the route's form)
  switches a route off. ECHO already passed it through Validate, Run and Publish.
- **An operation whose route is switched off answers 404**, like one without a route
  (decision 0008): `RestFromSpec` adds its `echo-missing-<operationId>` route, whose message says
  the route is disabled. Without this, callers got Camel's 500 "no consumers" error.
- **Kaoto's Routes list marks the route "Disabled"** (a badge after its name, CSS that
  `KaotoEditorHost` writes from the route YAML; Kaoto stays unmodified).
