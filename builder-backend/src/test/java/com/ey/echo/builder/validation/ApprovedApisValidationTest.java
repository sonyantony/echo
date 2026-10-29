package com.ey.echo.builder.validation;

import static org.assertj.core.api.Assertions.assertThat;

import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.apis.ApiProperties;
import com.ey.echo.builder.validation.ValidationResult.Problem;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** REST OpenApi steps may only call allowed operations of the install's approved APIs. */
class ApprovedApisValidationTest {

    private static final ApiProperties.Spec INVENTORY = new ApiProperties.Spec("inventory", "Inventory",
            "src/test/resources/apis/inventory.yaml", List.of("TMF638 Service Controller"), null);

    private final FlowValidator validator = validator(true);

    private static FlowValidator validator(boolean only) {
        return new FlowValidator(new ValidationProperties(null, null),
                new ApiCatalog(new ApiProperties(only, List.of(INVENTORY))));
    }

    /** A route receiving a request and calling {@code to}, with the incoming headers removed first. */
    private static String call(String to) {
        return """
            - route:
                from:
                  uri: platform-http:/services
                  steps:
                    - removeHeaders:
                        pattern: "*"
            %s
            """.formatted(to.indent(8).stripTrailing());
    }

    private List<String> problems(FlowValidator validator, String route) {
        return validator.validate("f.camel.yaml", Map.of("f.camel.yaml", route,
                "application.properties", "inventory.base-url=http://localhost:9090\n"))
                .problems().stream().map(Problem::message).toList();
    }

    private List<String> problems(String route) {
        return problems(validator, route);
    }

    @Test
    void anAllowedOperationWithAHostIsFine() {
        assertThat(problems(call("""
            - to:
                uri: rest-openapi:inventory.openapi.json#getService
                parameters:
                  host: "{{inventory.base-url}}"
            """))).isEmpty();
    }

    @Test
    void kaotosFormWithTheSpecAndOperationAsParametersIsFine() {
        assertThat(problems(call("""
            - to:
                uri: rest-openapi
                parameters:
                  specificationUri: inventory.openapi.json
                  operationId: createService
                  host: "{{inventory.base-url}}"
            """))).isEmpty();
    }

    @Test
    void anOperationOutsideTheAllowedTagsIsRejected() {
        assertThat(problems(call("""
            - to:
                uri: rest-openapi:inventory.openapi.json#init
                parameters:
                  host: "{{inventory.base-url}}"
            """))).containsExactly(
                "Flows may not call Inventory's 'init' operation (POST /shutdown/init). Allowed: createService, getService.");
    }

    @Test
    void anUnknownOrMissingOperationIsRejected() {
        assertThat(problems(call("""
            - to:
                uri: rest-openapi:inventory.openapi.json#getServices
                parameters:
                  host: "{{inventory.base-url}}"
            """))).containsExactly("'getServices' is not an operation of Inventory.");
        assertThat(problems(call("""
            - to:
                uri: rest-openapi
                parameters:
                  specificationUri: inventory.openapi.json
                  host: "{{inventory.base-url}}"
            """))).containsExactly("Choose the Inventory operation this step calls (Operation Id).");
    }

    @Test
    void aSpecWithoutAServerNeedsAHost() {
        assertThat(problems(call("""
            - to:
                uri: rest-openapi:inventory.openapi.json#getService
            """))).containsExactly(
                "Inventory's spec names no server, so set Host on this REST OpenApi step, for example {{inventory.base-url}} in application.properties.");
    }

    @Test
    void anotherSpecOrAPlainHttpCallIsRejected() {
        assertThat(problems(call("""
            - to:
                uri: rest-openapi:petstore.json#getPet
            """))).containsExactly(
                "'petstore.json' is not an approved API. Set Specification Uri to one of: inventory.openapi.json.");
        assertThat(problems(call("""
            - to:
                uri: http://localhost:9090/services
                parameters:
                  bridgeEndpoint: true
            """))).containsExactly(
                "Flows may only call approved APIs (Inventory). Use a REST OpenApi step instead of http.");
    }

    @Test
    void withoutOnlyOtherSpecsAndPlainHttpStillWork() {
        var open = validator(false);
        assertThat(problems(open, call("""
            - to:
                uri: rest-openapi:petstore.json#getPet
            """))).isEmpty();
        assertThat(problems(open, call("""
            - to:
                uri: http://localhost:9090/services
            """))).isEmpty();
        // A step that names nothing (as a new operation's route leaves it) is not left to fail at start.
        assertThat(problems(open, call("""
            - to:
                uri: rest-openapi
                parameters: {}
            """))).containsExactly(
                "This REST OpenApi step calls nothing yet. Set Specification Uri to one of: inventory.openapi.json, and pick its Operation Id.");
        // Approved APIs are still checked.
        assertThat(problems(open, call("""
            - to:
                uri: rest-openapi:inventory.openapi.json#init
                parameters:
                  host: "{{inventory.base-url}}"
            """))).hasSize(1);
    }

    @Test
    void incomingHeadersBeforeTheCallAreReported() {
        var route = """
            - route:
                from:
                  uri: platform-http:/services
                  steps:
                    - to:
                        uri: rest-openapi:inventory.openapi.json#getService
                        parameters:
                          host: "{{inventory.base-url}}"
            """;
        assertThat(problems(route)).containsExactly(
                "The incoming request's headers would change the URL this REST OpenApi step calls. Add a Remove Headers step with pattern * before it.");
    }

    @Test
    void anEnrichCallingAnAllowedOperationWithItsHostIsFine() {
        assertThat(problems(call("""
            - enrich:
                simple:
                  expression: rest-openapi:inventory.openapi.json#getService?host={{inventory.base-url}}
            """))).isEmpty();
        assertThat(problems(call("""
            - enrich:
                expression:
                  constant:
                    expression: rest-openapi:inventory.openapi.json#createService?host={{inventory.base-url}}
            """))).isEmpty();
    }

    @Test
    void anEnrichIsCheckedLikeARestOpenApiStep() {
        assertThat(problems(call("""
            - enrich:
                simple:
                  expression: rest-openapi:inventory.openapi.json#init
            """))).containsExactly(
                "Flows may not call Inventory's 'init' operation (POST /shutdown/init). Allowed: createService, getService.",
                "Inventory's spec names no server, so set Host on this Enrich step, for example {{inventory.base-url}} in application.properties.");
        assertThat(problems(call("""
            - enrich:
                simple:
                  expression: rest-openapi:other.json#getService
            """))).containsExactly(
                "'other.json' is not an approved API. Set Specification Uri to one of: inventory.openapi.json.");
    }

    @Test
    void anEnrichToHttpIsRefusedWhenOnlyApprovedApisMayBeCalled() {
        assertThat(problems(call("""
            - enrich:
                simple:
                  expression: http://localhost:9090/orders
            """))).containsExactly(
                "Flows may only call approved APIs (Inventory). Use a REST OpenApi step instead of http.");
        assertThat(problems(validator(false), call("""
            - enrich:
                simple:
                  expression: http://localhost:9090/orders
            """))).isEmpty();
    }

    @Test
    void anEnrichWithAComputedUriIsLeftToRunTime() {
        assertThat(problems(call("""
            - enrich:
                simple:
                  expression: rest-openapi:inventory.openapi.json#${header.op}
            """))).isEmpty();
    }
}
