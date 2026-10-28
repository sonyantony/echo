# 0007. Save As and flow templates

Date: 2026-10-18
Status: Accepted

Users asked for Save As (a flow under another name), and for templates kept in the flow
repository that new flows can start from (Save As Template, Open Flow Template).

- **Templates live next to the flows folder**, in `templates/<name>/` (S3: the `templates` prefix
  next to the flows prefix). Pipelines build `flows/` only, so templates are never built into
  images without any pipeline change; `build-flow.sh` also refuses a folder under `templates/`.
- **A template is a whole flow folder** (route file plus DataMapper, schema and other side files)
  plus `echo-template.json` (description, who saved it, when), so a template with a data mapping
  still works when opened. Opening a template renames the route file to the new flow's name; the
  route's content is copied as it is.
- **Templates go through the publish targets** (`FlowPublisher.templates()`): saving writes to
  every enabled target like a publish, Open Flow Template reads the first one like the Flows page.
- **Save As works on drafts.** It copies what is on screen (unsaved edits included) and the side
  files to a draft with the new name and opens it; the original keeps its last saved version.
- **Nothing is replaced without asking.** Both Save As and Save As Template answer 409 with
  `confirmOverwrite: true` when the name is taken; the editor shows a warning with Replace or
  Cancel and sends the request again with `overwrite: true`. Open Flow Template never overwrites a flow.
