package com.ey.echo.runtime;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URISyntaxException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;
import org.apache.camel.CamelContext;
import org.apache.camel.Exchange;
import org.apache.camel.ExchangePropertyKey;
import org.apache.camel.Message;
import org.apache.camel.Route;
import org.apache.camel.StreamCache;
import org.apache.camel.component.http.CompositeHttpConfigurer;
import org.apache.camel.component.http.HttpActivityListener;
import org.apache.camel.component.http.HttpClientConfigurer;
import org.apache.camel.component.http.HttpComponent;
import org.apache.camel.component.platform.http.PlatformHttpEndpoint;
import org.apache.camel.spi.CamelEvent;
import org.apache.camel.spi.CamelEvent.ExchangeCompletedEvent;
import org.apache.camel.spi.CamelEvent.ExchangeCreatedEvent;
import org.apache.camel.spi.CamelEvent.ExchangeEvent;
import org.apache.camel.spi.CamelEvent.ExchangeFailedEvent;
import org.apache.camel.spi.CamelEvent.ExchangeSentEvent;
import org.apache.camel.spi.ComponentCustomizer;

import org.apache.camel.support.EventNotifierSupport;
import org.apache.camel.support.MessageHelper;
import org.apache.hc.core5.http.ClassicHttpRequest;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.http.Header;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.http.HttpException;
import org.apache.hc.core5.http.HttpHost;
import org.apache.hc.core5.http.HttpRequest;
import org.apache.hc.core5.http.HttpResponse;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.http.io.entity.InputStreamEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.slf4j.spi.LoggingEventBuilder;

/**
 * EY ECHO's HTTP log: one record when a request reaches a flow and one when the flow answers it, and
 * one when the flow calls another service over HTTP (REST OpenApi, http) and one when that service
 * answers or the call fails. Records are written the moment each happens, with no buffering, so a
 * call that is still waiting shows as a request without a response.
 *
 * <p>Each record goes to the {@code echo.http} logger with its details as key-value fields (Spring
 * Boot's structured logging, e.g. ECS JSON, makes them fields), and to an optional extra sink (the
 * Builder's Run panel). Records of one incoming request share {@code echo.correlation_id}: the
 * caller's {@code X-Correlation-ID}, else the trace id of its {@code traceparent}, else a new one;
 * outgoing calls carry it on as {@code X-Correlation-ID}. Header values named in
 * {@code echo.http-log.masked-headers}, and the values of settings whose names match
 * {@code echo.http-log.secret-names}, are masked before anything is logged.
 *
 * <p>The same source runs in every flow image (copied by pipeline/build-flow.sh, registered by
 * {@link HttpExchangeLogConfiguration}) and in the Builder's Run.
 */
public class HttpExchangeLog extends EventNotifierSupport implements HttpActivityListener {

    public static final String LOGGER = "echo.http";
    public static final String CORRELATION_HEADER = "X-Correlation-ID";

    static final String CORRELATION_ID = "EchoCorrelationId";
    private static final String INBOUND = "EchoHttpLogInbound";
    private static final String CALL = "EchoHttpLogCall";
    private static final String MASK = "****";
    private static final Pattern TRACEPARENT = Pattern.compile("^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$");

    /** One record; message is a readable summary, fields hold the details. */
    public record Entry(Level level, String message, Map<String, Object> fields) {

        /** Summary, headers and body on separate lines (the Run panel). */
        public String text() {
            var text = new StringBuilder(message);
            if (fields.get("http.headers") instanceof Map<?, ?> headers && !headers.isEmpty()) {
                headers.forEach((k, v) -> text.append("\n  ").append(k).append(": ").append(v));
            }
            if (fields.get("http.body") instanceof String body && !body.isEmpty()) {
                text.append("\n  ").append(body);
            }
            return text.toString();
        }
    }

