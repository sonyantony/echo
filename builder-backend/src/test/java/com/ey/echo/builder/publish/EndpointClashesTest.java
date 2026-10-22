package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.ey.echo.builder.flow.RestFromSpec;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class EndpointClashesTest {

    private static String spec(String server, String path, String method, String operationId) {
        return """
                openapi: 3.0.3
                info: {title: Cards, version: 1.0.0}
                %s
                paths:
                  %s:
                    %s:
                      operationId: %s
                      responses: {"200": {description: ok}}
                """.formatted(server == null ? "" : "servers: [{url: '%s'}]".formatted(server), path, method, operationId);
    }

    /** A flow's files as Publish sends them: the route with the REST part ECHO adds from the spec. */
    private static Map<String, String> flow(String name, String spec) {
        return RestFromSpec.apply(name + ".camel.yaml", Optional.of("api.yaml"),
                Map.of(name + ".camel.yaml", "- route:\n    from:\n      uri: direct:x\n      steps: []\n", "api.yaml", spec));
    }

    private static EndpointClashes published(Map<String, Map<String, String>> flows) {
        var git = mock(FlowPublisher.class);
        when(git.enabled()).thenReturn(true);
        when(git.list()).thenReturn(flows.entrySet().stream()
                .map(e -> new FlowPublisher.PublishedFolder(e.getKey(), e.getValue())).toList());
        return new EndpointClashes(new PublishTargets(List.of(git)));
    }

    @Test
    void theSameMethodOnTheSamePathClashesWhateverThePathParametersAreCalled() {
        var check = published(Map.of("card-orders", flow("card-orders", spec("https://api.example.com/api", "/cards/{id}", "get", "getCard"))));

        assertThat(check.check("cards", null, flow("cards", spec("/api", "/cards/{cardId}", "get", "readCard"))))
                .containsExactly("GET /api/cards/{cardId} is already used by flow card-orders",
                        "Swagger UI at /api/docs is already used by flow card-orders");
    }

    @Test
    void anotherMethodOnlyClashesOnSwaggerUiWhichEachBasePathHasOnce() {
        var check = published(Map.of("card-orders", flow("card-orders", spec("/api", "/cards", "post", "createCard"))));

        assertThat(check.check("cards", null, flow("cards", spec("/api", "/cards", "get", "listCards"))))
                .containsExactly("Swagger UI at /api/docs is already used by flow card-orders");
        assertThat(check.check("cards", null, flow("cards", spec("/v2", "/cards", "post", "createCardV2")))).isEmpty();
    }

    @Test
    void flowsWithoutABasePathShareSwaggerUiAtDocs() {
        var check = published(Map.of("a", flow("a", spec(null, "/a", "get", "getA"))));

        assertThat(check.check("b", null, flow("b", spec(null, "/b", "get", "getB"))))
                .containsExactly("Swagger UI at /docs is already used by flow a");
    }

    @Test
    void duplicateOperationIdsClash() {
        var check = published(Map.of("a", flow("a", spec("/a", "/x", "get", "getThing"))));

        assertThat(check.check("b", null, flow("b", spec("/b", "/y", "get", "getThing"))))
                .containsExactly("operationId getThing is already used by flow a");
    }

    @Test
    void theFlowsOwnPublishedVersionAndItsOldNameAreSkipped() {
        var mine = flow("cards", spec("/api", "/cards", "get", "listCards"));
        var check = published(Map.of("cards", mine, "old-cards", flow("old-cards", spec("/api", "/cards", "get", "listCards"))));

        assertThat(check.check("cards", "old-cards", mine)).isEmpty();
    }

    @Test
    void plainPlatformHttpRoutesCountAndWithoutAMethodTakeEveryMethod() {
        var check = published(Map.of("orders", Map.of("orders.camel.yaml", """
                - route:
                    from:
                      uri: platform-http:/orders/
                      steps: []
                """)));

        assertThat(check.check("more-orders", null, Map.of("more-orders.camel.yaml", """
                - route:
                    from:
                      uri: platform-http:/orders
                      parameters:
                        httpMethodRestrict: POST
                      steps: []
                """))).containsExactly("POST /orders is already used by flow orders");
    }

    @Test
    void nothingIsCheckedWithoutAnEnabledTarget() {
        var check = new EndpointClashes(new PublishTargets(List.of()));
        assertThat(check.check("b", null, flow("b", spec(null, "/b", "get", "getB")))).isEmpty();
    }
}
