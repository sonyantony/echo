# Publish targets

Publish validates a flow, then sends it to **every enabled publish target**. Delete removes it
from every enabled target. Each install picks its targets in `application.yaml` (or
`config/application.yaml` for docker compose); no rebuild is needed.

| Target | Setting | On by default | What a publish does |
|---|---|---|---|
| Git | `echo.git` | yes, once `url` is set | Commits `flows/<flow>/` to one branch and pushes (author = Builder user) |
| S3 | `echo.s3` | no | Writes `<prefix>/<flow>/<file>` objects to one bucket, deletes files the flow no longer has |

A target is used when it is `enabled: true` **and** configured (`echo.git.url`, `echo.s3.bucket`).

```yaml
echo:
  git:
    enabled: true
    url: https://git.example.com/acme/echo-flows.git
    branch: main
    username: echo-bot
    token: ${ECHO_GIT_TOKEN:}
  s3:
    enabled: true
    bucket: acme-echo-flows
    prefix: flows                       # default
    region: eu-west-1                   # default us-east-1
    # endpoint: http://minio:9000       # S3-compatible stores (MinIO, Ceph, ...); path-style
    access-key: ${ECHO_S3_ACCESS_KEY:}  # falls back to AWS_ACCESS_KEY_ID
    secret-key: ${ECHO_S3_SECRET_KEY:}  # falls back to AWS_SECRET_ACCESS_KEY
    # session-token: from AWS_SESSION_TOKEN, for temporary credentials
```

Environment variables work too: `ECHO_GIT_ENABLED`, `ECHO_S3_ENABLED`, `ECHO_S3_BUCKET`,
`ECHO_S3_REGION`, `ECHO_S3_ENDPOINT`, `ECHO_S3_ACCESS_KEY`, `ECHO_S3_SECRET_KEY`.
With docker compose, the secrets can sit in `config/application.yaml` or come from the shell or
a `.env` file next to `docker-compose.yml` (git-ignored). Compose passes a secret only when it is
set, so an unset variable never blanks a value in `application.yaml`. After changing `.env`, run
`docker compose up -d`; `restart` does not pick up new environment values.

## Behaviour

- **Publish** goes to each enabled target in turn (Git first). A target that fails does not stop
  the others: the editor says where the flow went and which target failed, and the publish
  history records each target's result. Publishing again fills in the target that failed. Only
  when every target fails is the publish an error.
- **Endpoints must be free.** Before anything is written, Publish compares the flow with the
  flows already published (in the first enabled target; drafts and the flow's own published
  version do not count) and stops, listing each clash in the Publish dialog, when it would serve
  the same method on the same effective path (Base Path + path, or a platform-http route's path),
  or use an operationId another flow uses. Path parameters match whatever their names
  (`/cards/{id}` is `/cards/{cardId}`), and a platform-http route without `httpMethodRestrict`
  takes every method. Swagger UI at `<Base Path>/docs` counts too, so two flows cannot share a
  Base Path (or both have none). The pipeline's `BundleCheck.java` catches the same clashes when
  it builds a bundle.
- **Delete** tries every enabled target. If one fails, the Builder keeps the draft and shows the
  error; deleting again finishes the job.
- **The Flows page** lists published flows from the first enabled target (Git, else S3).
- **Templates** (Save As Template, Open Template) live in a `templates` folder next to the flows
  folder: `templates/<name>/` in Git, `<parent of prefix>/templates/<name>/` in S3. Saving a
  template writes it to every enabled target (Git commit "Save template <name>"); Open Template
  reads the first enabled one. Each template folder is a flow folder plus `echo-template.json`
  (description, who saved it, when). Pipelines build `flows/` only, so templates are never built.
- Git keeps every version in its history. S3 keeps only the latest; turn on bucket versioning
  if you need old versions there.
- The S3 credentials need `s3:ListBucket` on the bucket and `s3:GetObject`, `s3:PutObject`,
  `s3:DeleteObject` on `<prefix>/*`.

## Adding a target

A target is a Spring bean implementing `FlowPublisher`
(`builder-backend/src/main/java/com/ey/echo/builder/publish/`): `publish`, `remove`, `list`,
`read`, `templates()` (the same operations on the templates folder), plus an `enabled()` check read from its own settings. `PublishConfig` registers the Git
and S3 beans; a new one is another `@Bean` there (its `@Order` decides its place, which matters
only for the Flows page). Nothing else changes: `PublishTargets` hands every enabled bean to
publish and delete. S3 is spoken over plain HTTPS with SigV4 signing (`S3Client`), keeping the
Builder free of cloud SDKs.
