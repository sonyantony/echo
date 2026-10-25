package com.ey.echo.builder.flow;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class FlowNamesTest {

    @ParameterizedTest
    @ValueSource(strings = {"orders", "order-sync", "a1", "customer-v2-api"})
    void folderSafeNamesAreAccepted(String name) {
        assertThat(FlowNames.isValidName(name)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "Orders", "1orders", "-orders", "orders-", "order--sync", "order sync", "order_sync",
            "../x", "orders/x", "a.b"})
    void unsafeNamesAreRejected(String name) {
        assertThat(FlowNames.isValidName(name)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"orders.camel.yaml", ".kaoto", "kaoto-datamapper-1.xsl", "schemas/order.schema.json"})
    void relativeFilePathsAreAccepted(String path) {
        assertThat(FlowNames.isValidPath(path)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "/etc/passwd", "../x", "a/../b", "a//b", "a/", "./a", "a b", "a\\b", "c:x"})
    void unsafeFilePathsAreRejected(String path) {
        assertThat(FlowNames.isValidPath(path)).isFalse();
    }

    @org.junit.jupiter.api.Test
    void namesLongerThan63AreRejected() {
        assertThat(FlowNames.isValidName("a".repeat(63))).isTrue();
        assertThat(FlowNames.isValidName("a".repeat(64))).isFalse();
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
        "First Flow, first-flow",
        "orders, orders",
        "'  Card API  ', card-api",
        "Café Orders!, cafe-orders",
        "2nd try, flow-2nd-try",
        "'***', flow",
        "a__b--c, a-b-c"})
    void idsAreMadeFromDisplayNames(String displayName, String id) {
        assertThat(FlowNames.idFor(displayName)).isEqualTo(id);
        assertThat(FlowNames.isValidName(FlowNames.idFor(displayName))).isTrue();
    }

    @org.junit.jupiter.api.Test
    void idsStayWithin63CharactersAndGetANumberWhenTaken() {
        String long_ = "word ".repeat(30);
        assertThat(FlowNames.idFor(long_)).hasSizeLessThanOrEqualTo(63).doesNotEndWith("-");
        var taken = java.util.Set.of("first-flow", "first-flow-2");
        assertThat(FlowNames.uniqueIdFor("First Flow", taken::contains)).isEqualTo("first-flow-3");
        assertThat(FlowNames.uniqueIdFor(long_, id -> id.equals(FlowNames.idFor(long_))))
                .hasSizeLessThanOrEqualTo(63).endsWith("-2");
    }

    @org.junit.jupiter.api.Test
    void displayNamesAreAnyTextUpTo100Characters() {
        assertThat(FlowNames.isValidDisplayName("First Flow")).isTrue();
        assertThat(FlowNames.isValidDisplayName("x".repeat(100))).isTrue();
        assertThat(FlowNames.isValidDisplayName("x".repeat(101))).isFalse();
        assertThat(FlowNames.isValidDisplayName("  ")).isFalse();
        assertThat(FlowNames.isValidDisplayName("a\nb")).isFalse();
        assertThat(FlowNames.isValidDisplayName(null)).isFalse();
    }
}
