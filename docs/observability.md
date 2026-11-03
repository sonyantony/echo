# Observability of flow images

Every flow image the pipeline builds (bundle or per-flow) has logs, metrics and tracing. None of them
depends on a vendor: logs are JSON on stdout, metrics are in Prometheus format, and traces are sent with
OpenTelemetry's OTLP protocol to whatever backend the buyer runs. The flows themselves need nothing for it.

| What | Where | On by default |
|---|---|---|
| Logs: JSON (ECS) on stdout, plus the HTTP log of every request and response ([http-log.md](http-log.md)) | `docker logs`, `kubectl logs`, any log shipper | yes |
| Correlation id and trace ids on every log line | log fields `echo.correlation_id`, `echo.route`, `trace.id`, `span.id` | yes (trace ids with tracing on) |
| Metrics | `GET /actuator/prometheus` on port 8080 | yes |
| Health | `/actuator/health/liveness`, `/actuator/health/readiness` | yes |
| Traces (OpenTelemetry) | sent to `OTEL_EXPORTER_OTLP_ENDPOINT` | no: set the endpoint to turn on |

## Log context

Every log line written inside a flow step carries `echo.correlation_id` and `echo.route`. That covers
Log steps, errors, and the HTTP log's call records, also in the branches of a parallel multicast. With
tracing on, the line also carries `trace.id` and `span.id`. All records of one request can be found by
one id in Splunk, Elasticsearch or Loki.

The correlation id is the caller's `X-Correlation-ID`, else the trace id of its `traceparent`, else a
new one. Every call the flow makes sends it on as `X-Correlation-ID`. Calls also pass on the caller's
`traceparent` (and `tracestate`): with tracing off, as received, and with tracing on, as Camel's own,
which continues the caller's trace. A downstream service that traces therefore joins the same trace.
Both are passed on even when the HTTP log is switched off (`echo.http-log.enabled=false`).

## Metrics

`/actuator/prometheus` serves, with the tag `application=<app name>`:

| Metric | What |
|---|---|
| `http_server_requests_seconds_*` | requests the flows answered: `method`, `uri` (the path, e.g. `/orders/{id}`), `status`, `outcome`; histogram buckets for percentiles |
| `camel_exchanges_*`, `camel_route_policy_seconds_*` | per route: messages, failures, processing time |
| `camel_exchange_event_notifier_seconds_*` | per endpoint the route sends to, including downstream calls (`endpointName`, e.g. `http://bp.example.com/...`), with `failed` |
| `jvm_*`, `process_*`, `system_*` | memory, GC, threads, CPU |

Prometheus, Grafana Agent/Alloy, the OpenTelemetry Collector, Datadog, Dynatrace and Azure Monitor all
scrape this format. The Deployment that the pipeline writes (`build/<app>/k8s/deployment.yaml`) has
the usual pod annotations `prometheus.io/scrape`, `prometheus.io/path` and `prometheus.io/port`. With
the Prometheus Operator, add a PodMonitor for the label `app.kubernetes.io/part-of: ey-echo` instead.

The endpoint is on the flows' port 8080, without login, like health. The Ingress or HTTPRoute that the
pipeline writes routes only the flows' own paths, so `/actuator` is not reachable from outside the cluster.

To show fewer metrics, use Spring Boot's settings, e.g. `MANAGEMENT_METRICS_ENABLE_JVM=false`. Camel's
are `camel.metrics.*`, e.g. `CAMEL_METRICS_ENABLE_EXCHANGE_EVENT_NOTIFIER=false`.

## Tracing

Tracing uses OpenTelemetry through Camel's camel-opentelemetry2. It records a span for each request a
flow receives, each route and step, and each call the flow makes. It is off until the standard
OpenTelemetry settings turn it on, so an image without them sends nothing anywhere.

| Setting (environment variable) | What |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | where to send traces, e.g. `http://otel-collector:4318`. Setting it turns tracing on |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | the same, for traces only (full URL, e.g. `.../v1/traces`) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (EY ECHO's default, port 4318) or `grpc` (port 4317) |
| `OTEL_EXPORTER_OTLP_HEADERS` | e.g. an API key your backend needs: `api-key=...`. Put it in the Secret, not the ConfigMap |
| `OTEL_SERVICE_NAME` | the name in the tracing tool; default the app's name (`echo-flows`, or the flow in a per-flow image) |
| `OTEL_RESOURCE_ATTRIBUTES` | extra attributes, e.g. `deployment.environment=prod` |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | how many requests to trace, e.g. `parentbased_traceidratio` and `0.1` for 10% (default: all, or as the caller decided) |
| `OTEL_SDK_DISABLED` | `true` keeps tracing off even with an endpoint set; `false` turns it on without one (to `localhost:4318`) |

Every setting in the [OpenTelemetry SDK configuration](https://opentelemetry.io/docs/languages/java/configuration/)
works. The same names in lower case with dots (`otel.service.name`) also work in a flow's
`application.properties`. Environment variables win. OpenTelemetry's own metrics and logs export stays
off (`otel.metrics.exporter=none`, `otel.logs.exporter=none`), because Prometheus and the JSON logs
cover them. Set them to `otlp` to send those too.

Backends that take OTLP directly or through the OpenTelemetry Collector include Jaeger, Grafana Tempo,
Zipkin (via the Collector), Elastic APM, Datadog, Dynatrace, New Relic, Honeycomb, AWS X-Ray (ADOT) and
Azure Monitor.

### Turning it on

In Kubernetes, add the variables to the Deployment. The pipeline's `deployment.yaml` has them as
comments next to `envFrom`:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://otel-collector.observability:4318
  - name: OTEL_TRACES_SAMPLER
    value: parentbased_traceidratio
  - name: OTEL_TRACES_SAMPLER_ARG
    value: "0.1"
```

With Docker:

```bash
docker run -e OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 echo-flows:1.0.0
```

The log says `Tracing on: OpenTelemetry spans of service echo-flows go to ...` at start (or
`Tracing off ...`).

## Builder

The Builder's Run has the HTTP log and passes the correlation id and `traceparent` on, as the images do.
It has no metrics endpoint or tracing of its own.

The code is `runtime-template/java/com/ey/echo/runtime/` (`ObservabilityConfiguration`,
`HttpExchangeLog`), `runtime-template/application.properties`, and the dependencies that
`pipeline/build-flow.sh` adds (decision 0021).
