# 0014. Every flow has a name of its own before any work on it

Date: 2026-10-26
Status: Accepted

Logging in used to land on a blank, unnamed canvas: routes and an OpenAPI spec could be built there
and the flow was named only at its first Save. A new flow's name was checked against the Builder's
drafts only, so a flow that was only in Git could be given the same name (and publishing would
overwrite its folder), and a name that made another flow's ID quietly got `-2`, `-3`. Users wanted
all work to happen on a flow that already has a unique name.

- **A start page instead of the blank canvas.** After login (and from the logo) the page offers New
  Flow, Open Flow, Open Flow Template and Upload Flow, and nothing to edit. Each of them names the flow
  first (Upload may keep the name in the file), so the editor only ever shows a named flow. The
  untitled flow's "first Save names the flow and its spec" is gone with it; a flow is started from
  its API by New Flow, then Interface.
- **A name must be the flow's own, checked against the Builder and the publish target.** New Flow,
  Open Flow Template, Upload, Save As and Rename refuse a name (ignoring case) that another flow has as
  its name or ID, or whose ID (`FlowNames.idFor`) another flow has, in the Builder or in the primary
  publish target (Git, else S3; `PublishedNames`). A flow's own published folder does not count.
  If the publish target cannot be read, only the Builder is checked; Publish reports the problem.
- **No numbered IDs.** The ID is always the one made from the name, so `Orders!` is refused while
  `Orders` exists instead of becoming `orders-2`.
- **The refusal says which flow has the name and offers to open it.** The server answers 409 with
  `nameTaken: true`, `existingName` and the flow's Builder id (`existingFlowId`) or, for a flow only
  published, its folder (`existingFolder`). The dialogs check as you type, from the same lists as the
  Open Flow page, and show "Open <name>" (a published-only flow opens as a new draft, as on Open
  Flow) and "Choose another name". Rename offers only the latter.
- **Save As still replaces a Builder flow of the same name after asking** (decision 0007). A name a
  published-only flow has, or one that makes another flow's ID, is refused there too.

Unique names do not make unique URLs: two flows can still serve the same path (the Base Path comes
from the spec). Publish and the bundle check catch those clashes (decisions 0008, 0009).
