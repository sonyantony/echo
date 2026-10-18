package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class S3PublisherTest {

    private FakeS3 s3;
    private S3Publisher publisher;

    @BeforeEach
    void setUp() throws Exception {
        s3 = new FakeS3();
        publisher = new S3Publisher(s3.properties("echo/flows/"), Clock.systemUTC());
    }

    @AfterEach
    void tearDown() {
        s3.close();
    }

    private static Map<String, String> orders(String yaml) {
        return Map.of("orders.camel.yaml", yaml, "application.properties", "a=1\n");
    }

    @Test
    void publishWritesTheFlowFolder() {
        var result = publisher.publish("orders", null, orders("- route: {}\n"), "alice", "Publish orders");

        assertThat(result.changed()).isTrue();
        assertThat(result.location()).isEqualTo("s3://flows-bucket/echo/flows/orders/");
        assertThat(s3.objects).containsOnly(Map.entry("echo/flows/orders/orders.camel.yaml", "- route: {}\n"),
                Map.entry("echo/flows/orders/application.properties", "a=1\n"));
    }

    @Test
    void templatesGoToTheTemplatesFolderNextToTheFlowsFolder() {
        publisher.publish("orders", null, orders("flow"), "alice", "Publish orders");
        publisher.templates().publish("basic", null, Map.of("basic.camel.yaml", "tpl"), "alice", "Save template");

        assertThat(s3.objects).containsEntry("echo/templates/basic/basic.camel.yaml", "tpl");
        assertThat(publisher.list()).extracting(FlowPublisher.PublishedFolder::name).containsExactly("orders");
        assertThat(publisher.templates().list()).extracting(FlowPublisher.PublishedFolder::name).containsExactly("basic");
        assertThat(publisher.templates().read("basic")).contains(Map.of("basic.camel.yaml", "tpl"));
    }

    @Test
    void publishingTheSameContentAgainWritesNothing() {
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        s3.requests.clear();

        var second = publisher.publish("orders", "orders", orders("v1"), "alice", "two");

        assertThat(second.changed()).isFalse();
        assertThat(s3.requests).noneMatch(r -> r.startsWith("PUT") || r.startsWith("DELETE"));
    }

    @Test
    void filesRemovedFromTheDraftAreRemovedFromS3() {
        publisher.publish("orders", null, Map.of("orders.camel.yaml", "v1", "old.xsl", "x", "sub/a.json", "{}"),
                "alice", "one");
        publisher.publish("orders", "orders", Map.of("orders.camel.yaml", "v2"), "alice", "two");

        assertThat(s3.objects).containsOnly(Map.entry("echo/flows/orders/orders.camel.yaml", "v2"));
    }

    @Test
    void renamedFlowsMoveFolderAndOtherFlowsAreKept() {
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        publisher.publish("refunds", null, Map.of("refunds.camel.yaml", "r1"), "alice", "one");
        s3.objects.put("echo/README.md", "not a flow");

        publisher.publish("order-intake", "orders", Map.of("order-intake.camel.yaml", "v1"), "alice", "two");

        assertThat(s3.objects).containsOnlyKeys("echo/README.md", "echo/flows/order-intake/order-intake.camel.yaml",
                "echo/flows/refunds/refunds.camel.yaml");
    }

    @Test
    void removeDeletesOnlyThatFlow() {
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        publisher.publish("order", null, Map.of("order.camel.yaml", "o"), "alice", "one"); // shares a key prefix

        assertThat(publisher.remove("order", "bob", "Delete flow order").changed()).isTrue();
        assertThat(publisher.remove("missing", "bob", "Delete flow missing").changed()).isFalse();

        assertThat(s3.objects).containsOnlyKeys("echo/flows/orders/orders.camel.yaml",
                "echo/flows/orders/application.properties");
    }

    @Test
    void listsAndReadsTheFlowsAcrossListingPages() {
        assertThat(publisher.list()).isEmpty();
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        publisher.publish("refunds", null, Map.of("refunds.camel.yaml", "r1", "echo-flow.json", "{}"), "bob", "two");
        s3.objects.put("echo/flows/stray.txt", "not in a flow folder");

        assertThat(publisher.list()).extracting(FlowPublisher.PublishedFolder::name)
                .containsExactly("orders", "refunds");
        assertThat(publisher.list().get(1).files()).containsEntry("refunds.camel.yaml", "r1");
        assertThat(publisher.read("orders")).contains(orders("v1"));
        assertThat(publisher.read("missing")).isEmpty();
    }

    @Test
    void rejectsNamesAndPathsOutsideTheFlowFolder() {
        assertThatThrownBy(() -> publisher.remove("..", "bob", "x")).isInstanceOf(PublishException.class);
        assertThatThrownBy(() -> publisher.read("a/b")).isInstanceOf(PublishException.class);
        assertThatThrownBy(() -> publisher.publish("orders", null, Map.of("../evil", "x"), "alice", "one"))
                .isInstanceOf(PublishException.class).hasMessageContaining("Invalid file path");
        assertThat(s3.objects).isEmpty();
    }

    @Test
    void serverErrorsFailWithAnS3Error() {
        s3.failing = true;
        assertThatThrownBy(() -> publisher.publish("orders", null, orders("v1"), "alice", "one"))
                .isInstanceOf(PublishException.class).hasMessageStartingWith("S3 error")
                .hasMessageContaining("503").hasMessageContaining("ServiceUnavailable");
    }

    @Test
    void wrongCredentialsAreReported() {
        var props = s3.properties("flows");
        var wrong = new S3Publisher(new S3Properties(true, props.bucket(), "flows", props.region(),
                props.endpoint(), "someone-else", "x", null), Clock.systemUTC());
        assertThatThrownBy(wrong::list).isInstanceOf(PublishException.class).hasMessageContaining("403");
    }

    @Test
    void enabledOnlyWithABucket() {
        assertThat(publisher.enabled()).isTrue();
        assertThat(new S3Publisher(new S3Properties(true, "", null, null, null, null, null, null),
                Clock.systemUTC()).enabled()).isFalse();
        assertThat(new S3Publisher(new S3Properties(null, "b", null, null, null, null, null, null),
                Clock.systemUTC()).enabled()).isFalse();
    }
}
