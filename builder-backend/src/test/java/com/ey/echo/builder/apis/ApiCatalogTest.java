package com.ey.echo.builder.apis;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Approved APIs are read from spec files in the install's config (fixtures in apis/). */
class ApiCatalogTest {

    static final String INVENTORY = "src/test/resources/apis/inventory.yaml";
    static final String ORDERS_SWAGGER2 = "src/test/resources/apis/orders-swagger2.json";

    static ApiCatalog catalog(ApiProperties.Spec... specs) {
        return new ApiCatalog(new ApiProperties(true, List.of(specs)));
    }

    static ApiProperties.Spec inventory() {
        return new ApiProperties.Spec("inventory", "Inventory", INVENTORY, List.of("TMF638 Service Controller"), null);
    }

    @Test
    void anOpenApiYamlSpecListsItsOperationsAndWhichMayBeCalled() {
        var api = catalog(inventory()).apis().getFirst();

        assertThat(api.problem()).isNull();
        assertThat(api.fileName()).isEqualTo("inventory.openapi.json");
        assertThat(api.operations()).containsOnlyKeys("createService", "getService", "init");
        assertThat(api.operations().get("getService")).isEqualTo(new ApiCatalog.Operation(
                "getService", "GET", "/v1/service/{id}", List.of("TMF638 Service Controller"), true));
        assertThat(api.allowedOperations()).containsExactly("createService", "getService");
        assertThat(api.hasHost()).isFalse();
        assertThat(api.content()).startsWith("{").contains("\"openapi\" : \"3.0.1\"")
                .contains("Service Creation Request");
    }

    @Test
    void operationsCanAlsoBeAllowedByName() {
        var spec = new ApiProperties.Spec("inventory", null, INVENTORY, null, List.of("getService"));
        var api = catalog(spec).apis().getFirst();

        assertThat(api.name()).isEqualTo("inventory");
        assertThat(api.allowedOperations()).containsExactly("getService");
    }

    @Test
    void withNoTagsOrOperationsListedEveryOperationMayBeCalled() {
        var api = catalog(new ApiProperties.Spec("inventory", null, INVENTORY, null, null)).apis().getFirst();

        assertThat(api.allowedOperations()).containsExactly("createService", "getService", "init");
    }

    @Test
    void aSwagger2SpecIsConvertedToOpenApi3() {
        var api = catalog(new ApiProperties.Spec("orders", null, ORDERS_SWAGGER2, null, null)).apis().getFirst();

        assertThat(api.problem()).isNull();
        assertThat(api.operations()).containsOnlyKeys("getOrder");
        assertThat(api.hasHost()).isTrue();
        assertThat(api.content()).contains("\"openapi\" : \"3.0")
                .contains("https://orders.example.com/orders-api")
                .doesNotContain("\"swagger\"");
    }

    @Test
    void aSpecThatCannotBeLoadedIsReportedNotFatal() {
        var catalog = catalog(
                new ApiProperties.Spec("missing", null, "src/test/resources/apis/nope.yaml", null, null),
                new ApiProperties.Spec("Bad Id", null, INVENTORY, null, null));

        assertThat(catalog.apis()).extracting(ApiCatalog.Api::problem).containsExactly(
                "cannot read the spec file src/test/resources/apis/nope.yaml.",
                "the id must be lower-case letters, digits and dashes.");
    }

    @Test
    void theFlowGetsACopyOfEachApprovedSpecItCalls() {
        var catalog = catalog(inventory(), new ApiProperties.Spec("orders", null, ORDERS_SWAGGER2, null, null));
        var route = "- to:\n    uri: rest-openapi:inventory.openapi.json#getService\n";

        var files = catalog.withSpecs("f.camel.yaml", Map.of("f.camel.yaml", route, "inventory.openapi.json", "old"));

        assertThat(files).containsOnlyKeys("f.camel.yaml", "inventory.openapi.json");
        assertThat(files.get("inventory.openapi.json")).contains("createService");
        assertThat(catalog.forSpecificationUri("classpath:inventory.openapi.json")).isPresent();
        assertThat(catalog.forSpecificationUri("other.json")).isEmpty();
    }
}
