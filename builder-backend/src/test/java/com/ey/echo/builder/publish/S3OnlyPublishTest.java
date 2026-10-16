package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ey.echo.builder.flow.FlowRepository;
import com.jayway.jsonpath.JsonPath;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Git switched off (though its URL is set): publishing and the Published list use S3 only. */
@SpringBootTest
@AutoConfigureMockMvc
class S3OnlyPublishTest {

    private static final Path TMP;
    private static final GitTestRepo GIT;
    private static final FakeS3 S3;

    static {
        try {
            TMP = Files.createTempDirectory("echo-s3-only-test");
            GIT = new GitTestRepo(TMP.resolve("flows.git"));
            S3 = new FakeS3();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void targets(DynamicPropertyRegistry registry) {
        registry.add("echo.git.enabled", () -> "false");
        registry.add("echo.git.url", GIT::url);
        registry.add("echo.git.workdir", () -> TMP.resolve("workdir").toString());
        registry.add("echo.s3.enabled", () -> "true");
        registry.add("echo.s3.bucket", () -> FakeS3.BUCKET);
        registry.add("echo.s3.region", () -> "eu-west-1");
        registry.add("echo.s3.endpoint", S3::endpoint);
        registry.add("echo.s3.access-key", () -> FakeS3.ACCESS_KEY);
        registry.add("echo.s3.secret-key", () -> FakeS3.SECRET_KEY);
    }

    @AfterAll
    static void stop() {
        S3.close();
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FlowRepository flows;

    @BeforeEach
    void clean() {
        flows.deleteAll();
        S3.objects.clear();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    @Test
    void publishesListsAndDeletesThroughS3() throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"orders\",\"description\":\"Demo\"}"))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();

        mvc.perform(as(post("/api/flows/{id}/publish", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targets", hasSize(1)))
                .andExpect(jsonPath("$.targets[0].target").value("s3"));
        assertThat(GIT.head("main")).isNull(); // Git untouched

        mvc.perform(as(get("/api/published-flows")))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("orders"))
                .andExpect(jsonPath("$[0].flowId").value(id))
                .andExpect(jsonPath("$[0].version").value(1));
        mvc.perform(as(get("/api/published-flows/orders/download"))).andExpect(status().isOk());

        mvc.perform(as(delete("/api/published-flows/orders"))).andExpect(status().isNoContent());
        assertThat(S3.objects).isEmpty();
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(status().isNotFound());
    }
}