    /** The echo.http-log.* settings. */
    public record Settings(boolean enabled, boolean bodies, int maxBody, Set<String> maskedHeaders,
            List<String> secretNames) {

        public static final String PREFIX = "echo.http-log.";
        static final String DEFAULT_MASKED_HEADERS = "Authorization,Proxy-Authorization,Cookie,Set-Cookie,X-Api-Key";
        static final String DEFAULT_SECRET_NAMES = "*password*,*passwd*,*pwd*,*secret*,*token*,*key*,*credential*";

        /** Reads the settings with lookup (setting name to value, null when unset). */
        public static Settings from(Function<String, String> lookup) {
            Function<String, String> get = name -> {
                String value = lookup.apply(PREFIX + name);
                return value == null ? null : value.trim();
            };
            String maxBody = get.apply("max-body");
            return new Settings(!"false".equalsIgnoreCase(get.apply("enabled")),
                    !"false".equalsIgnoreCase(get.apply("bodies")),
                    maxBody == null || maxBody.isEmpty() ? 8192 : Integer.parseInt(maxBody),
                    list(orDefault(get.apply("masked-headers"), DEFAULT_MASKED_HEADERS)).stream()
                            .map(h -> h.toLowerCase(Locale.ROOT)).collect(Collectors.toSet()),
                    list(orDefault(get.apply("secret-names"), DEFAULT_SECRET_NAMES)));
        }

        /** Whether a setting called name holds a secret (glob match, any case). */
        public boolean isSecretName(String name) {
            String lower = name.toLowerCase(Locale.ROOT);
            return secretNames.stream().anyMatch(glob -> lower.matches(
                    Arrays.stream(glob.toLowerCase(Locale.ROOT).split("\\*", -1)).map(Pattern::quote)
                            .collect(Collectors.joining(".*"))));
        }

        private static String orDefault(String value, String fallback) {
            return value == null ? fallback : value;
        }

        private static List<String> list(String value) {
            return Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        }
    }

    private final Logger log = LoggerFactory.getLogger(LOGGER);
    private final Settings settings;
    private final String app;
    private volatile List<String> secretValues = List.of();
    private volatile Consumer<Entry> sink = entry -> { };
    /** Endpoint URI to whether its route serves Swagger UI (not logged). */
    private final Map<String, Boolean> docs = new ConcurrentHashMap<>();

    public HttpExchangeLog(Settings settings, String app) {
        this.settings = settings;
        this.app = app;
        // Only exchange events; the rest of Camel's events are not looked at.
        setIgnoreCamelContextEvents(true);
        setIgnoreCamelContextInitEvents(true);
        setIgnoreRouteEvents(true);
        setIgnoreServiceEvents(true);
        setIgnoreStepEvents(true);
        setIgnoreExchangeRedeliveryEvents(true);
        setIgnoreExchangeAsyncProcessingStartedEvents(true);
        setIgnoreExchangeSendingEvents(true);
    }

    public Settings settings() {
        return settings;
    }

    /** Values masked wherever they appear (the values of secret settings). */
    public void secretValues(Map<String, String> settingsByName) {
        secretValues = settingsByName.entrySet().stream()
                .filter(e -> settings.isSecretName(e.getKey()) && e.getValue() != null && e.getValue().length() >= 4)
                .map(Map.Entry::getValue).distinct()
                // Longest first, so a value inside another is not half masked.
                .sorted((a, b) -> b.length() - a.length()).toList();
    }

    /** Also hands every record to sink (the Builder's Run panel). */
    public void sink(Consumer<Entry> sink) {
        this.sink = sink;
    }

    /** Adds the log to camel: its events, and the http components' calls (before any endpoint is made). */
    public void attach(CamelContext camel) {
        if (!settings.enabled()) {
            return;
        }
        camel.getManagementStrategy().addEventNotifier(this);
        for (String scheme : List.of("http", "https")) {
            if (camel.getComponent(scheme) instanceof HttpComponent http) {
                watch(http);
            }
        }
    }

    /** For Spring Boot: puts the log on each http component Camel makes. */
    public ComponentCustomizer httpCustomizer() {
        return ComponentCustomizer.forType(HttpComponent.class, http -> {
            if (settings.enabled()) {
                watch(http);
            }
        });
    }

