package com.ey.echo.builder.flow;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class OperationIdsTest {

    /** The operationIds of a spec, in order. */
    static List<String> ids(String spec) {
        return RestFromSpec.Spec.read(spec).operations().stream().map(RestFromSpec.Operation::operationId).toList();
    }

    @Test
    void theNaturalNameIsTheMethodAndPathInCamelCase() {
        assertThat(OperationIds.natural("POST", "/cards/{cardId}/activate")).isEqualTo("postCardsCardIdActivate");
        assertThat(OperationIds.natural("get", "/somthing1/hahaha/Cards")).isEqualTo("getSomthing1HahahaCards");
        assertThat(OperationIds.natural("GET", "/")).isEqualTo("get");
    }

    @Test
    void fillsOnlyMissingOperationIdsAndNumbersOnesThatWouldBeTaken() {
        String spec = """
                openapi: 3.0.3
                info: {title: Cards, version: 1.0.0}
                paths:
                  /cards:
                    get:
                      operationId: listCards
                    post:
                      responses: {}
                  /cards_x:
                    get: {}
                  /cards-x:
                    get: {}
                """;
        String filled = OperationIds.fill(spec, false);
        assertThat(ids(filled)).containsExactly("listCards", "postCards", "getCardsX", "getCardsX2");
        assertThat(filled).contains("title: Cards");
        assertThat(ids(OperationIds.fill(spec.replace("    get: {}", "    get: {operationId: a}"), false)))
                .containsExactly("listCards", "postCards", "a", "a");
    }

    @Test
    void leavesASpecWithEveryOperationIdAloneAndKeepsJsonAsJson() {
        String spec = "{\"openapi\":\"3.0.3\",\"paths\":{\"/a\":{\"get\":{\"operationId\":\"x\"}}}}";
        assertThat(OperationIds.fill(spec, true)).isSameAs(spec);
        String filled = OperationIds.fill("{\"openapi\":\"3.0.3\",\"paths\":{\"/a\":{\"get\":{}}}}", true);
        assertThat(filled).startsWith("{").contains("\"operationId\" : \"getA\"");
    }
}
