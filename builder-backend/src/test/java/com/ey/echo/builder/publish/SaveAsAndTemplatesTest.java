package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
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

/** Save As (a draft under another name), Save As Template and Open Template (templates/ in Git). */
@SpringBootTest
@AutoConfigureMockMvc
class SaveAsAndTemplatesTest {

    private static final Path TMP;
    private static final GitTestRepo REMOTE;

    static {
        try {
            TMP = Files.createTempDirectory("echo-templates-test");
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

    @Autowired
    private JGitPublisher publisher;

    @BeforeEach
    void clean() {
        flows.deleteAll();
        for (var folder : publisher.templates().list()) {
            publisher.templates().remove(folder.name(), "test", "Clean up " + folder.name());
        }
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long create(String name) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"description\":\"Demo %s\"}".formatted(name, name)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        mvc.perform(as(put("/api/flows/%d/files/kaoto-datamapper-1.xsl".formatted(id))).content("<xsl/>"))
                .andExpect(status().isNoContent());
        return id;
    }

    private String read(long id, String path) throws Exception {
        return mvc.perform(as(get("/api/flows/%d/files/%s".formatted(id, path))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    @Test
    void saveAsCopiesTheFlowWithTheOnScreenRouteAndRenamedRouteFile() throws Exception {
        long id = create("orders");
        var body = mvc.perform(as(post("/api/flows/%d/save-as".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"orders-copy\",\"routeContent\":\"- route: {id: edited}\\n\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("orders-copy"))
                .andExpect(jsonPath("$.routeFile").value("orders-copy.camel.yaml"))
                .andExpect(jsonPath("$.description").value("Demo orders"))
                .andReturn().getResponse().getContentAsString();
        long copy = ((Number) JsonPath.read(body, "$.id")).longValue();
        assertThat(read(copy, "orders-copy.camel.yaml")).contains("edited");
        assertThat(read(copy, "kaoto-datamapper-1.xsl")).isEqualTo("<xsl/>");
        assertThat(read(id, "orders.camel.yaml")).doesNotContain("edited"); // the source keeps its saved state
    }

    @Test
    void saveAsAsksBeforeReplacingAnExistingDraft() throws Exception {
        long id = create("orders");
        long other = create("billing");
        String request = "{\"name\":\"billing\",\"routeContent\":\"- route: {id: replaced}\\n\"%s}";
        mvc.perform(as(post("/api/flows/%d/save-as".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content(request.formatted("")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.confirmOverwrite").value(true));
        assertThat(read(other, "billing.camel.yaml")).doesNotContain("replaced");

        mvc.perform(as(post("/api/flows/%d/save-as".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content(request.formatted(",\"overwrite\":true")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(other));
        assertThat(read(other, "billing.camel.yaml")).contains("replaced");
        assertThat(read(other, "kaoto-datamapper-1.xsl")).isEqualTo("<xsl/>");
    }

    @Test
    void savesATemplateInGitNextToTheFlowsFolderAndOpensItAsANewDraft() throws Exception {
        long id = create("orders");
        mvc.perform(as(post("/api/templates/from-flow/%d".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"http-json\",\"routeContent\":\"- route: {id: tpl}\\n\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("http-json"));
        assertThat(REMOTE.files("main")).contains("templates/http-json/http-json.camel.yaml",
                "templates/http-json/kaoto-datamapper-1.xsl", "templates/http-json/echo-template.json");
        assertThat(REMOTE.files("main")).noneMatch(f -> f.startsWith("flows/"));

        mvc.perform(as(get("/api/templates")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("http-json"))
                .andExpect(jsonPath("$[0].savedBy").value("designer"));

        var body = mvc.perform(as(post("/api/templates/http-json/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"payments\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("payments"))
                .andExpect(jsonPath("$.files").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.hasItem("echo-template.json"))))
                .andReturn().getResponse().getContentAsString();
        long flow = ((Number) JsonPath.read(body, "$.id")).longValue();
        assertThat(read(flow, "payments.camel.yaml")).contains("tpl");

        // Opening never overwrites a flow.
        mvc.perform(as(post("/api/templates/http-json/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"payments\"}"))
                .andExpect(status().isConflict());
        // Templates are not flows: the Flows page does not list them.
        mvc.perform(as(get("/api/published-flows"))).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void saveAsTemplateAsksBeforeReplacingATemplate() throws Exception {
        long id = create("orders");
        String request = "{\"name\":\"http-json\",\"routeContent\":\"- route: {id: v%d}\\n\"%s}";
        mvc.perform(as(post("/api/templates/from-flow/%d".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                .content(request.formatted(1, ""))).andExpect(status().isOk());
        mvc.perform(as(post("/api/templates/from-flow/%d".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content(request.formatted(2, "")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.confirmOverwrite").value(true));
        assertThat(REMOTE.read("main", "templates/http-json/http-json.camel.yaml")).contains("v1");

        mvc.perform(as(post("/api/templates/from-flow/%d".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                .content(request.formatted(2, ",\"overwrite\":true"))).andExpect(status().isOk());
        assertThat(REMOTE.read("main", "templates/http-json/http-json.camel.yaml")).contains("v2");
    }

    @Test
    void saveAsTakesAnyNameAndMatchesExistingFlowsByName() throws Exception {
        long id = create("orders");
        mvc.perform(as(post("/api/flows/%d/save-as".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Orders Copy\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("orders-copy"))
                .andExpect(jsonPath("$.displayName").value("Orders Copy"))
                .andExpect(jsonPath("$.routeFile").value("orders-copy.camel.yaml"));
        // The same name in other letter case is that flow: replacing it is asked first.
        mvc.perform(as(post("/api/flows/%d/save-as".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"orders copy\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("A flow named 'Orders Copy' already exists. Replace it?"));
        // Another name that makes the same ID gets a numbered ID.
        mvc.perform(as(post("/api/flows/%d/save-as".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Orders, copy\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("orders-copy-2"));
    }

    @Test
    void aTemplateMayHaveAnyNameAndIsKeptInAFolderMadeFromIt() throws Exception {
        long id = create("orders");
        mvc.perform(as(post("/api/templates/from-flow/%d".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"HTTP to JSON\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("http-to-json"))
                .andExpect(jsonPath("$.displayName").value("HTTP to JSON"));
        assertThat(REMOTE.read("main", "templates/http-to-json/echo-template.json"))
                .contains("\"displayName\" : \"HTTP to JSON\"");
        mvc.perform(as(get("/api/templates"))).andExpect(jsonPath("$[0].displayName").value("HTTP to JSON"));
        mvc.perform(as(post("/api/templates/from-flow/%d".formatted(id))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"http to json\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("A template named 'HTTP to JSON' already exists. Replace it?"));

        mvc.perform(as(post("/api/templates/http-to-json/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"My Payments\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("my-payments"))
                .andExpect(jsonPath("$.displayName").value("My Payments"))
                .andExpect(jsonPath("$.routeFile").value("my-payments.camel.yaml"));
    }
}