    /**
     * Logs the http component's calls: the activity listener sees each request as sent (with the
     * headers the client adds) and each answer; a call that never got as far (connection refused)
     * is logged from the client's first step instead.
     */
    private void watch(HttpComponent http) {
        http.setHttpActivityListener(this);
        HttpClientConfigurer unsent = builder -> builder.addExecInterceptorFirst("echo-http-log", (request, scope, chain) -> {
            try {
                return chain.proceed(request, scope);
            } catch (IOException | HttpException | RuntimeException e) {
                if (scope.clientContext.getAttribute(Exchange.class.getName()) instanceof Exchange exchange
                        && exchange.getProperty(CALL) == null) {
                    callStarted(exchange, request.getMethod(), uri(request, scope.route.getTargetHost()),
                            headers(request.getHeaders()), null);
                }
                throw e;
            }
        });
        http.setHttpClientConfigurer(http.getHttpClientConfigurer() == null ? unsent
                : CompositeHttpConfigurer.combineConfigurers(http.getHttpClientConfigurer(), unsent));
    }

    private static String uri(HttpRequest request, HttpHost host) {
        try {
            return request.getUri().toString();
        } catch (URISyntaxException e) {
            return host.toURI() + request.getRequestUri();
        }
    }

    // --- incoming requests (Camel events) ---

    @Override
    public boolean isEnabled(CamelEvent event) {
        return settings.enabled() && event instanceof ExchangeEvent;
    }

    @Override
    public void notify(CamelEvent event) {
        Exchange exchange = ((ExchangeEvent) event).getExchange();
        switch (event) {
            case ExchangeCreatedEvent e -> {
                if (incoming(exchange)) {
                    requestArrived(exchange);
                }
            }
            case ExchangeSentEvent e -> callEnded(exchange);
            case ExchangeCompletedEvent e -> finished(exchange);
            case ExchangeFailedEvent e -> finished(exchange);
            default -> {
                // other exchange events are not logged
            }
        }
    }

    /** A request a flow's HTTP endpoint received (not a copy multicast or split made, nor Swagger UI). */
    private boolean incoming(Exchange exchange) {
        return exchange.getFromEndpoint() instanceof PlatformHttpEndpoint endpoint
                && exchange.getProperty(ExchangePropertyKey.CORRELATION_ID) == null
                && !docs.computeIfAbsent(endpoint.getEndpointUri(), uri -> exchange.getContext().getRoutes().stream()
                        .filter(r -> r.getEndpoint() == endpoint).map(Route::getRouteId)
                        .anyMatch(id -> id.startsWith("echo-docs-") || id.startsWith("echo-api-docs")));
    }

    private void requestArrived(Exchange exchange) {
        Message in = exchange.getIn();
        String correlation = correlationId(in);
        exchange.setProperty(CORRELATION_ID, correlation);
        String method = in.getHeader(Exchange.HTTP_METHOD, "", String.class);
        String url = mask(incomingUrl(in));
        exchange.setProperty(INBOUND, new Inbound(exchange.getExchangeId(), method, url, System.nanoTime()));
        var fields = fields(exchange, "inbound", "request");
        fields.put("http.request.method", method);
        fields.put("url.full", url);
        fields.put("http.headers", headers(in));
        if (settings.bodies()) {
            keepStreamReadable(in);
            fields.put("http.body", body(in));
        }
        write(new Entry(Level.INFO, "Request in: %s %s".formatted(method, url), fields));
    }

    /** The request a flow is answering. */
    private record Inbound(String exchangeId, String method, String url, long started) {
    }

