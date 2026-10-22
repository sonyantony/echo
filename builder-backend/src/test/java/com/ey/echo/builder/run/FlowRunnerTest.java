package com.ey.echo.builder.run;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Runs flows inside the test JVM against a local mock downstream (no network). */
class FlowRunnerTest {

    /** The golden flow shared by all test levels. */
    private static final Path ORDERS = Path.of("../samples/flows/orders");

    private final HttpClient http = HttpClient.newBuilder().proxy(HttpClient.Builder.NO_PROXY).build();
    private final List<String> downstreamCalls = new CopyOnWriteArrayList<>();
    private HttpServer downstream;
    private FlowRunner runner;

    @BeforeEach
    void setUp() throws IOException {
        downstream = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        downstream.createContext("/", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            downstreamCalls.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath() + " " + body);
            byte[] reply = "{\"id\":\"FUL-A100\",\"reference\":\"A100\",\"state\":\"ACCEPTED\",\"lineCount\":2}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, reply.length);
            exchange.getResponseBody().write(reply);
            exchange.close();
        });
        downstream.start();
        runner = new FlowRunner(new RunProperties(true, 18081, 18085, 30, "http://localhost"), Clock.systemUTC());
    }

    @AfterEach
    void tearDown() {
        runner.stopAll();
        downstream.stop(0);
    }

    private String downstreamUrl(String path) {
        return "http://localhost:" + downstream.getAddress().getPort() + path;
    }

    private static Map<String, String> folder(Path dir) {
        try (Stream<Path> files = Files.list(dir)) {
            var result = new HashMap<String, String>();
            files.filter(Files::isRegularFile).forEach(f -> {
                try {
                    result.put(f.getFileName().toString(), Files.readString(f));
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
            return result;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Completion events arrive just after the reply is written, so wait briefly for them. */
    private static void awaitLog(FlowRun run, String prefix) throws InterruptedException {
        for (int i = 0; i < 50; i++) {
            if (run.logAfter(0).stream().anyMatch(l -> l.message().startsWith(prefix))) {
                return;
            }
            Thread.sleep(100);
        }
        assertThat(run.logAfter(0)).extracting(FlowRun.LogLine::message).anySatisfy(m -> assertThat(m).startsWith(prefix));
    }

    private HttpResponse<String> post(int port, String path, String body) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void callsAnOperationOfTheFlowsOpenApiSpecWithRestOpenapi() throws Exception {
        var files = Map.of(
                "spec.camel.yaml", """
                        - route:
                            from:
                              uri: platform-http:/orders
                              steps:
                                - removeHeaders: {pattern: "*"}
                                - setHeader: {name: Content-Type, constant: application/json}
                                - to:
                                    uri: rest-openapi:fulfilment.json#createFulfilment
                                    parameters:
                                      host: "{{fulfilment.host}}"
                        """,
                "fulfilment.json", """
                        {"openapi": "3.0.3", "info": {"title": "Fulfilment", "version": "1"},
                         "paths": {"/fulfilment": {"post": {"operationId": "createFulfilment",
                           "requestBody": {"content": {"application/json": {"schema": {"type": "object"}}}},
                           "responses": {"200": {"description": "ok"}}}}}}
                        """,
                "application.properties", "fulfilment.host=" + downstreamUrl(""));

        var run = runner.start(1, "spec", "spec.camel.yaml", files, "designer");
        var response = post(run.port, "/orders", "{\"reference\":\"A100\"}");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("FUL-A100");
        assertThat(downstreamCalls).containsExactly("POST /fulfilment {\"reference\":\"A100\"}");
    }

    @Test
    void restDslRunsOnPlatformHttpWithoutAComponentSet() throws Exception {
        var files = Map.of("hello.camel.yaml", """
                - restConfiguration: {}
                - rest:
                    path: /api
                    post:
                      - path: /hello
                        to: direct:hello
                - route:
                    from:
                      uri: direct:hello
                      steps:
                        - setBody:
                            simple: "hello ${body}"
                """);

        var run = runner.start(1, "hello", "hello.camel.yaml", files, "designer");
        var response = post(run.port, "/api/hello", "world");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("hello world");
        assertThat(run.camel.getRestConfiguration().getComponent()).isEqualTo("platform-http");
    }

    @Test
    void contractFirstRestServesTheOperationsOfTheFlowsYamlSpec() throws Exception {
        // What the Rest tab writes when Openapi Specification names the flow's own spec.
        var files = Map.of(
                "customers.camel.yaml", """
                        - restConfiguration: {}
                        - rest:
                            openApi:
                              specification: customer-api.yaml
                        - route:
                            from:
                              uri: direct:getCustomer
                              steps:
                                - setBody:
                                    simple: '{"id":"${header.id}"}'
                        """,
                "customer-api.yaml", """
                        openapi: 3.0.3
                        info: {title: Customers, version: 1.0.0}
                        paths:
                          /customers/{id}:
                            get:
                              operationId: getCustomer
                              parameters:
                                - {name: id, in: path, required: true, schema: {type: string}}
                              responses:
                                "200": {description: ok}
                        """);

        var run = runner.start(1, "customers", "customers.camel.yaml", files, "designer");
        var response = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + run.port + "/customers/C7")).GET().build(),
                HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"id\":\"C7\"}");
    }

    @Test
    void servesTheSpecUnderItsBasePathAndAnswers404ForOperationsWithoutARoute() throws Exception {
        // The draft has only the route; ECHO adds the REST part from the spec when the flow runs.
        String spec = """
                openapi: 3.0.3
                info: {title: Customers, version: 1.0.0}
                servers:
                  - url: /myurlbase
                paths:
                  /customers/{id}:
                    get:
                      operationId: getCustomer
                      responses: {"200": {description: ok}}
                  /orders:
                    get:
                      operationId: listOrders
                      responses: {"200": {description: ok}}
                """;
        var files = com.ey.echo.builder.flow.RestFromSpec.apply("customers.camel.yaml", java.util.Optional.of("customer-api.yaml"), Map.of(
                "customers.camel.yaml", """
                        - route:
                            from:
                              uri: direct:getCustomer
                              steps:
                                - setBody:
                                    simple: '{"id":"${header.id}"}'
                        """,
                "customer-api.yaml", spec));

        var run = runner.start(1, "customers", "customers.camel.yaml", files, "designer");
        assertThat(run.endpoints).containsExactly(
                new FlowRun.Endpoint("/myurlbase/customers/{id}", List.of("GET")),
                new FlowRun.Endpoint("/myurlbase/orders", List.of("GET")));

        var found = get(run.port, "/myurlbase/customers/C7");
        assertThat(found.statusCode()).isEqualTo(200);
        assertThat(found.body()).isEqualTo("{\"id\":\"C7\"}");
        var missing = get(run.port, "/myurlbase/orders");
        assertThat(missing.statusCode()).isEqualTo(404);
        assertThat(missing.body()).contains("listOrders");
        assertThat(get(run.port, "/customers/C7").statusCode()).isEqualTo(404);
    }

    @Test
    void servesSwaggerUiForTheSpecNextToItsOperations() throws Exception {
        String spec = """
                openapi: 3.0.3
                info: {title: Customers, version: 1.0.0}
                servers:
                  - url: http://api.example.com/myurlbase
                paths:
                  /customers/{id}:
                    get:
                      operationId: getCustomer
                      responses: {"200": {description: ok}}
                """;
        var files = com.ey.echo.builder.flow.RestFromSpec.apply("customers.camel.yaml", java.util.Optional.of("customer-api.yaml"), Map.of(
                "customers.camel.yaml", """
                        - route:
                            from:
                              uri: direct:getCustomer
                              steps:
                                - setBody:
                                    simple: '{"id":"${header.id}"}'
                        """,
                "customer-api.yaml", spec));
        var run = runner.start(1, "customers", "customers.camel.yaml", files, "designer");

        assertThat(run.docsPath).isEqualTo("/myurlbase/docs");
        assertThat(run.endpoints).containsExactly(new FlowRun.Endpoint("/myurlbase/customers/{id}", List.of("GET")));
        var page = get(run.port, "/myurlbase/docs");
        assertThat(page.statusCode()).isEqualTo(200);
        assertThat(page.headers().firstValue("Content-Type")).hasValueSatisfying(t -> assertThat(t).startsWith("text/html"));
        assertThat(page.body()).contains("<title>Customers - API docs</title>", "SwaggerUIBundle(");
        var served = get(run.port, "/myurlbase/docs/openapi");
        assertThat(served.statusCode()).isEqualTo(200);
        assertThat(served.body()).isEqualTo(spec);
        String webjar = "META-INF/resources/webjars/swagger-ui/" + FlowRunner.swaggerUiVersion() + "/";
        for (String asset : List.of("swagger-ui-bundle.js", "swagger-ui.css")) {
            var response = get(run.port, "/myurlbase/docs/" + asset);
            assertThat(response.statusCode()).as(asset).isEqualTo(200);
            try (var in = getClass().getClassLoader().getResourceAsStream(webjar + asset)) {
                assertThat(response.body()).as(asset).isEqualTo(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            }
        }
        // The operations still work next to it.
        assertThat(get(run.port, "/myurlbase/customers/C7").body()).isEqualTo("{\"id\":\"C7\"}");
    }

    @Test
    void theFlowDesignMenusRestSettingsApplyToTheServiceMadeFromTheSpec() throws Exception {
        String spec = """
                openapi: 3.0.3
                info: {title: Orders, version: 1.0.0}
                paths:
                  /orders:
                    post:
                      operationId: createOrder
                      requestBody:
                        required: true
                        content:
                          application/json:
                            schema:
                              type: object
                              required: [sku]
                              properties: {sku: {type: string}}
                      responses: {"200": {description: ok}}
                """;
        var files = com.ey.echo.builder.flow.RestFromSpec.apply("orders.camel.yaml", java.util.Optional.of("orders-api.yaml"), Map.of(
                "orders.camel.yaml", """
                        - restConfiguration:
                            clientRequestValidation: true
                            enableCORS: true
                        - route:
                            from:
                              uri: direct:createOrder
                              steps:
                                - setBody:
                                    constant: '{"ok":true}'
                        """,
                "orders-api.yaml", spec));
        var run = runner.start(1, "orders", "orders.camel.yaml", files, "designer");

        // Client request validation checks the content type, that a required body, query parameter or
        // header is there, and (camel-openapi-validator) the body against the spec's schema.
        var noBody = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + run.port + "/orders"))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(noBody.statusCode()).isEqualTo(400);
        var wrongType = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + run.port + "/orders"))
                .header("Content-Type", "text/plain").POST(HttpRequest.BodyPublishers.ofString("sku=X")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(wrongType.statusCode()).isBetween(400, 415);
        var missingField = post(run.port, "/orders", "{\"qty\":2}");
        assertThat(missingField.statusCode()).isEqualTo(400);
        assertThat(missingField.body()).contains("missing required properties", "sku");
        var wrongField = post(run.port, "/orders", "{\"sku\":7}");
        assertThat(wrongField.statusCode()).isEqualTo(400);
        assertThat(wrongField.body()).contains("/sku", "string");
        var asJson = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + run.port + "/orders"))
                .header("Content-Type", "application/json").header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"sku\":7}")).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(asJson.statusCode()).isEqualTo(400);
        assertThat(asJson.body()).contains("\"instance\" : \"/sku\"");
        var good = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + run.port + "/orders"))
                .header("Content-Type", "application/json").header("Origin", "http://web.example")
                .POST(HttpRequest.BodyPublishers.ofString("{\"sku\":\"X\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(good.statusCode()).isEqualTo(200);
        assertThat(good.headers().firstValue("Access-Control-Allow-Origin")).isPresent();
    }

    private HttpResponse<String> get(int port, String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void runsTheGoldenOrdersFlowWithItsDataMapperFiles() throws Exception {
        var files = folder(ORDERS);
        files.put("application.properties", "fulfilment.url=" + downstreamUrl("/fulfilment"));

        var run = runner.start(1, "orders", "orders.camel.yaml", files, "designer");
        assertThat(run.port).isEqualTo(18081);
        assertThat(run.endpoints).containsExactly(new FlowRun.Endpoint("/orders", List.of("POST")));

        var response = post(run.port, "/orders", Files.readString(ORDERS.resolve("sample-request.json")));

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"orderId\":\"A100\",\"fulfilmentId\":\"FUL-A100\",\"status\":\"ACCEPTED\"}");
        assertThat(downstreamCalls).singleElement().asString().startsWith("POST /fulfilment {\"reference\":\"A100\"");
        awaitLog(run, "Done in");
        assertThat(run.logAfter(0)).extracting(FlowRun.LogLine::message).contains("Request: POST /orders");
    }

    @Test
    void multicastsToSeveralServicesAndShowsTheFlowsLogLines() throws Exception {
        String yaml = """
                - route:
                    id: firsttestflow
                    from:
                      uri: platform-http:/firsttestflow
                      steps:
                        - log:
                            message: "got ${body}"
                        - removeHeaders:
                            pattern: "*"
                        - multicast:
                            steps:
                              - to:
                                  uri: "%s"
                              - to:
                                  uri: http
                                  parameters:
                                    httpUri: "%s"
                """.formatted(downstreamUrl("/one"), downstreamUrl("/two"));
        var run = runner.start(2, "firsttestflow", "firsttestflow.camel.yaml",
                Map.of("firsttestflow.camel.yaml", yaml), "designer");

        var response = post(run.port, "/firsttestflow", "{\"hello\":\"world\"}");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(downstreamCalls).containsExactlyInAnyOrder(
                "POST /one {\"hello\":\"world\"}", "POST /two {\"hello\":\"world\"}");
        awaitLog(run, "Done in");
        assertThat(run.logAfter(0)).extracting(FlowRun.LogLine::message)
                .contains("got {\"hello\":\"world\"}")
                .filteredOn(m -> m.startsWith("Request:")).hasSize(1);
    }

    @Test
    void reportsADownstreamFailureInTheLog() throws Exception {
        String yaml = """
                - route:
                    from:
                      uri: platform-http:/broken
                      steps:
                        - multicast:
                            steps:
                              - to:
                                  uri: http://localhost:1/nothing-here
                """;
        var run = runner.start(3, "broken", "broken.camel.yaml", Map.of("broken.camel.yaml", yaml), "designer");

        var response = post(run.port, "/broken", "{}");

        assertThat(response.statusCode()).isEqualTo(500);
        // The incoming request's headers redirect the call unless they are removed first.
        awaitLog(run, "Tip: add a Remove Headers step");
        assertThat(run.logAfter(0)).extracting(FlowRun.LogLine::level).contains("ERROR");
    }

    @Test
    void runningAgainReplacesTheEarlierRunAndStopFreesThePort() throws Exception {
        String yaml = "- route:\n    from:\n      uri: platform-http:/ping\n      steps:\n        - setBody:\n            constant: pong\n";
        var files = Map.of("ping.camel.yaml", yaml);
        var first = runner.start(4, "ping", "ping.camel.yaml", files, "designer");
        var second = runner.start(4, "ping", "ping.camel.yaml", files, "designer");
        var other = runner.start(5, "ping", "ping.camel.yaml", files, "designer");

        assertThat(second.port).isEqualTo(first.port);
        assertThat(other.port).isNotEqualTo(first.port);
        assertThat(post(second.port, "/ping", "").body()).isEqualTo("pong");
        assertThat(Files.exists(first.dir)).isFalse();

        runner.stop(4);
        assertThat(runner.get(4)).isEmpty();
        assertThatThrownBy(() -> post(second.port, "/ping", "")).isInstanceOf(IOException.class);
    }

    @Test
    void aFlowThatCannotStartIsReported() {
        assertThatThrownBy(() -> runner.start(6, "bad", "bad.camel.yaml",
                Map.of("bad.camel.yaml", "- route:\n    from:\n      uri: platform-http:/x\n      steps:\n        - to:\n            uri: nosuchcomponent:foo\n"),
                "designer"))
                .isInstanceOf(RunException.class)
                .hasMessageContaining("could not start");
        assertThat(runner.get(6)).isEmpty();
    }

    @Test
    void stopsRunsThatHaveBeenIdle() {
        var clock = new MutableClock();
        runner = new FlowRunner(new RunProperties(true, 18081, 18085, 30, "http://localhost"), clock);
        runner.start(7, "ping", "ping.camel.yaml",
                Map.of("ping.camel.yaml", "- route:\n    from:\n      uri: platform-http:/ping\n      steps:\n        - log: hi\n"),
                "designer");

        clock.advance(Duration.ofMinutes(29));
        runner.stopIdle();
        assertThat(runner.get(7)).isPresent();

        clock.advance(Duration.ofMinutes(2));
        runner.stopIdle();
        assertThat(runner.get(7)).isEmpty();
    }

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-16T10:00:00Z");

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
