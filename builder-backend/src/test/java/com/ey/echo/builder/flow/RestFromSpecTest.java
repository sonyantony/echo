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
        String yaml = RestFromSpec.applyTo(ROUTE, "customer-api.yaml", SPEC);
        assertThat(yaml).isEqualTo("""
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
    void isTheSameWhenAppliedAgainAndStripsBackToTheDraft() {
        String once = RestFromSpec.applyTo(ROUTE, "customer-api.yaml", SPEC);
        assertThat(RestFromSpec.applyTo(once, "customer-api.yaml", SPEC)).isEqualTo(once);
        assertThat(RestFromSpec.strip(once)).doesNotContain("rest:", "echo-missing").contains("get-customer");
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
        String yaml = RestFromSpec.applyTo(old, "customer-api.yaml", SPEC);
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
        assertThat(RestFromSpec.applyTo(plain, null, null)).isSameAs(plain);
    }

    @Test
    void keepsTheContextPathWhenTheSpecHasNoBasePath() {
        String spec = SPEC.replace("servers:\n  - url: /myurlbase\n", "");
        assertThat(RestFromSpec.applyTo(ROUTE, "customer-api.yaml", spec)).contains("contextPath: /old");
    }
}
