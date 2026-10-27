package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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

/** Publish, history and delete with Git and S3 both enabled (local bare repository, fake S3). */
@SpringBootTest
@AutoConfigureMockMvc
class MultiTargetPublishTest {

    private static final Path TMP;
    private static final GitTestRepo GIT;
    private static final FakeS3 S3;

    static {
        try {
            TMP = Files.createTempDirectory("echo-multi-target-test");
            GIT = new GitTestRepo(TMP.resolve("flows.git"));
            S3 = new FakeS3();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void targets(DynamicPropertyRegistry registry) {
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
        S3.failing = false;
        S3.objects.clear();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long create(String name) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"description\":\"Demo\"}".formatted(name)))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        // A new flow has no routes: give it one serving POST /<name>.
        mvc.perform(as(put("/api/flows/{id}/files/{file}", id, name + ".camel.yaml")).contentType(MediaType.TEXT_PLAIN)
                .content("- route:\n    from:\n      uri: platform-http:/%s\n      parameters:\n".formatted(name)
                        + "        httpMethodRestrict: POST\n      steps:\n        - log:\n            message: hi\n"))
                .andExpect(status().isNoContent());
        return id;
    }

    @Test
    void listsTheEnabledTargets() throws Exception {
        mvc.perform(as(get("/api/publish-targets")))
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].id").value("git"))
                .andExpect(jsonPath("$[0].location", containsString("(branch main)")))
                .andExpect(jsonPath("$[1].id").value("s3"))
                .andExpect(jsonPath("$[1].location", containsString("s3://flows-bucket/flows/")));
    }

    @Test
    void publishGoesToEveryEnabledTarget() throws Exception {
        long id = create("orders");

        mvc.perform(as(post("/api/flows/{id}/publish", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.changed").value(true))
                .andExpect(jsonPath("$.targets", hasSize(2)))
                .andExpect(jsonPath("$.targets[0].name").value("Git"))
                .andExpect(jsonPath("$.targets[0].revision").value(GIT.head("main").getName()))
                .andExpect(jsonPath("$.targets[1].name").value("S3"))
                .andExpect(jsonPath("$.targets[1].location").value("s3://flows-bucket/flows/orders/"))
                .andExpect(jsonPath("$.targets[1].error").doesNotExist());

        assertThat(GIT.read("main", "flows/orders/orders.camel.yaml")).contains("platform-http:/orders");
        assertThat(S3.objects.get("flows/orders/orders.camel.yaml"))
                .isEqualTo(GIT.read("main", "flows/orders/orders.camel.yaml"));
        assertThat(S3.objects).containsKey("flows/orders/echo-flow.json");
        mvc.perform(as(get("/api/flows/{id}/history", id)))
                .andExpect(jsonPath("$[0].targets[*].target").value(org.hamcrest.Matchers.contains("git", "s3")));
    }

    @Test
    void aFailingTargetDoesNotStopTheOthers() throws Exception {
        long id = create("refunds");
        S3.failing = true;

        mvc.perform(as(post("/api/flows/{id}/publish", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targets[0].error").doesNotExist())
                .andExpect(jsonPath("$.targets[1].error", containsString("503")));
        assertThat(GIT.files("main")).contains("flows/refunds/refunds.camel.yaml");
        mvc.perform(as(get("/api/flows/{id}/history", id)))
                .andExpect(jsonPath("$[0].targets[1].error", containsString("ServiceUnavailable")));

        // Publishing again once S3 is back fills it in.
        S3.failing = false;
        mvc.perform(as(post("/api/flows/{id}/publish", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targets[1].changed").value(true));
        assertThat(S3.objects).containsKey("flows/refunds/refunds.camel.yaml");
    }

    @Test
    void deleteRemovesTheFlowFromEveryTarget() throws Exception {
        long id = create("payments");
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());

        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());

        assertThat(GIT.files("main")).noneMatch(f -> f.startsWith("flows/payments/"));
        assertThat(S3.objects).isEmpty();
    }

    @Test
    void aFailedDeleteKeepsTheDraftToTryAgain() throws Exception {
        long id = create("invoices");
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());
        S3.failing = true;

        mvc.perform(as(delete("/api/published-flows/invoices")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.detail", containsString("S3: S3 error")));
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(status().isOk());

        S3.failing = false;
        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());
        assertThat(S3.objects).isEmpty();
    }
}
