# 0013. ECHO names operations after their method and path, and warns at Publish about ones without a route

Date: 2026-10-24
Status: Accepted

Camel's contract-first REST sends each operation of the flow's spec to `direct:<operationId>`, so
the operationId is what connects an operation to the route that handles it (decision 0008). Users
had to type it in Openapi and again in the route, and an operation added in Openapi had none at
all (Apicurio leaves it empty; Camel then makes up a name nobody knows). Users asked for two
things: not to deal with operationIds at all, and a warning at Publish when operations have no
route.

## operationIds

- **The id is the method and path in camelCase**: `GET /cards/{cardId}` is `getCardsCardId`,
  `GET /somthing1/hahaha/Cards` is `getSomthing1HahahaCards` (the naming New From Samples already
  used). Two paths that come out the same (`/cards-x`, `/cards_x`) get `2`, `3`... added. The Base
  Path is not part of it: within a flow it is the same for every operation, and two flows that end
  up with the same id are stopped by Publish's clash check (it would also clash in a bundle).
- **Named when the spec is saved** (Save, autosave, Upload, Rename, the untitled flow's first
  Save; `builder-ui/src/apispec/operationIds.ts`). An operation without an id gets its name.
- **Renamed together with its routes.** When a path is renamed (or a method changed) in Openapi,
  the operation keeps its old id until the save, so ECHO knows exactly which operation it was:
  the id is renamed to the new natural name, and every `direct:` endpoint in the flow with the old
  name follows (a route's `from`, a `to` calling it), in either form Kaoto writes
  (`uri: direct:x`, or `uri: direct` with `parameters.name`). A route's ECHO-made id
  (`route-<id>`) and label (`GET /cards`) follow too; ids and labels the user wrote are left alone.
  All renames of one save are applied at once, so two operations can swap paths. We chose this
  over ids that never change after they are made: those would leave a stale name in the spec (for
  example `getCards` on `/payment-cards`) that leaks into Swagger UI and into client code other
  teams generate from it, and would stop a new `/cards` from getting its natural name.
- **A deleted operation and a new one are not a rename.** The new one has no id, so it gets a new
  name and no route; Publish lists it. Nothing is ever connected to the wrong route by guessing.
- **Two operations sharing an id** (only in a hand-edited or uploaded spec) both get their natural
  names, but no route moves, as it cannot be told which one the route was for.
- **Specs from elsewhere.** An uploaded spec is named on Upload, and routes already in the flow for
  its old ids follow, so a partner's spec with its own ids keeps working. A spec that reaches a
  flow without being saved in Openapi (a .zip upload, Copy From Another Flow of an old spec, a
  template) keeps its ids until it is next saved; when the flow leaves the editor, the backend
  fills in any missing id with the same naming (`OperationIds.fill`, in `RestFromSpec.apply`), so
  Camel never makes up names of its own.
- **Openapi hides the Operation ID field** (`theme/apicurio-mapping.css`); it is still in Source.
  The editor shows the ids it was opened with until it is out of sight (another view is picked),
  then opens the stored spec again, so moving the user out of what they are editing never happens
  on an autosave and the editor never works with out-of-date ids.
- **Flow > Add Route For Operation** lists the spec's operations by method and path (summary
  below), marks those that have a route (or a disabled one), and appends a route for each one
  picked: `id: route-<operationId>`, `description: GET /cards`, `from: direct` with the name as a
  parameter, and a log step to start from. New From Samples no longer asks for an operationId.

## Publish warns about operations without a route

- **After validation and the clash check**, Publish lists the spec's operations that no route
  handles: no route starts from their `direct:<operationId>`, or the one that does is switched off
  (`autoStartup: false`, decision 0011, shown as "its route is disabled"). Callers get 404 for
  them. The dialog shows the list and **Publish Anyway**; Cancel leaves the flow unpublished.
- **The API**: `POST /api/flows/{id}/publish` with `allowMissingRoutes: false` answers 409 with
  `missingRoutes: [{method, path, operationId, disabled}]` (the path as the spec has it, without the
  Base Path). The dialog sends `false`, then `true` after Publish Anyway. Left out, missing routes
  do not stop a publish, so scripts and earlier clients work as before.
- **It asks on every publish**, not only the first: a later version can still have gaps.
- **Routes as Kaoto writes them now count.** `RestFromSpec` used to see only `uri: direct:x`, so a
  route made in Kaoto (`uri: direct` with `parameters.name: x`) was taken as missing and got a
  second `direct:x` consumer next to it. Both forms count now, for the 404 routes and the warning.
