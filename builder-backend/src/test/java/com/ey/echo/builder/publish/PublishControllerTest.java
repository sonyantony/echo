package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ey.echo.builder.flow.FlowRepository;
import com.jayway.jsonpath.JsonPath;
import java.nio.file.Files;
import java.nio.file.Path;
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

/** Publishes through the REST API to a local bare repository (no external Git server). */
@SpringBootTest
@AutoConfigureMockMvc
class PublishControllerTest {

    private static final Path TMP;
    private static final GitTestRepo REMOTE;

    static {
        try {
            TMP = Files.createTempDirectory("echo-publish-test");
            REMOTE = new GitTestRepo(TMP.resolve("flows.git"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void git(DynamicPropertyRegistry registry) {
        registry.add("echo.git.url", REMOTE::url);
        registry.add("echo.git.workdir", () -> TMP.resolve("workdir").toString());
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FlowRepository flows;

    @BeforeEach
    void clean() {
        flows.deleteAll();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long create(String name) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"description\":\"Demo\"}".formatted(name)))
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(body, "$.id")).longValue();
    }

    @Test
    void publishesAValidFlowToGit() throws Exception {
        long id = create("orders");

        var body = mvc.perform(as(post("/api/flows/{id}/publish", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"First version of orders\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.branch").value("main"))
                .andExpect(jsonPath("$.publishedBy").value("designer"))
                .andExpect(jsonPath("$.changed").value(true))
                .andReturn().getResponse().getContentAsString();
        String sha = JsonPath.read(body, "$.commitSha");

        var head = REMOTE.head("main");
        assertThat(head.getName()).isEqualTo(sha);
        assertThat(head.getFullMessage()).isEqualTo("First version of orders");
        assertThat(head.getAuthorIdent().getName()).isEqualTo("designer");
        assertThat(REMOTE.read("main", "flows/orders/orders.camel.yaml")).contains("platform-http:/orders");
        assertThat(REMOTE.read("main", "flows/orders/echo-flow.json"))
                .contains("\"name\" : \"orders\"", "\"version\" : 1", "\"author\" : \"designer\"");

        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.status").value("PUBLISHED"));
        mvc.perform(as(get("/api/flows/{id}/history", id)))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].commitSha").value(sha))
                .andExpect(jsonPath("$[0].message").value("First version of orders"));
    }

    @Test
    void editingAPublishedFlowMakesItADraftAgainAndRepublishingAddsHistory() throws Exception {
        long id = create("refunds");
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());

        mvc.perform(as(put("/api/flows/{id}/files/application.properties", id)).contentType(MediaType.TEXT_PLAIN)
                .content("refund.limit=100\n")).andExpect(status().isNoContent());
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.status").value("DRAFT"));

        mvc.perform(as(post("/api/flows/{id}/publish", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Publish flow refunds (version 2)"));
        mvc.perform(as(get("/api/flows/{id}/history", id))).andExpect(jsonPath("$", hasSize(2)));
        assertThat(REMOTE.read("main", "flows/refunds/application.properties")).isEqualTo("refund.limit=100\n");
    }

    @Test
    void invalidFlowsAreNotPublished() throws Exception {
        long id = create("broken");
        var before = REMOTE.head("main");
        mvc.perform(as(put("/api/flows/{id}/files/broken.camel.yaml", id)).contentType(MediaType.TEXT_PLAIN)
                .content("- route:\n    from:\n      uri: kafka:in\n      steps: []\n")).andExpect(status().isNoContent());

        mvc.perform(as(post("/api/flows/{id}/publish", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.problems[0].message", containsString("kafka")));
        var after = REMOTE.head("main");
        assertThat(after == null ? null : after.getName()).isEqualTo(before == null ? null : before.getName());
    }
}
