# 0003. Pluggable publish targets (Git, S3)

Date: 2026-10-16
Status: Accepted (replaces the `GitPublisher` part of 0002)

Buyers may want flows somewhere other than (or as well as) a Git repository. Publishing now goes
through a `FlowPublisher` interface with two implementations, `JGitPublisher` and `S3Publisher`,
each switched on with its own `enabled` setting. Publish and Delete use every enabled target.

- **All enabled targets, partial success.** One unreachable target should not block the others;
  each publish records a per-target result (`publish_target` table, migration V3), and only an
  all-target failure is an error. Delete stops short of removing the draft until every target
  has removed the flow, so a retry completes it.
- **Defaults keep today's behaviour.** Git is enabled (and still off until `echo.git.url` is
  set); S3 is disabled. Existing publish history is migrated as Git results.
- **One source for the Flows page.** Reading published flows from several targets would need
  merge rules; the first enabled target (Git, else S3) is the source.
- **No AWS SDK.** The project keeps cloud SDKs out. S3 needs four REST calls (put, get, delete,
  ListObjectsV2), signed with SigV4 in `S3Client` on the JDK HTTP client; the signer is checked
  against the worked examples in the S3 API reference. Works with S3-compatible stores via
  `endpoint`. Static keys only (or `AWS_*` environment variables); instance-role credentials
  would need the SDK or more code, and can come later.
