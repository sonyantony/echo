package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ey.echo.builder.flow.FlowArchive;
import com.ey.echo.builder.flow.FlowRepository;
import com.jayway.jsonpath.JsonPath;
import java.io.ByteArrayInputStream;
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

/** Lists, opens and deletes flows as they are in Git (a local bare repository). */
@SpringBootTest
@AutoConfigureMockMvc
class PublishedFlowControllerTest {

    private static final Path TMP;
    private static final GitTestRepo REMOTE;

    static {
        try {
            TMP = Files.createTempDirectory("echo-published-test");
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
    void clean() throws Exception {
        flows.deleteAll();
        // start every test from an empty flows folder
        for (var folder : publisher.list()) {
            publisher.remove(folder.name(), "test", "Clean up " + folder.name());
        }
    }

    @Autowired
    private JGitPublisher publisher;

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long createAndPublish(String name) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"description\":\"Demo %s\"}".formatted(name, name)))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());
        return id;
    }

    @Test
    void listsPublishedFlowsLinkedToTheirDrafts() throws Exception {
        long orders = createAndPublish("orders");
        long refunds = createAndPublish("refunds");
        mvc.perform(as(put("/api/flows/{id}/files/application.properties", refunds))
                .contentType(MediaType.TEXT_PLAIN).content("x=1\n")).andExpect(status().isNoContent());
        publisher.publish("legacy", null, java.util.Map.of("legacy.camel.yaml", "- route: {}\n"), "someone",
                "Added in Git");

        mvc.perform(as(get("/api/published-flows")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].name").value("legacy"))
                .andExpect(jsonPath("$[0].flowId").doesNotExist())
                .andExpect(jsonPath("$[0].version").doesNotExist())
                .andExpect(jsonPath("$[0].target").value("Git"))
                .andExpect(jsonPath("$[1].name").value("orders"))
                .andExpect(jsonPath("$[1].flowId").value(orders))
                .andExpect(jsonPath("$[1].draftChanged").value(false))
                .andExpect(jsonPath("$[1].version").value(1))
                .andExpect(jsonPath("$[1].publishedBy").value("designer"))
                .andExpect(jsonPath("$[1].description").value("Demo orders"))
                .andExpect(jsonPath("$[2].flowId").value(refunds))
                .andExpect(jsonPath("$[2].draftChanged").value(true));
    }

    @Test
    void theDisplayNameGoesToGitAndComesBackWithTheDraft() throws Exception {
        long id = createAndPublish("Customer Refunds");
        assertThat(REMOTE.read("main", "flows/customer-refunds/echo-flow.json"))
                .contains("\"name\" : \"customer-refunds\"", "\"displayName\" : \"Customer Refunds\"");
        mvc.perform(as(get("/api/published-flows")))
                .andExpect(jsonPath("$[0].name").value("customer-refunds"))
                .andExpect(jsonPath("$[0].displayName").value("Customer Refunds"));

        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());
        publisher.publish("customer-refunds", null, java.util.Map.of(
                "customer-refunds.camel.yaml", "- route: {}\n",
                "echo-flow.json", "{\"name\":\"customer-refunds\",\"displayName\":\"Customer Refunds\"}"),
                "someone", "Back in Git");
        mvc.perform(as(post("/api/published-flows/customer-refunds/draft")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("customer-refunds"))
                .andExpect(jsonPath("$.displayName").value("Customer Refunds"));
    }

    @Test
    void opensAGitOnlyFlowAsANewDraft() throws Exception {
        publisher.publish("legacy", null, java.util.Map.of("legacy.camel.yaml", "- route: {}\n",
                "echo-flow.json", "{\"description\":\"Old one\"}"), "someone", "Added in Git");

        var body = mvc.perform(as(post("/api/published-flows/legacy/draft")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("legacy"))
                .andExpect(jsonPath("$.description").value("Old one"))
                .andExpect(jsonPath("$.files", hasSize(1)))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();

        mvc.perform(as(get("/api/published-flows"))).andExpect(jsonPath("$[0].flowId").value(id));
        mvc.perform(as(post("/api/published-flows/legacy/draft"))).andExpect(status().isConflict());
        mvc.perform(as(post("/api/published-flows/missing/draft"))).andExpect(status().isNotFound());
    }

    @Test
    void replacesAChangedDraftWithThePublishedVersion() throws Exception {
        long refunds = createAndPublish("refunds");
        mvc.perform(as(put("/api/flows/{id}/files/application.properties", refunds))
                .contentType(MediaType.TEXT_PLAIN).content("x=1\n")).andExpect(status().isNoContent());
        mvc.perform(as(put("/api/flows/{id}/files/extra.schema.json", refunds))
                .contentType(MediaType.TEXT_PLAIN).content("{}")).andExpect(status().isNoContent());

        mvc.perform(as(post("/api/published-flows/refunds/draft").param("replace", "true")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(refunds))
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.files", hasSize(2)));
        mvc.perform(as(get("/api/flows/{id}/files/application.properties", refunds)))
                .andExpect(status().isOk())
                .andExpect(result -> assertThat(result.getResponse().getContentAsString()).doesNotContain("x=1"));
        mvc.perform(as(get("/api/published-flows"))).andExpect(jsonPath("$[0].draftChanged").value(false));
        assertThat(flows.count()).isEqualTo(1);
    }

    @Test
    void downloadsThePublishedFlow() throws Exception {
        createAndPublish("orders");

        var zip = mvc.perform(as(get("/api/published-flows/orders/download")))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"orders.zip\""))
                .andReturn().getResponse().getContentAsByteArray();
        var contents = FlowArchive.read(new ByteArrayInputStream(zip));
        assertThat(contents.name()).isEqualTo("orders");
        assertThat(contents.files()).containsKey("orders.camel.yaml").doesNotContainKey("echo-flow.json");
    }

    @Test
    void deletingAPublishedFlowRemovesItFromGitAndTheBuilder() throws Exception {
        long id = createAndPublish("orders");
        publisher.publish("legacy", null, java.util.Map.of("legacy.camel.yaml", "- route: {}\n"), "someone",
                "Added in Git");

        mvc.perform(as(delete("/api/published-flows/orders"))).andExpect(status().isNoContent());
        mvc.perform(as(delete("/api/published-flows/legacy"))).andExpect(status().isNoContent());

        assertThat(REMOTE.files("main")).noneMatch(f -> f.startsWith("flows/"));
        assertThat(REMOTE.head("main").getAuthorIdent().getName()).isEqualTo("designer");
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(status().isNotFound());
        mvc.perform(as(delete("/api/published-flows/orders"))).andExpect(status().isNotFound());
    }

    @Test
    void disablingAFlowKeepsItInGitMarkedDisabledUntilEnabled() throws Exception {
        long id = createAndPublish("orders");

        mvc.perform(as(post("/api/published-flows/orders/disable"))).andExpect(status().isNoContent());
        assertThat(REMOTE.read("main", "flows/orders/echo-flow.json")).contains("\"disabled\" : true");
        assertThat(REMOTE.files("main")).contains("flows/orders/orders.camel.yaml");
        assertThat(REMOTE.head("main").getFullMessage()).isEqualTo("Disable flow orders");
        mvc.perform(as(get("/api/published-flows"))).andExpect(jsonPath("$[0].disabled").value(true));

        // A new version stays disabled.
        mvc.perform(as(put("/api/flows/{id}/files/application.properties", id))
                .contentType(MediaType.TEXT_PLAIN).content("x=1\n")).andExpect(status().isNoContent());
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());
        assertThat(REMOTE.read("main", "flows/orders/echo-flow.json")).contains("\"version\" : 2")
                .contains("\"disabled\" : true");

        mvc.perform(as(post("/api/published-flows/orders/enable"))).andExpect(status().isNoContent());
        assertThat(REMOTE.read("main", "flows/orders/echo-flow.json")).doesNotContain("disabled")
                .contains("\"version\" : 2");
        mvc.perform(as(get("/api/published-flows"))).andExpect(jsonPath("$[0].disabled").value(false));
        mvc.perform(as(post("/api/published-flows/missing/disable"))).andExpect(status().isNotFound());
    }
}
