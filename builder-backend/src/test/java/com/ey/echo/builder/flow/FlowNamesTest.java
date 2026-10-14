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
}
