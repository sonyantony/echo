package com.ey.echo.runtime;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.autoconfigure.AutoConfiguredOpenTelemetrySdk;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import org.apache.camel.AsyncCallback;
import org.apache.camel.CamelContext;
import org.apache.camel.Exchange;
import org.apache.camel.NamedNode;
import org.apache.camel.Processor;
import org.apache.camel.opentelemetry2.OpenTelemetryTracer;
import org.apache.camel.spi.InterceptStrategy;
import org.apache.camel.spring.boot.CamelContextConfiguration;
import org.apache.camel.support.AsyncProcessorConverterHelper;
import org.apache.camel.support.processor.DelegateAsyncProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;

/**
 * Tracing and log context of a flow image (docs/observability.md). Metrics need no code: Spring Boot
 * and camel-micrometer record them and /actuator/prometheus serves them (runtime-template
 * application.properties).
 *
 * <ul>
 * <li><b>Log context.</b> Every log line written inside a flow step (Log steps, errors, the HTTP log's
 * call records) carries {@code echo.correlation_id} and {@code echo.route} in the MDC, and, with tracing
 * on, {@code trace.id} and {@code span.id}; Spring Boot's ECS JSON makes them fields.</li>
 * <li><b>Tracing</b> (OpenTelemetry, Camel's camel-opentelemetry2) is off unless the standard
 * {@code OTEL_*} settings turn it on: {@code OTEL_EXPORTER_OTLP_ENDPOINT} (or
 * {@code OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}) set, or {@code OTEL_SDK_DISABLED=false}; and
 * {@code OTEL_SDK_DISABLED=true} always keeps it off. All other {@code OTEL_*} settings (sampler,
 * headers, protocol, resource attributes) work as OpenTelemetry documents them. The service name
 * defaults to the app's name; OpenTelemetry metrics and logs stay off (Prometheus and the JSON logs
 * cover them).</li>
 * </ul>
 *
 * <p>build-flow.sh copies this class into every app and lists it as an auto-configuration. The Builder
 * does not compile it (its Run has no tracing).
 */
@Configuration(proxyBeanMethods = false)
public class ObservabilityConfiguration {

    /** MDC keys (ECS field names). */
    static final String ROUTE = "echo.route";
    static final String TRACE_ID = "trace.id";
    static final String SPAN_ID = "span.id";

    private static final Logger LOG = LoggerFactory.getLogger(ObservabilityConfiguration.class);

    /** The OpenTelemetry SDK when tracing is on; closed (spans flushed) when the app stops. */
    public static final class Tracing implements AutoCloseable {

        private final OpenTelemetrySdk sdk;

        Tracing(OpenTelemetrySdk sdk) {
            this.sdk = sdk;
        }

        public boolean on() {
            return sdk != null;
        }

        @Override
        public void close() {
            if (sdk != null) {
                sdk.close();
            }
        }
    }

    @Bean(destroyMethod = "close")
    public Tracing echoTracing(ConfigurableEnvironment env) {
        if (!tracingOn(env::getProperty)) {
            LOG.info("Tracing off (set OTEL_EXPORTER_OTLP_ENDPOINT to send traces)");
            return new Tracing(null);
        }
        String app = env.getProperty("spring.application.name", env.getProperty("camel.main.name", "echo-flow"));
        var defaults = new LinkedHashMap<String, String>();
        defaults.put("otel.service.name", app);
        // Prometheus serves the metrics and the JSON logs go to stdout: OpenTelemetry sends traces only.
        defaults.put("otel.metrics.exporter", "none");
        defaults.put("otel.logs.exporter", "none");
        defaults.put("otel.sdk.disabled", "false");
        // OTLP over HTTP (port 4318), the protocol OpenTelemetry recommends by default; the Java SDK's own
        // default is gRPC (4317). OTEL_EXPORTER_OTLP_PROTOCOL=grpc switches.
        defaults.put("otel.exporter.otlp.protocol", "http/protobuf");
        // otel.* in application.properties also count; OTEL_* environment variables and -Dotel.* win.
        var seen = new HashSet<String>();
        for (var source : env.getPropertySources()) {
            if (source instanceof EnumerablePropertySource<?> enumerable) {
                for (String name : enumerable.getPropertyNames()) {
                    String value;
                    if (name.startsWith("otel.") && seen.add(name) && (value = env.getProperty(name)) != null) {
                        defaults.put(name, value);
                    }
                }
            }
        }
        OpenTelemetrySdk sdk = AutoConfiguredOpenTelemetrySdk.builder()
                .addPropertiesSupplier(() -> defaults)
                .disableShutdownHook()
                .build()
                .getOpenTelemetrySdk();
        LOG.info("Tracing on: OpenTelemetry spans of service {} go to {}", app,
                firstSet(env::getProperty, "otel.exporter.otlp.traces.endpoint", "otel.exporter.otlp.endpoint"));
        return new Tracing(sdk);
    }