    private void finished(Exchange exchange) {
        callEnded(exchange);
        Inbound request = exchange.getProperty(INBOUND, Inbound.class);
        // Copies multicast and split make carry the property too: only the request itself is answered.
        if (request == null || !request.exchangeId().equals(exchange.getExchangeId())) {
            return;
        }
        exchange.removeProperty(INBOUND);
        Message message = exchange.getMessage();
        Exception failure = exchange.getException();
        int status = failure != null ? 500 : message.getHeader(Exchange.HTTP_RESPONSE_CODE, 200, Integer.class);
        long ms = (System.nanoTime() - request.started()) / 1_000_000;
        var fields = fields(exchange, "inbound", "response");
        fields.put("http.request.method", request.method());
        fields.put("url.full", request.url());
        fields.put("http.response.status_code", status);
        fields.put("event.duration_ms", ms);
        if (failure != null) {
            fields.put("error.message", mask(String.valueOf(rootCause(failure).getMessage())));
        } else {
            fields.put("http.headers", headers(message));
            if (settings.bodies()) {
                fields.put("http.body", body(message));
            }
        }
        write(new Entry(failure != null ? Level.WARN : Level.INFO,
                "Response out: %d to %s %s (%d ms)%s".formatted(status, request.method(), request.url(), ms,
                        failure != null ? ": " + fields.get("error.message") : ""), fields));
    }

    // --- outgoing calls (camel-http's activity listener; on the calling thread) ---

    private record Call(String id, String method, String url, long started) {
    }

    @Override
    public void onRequestSubmitted(Object source, Exchange exchange, HttpHost host, HttpRequest request,
            HttpEntity entity) {
        if (!request.containsHeader(CORRELATION_HEADER)) {
            request.setHeader(CORRELATION_HEADER, correlationId(exchange));
        }
        HttpEntity readable = entity;
        // A streamed body can be read once (the client's wrapper still calls it repeatable): read it into
        // memory and send that copy, so logging it does not use it up.
        if (settings.bodies() && entity != null && entity.isStreaming() && request instanceof ClassicHttpRequest classic) {
            try (InputStream content = entity.getContent()) {
                readable = new ByteArrayEntity(content.readAllBytes(),
                        entity.getContentType() == null ? null : ContentType.parse(entity.getContentType()),
                        entity.getContentEncoding(), entity.isChunked());
                classic.setEntity(readable);
            } catch (IOException e) {
                readable = null;
            }
        }
        callStarted(exchange, request.getMethod(), host.toURI() + request.getRequestUri(),
                headers(request.getHeaders()), readable);
    }

    private void callStarted(Exchange exchange, String method, String rawUrl, Map<String, String> headers,
            HttpEntity entity) {
        correlationId(exchange);
        String url = mask(rawUrl);
        var call = new Call(UUID.randomUUID().toString().substring(0, 8), method, url, System.nanoTime());
        exchange.setProperty(CALL, call);
        var fields = fields(exchange, "outbound", "request");
        fields.put("echo.call_id", call.id());
        fields.put("http.request.method", method);
        fields.put("url.full", url);
        fields.put("http.headers", headers);
        if (settings.bodies()) {
            fields.put("http.body", entity == null ? "" : entity.isRepeatable() && !entity.isStreaming()
                    ? entityText(entity, null) : "[body not readable]");
        }
        write(new Entry(Level.INFO, "Call out [%s]: %s %s".formatted(call.id(), method, url), fields));
    }

    /** The exchange's correlation id; one is made for exchanges no HTTP request started (timers). */
    private static String correlationId(Exchange exchange) {
        String correlation = exchange.getProperty(CORRELATION_ID, String.class);
        if (correlation == null) {
            correlation = UUID.randomUUID().toString();
            exchange.setProperty(CORRELATION_ID, correlation);
        }
        return correlation;
    }

