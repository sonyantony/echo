package com.ey.echo.builder.validation;

import static org.assertj.core.api.Assertions.assertThat;

import com.ey.echo.builder.validation.ValidationResult.Problem;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class FlowValidatorTest {

    private static final Path FIXTURES = Path.of("src/test/resources/flows");
    /** The golden flow shared by all test levels. */
    private static final Path ORDERS = Path.of("../samples/flows/orders");

    private final FlowValidator validator = new FlowValidator(new ValidationProperties(null, null));

    private static Map<String, String> folder(Path dir) {
        try (Stream<Path> files = Files.list(dir)) {
            var result = new HashMap<String, String>();
            files.filter(Files::isRegularFile).forEach(f -> result.put(f.getFileName().toString(), read(f)));
            return result;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String read(Path f) {
        try {
            return Files.readString(f);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private ValidationResult validateFixture(String name) {
        return validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", read(FIXTURES.resolve(name))));
    }

    @Test
    void goldenOrdersFlowIsValid() {
        var result = validator.validate("orders.camel.yaml", folder(ORDERS));
        assertThat(result.problems()).isEmpty();
        assertThat(result.valid()).isTrue();
    }

    @Test
    void contractFirstSampleWithItsGeneratedRestAndSwaggerUiIsValid() {
        var result = validator.validate("greetings.camel.yaml", folder(Path.of("../samples/flows/greetings")));
        assertThat(result.problems()).isEmpty();
    }

    @Test
    void malformedYamlIsReportedWithItsLine() {
        var result = validateFixture("malformed.camel.yaml");
        assertThat(result.valid()).isFalse();
        assertThat(result.problems()).singleElement().satisfies(p -> {
            assertThat(p.message()).startsWith("Malformed YAML");
            assertThat(p.line()).isEqualTo(7);
        });
    }

    @Test
    void unknownStepIsReportedByCamel() {
        var result = validateFixture("unknown-step.camel.yaml");
        assertThat(result.problems()).singleElement().satisfies(p -> {
            assertThat(p.message()).contains("setBodyy");
            assertThat(p.line()).isEqualTo(5);
        });
    }

    @Test
    void disallowedComponentsAreRejected() {
        var result = validateFixture("disallowed-component.camel.yaml");
        assertThat(result.problems()).extracting(Problem::message)
                .containsExactly("The 'kafka' component is not allowed in flows "
                        + "(allowed components: platform-http, http, https, xslt-saxon, log, direct, rest-openapi).");
        assertThat(result.problems().getFirst().line()).isEqualTo(6);
    }

    @Test
    void restConfigurationMayOnlyUsePlatformHttpWithBindingOffAndNoApiDocs() {
        String rest = """
                - rest:
                    get:
                      - path: /hello
                        to: direct:hello
                - route:
                    from:
                      uri: direct:hello
                      steps:
                        - setBody: {constant: hi}
                """;
        var ok = validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml",
                "- restConfiguration:\n    component: platform-http\n    bindingMode: \"off\"\n" + rest));
        assertThat(ok.problems()).isEmpty();
        assertThat(validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", rest)).problems()).isEmpty();

        var result = validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml",
                "- restConfiguration:\n    component: servlet\n    bindingMode: json\n    apiContextPath: /api-doc\n" + rest));
        assertThat(result.problems()).extracting(Problem::line, Problem::message).containsExactly(
                org.assertj.core.groups.Tuple.tuple(2, "REST services in flows always run on platform-http, so remove 'component: servlet' from the REST configuration."),
                org.assertj.core.groups.Tuple.tuple(3, "REST binding mode 'json' is not supported in flows (bodies stay plain JSON text), so remove 'bindingMode' from the REST configuration."),
                org.assertj.core.groups.Tuple.tuple(4, "Generated API docs are not supported in flows, so remove 'apiContextPath' from the REST configuration."));
    }

    @Test
    void disallowedLanguagesAreRejected() {
        var result = validateFixture("disallowed-language.camel.yaml");
        assertThat(result.problems()).extracting(Problem::message)
                .singleElement().asString().startsWith("The 'jq' expression language is not allowed in flows");
    }

    @Test
    void badSimpleExpressionIsRejected() {
        var result = validateFixture("bad-expression.camel.yaml");
        assertThat(result.problems()).singleElement().satisfies(p -> {
            assertThat(p.message()).contains("${noSuchFunction}").contains("Unknown function");
            assertThat(p.line()).isEqualTo(6);
        });
    }

    @Test
    void missingMappingFileAndPropertyAreReported() {
        var result = validateFixture("missing-mapping.camel.yaml");
        assertThat(result.problems()).extracting(Problem::message).containsExactly(
                "The mapping file 'kaoto-datamapper-missing.xsl' is missing from the flow.",
                "Property 'downstream.url' is not set in application.properties.");
    }

    @Test
    void placeholdersResolveFromTheFlowProperties() {
        var files = Map.of(
                "flow.camel.yaml", read(FIXTURES.resolve("missing-mapping.camel.yaml")),
                "kaoto-datamapper-missing.xsl", "<xsl:stylesheet/>",
                "application.properties", "downstream.url=kafka:topic");
        // The placeholder resolves, and the resolved component is then checked against the scope.
        assertThat(validator.validate("flow.camel.yaml", files).problems()).extracting(Problem::message)
                .singleElement().asString().startsWith("The 'kafka' component");
    }

    @Test
    void emptyRouteFileIsInvalid() {
        assertThat(validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", "  ")).problems())
                .extracting(Problem::message).containsExactly("The route file is empty.");
        assertThat(validator.validate("flow.camel.yaml", Map.of()).valid()).isFalse();
    }

    @Test
    void scopeIsConfigurable() {
        var kafkaAllowed = new FlowValidator(new ValidationProperties(List.of("platform-http", "kafka"), null));
        var files = Map.of("flow.camel.yaml", read(FIXTURES.resolve("disallowed-component.camel.yaml")));
        assertThat(kafkaAllowed.validate("flow.camel.yaml", files).valid()).isTrue();
    }

    private static String multicastTo(String to) {
        return """
                - route:
                    from:
                      uri: platform-http:/firsttestflow
                      steps:
                        - removeHeaders:
                            pattern: "*"
                        - multicast:
                            steps:
                              - to:
                %s
                """.formatted(to.indent(20).stripTrailing());
    }

    @Test
    void anHttpStepWithoutAUrlIsReported() {
        // What Kaoto writes for an http step dropped on the canvas and not filled in.
        for (String to : List.of("uri: http", "uri: https\nparameters: {}", "uri: \"http:\"")) {
            var result = validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", multicastTo(to)));
            assertThat(result.problems()).as(to).singleElement().satisfies(p -> {
                assertThat(p.line()).isEqualTo(10);
                assertThat(p.message()).contains("step has no URL").contains("Http Uri");
            });
        }
    }

    @Test
    void anHttpUrlInTheUriOrInHttpUriIsFine() {
        for (String to : List.of("uri: http://localhost:9090/one",
                "uri: http\nparameters:\n  httpUri: localhost:9090/one",
                "uri: https\nparameters:\n  httpUri: \"https://example.com/two\"")) {
            var result = validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", multicastTo(to)));
            assertThat(result.problems()).as(to).isEmpty();
        }
    }

    private static String httpAfter(String before, String to) {
        return """
                - route:
                    from:
                      uri: platform-http:/firsttestflow
                      steps:
                %s
                        - to:
                %s
                        - to:
                            uri: http://localhost:9090/two
                """.formatted(before.indent(8).stripTrailing(), to.indent(12).stripTrailing());
    }

    @Test
    void incomingHeadersBeforeAnHttpCallAreReportedOncePerRoute() {
        var result = validator.validate("flow.camel.yaml",
                Map.of("flow.camel.yaml", httpAfter("- log: hi", "uri: http://localhost:9090/one")));
        assertThat(result.problems()).singleElement().satisfies(p -> {
            assertThat(p.line()).isEqualTo(7);
            assertThat(p.message()).contains("incoming request's headers").contains("Remove Headers");
        });
    }

    @Test
    void removingTheHeadersOrBridgingTheEndpointIsFine() {
        for (String[] c : List.of(
                new String[] {"- removeHeaders:\n    pattern: \"*\"", "uri: http://localhost:9090/one"},
                new String[] {"- removeHeaders:\n    pattern: \"CamelHttp*\"", "uri: http://localhost:9090/one"},
                new String[] {"- removeHeaders: \"*\"", "uri: http://localhost:9090/one"})) {
            var result = validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", httpAfter(c[0], c[1])));
            assertThat(result.problems()).as(c[0]).isEmpty();
        }
        // Bridge Endpoint on every http step (the second one in httpAfter has none, so drop it).
        var bridged = """
                - route:
                    from:
                      uri: platform-http:/firsttestflow
                      steps:
                        - to:
                            uri: http
                            parameters:
                              httpUri: localhost:9090/one
                              bridgeEndpoint: true
                """;
        assertThat(validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml", bridged)).problems()).isEmpty();
    }

    @Test
    void removingOtherHeadersDoesNotCount() {
        var result = validator.validate("flow.camel.yaml", Map.of("flow.camel.yaml",
                httpAfter("- removeHeaders:\n    pattern: \"X-*\"", "uri: http://localhost:9090/one")));
        assertThat(result.problems()).extracting(Problem::message).singleElement().asString()
                .contains("incoming request's headers");
    }
}
