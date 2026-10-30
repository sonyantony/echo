# HTTP log

Every flow image, and the Builder's Run, logs each HTTP exchange a flow takes part in. Flows need no
Log steps for it.

| Record | Written when | Message starts with |
|---|---|---|
| Incoming request | a request reaches the flow | `Request in: POST http://host/orders` |
| Incoming response | the flow answers it (or fails) | `Response out: 200 to POST ... (12 ms)` |
| Outgoing request | the flow calls a service (REST OpenApi, Enrich, http) | `Call out [a1b2c3d4]: GET https://bp.example.com/...` |
| Outgoing response | that service answers, or the call fails | `Call answered [a1b2c3d4]: 200 ...` / `Call failed [a1b2c3d4]: ...` |

Each record is written the moment it happens, with nothing buffered in the flow, so a call that is still
waiting shows as a `Call out` with no `Call answered` for its call id. One incoming request with one
downstream call writes four records.

## Fields

Records go to the logger `echo.http`. The images log JSON (ECS) on stdout, so each detail is its own
field for Splunk, Elasticsearch, Loki and the like:

| Field | What |
|---|---|
| `echo.direction`, `echo.phase` | `inbound` / `outbound`, `request` / `response` |
| `echo.app`, `echo.route` | the app (the flow in a per-flow image or in Run, the bundle's name in a bundle image) and the route |
| `echo.correlation_id` | the same on every record of one incoming request (see below) |
| `echo.call_id` | pairs an outgoing request with its response |
| `http.request.method`, `url.full` | the method and the full URL (for outgoing calls, the URL actually called, with query) |
| `http.response.status_code`, `event.duration_ms` | on responses |
| `http.headers`, `http.body` | the headers and body of that request or response |
| `error.message` | on a failure |

The correlation id is the caller's `X-Correlation-ID`, else the trace id of its `traceparent`, else a new
one. Outgoing calls send it on as `X-Correlation-ID`.

The format is Spring Boot's: `logging.structured.format.console=ecs` (the default in
`runtime-template/application.properties`), `logstash` or `gelf`, or removed for plain text. A buyer can
change it per install, e.g. `LOGGING_STRUCTURED_FORMAT_CONSOLE=logstash`.

## Settings

Set in a flow's `application.properties`, or per install as environment variables / ConfigMap
(`ECHO_HTTP_LOG_BODIES=false`). The Builder's Run takes them from the flow, else from the Builder's
`application.yaml`.

| Setting | Default | What |
|---|---|---|
| `echo.http-log.enabled` | `true` | `false` turns the log off |
| `echo.http-log.bodies` | `true` | `false` leaves bodies out (they may hold customer data) |
| `echo.http-log.max-body` | `8192` | characters of a body logged; the rest is cut |
| `echo.http-log.masked-headers` | `Authorization,Proxy-Authorization,Cookie,Set-Cookie,X-Api-Key` | headers whose values are masked (`Bearer ****` keeps the scheme) |
| `echo.http-log.secret-names` | `*password*,*passwd*,*pwd*,*secret*,*token*,*key*,*credential*` | settings whose values are masked wherever they appear (URL, headers, bodies) |

`logging.level.echo.http=OFF` also silences it.

## Where it shows

- **Flow images:** stdout, collected by the platform (`docker logs`, `kubectl logs`, Fluent Bit,
  Filebeat, Splunk Connect). Logging is synchronous; any delay comes from the log shipper.
- **Builder Run:** the Run panel shows each record with its headers and body; the Builder's console
  (`docker compose logs`) shows them as text with the fields.

The code is `runtime-template/java/com/ey/echo/runtime/` (decision 0020).
