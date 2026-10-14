package com.ey.echo.builder.flow;

import static org.assertj.core.api.Assertions.assertThat;

import com.ey.echo.builder.BuilderApplication;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.WebApplicationType;

/** Drafts are kept in the H2 file database and survive a backend restart. */
class FlowPersistenceTest {

    @TempDir
    Path dataDir;

    private org.springframework.context.ConfigurableApplicationContext start() {
        // Command-line arguments override the in-memory test datasource.
        return new SpringApplicationBuilder(BuilderApplication.class)
                .web(WebApplicationType.NONE)
                .run("--echo.data-dir=" + dataDir,
                        "--spring.datasource.url=jdbc:h2:file:" + dataDir.resolve("h2/echo"));
    }

    @Test
    void draftsSurviveARestart() {
        try (var first = start()) {
            var service = first.getBean(FlowService.class);
            var flow = service.create("orders", "Order intake", "designer");
            service.writeFile(flow.getId(), "kaoto-datamapper-1.xsl", "<xsl/>", "designer");
        }

        try (var second = start()) {
            var service = second.getBean(FlowService.class);
            assertThat(service.list()).extracting(Flow::getName).containsExactly("orders");
            long id = service.list().getFirst().getId();
            assertThat(service.readFile(id, "kaoto-datamapper-1.xsl")).isEqualTo("<xsl/>");
        }
        assertThat(dataDir.resolve("h2/echo.mv.db")).exists();
    }
}
