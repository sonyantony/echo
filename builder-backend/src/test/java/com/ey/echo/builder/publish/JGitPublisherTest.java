package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class JGitPublisherTest {

    @TempDir
    Path tmp;

    private GitTestRepo remote;
    private JGitPublisher publisher;

    @BeforeEach
    void setUp() throws Exception {
        remote = new GitTestRepo(tmp.resolve("remote.git"));
        publisher = new JGitPublisher(new GitProperties(remote.url(), "main", null, null, null, "echo@example.com",
                tmp.resolve("workdir"), null));
    }

    private static Map<String, String> orders(String yaml) {
        return Map.of("orders.camel.yaml", yaml, "application.properties", "a=1\n");
    }

    @Test
    void firstPublishCreatesTheBranchWithTheFlowFolder() throws Exception {
        var result = publisher.publish("orders", null, orders("- route: {}\n"), "alice", "Publish orders");

        assertThat(result.changed()).isTrue();
        assertThat(result.branch()).isEqualTo("main");
        var head = remote.head("main");
        assertThat(head.getName()).isEqualTo(result.commitSha());
        assertThat(head.getFullMessage()).isEqualTo("Publish orders");
        assertThat(head.getAuthorIdent().getName()).isEqualTo("alice");
        assertThat(head.getCommitterIdent().getName()).isEqualTo("ECHO Builder");
        assertThat(remote.files("main"))
                .containsExactlyInAnyOrder("flows/orders/orders.camel.yaml", "flows/orders/application.properties");
        assertThat(remote.read("main", "flows/orders/orders.camel.yaml")).isEqualTo("- route: {}\n");
    }

    @Test
    void publishingTheSameContentAgainChangesNothing() throws Exception {
        var first = publisher.publish("orders", null, orders("v1"), "alice", "one");
        var second = publisher.publish("orders", "orders", orders("v1"), "alice", "two");

        assertThat(second.changed()).isFalse();
        assertThat(second.commitSha()).isEqualTo(first.commitSha());
        assertThat(remote.head("main").getName()).isEqualTo(first.commitSha());
    }

    @Test
    void filesRemovedFromTheDraftAreRemovedFromGit() throws Exception {
        publisher.publish("orders", null, Map.of("orders.camel.yaml", "v1", "old.xsl", "x"), "alice", "one");
        publisher.publish("orders", "orders", Map.of("orders.camel.yaml", "v2"), "alice", "two");

        assertThat(remote.files("main")).containsExactly("flows/orders/orders.camel.yaml");
        assertThat(remote.read("main", "flows/orders/orders.camel.yaml")).isEqualTo("v2");
    }

    @Test
    void renamedFlowsMoveFolder() throws Exception {
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        publisher.publish("order-intake", "orders", Map.of("order-intake.camel.yaml", "v1"), "alice", "two");

        assertThat(remote.files("main")).containsExactly("flows/order-intake/order-intake.camel.yaml");
    }

    @Test
    void removeDeletesOnlyThatFlowFolderWithACommit() throws Exception {
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        var published = publisher.publish("refunds", null, Map.of("refunds.camel.yaml", "v1"), "alice", "two");

        var result = publisher.remove("orders", "bob", "Delete flow orders");

        assertThat(result.changed()).isTrue();
        assertThat(remote.files("main")).containsExactly("flows/refunds/refunds.camel.yaml");
        var head = remote.head("main");
        assertThat(head.getFullMessage()).isEqualTo("Delete flow orders");
        assertThat(head.getAuthorIdent().getName()).isEqualTo("bob");
        assertThat(head.getParent(0).getName()).isEqualTo(published.commitSha()); // history keeps the old files
    }

    @Test
    void removingAFlowThatIsNotInGitChangesNothing() throws Exception {
        var first = publisher.publish("orders", null, orders("v1"), "alice", "one");

        var result = publisher.remove("refunds", "bob", "Delete flow refunds");

        assertThat(result.changed()).isFalse();
        assertThat(remote.head("main").getName()).isEqualTo(first.commitSha());
    }

    @Test
    void removeRejectsNamesOutsideTheFlowsFolder() {
        assertThatThrownBy(() -> publisher.remove("..", "bob", "x")).isInstanceOf(PublishException.class);
        assertThatThrownBy(() -> publisher.remove("../README.md", "bob", "x")).isInstanceOf(PublishException.class);
    }

    @Test
    void listsAndReadsTheFlowsInTheRepository() throws Exception {
        assertThat(publisher.list()).isEmpty(); // the branch does not exist yet
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        remote.pushFromElsewhere(tmp.resolve("other"), "flows/refunds/refunds.camel.yaml", "r1");

        assertThat(publisher.list()).extracting(GitPublisher.PublishedFolder::name)
                .containsExactly("orders", "refunds");
        assertThat(publisher.list().get(1).files()).containsEntry("refunds.camel.yaml", "r1");
        assertThat(publisher.read("orders")).contains(orders("v1"));
        assertThat(publisher.read("missing")).isEmpty();
        assertThatThrownBy(() -> publisher.read("..")).isInstanceOf(PublishException.class);
    }

    @Test
    void otherFlowsAndFilesInTheRepositoryAreKept() throws Exception {
        publisher.publish("orders", null, orders("v1"), "alice", "one");
        remote.pushFromElsewhere(tmp.resolve("other-clone"), "Jenkinsfile", "pipeline {}");
        publisher.publish("refunds", null, Map.of("refunds.camel.yaml", "r1"), "bob", "two");

        assertThat(remote.files("main")).containsExactlyInAnyOrder("Jenkinsfile", "flows/orders/orders.camel.yaml",
                "flows/orders/application.properties", "flows/refunds/refunds.camel.yaml");
        assertThat(remote.head("main").getAuthorIdent().getName()).isEqualTo("bob");
    }

    @Test
    void publishesToAnExistingRepositoryWithHistory() throws Exception {
        remote.pushFromElsewhere(tmp.resolve("seed"), "README.md", "flows repo");
        var result = publisher.publish("orders", null, orders("v1"), "alice", "one");

        assertThat(remote.head("main").getParentCount()).isEqualTo(1);
        assertThat(remote.files("main")).contains("README.md", "flows/orders/orders.camel.yaml");
        assertThat(result.changed()).isTrue();
    }

    @Test
    void rejectsPathsOutsideTheFlowFolder() {
        assertThatThrownBy(() -> publisher.publish("orders", null, Map.of("../evil", "x"), "alice", "one"))
                .isInstanceOf(PublishException.class).hasMessageContaining("Invalid file path");
    }

    @Test
    void unreachableRemoteFailsWithAGitError() {
        var broken = new JGitPublisher(new GitProperties(tmp.resolve("missing.git").toUri().toString(), "main", null,
                null, null, null, tmp.resolve("wd2"), null));
        assertThatThrownBy(() -> broken.publish("orders", null, orders("v1"), "alice", "one"))
                .isInstanceOf(PublishException.class).hasMessageStartingWith("Git error");
    }
}
