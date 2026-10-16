# 0004. Run a draft inside the Builder (Run button)

Date: 2026-10-16
Status: Accepted

Users want to send a request to the flow they are drawing without publishing it and building an
image. The editor's **Run** button saves and validates the draft, then runs it inside the Builder
(`FlowRunner`, `/api/flows/{id}/run`).

- **In process, not a separate runtime.** Each run is its own Camel context with its own Vert.x
  HTTP server, using the Builder's Camel 4.22.1 plus the Version 1 components (platform-http,
  http, xslt-saxon, log, direct; about 15 MB in the image). Starting Camel JBang or a container
  per run would need network access to Maven Central or a Docker socket inside the Builder. The
  flow image (Spring Boot export) stays the final check.
- **A port per running flow** (`echo.run.first-port`..`last-port`, default 8081-8090, published by
  docker-compose), so flows with the same path never clash. With about 10 users this caps
  concurrent runs at 10. Runs stop after `idle-minutes` without requests, and on shutdown.
- **DataMapper files from the flow folder.** The files are written to a temporary folder that is
  first on the run's classpath, so `xslt-saxon:<file>.xsl` resolves as it does in the image.
- **Test requests go through the Builder** (`POST /api/flows/{id}/run/request`), so the panel
  works even when the run ports are not reachable from the browser. The run ports themselves have
  no login, like the flow image.
- **Trade-off:** a flow runs in the Builder's JVM, so a heavy flow slows the Builder. Fine for
  a demo prototype; a separate runner container is the next step if that matters.