    @Override
    public void onResponseReceived(Object source, Exchange exchange, HttpHost host, HttpResponse response,
            HttpEntity entity, long elapsed) {
        Call call = exchange.getProperty(CALL, Call.class);
        exchange.removeProperty(CALL);
        String id = call != null ? call.id() : "?";
        var fields = fields(exchange, "outbound", "response");
        fields.put("echo.call_id", id);
        if (call != null) {
            fields.put("http.request.method", call.method());
            fields.put("url.full", call.url());
        }
        fields.put("http.response.status_code", response.getCode());
        fields.put("event.duration_ms", elapsed);
        fields.put("http.headers", headers(response.getHeaders()));
        if (settings.bodies() && entity != null) {
            String body = "[body not readable]";
            if (entity.isStreaming() && response instanceof ClassicHttpResponse classic) {
                // Read the answer once into memory and hand camel-http a copy (still a stream, so Camel
                // reads it into the message as it would the original).
                try (InputStream content = entity.getContent()) {
                    byte[] bytes = content.readAllBytes();
                    classic.setEntity(new InputStreamEntity(new ByteArrayInputStream(bytes), bytes.length,
                            entity.getContentType() == null ? null : ContentType.parse(entity.getContentType()),
                            entity.getContentEncoding()));
                    Header encoding = response.getFirstHeader("Content-Encoding");
                    body = text(bytes, entity.getContentType(), encoding == null ? null : encoding.getValue());
                } catch (IOException e) {
                    body = "[body not readable: " + e.getMessage() + "]";
                }
            } else if (entity.isRepeatable()) {
                body = entityText(entity, null);
            }
            fields.put("http.body", body);
        }
        write(new Entry(response.getCode() >= 500 ? Level.WARN : Level.INFO,
                "Call answered [%s]: %d %s %s (%d ms)".formatted(id, response.getCode(),
                        call != null ? call.method() : "", call != null ? call.url() : host.toURI(), elapsed),
                fields));
    }

    /** A call that ended with no answer (refused, timed out): its response record is the error. */
    private void callEnded(Exchange exchange) {
        Call call = exchange.getProperty(CALL, Call.class);
        if (call == null) {
            return;
        }
        exchange.removeProperty(CALL);
        long ms = (System.nanoTime() - call.started()) / 1_000_000;
        Exception failure = exchange.getException();
        String error = failure == null ? "no answer" : mask(String.valueOf(rootCause(failure).getMessage()));
        var fields = fields(exchange, "outbound", "response");
        fields.put("echo.call_id", call.id());
        fields.put("http.request.method", call.method());
        fields.put("url.full", call.url());
        fields.put("event.duration_ms", ms);
        fields.put("error.message", error);
        write(new Entry(Level.WARN, "Call failed [%s]: %s %s (%d ms): %s".formatted(call.id(), call.method(),
                call.url(), ms, error), fields));
    }

    // --- shared ---

    private Map<String, Object> fields(Exchange exchange, String direction, String phase) {
        var fields = new LinkedHashMap<String, Object>();
        fields.put("event.kind", "http");
        fields.put("echo.direction", direction);
        fields.put("echo.phase", phase);
        fields.put("echo.app", app);
        if (exchange.getFromRouteId() != null) {
            fields.put("echo.route", exchange.getFromRouteId());
        }
        fields.put("echo.correlation_id", exchange.getProperty(CORRELATION_ID, String.class));
        return fields;
    }

    private void write(Entry entry) {
        LoggingEventBuilder event = entry.level() == Level.WARN ? log.atWarn() : log.atInfo();
        entry.fields().forEach(event::addKeyValue);
        event.log(entry.message());
        try {
            sink.accept(entry);
        } catch (RuntimeException e) {
            log.debug("HTTP log sink failed", e);
        }
    }

    private static String correlationId(Message in) {
        String given = in.getHeader(CORRELATION_HEADER, String.class);
        if (given != null && !given.isBlank()) {
            return given.trim();
        }
        String traceparent = in.getHeader("traceparent", String.class);
        if (traceparent != null) {
            var m = TRACEPARENT.matcher(traceparent.trim());
            if (m.matches()) {
                return m.group(1);
            }
        }
        return UUID.randomUUID().toString();
    }

    private static String incomingUrl(Message in) {
        String url = in.getHeader(Exchange.HTTP_URL, String.class);
        if (url == null || url.isEmpty()) {
            url = in.getHeader(Exchange.HTTP_URI, "", String.class);
        }
        String query = in.getHeader(Exchange.HTTP_QUERY, String.class);
        return query == null || query.isEmpty() || url.contains("?") ? url : url + "?" + query;
    }

