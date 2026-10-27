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
- **Named as soon as it is added.** A new operation gets its name the moment it is added in
  Openapi, before any Save, so Source shows it at once. Apicurio cannot be handed a changed spec
  without opening it again, so ECHO fills in the operation's own (hidden) Operation ID field the
  way a user would: it types the name and presses the field's Save
  (`builder-ui/src/apispec/operationIdFiller.ts`). That is an ordinary edit, which Undo takes back.
  A spec opened without ids is shown with them filled in. Saving (Save, autosave, Upload, Rename;
  `operationIds.ts`) names anything still missing.
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
- **Specs from elsewhere.** An uploaded spec keeps its own ids (changed 2026-10-25, see the last
  section; it used to be renamed on Upload). A spec that reaches a
  flow without being saved in Openapi (a .zip upload, Copy From Another Flow of an old spec, a
  template) keeps its ids until it is next saved; when the flow leaves the editor, the backend
  fills in any missing id with the same naming (`OperationIds.fill`, in `RestFromSpec.apply`), so
  Camel never makes up names of its own.
- **Openapi hides the Operation ID field** (`theme/apicurio-mapping.css`); it is still in Source.
  After a rename, the editor shows the old id until it is out of sight (another view is picked),
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

## Routes follow the methods edited in Interface

Added 2026-10-25. Users asked for a route to appear as soon as a method is added, and to be asked
about the route when a method is deleted. The tab line item Openapi is now called **Interface**.

- **Added: a route at once.** Each edit in Interface is compared with the one before, by the
  operationId the route starts from (a new operation is named as soon as it is added, and a
  renamed path keeps its id until the save, so a rename is never an add plus a delete). An
  operation that appears and has no route gets one on the canvas straight away: the same route
  Add Route For Operation makes (`direct:<operationId>`, a log step). The route's entry point stays
  `direct:`, not a `platform-http` endpoint of its own: the REST service ECHO makes from the spec
  already listens on platform-http and calls it, which keeps request validation, Swagger UI and
  the clash checks working. An operation that has a route already (or a disabled one) gets none.
- **Deleted: ask only when there is work to lose.** A route still as ECHO made it (nothing but
  its log step) goes quietly, so undoing an add leaves nothing behind. Any other route is kept
  unless the user picks **Remove Route** in the dialog that asks (several deleted at once, such as
  a whole path, are listed in one dialog); the dialog warns when other routes call it. A route
  removed this session comes back as it was if its operation does (Undo in Interface). One that
  came back while the dialog was open keeps its route.
- **Like any canvas edit.** The routes change in the editor on screen (unsaved canvas work stays)
  and are saved with the next Save or autosave.
- **Upload gives every operation a route** (added 2026-10-25), under the operationId the file
  has (ECHO's only where it has none): one that has a route already keeps it. Operations of the
  spec before that the uploaded file lacks are handled as deleted (quietly when untouched, else
  Keep/Remove). New From Samples does the same with the spec it makes (added 2026-10-27: a flow
  started from samples had no route at all once new flows stopped getting a starter route). Copy
  From Another Flow and Discard still add no routes; Add Route For Operation and the Publish
  warning cover them.
- **After a save renamed operations** (and before the editor opens the renamed spec), a deleted
  operation is looked up by its new id, which its routes already start from.

## Uploaded specs keep their own operationIds and comments

Added 2026-10-25. Users asked that an uploaded spec keep the operationIds its author gave it, with
ECHO's name only for operations that have none, and that no comment in the file is ever removed.

- **An operation keeps the id it has**, whether ECHO or the spec's author gave it. A save renames
  one only when its path or method changed since the spec was stored (compared by id with the
  stored spec; after a rename the editor's old ids are read as the new ones until it reopens), and
  its routes follow as before. A moved operation with an author's id gets ECHO's name from then on.
  Upload compares with nothing, so every id in the file stays, and routes for them keep working.
- **Only what cannot work is renamed**: a missing id gets ECHO's name; the second of two operations
  sharing an id, and an id that cannot name a `direct:` endpoint (anything but letters, digits,
  `_`, `.` and `-`), get ECHO's name too.
- **Comments stay.** The spec is no longer written out afresh on each save: what the editor holds
  is applied onto the stored file (`serialize` in `apiSpec.ts`, with the `yaml` library's document
  model), so in YAML the comments, layout and quoting stay wherever the spec did not change, and a
  file whose spec did not change is left byte for byte. A comment goes with what it is on when
  that is deleted. Upload adds just the missing ids to the file as it came. This covers Save,
  autosave, Rename, Upload and Download. JSON has no comments.
  The backend still fills in missing ids when a flow leaves the editor (`OperationIds.fill`), which
  writes the file afresh; a spec saved in Interface has none missing.
- We chose this over always using ECHO's names (earlier in this decision): the worry was stale
  names, and an author's id now only stays while its operation's path and method do.
