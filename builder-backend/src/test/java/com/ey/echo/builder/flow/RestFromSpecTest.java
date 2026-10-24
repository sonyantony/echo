package com.ey.echo.builder.flow;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class RestFromSpecTest {

    static final String SPEC = """
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

    static final String ROUTE = """
            - restConfiguration:
                clientRequestValidation: true
                contextPath: /old
            - route:
                id: get-customer
                from:
                  uri: direct:getCustomer
                  steps:
                    - setBody:
                        simple: '{"id":"${header.id}"}'
            """;

    @Test
    void addsTheRestServiceAndA404RouteForEachMissingOperation() {
        String yaml = RestFromSpec.applyTo(ROUTE, "customers", "customer-api.yaml", SPEC);
        assertThat(yaml).startsWith("""
                - restConfiguration:
                    clientRequestValidation: true
                - route:
                    id: get-customer
                    from:
                      uri: direct:getCustomer
                      steps:
                        - setBody:
                            simple: '{"id":"${header.id}"}'
                - rest:
                    id: echo-openapi
                    openApi:
                      specification: 'customer-api.yaml'
                      missingOperation: ignore
                - route:
                    id: 'echo-missing-listOrders'
                    description: Made by EY ECHO; the flow has no route for this operation of its OpenAPI spec
                    from:
                      uri: 'direct:listOrders'
                      steps:
                        - setHeader:
                            name: CamelHttpResponseCode
                            constant: 404
                        - setHeader:
                            name: Content-Type
                            constant: application/json
                        - setBody:
                            constant: '{"error":"Not found","message":"This flow does not implement the operation listOrders yet."}'
                """);
    }

    @Test
    void aRouteSwitchedOffWithAutoStartupFalseAnswers404LikeAMissingOne() {
        String route = ROUTE.replace("    id: get-customer\n", "    id: get-customer\n    autoStartup: false\n");
        String yaml = RestFromSpec.applyTo(route, "customers", "customer-api.yaml", SPEC);
        assertThat(yaml).contains("id: 'echo-missing-getCustomer'")
                .contains("The route for the operation getCustomer is disabled in this flow.")
                .contains("id: 'echo-missing-listOrders'")
                .contains("This flow does not implement the operation listOrders yet.");
    }

    @Test
    void swaggerUiShowsAnOperationWhoseRouteIsSwitchedOffAsDeprecated() {
        String route = ROUTE.replace("    id: get-customer\n", "    id: get-customer\n    autoStartup: false\n");
        String spec = SPEC.replace("info: {title: Customers, version: 1.0.0}",
                "info: {title: 'Customers {{x}}', version: 1.0.0, description: Since 2024-01-01, x-flag: on}");
        String yaml = RestFromSpec.applyTo(route, "customers", "customer-api.yaml", spec);
        // The spec Swagger UI reads is a JSON copy with the flag; the file itself is not touched.
        assertThat(yaml).doesNotContain("'resource:classpath:customer-api.yaml'")
                .contains("constant: 'application/json'")
                .contains("\"/customers/{id}\":{\"get\":{\"operationId\":\"getCustomer\",\"responses\":{\"200\":{\"description\":\"ok\"}},\"deprecated\":true}}")
                .contains("\"/orders\":{\"get\":{\"operationId\":\"listOrders\",\"responses\":{\"200\":{\"description\":\"ok\"}}}}")
                // Read as Swagger UI reads YAML: dates and on/off stay text; {{ is no Camel placeholder.
                .contains("\"description\":\"Since 2024-01-01\"", "\"x-flag\":\"on\"", "\"title\":\"Customers {\\u007bx}}\"");
        // Without a switched-off route the spec file is served as it is.
        assertThat(RestFromSpec.deprecated(SPEC, java.util.Set.of())).isNull();
        assertThat(RestFromSpec.applyTo(ROUTE, "customers", "customer-api.yaml", SPEC))
                .contains("'resource:classpath:customer-api.yaml'").doesNotContain("deprecated");
    }

    @Test
    void aDirectRouteAsKaotoWritesItWithTheNameAsAParameterCounts() {
        String route = ROUTE.replace("      uri: direct:getCustomer\n",
                "      uri: direct\n      parameters:\n        name: getCustomer\n");
        String yaml = RestFromSpec.applyTo(route, "customers", "customer-api.yaml", SPEC);
        assertThat(yaml).doesNotContain("echo-missing-getCustomer").contains("echo-missing-listOrders");
    }

    @Test
    void listsTheOperationsWithoutARouteIncludingOnesWhoseRouteIsSwitchedOff() {
        String route = ROUTE + """
                - route:
                    id: orders
                    autoStartup: false
                    from:
                      uri: direct
                      parameters:
                        name: listOrders
                      steps:
                        - log: {message: orders}
                """;
        String spec = SPEC + """
                  /refunds:
                    post:
                      responses: {"200": {description: ok}}
                """;
        assertThat(RestFromSpec.unrouted(route, spec)).containsExactly(
                new RestFromSpec.Unrouted("GET", "/orders", "listOrders", true),
                new RestFromSpec.Unrouted("POST", "/refunds", null, false));
        // What apply adds (the 404 routes) does not count as a route.
        String applied = RestFromSpec.applyTo(ROUTE, "customers", "customer-api.yaml", SPEC);
        assertThat(RestFromSpec.unrouted(applied, SPEC)).containsExactly(
                new RestFromSpec.Unrouted("GET", "/orders", "listOrders", false));
        assertThat(RestFromSpec.unrouted(ROUTE.replace("direct:getCustomer", "direct:other"), SPEC)).hasSize(2);
    }

    @Test
    void anOperationWithoutAnOperationIdGetsItsNaturalNameWhenTheFlowLeavesTheEditor() {
        String spec = SPEC.replace("      operationId: listOrders\n", "");
        var files = RestFromSpec.apply("customers.camel.yaml", Optional.of("customer-api.yaml"),
                Map.of("customers.camel.yaml", ROUTE, "customer-api.yaml", spec));
        assertThat(OperationIdsTest.ids(files.get("customer-api.yaml"))).containsExactly("getCustomer", "getOrders");
        assertThat(files.get("customers.camel.yaml")).contains("echo-missing-getOrders");
    }

    @Test
    void isTheSameWhenAppliedAgainAndStripsBackToTheDraft() {
        String once = RestFromSpec.applyTo(ROUTE, "customers", "customer-api.yaml", SPEC);
        assertThat(RestFromSpec.applyTo(once, "customers", "customer-api.yaml", SPEC)).isEqualTo(once);
        assertThat(RestFromSpec.strip(once)).doesNotContain("rest:", "echo-missing", "echo-docs").contains("get-customer");
    }

    @Test
    void followsARenamedSpecAndReplacesAContractFirstServiceTheRestTabWrote() {
        String old = """
                - rest:
                    openApi:
                      specification: old-name.yaml
                - route:
                    from:
                      uri: direct:getCustomer
                      steps:
                        - log: hi
                """;
        String yaml = RestFromSpec.applyTo(old, "customers", "customer-api.yaml", SPEC);
        assertThat(yaml).doesNotContain("old-name").containsOnlyOnce("- rest:").contains("specification: 'customer-api.yaml'");
    }

    @Test
    void withoutASpecRemovesTheGeneratedPartAndKeepsHandWrittenRest() {
        String yaml = """
                - rest:
                    openApi:
                      specification: gone.yaml
                - rest:
                    path: /hello
                    get:
                      - to: direct:hello
                - route:
                    from:
                      uri: direct:hello
                      steps:
                        - log: hi
                """;
        assertThat(RestFromSpec.apply("f.camel.yaml", Optional.empty(), Map.of("f.camel.yaml", yaml)).get("f.camel.yaml"))
                .doesNotContain("gone.yaml").contains("path: /hello");
        String plain = "- route:\n    from:\n      uri: direct:x\n";
        assertThat(RestFromSpec.applyTo(plain, "customers", null, null)).isSameAs(plain);
    }

    @Test
    void keepsTheContextPathWhenTheSpecHasNoBasePath() {
        String spec = SPEC.replace("servers:\n  - url: /myurlbase\n", "");
        assertThat(RestFromSpec.applyTo(ROUTE, "customers", "customer-api.yaml", spec)).contains("contextPath: /old")
                .contains("uri: 'platform-http:/old/docs'");
    }

    @Test
    void servesSwaggerUiForTheSpecUnderTheBasePath() {
        String yaml = RestFromSpec.applyTo(ROUTE, "customers", "customer-api.yaml", SPEC);
        assertThat(yaml).contains("""
                - route:
                    id: 'echo-docs-customers-spec'
                    description: Made by EY ECHO; Swagger UI for the flow's OpenAPI spec
                    from:
                      uri: 'platform-http:/myurlbase/docs/openapi'
                      parameters:
                        httpMethodRestrict: GET
                      steps:
                        - setHeader:
                            name: Content-Type
                            constant: 'application/yaml'
                        - setBody:
                            constant: 'resource:classpath:customer-api.yaml'
                """)
                .contains("id: 'echo-docs-customers'", "uri: 'platform-http:/myurlbase/docs'",
                        "<title>Customers - API docs</title>", "href=\"docs/swagger-ui.css\"", "url: ''docs/openapi''")
                .contains("uri: 'platform-http:/myurlbase/docs/swagger-ui-bundle.js'",
                        "constant: 'resource:classpath:META-INF/resources/webjars/swagger-ui/{{echo.swagger-ui.version}}/swagger-ui-bundle.js'")
                .contains("uri: 'platform-http:/myurlbase/docs/swagger-ui.css'");
        // The flow's name keeps the ids apart when several flows share one bundle image.
        assertThat(RestFromSpec.applyTo(ROUTE, "orders", "customer-api.yaml", SPEC)).contains("id: 'echo-docs-orders'");
        // A JSON spec is served as JSON; a title that looks like a placeholder is not one.
        String json = RestFromSpec.applyTo(ROUTE, "customers", "api.json",
                "{\"openapi\": \"3.0.3\", \"info\": {\"title\": \"A <b> {{x}}\", \"version\": \"1\"}, \"paths\": {}}");
        assertThat(json).contains("constant: 'application/json'", "<title>A &lt;b&gt; &#123;&#123;x}} - API docs</title>",
                "uri: 'platform-http:/old/docs'"); // no Base Path: under the old Context Path
    }

    @Test
    void docsPathFollowsTheBasePath() {
        assertThat(RestFromSpec.docsPath("")).isEqualTo("/docs");
        assertThat(RestFromSpec.docsPath("/shop/")).isEqualTo("/shop/docs");
        assertThat(RestFromSpec.docsPath("shop")).isEqualTo("/shop/docs");
    }
}
