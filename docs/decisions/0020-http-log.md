# 0020. Flows log every HTTP request and response, in and out

Date: 2026-10-30
Status: Accepted

Nothing logged what a flow received, what it called downstream (Blue Planet) or what came back. The
HTTP client's own debug logging shows the traffic but prints tokens in full, and Log steps in every flow
are work for the flow author and easy to forget. Buyers want this in Splunk or ELK, in production.

- **One listener, no steps in flows.** `HttpExchangeLog` (runtime-template/java) is a Camel event
  notifier for incoming requests (platform-http) and camel-http's activity listener for outgoing calls
  (REST OpenApi, Enrich, http), which sees the URL actually called and the headers the client adds. A call
  refused before it is sent is logged from the client's first step. Swagger UI routes are skipped.
- **Request and response are separate records**, written at once and synchronously, so a call still
  waiting shows as a request with no response. They share a correlation id (`X-Correlation-ID`, else
  `traceparent`, else new), sent on to downstream services; outgoing pairs share a call id.
- **Masking before logging.** Header values in `echo.http-log.masked-headers` and the values of settings
  matching `echo.http-log.secret-names` (the k8s.secret-names globs) never reach a logger.
- **Format is Spring Boot's.** Details are key-value fields on the `echo.http` logger; the images' ECS
  JSON makes them fields. Bodies are read into memory to log them (camel-http reads them whole anyway)
  and cut at `max-body`; `bodies: false` leaves them out.
- **Same code in images and Run.** build-flow.sh copies the sources into each exported app (given to
  `camel export`, JBang would compile them as routes) with an auto-configuration entry, and adds
  camel-http and platform-http; the Builder compiles the shared class and attaches it to each run, whose
  panel shows the records.