    /** Whether the OTEL_* settings (read as otel.* through lookup) turn tracing on. */
    static boolean tracingOn(Function<String, String> lookup) {
        String disabled = lookup.apply("otel.sdk.disabled");
        if (disabled != null && !disabled.isBlank()) {
            return !"true".equalsIgnoreCase(disabled.trim());
        }
        return firstSet(lookup, "otel.exporter.otlp.traces.endpoint", "otel.exporter.otlp.endpoint") != null;
    }

    private static String firstSet(Function<String, String> lookup, String... names) {
        for (String name : names) {
            String value = lookup.apply(name);
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }

    @Bean
    public CamelContextConfiguration echoObservability(Tracing tracing) {
        return new CamelContextConfiguration() {
            @Override
            public void beforeApplicationStart(CamelContext camel) {
                if (tracing.on()) {
                    // Camel's tracer finds the SDK's tracer and propagators in the registry.
                    camel.getRegistry().bind("echoOpenTelemetryTracer", tracing.sdk.getTracer("camel"));
                    camel.getRegistry().bind("echoOpenTelemetryPropagators", tracing.sdk.getPropagators());
                    new OpenTelemetryTracer().init(camel);
                }
                // Added after the tracer's, so it runs inside the span the tracer makes current.
                camel.getCamelContextExtension().addInterceptStrategy(new LogContext(tracing.on()));
            }

            @Override
            public void afterApplicationStart(CamelContext camel) {
                // nothing to do
            }
        };
    }

    /** Puts the exchange's correlation id, route and trace ids in the MDC around every step. */
    static final class LogContext implements InterceptStrategy {

        private final boolean tracing;

        LogContext(boolean tracing) {
            this.tracing = tracing;
        }

        @Override
        public Processor wrapProcessorInInterceptors(CamelContext context, NamedNode definition, Processor target,
                Processor nextTarget) {
            return new DelegateAsyncProcessor(AsyncProcessorConverterHelper.convert(target)) {
                @Override
                public boolean process(Exchange exchange, AsyncCallback callback) {
                    Map<String, String> previous = put(exchange);
                    try {
                        return processor.process(exchange, callback);
                    } finally {
                        restore(previous);
                    }
                }

                @Override
                public void process(Exchange exchange) throws Exception {
                    Map<String, String> previous = put(exchange);
                    try {
                        processor.process(exchange);
                    } finally {
                        restore(previous);
                    }
                }
            };
        }

        private Map<String, String> put(Exchange exchange) {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            String correlation = exchange.getProperty(HttpExchangeLog.CORRELATION_ID, String.class);
            if (correlation != null) {
                MDC.put(HttpExchangeLog.CORRELATION_FIELD, correlation);
            }
            if (exchange.getFromRouteId() != null) {
                MDC.put(ROUTE, exchange.getFromRouteId());
            }
            if (tracing) {
                SpanContext span = Span.current().getSpanContext();
                if (span.isValid()) {
                    MDC.put(TRACE_ID, span.getTraceId());
                    MDC.put(SPAN_ID, span.getSpanId());
                    // For the HTTP log's records written outside a step (the response to the caller).
                    exchange.setProperty(HttpExchangeLog.TRACE_ID, span.getTraceId());
                }
            }
            return previous;
        }

        private static void restore(Map<String, String> previous) {
            if (previous != null) {
                MDC.setContextMap(previous);
            } else {
                MDC.clear();
            }
        }
    }
}
