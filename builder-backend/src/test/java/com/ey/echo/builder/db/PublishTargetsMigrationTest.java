package com.ey.echo.builder.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

/** Installs that published before V3 keep their history: each old publish becomes a Git target row. */
class PublishTargetsMigrationTest {

    @Test
    void existingPublishesBecomeGitTargets() throws Exception {
        String url = "jdbc:h2:mem:migration;DB_CLOSE_DELAY=-1";
        Flyway.configure().dataSource(url, "sa", "").target("2").load().migrate();
        try (var c = DriverManager.getConnection(url, "sa", ""); var s = c.createStatement()) {
            s.execute("INSERT INTO flow (id, name, status, created_by, created_at, updated_by, updated_at) "
                    + "VALUES (1, 'orders', 'PUBLISHED', 'd', CURRENT_TIMESTAMP, 'd', CURRENT_TIMESTAMP)");
            s.execute("INSERT INTO publish_event (id, flow_id, flow_name, commit_sha, branch, published_by, "
                    + "published_at, message) VALUES (7, 1, 'orders', 'abc123', 'main', 'd', CURRENT_TIMESTAMP, 'm')");
        }

        Flyway.configure().dataSource(url, "sa", "").load().migrate();

        try (var c = DriverManager.getConnection(url, "sa", ""); var s = c.createStatement();
                var rs = s.executeQuery("SELECT * FROM publish_target")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("publish_event_id")).isEqualTo(7);
            assertThat(rs.getString("target")).isEqualTo("git");
            assertThat(rs.getString("revision")).isEqualTo("abc123");
            assertThat(rs.getString("location")).isEqualTo("main");
            assertThat(rs.getBoolean("changed")).isTrue();
            assertThat(rs.next()).isFalse();
        }
    }
}
