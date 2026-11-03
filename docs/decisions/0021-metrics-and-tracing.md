# 0021. Flow images have Prometheus metrics, OpenTelemetry tracing and a log context

Date: 2026-11-03
Status: Accepted

Flow images had health probes, ECS JSON logs and the HTTP log (0020), but no metrics, and no tracing.
The correlation id was only on the HTTP log's records, so Log steps and errors could not be tied to a
request. A caller's `traceparent` also stopped at the flow. Buyers self-host and choose their own monitoring,
so nothing may depend on one vendor's backend.

- **Metrics in Prometheus format at `/actuator/prometheus`.** Spring Boot already records the requests
  the flows answer (`http.server.requests`, served by Tomcat). camel-micrometer adds routes and the
  endpoints they send to, which covers downstream calls. micrometer-registry-prometheus serves both. It
  is the format every monitoring product scrapes. OpenTelemetry metrics would need a collector in front.
  The endpoint stays on port 8080, open like health, because the Ingress routes only the flows' paths.
  The Deployment gets the common `prometheus.io/*` scrape annotations.
- **Tracing with OpenTelemetry, off by default, set with the standard `OTEL_*` variables.** The image
  builds the OpenTelemetry SDK with its autoconfigure module. That is why every documented `OTEL_*`
  setting works, and why the backend is the buyer's choice (OTLP). Camel's camel-opentelemetry2 makes
  the spans and passes trace context to downstream calls.
  - Tracing turns on when an OTLP endpoint is set (or `OTEL_SDK_DISABLED=false`). An image without one
    exports nothing, and does not log export errors for a collector that isn't there.
  - The protocol defaults to http/protobuf (4318), the OpenTelemetry default, not the Java SDK's gRPC.
  - OTel metrics and logs export stay off, because Prometheus and stdout cover them.
  - The Camel starter's own auto-configuration is switched off (`camel.opentelemetry2.enabled=false`),
    because it always installs a tracer.
  - We chose this over the OpenTelemetry Java agent, which is a larger image, a `-javaagent` flag and
    instruments far more than flows use, and over Micrometer Tracing, whose `management.*` settings are
    not the `OTEL_*` names buyers know.
- **Log context on every step.** An intercept strategy puts `echo.correlation_id` and `echo.route` (and,
  with tracing, `trace.id` and `span.id`) in the MDC around every processor. The ECS JSON then puts them
  on Log steps, errors and the HTTP log's call records, also on multicast threads. We chose a small
  strategy of our own over camel-mdc, which uses Camel's own key names, and runs inside the tracer's
  strategy so the span is current. The HTTP log writes a field once when the MDC holds it already.
- **`traceparent` passed on without tracing.** The HTTP log keeps the caller's `traceparent` and
  `tracestate` and sets them on calls that carry none (Remove Headers `*` in the scaffold drops them).
  With tracing on, Camel sets its own first. This and `X-Correlation-ID` now work with the HTTP log
  switched off.
- **`spring.application.name`** is the app's name, so it is ECS `service.name`, the metrics'
  `application` tag and the default trace service name.
- **Builder unchanged** apart from the shared HTTP log: `ObservabilityConfiguration` is for images only,
  and the Builder's compile excludes it like `HttpExchangeLogConfiguration`.

Cost: about 7 MB more per image (OpenTelemetry SDK, OTLP exporter, Prometheus client). With tracing
off, the cost is the MDC put per step.
