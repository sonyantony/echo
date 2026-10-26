# 0015. A path is in one flow only

Date: 2026-10-26
Status: Accepted

Two flows in one bundle image cannot share a Base Path: the REST service ECHO makes from a flow's
spec (decision 0008) is Camel's contract-first REST, which takes the whole Base Path on
platform-http (`platform-http:///<Base Path>?matchOnUriPrefix=true`), and a second flow with the
same Base Path fails to start ("Multiple consumers for the same endpoint is not allowed"). So the
same path with another method cannot be served from another flow either, and moving the Swagger
pages apart would not change that. Publish and `BundleCheck` caught these clashes, but only at the
end, after the work was done.

- **A path belongs to one flow, checked when it comes in.** A path is the Base Path (the spec's
  server URL, or the route's `contextPath`) plus the spec's path. Parameters do not count by name,
  and a path counts as the same as the one with a parameter after it: `/shop/shoes`,
  `/shop/shoes/{id}` and `/shop/shoes/{shoeId}` are one path (`ApiPaths.key`). Methods do not
  matter. Every other flow counts: the Builder's flows and, from the primary publish target, the
  published ones (a flow's own published folder does not count).
- **Added in Interface:** the moment a path appears, the Builder asks the server
  (`POST /api/flows/{id}/path-clashes`) and, if another flow has it, shows "This path is in another
  flow" with **Switch to <flow>** (the path comes out, this flow and its spec are saved, and the
  other flow opens; a published-only one as a new draft, as on Open Flow) and **Remove the path
  here**. Closing the dialog removes it too.
- **Uploaded:** Interface > Upload refuses a file with such paths and lists them; Upload Flow
  refuses a flow zip whose spec has them (409, nothing is imported).
- **Saving is the backstop.** Saving a spec with a path that is new in it and another flow has is
  refused (409 with `pathClashes`). Paths the spec already had are left alone, so flows made before
  this rule can still be saved. This also catches a Base Path changed in Info, and Copy From Another
  Flow, whose paths are the other flow's.

Templates are not checked: a template's paths are checked when a flow made from it is saved.