    /** The message's HTTP headers (not Camel's own), masked. */
    private Map<String, String> headers(Message message) {
        var headers = new LinkedHashMap<String, String>();
        message.getHeaders().forEach((name, value) -> {
            if (value != null && !name.regionMatches(true, 0, "Camel", 0, 5)) {
                headers.put(name, maskHeader(name, String.valueOf(value)));
            }
        });
        return headers;
    }

    private Map<String, String> headers(Header[] list) {
        var headers = new LinkedHashMap<String, String>();
        for (Header h : list) {
            headers.merge(h.getName(), maskHeader(h.getName(), h.getValue()), (a, b) -> a + ", " + b);
        }
        return headers;
    }

    private String maskHeader(String name, String value) {
        if (!settings.maskedHeaders().contains(name.toLowerCase(Locale.ROOT))) {
            return mask(value);
        }
        // Keep the scheme (Bearer, Basic) so the log still says what kind of credential was sent.
        int space = value.indexOf(' ');
        return space > 0 && space < 20 ? value.substring(0, space + 1) + MASK : MASK;
    }

    String mask(String text) {
        if (text == null) {
            return null;
        }
        for (String secret : secretValues) {
            text = text.replace(secret, MASK);
        }
        return text;
    }

    /** A stream can be read once: the body becomes what was read, so logging it does not use it up. */
    private static void keepStreamReadable(Message message) {
        if (message.getBody() instanceof InputStream stream && !(stream instanceof StreamCache)) {
            message.setBody(message.getBody(byte[].class));
        }
    }

    private String body(Message message) {
        if (message.getBody() == null) {
            return "";
        }
        return mask(MessageHelper.extractBodyForLogging(message, "", true, false, false, settings.maxBody()));
    }

    /** A repeatable entity's text, cut at max-body. */
    private String entityText(HttpEntity entity, String contentEncoding) {
        try (InputStream raw = entity.getContent()) {
            return text(raw.readAllBytes(), entity.getContentType(), contentEncoding);
        } catch (IOException | RuntimeException e) {
            return "[body not readable: " + e.getMessage() + "]";
        }
    }

    /** A body's text (decompressed when gzip/deflate), cut at max-body and masked. */
    private String text(byte[] bytes, String contentType, String contentEncoding) {
        try {
            String encoding = contentEncoding == null ? "" : contentEncoding.toLowerCase(Locale.ROOT);
            if (encoding.contains("gzip") || encoding.contains("deflate")) {
                try (InputStream in = encoding.contains("gzip") ? new GZIPInputStream(new ByteArrayInputStream(bytes))
                        : new InflaterInputStream(new ByteArrayInputStream(bytes))) {
                    bytes = in.readAllBytes();
                }
            }
            if (!isText(contentType)) {
                return "[%s, %d bytes]".formatted(contentType, bytes.length);
            }
            String text = new String(bytes, charset(contentType));
            if (text.length() > settings.maxBody()) {
                text = text.substring(0, settings.maxBody()) + "... [cut at %d of %d characters]"
                        .formatted(settings.maxBody(), text.length());
            }
            return mask(text);
        } catch (IOException | RuntimeException e) {
            return "[body not readable: " + e.getMessage() + "]";
        }
    }

    private static boolean isText(String contentType) {
        if (contentType == null) {
            return true;
        }
        String type = contentType.toLowerCase(Locale.ROOT);
        return type.startsWith("text/") || type.contains("json") || type.contains("xml")
                || type.contains("x-www-form-urlencoded") || type.contains("yaml");
    }

    private static Charset charset(String contentType) {
        if (contentType != null) {
            for (String part : contentType.split(";")) {
                String p = part.trim();
                if (p.regionMatches(true, 0, "charset=", 0, 8)) {
                    try {
                        return Charset.forName(p.substring(8).replace("\"", ""));
                    } catch (RuntimeException e) {
                        break;
                    }
                }
            }
        }
        return StandardCharsets.UTF_8;
    }

    private static Throwable rootCause(Throwable e) {
        var seen = new ArrayList<Throwable>();
        while (e.getCause() != null && !seen.contains(e.getCause())) {
            seen.add(e);
            e = e.getCause();
        }
        return e;
    }
}
