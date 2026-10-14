# 0002. Flow validation and publishing (M6, M7)

Date: 2026-10-14
Status: Accepted

## Validation

The plan suggested checking the YAML against the Camel YAML DSL JSON Schema with a separate
JSON-schema library. Instead the Builder loads the route with Camel 4.22.1's own YAML DSL
parser into a never-started Camel context. That parser is what the runtime uses, rejects the
same structural errors as the schema, and reports the line. No extra library is needed.

On top of that the Builder checks the Version 1 scope (`echo.validation` in application.yaml):

- components: `platform-http`, `http`, `https`, `xslt-saxon`, `log`, `direct`;
- expression languages: `simple`, `constant`, `header`, `exchangeProperty`, `variable`;
- `{{placeholders}}` in endpoint URIs must be set in the flow's `application.properties`;
- `xslt-saxon:` files (DataMapper output) must exist in the flow;
- simple expressions must parse.

Publishing always validates first and refuses an invalid flow (HTTP 422 with the problems).

## Publishing

- `GitPublisher` interface, `JGitPublisher` implementation: a Builder-owned working copy in
  `<data-dir>/git` is reset to the remote branch, `flows/<name>/` is replaced with the draft's
  files plus `echo-flow.json`, then committed (author = Builder user, committer = configured
  identity) and pushed. A rejected push (someone else pushed) is retried once on the new head.
- Works with any Git server over HTTPS (`echo.git.url`, `username`, `token`); tests use a local
  bare repository. Publishing is off until `echo.git.url` is set.
- A renamed flow's old folder is removed on its next publish.
- Version 2's "branch + pull request" flow can be a second `GitPublisher`.
