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
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        // A new flow has no routes: give it one serving POST /<name>.
        mvc.perform(as(put("/api/flows/{id}/files/{file}", id, name + ".camel.yaml")).contentType(MediaType.TEXT_PLAIN)
                .content("- route:\n    from:\n      uri: platform-http:/%s\n      parameters:\n".formatted(name)
                        + "        httpMethodRestrict: POST\n      steps:\n        - log:\n            message: hi\n"))
                .andExpect(status().isNoContent());
        return id;
    }

    @Test
    void publishesAValidFlowToGit() throws Exception {
        long id = create("orders");

        var body = mvc.perform(as(post("/api/flows/{id}/publish", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"First version of orders\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targets", hasSize(1)))
                .andExpect(jsonPath("$.targets[0].target").value("git"))
                .andExpect(jsonPath("$.targets[0].name").value("Git"))
                .andExpect(jsonPath("$.targets[0].location").value("main"))
                .andExpect(jsonPath("$.publishedBy").value("designer"))
                .andExpect(jsonPath("$.changed").value(true))
                .andReturn().getResponse().getContentAsString();
        String sha = JsonPath.read(body, "$.targets[0].revision");

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
                .andExpect(jsonPath("$[0].targets[0].revision").value(sha))
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

    @Test
    void aFlowServingAPathAPublishedFlowServesIsNotPublished() throws Exception {
        long first = create("shipments");
        mvc.perform(as(post("/api/flows/{id}/publish", first))).andExpect(status().isOk());
        long second = create("shipments-copy");
        mvc.perform(as(put("/api/flows/{id}/files/shipments-copy.camel.yaml", second)).contentType(MediaType.TEXT_PLAIN)
                .content("- route:\n    from:\n      uri: platform-http:/shipments\n      parameters:\n"
                        + "        httpMethodRestrict: POST\n      steps:\n        - log:\n            message: hi\n"))
                .andExpect(status().isNoContent());
        var before = REMOTE.head("main");

        mvc.perform(as(post("/api/flows/{id}/publish", second)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.clashes[0]").value("POST /shipments is already used by flow shipments"));
        assertThat(REMOTE.head("main").getName()).isEqualTo(before.getName());
        // Publishing the first flow again does not clash with its own published version.
        mvc.perform(as(post("/api/flows/{id}/publish", first))).andExpect(status().isOk());
    }

    @Test
    void operationsWithoutARouteAreListedUntilTheUserSaysPublishAnyway() throws Exception {
        long id = create("cards");
        mvc.perform(as(put("/api/flows/{id}/api-spec/cards-api.yaml", id)).contentType(MediaType.TEXT_PLAIN)
                .content("""
                        openapi: 3.0.3
                        info: {title: Cards, version: 1.0.0}
                        servers: [{url: /cards-api}]
                        paths:
                          /cards:
                            get:
                              operationId: getCards
                              responses: {"200": {description: ok}}
                          /cards/{id}:
                            delete:
                              responses: {"204": {description: gone}}
                        """))
                .andExpect(status().isOk());
        mvc.perform(as(put("/api/flows/{id}/files/cards.camel.yaml", id)).contentType(MediaType.TEXT_PLAIN)
                .content("- route:\n    from:\n      uri: direct\n      parameters:\n        name: getCards\n"
                        + "      steps:\n        - log:\n            message: hi\n"))
                .andExpect(status().isNoContent());
        var before = REMOTE.head("main");

        mvc.perform(as(post("/api/flows/{id}/publish", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"allowMissingRoutes\":false}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.missingRoutes", hasSize(1)))
                .andExpect(jsonPath("$.missingRoutes[0].method").value("DELETE"))
                .andExpect(jsonPath("$.missingRoutes[0].path").value("/cards/{id}"))
                .andExpect(jsonPath("$.missingRoutes[0].operationId").value("deleteCardsId"))
                .andExpect(jsonPath("$.missingRoutes[0].disabled").value(false));
        var after = REMOTE.head("main");
        assertThat(after == null ? null : after.getName()).isEqualTo(before == null ? null : before.getName());

        mvc.perform(as(post("/api/flows/{id}/publish", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"allowMissingRoutes\":true}"))
                .andExpect(status().isOk());
        assertThat(REMOTE.read("main", "flows/cards/cards-api.yaml")).contains("operationId: deleteCardsId");
        assertThat(REMOTE.read("main", "flows/cards/cards.camel.yaml")).contains("echo-missing-deleteCardsId")
                .doesNotContain("echo-missing-getCards");
    }

    @Test
    void deletingAPublishedFlowRemovesItFromTheBuilderAndFromGit() throws Exception {
        long id = create("payments");
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());
        assertThat(REMOTE.files("main")).contains("flows/payments/payments.camel.yaml");

        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());

        assertThat(REMOTE.files("main")).noneMatch(f -> f.startsWith("flows/payments/"));
        assertThat(REMOTE.head("main").getFullMessage()).isEqualTo("Delete flow payments");
        assertThat(REMOTE.head("main").getAuthorIdent().getName()).isEqualTo("designer");
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(status().isNotFound());
    }

    @Test
    void deletingARenamedPublishedFlowRemovesThePublishedFolder() throws Exception {
        long id = create("invoices");
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());
        mvc.perform(as(put("/api/flows/{id}", id)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"billing\",\"description\":\"Demo\"}")).andExpect(status().isOk());

        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());

        assertThat(REMOTE.files("main")).noneMatch(f -> f.startsWith("flows/invoices/"));
    }

    @Test
    void deletingANeverPublishedFlowLeavesGitAlone() throws Exception {
        long id = create("drafty");
        var before = REMOTE.head("main");

        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());

        var after = REMOTE.head("main");
        assertThat(after == null ? null : after.getName()).isEqualTo(before == null ? null : before.getName());
    }
}
