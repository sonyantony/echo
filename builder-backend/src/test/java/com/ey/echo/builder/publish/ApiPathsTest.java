package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ey.echo.builder.flow.FlowArchive;
import com.ey.echo.builder.flow.FlowRepository;
import com.jayway.jsonpath.JsonPath;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** A path is in one flow only: Interface asks, spec saves and uploads are refused (ApiPaths). */
@SpringBootTest
@AutoConfigureMockMvc
class ApiPathsTest {

    private static final Path TMP;
    private static final GitTestRepo REMOTE;

    static {
        try {
            TMP = Files.createTempDirectory("echo-paths-test");
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
        for (var folder : publisher.list()) {
            publisher.remove(folder.name(), "test", "Clean up " + folder.name());
        }
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private static String spec(String base, String... paths) {
        var out = new StringBuilder("openapi: 3.0.3\ninfo: {title: T, version: '1'}\n");
        if (base != null) {
            out.append("servers: [{url: '").append(base).append("'}]\n");
        }
        out.append("paths:\n");
        for (String p : paths) {
            String[] mp = p.split(" ");
            out.append("  '").append(mp[1]).append("':\n    ").append(mp[0])
                    .append(":\n      responses: {'200': {description: ok}}\n");
        }
        return out.toString();
    }

    private long create(String name, String spec) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\"}".formatted(name)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        if (spec != null) {
            mvc.perform(as(put("/api/flows/{id}/api-spec/{n}", id, name.toLowerCase().replace(' ', '-') + "-api.yaml"))
                    .contentType(MediaType.TEXT_PLAIN).content(spec)).andExpect(status().isOk());
        }
        return id;
    }

    @Test
    void aPathWithOrWithoutTrailingParametersBelongsToOneFlowWhateverTheMethodAndBasePathSplit() throws Exception {
        long reader = create("Order Reader", spec("/shop", "get /orders/{id}"));
        long writer = create("Order Writer", null);

        // Same Base Path + path, another method; also / + /shop/orders: both are /shop/orders.
        mvc.perform(as(post("/api/flows/{id}/path-clashes", writer)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"spec\":%s}".formatted(json(spec("/", "post /shop/orders", "get /shop/carts")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].path").value("/shop/orders"))
                .andExpect(jsonPath("$[0].otherPath").value("/shop/orders/{id}"))
                .andExpect(jsonPath("$[0].flowName").value("Order Reader"))
                .andExpect(jsonPath("$[0].flowId").value(reader));
        // Only the paths asked about.
        mvc.perform(as(post("/api/flows/{id}/path-clashes", writer)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"spec\":%s,\"paths\":[\"/shop/carts\"]}".formatted(json(spec("/", "post /shop/orders", "get /shop/carts")))))
                .andExpect(jsonPath("$", hasSize(0)));
        // The flow's own paths do not count.
        mvc.perform(as(post("/api/flows/{id}/path-clashes", reader)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"spec\":%s}".formatted(json(spec("/shop", "get /orders/{id}", "put /orders/{id}")))))
                .andExpect(jsonPath("$", hasSize(0)));

        // Saving a spec with it is refused.
        mvc.perform(as(put("/api/flows/{id}/api-spec/writer.yaml", writer)).contentType(MediaType.TEXT_PLAIN)
                        .content(spec("/shop", "post /orders")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("The spec cannot be saved: it has paths other flows have: "
                        + "/shop/orders (in flow Order Reader). A path can be in one flow only."))
                .andExpect(jsonPath("$.pathClashes[0].flowId").value(reader));
        mvc.perform(as(put("/api/flows/{id}/api-spec/writer.yaml", writer)).contentType(MediaType.TEXT_PLAIN)
                        .content(spec("/shop", "post /payments")))
                .andExpect(status().isOk());
    }

    @Test
    void pathsAFlowHadAlreadyStaySaveable() throws Exception {
        long a = create("A", spec("/x", "get /items"));
        long b = create("B", spec("/y", "get /items"));
        // B's spec written as a plain file (as an older Builder could): its path, now A's too, stays saveable.
        mvc.perform(as(put("/api/flows/{id}/files/b-api.yaml", b)).contentType(MediaType.TEXT_PLAIN)
                .content(spec("/x", "get /items"))).andExpect(status().isNoContent());
        mvc.perform(as(put("/api/flows/{id}/api-spec/b-api.yaml", b)).contentType(MediaType.TEXT_PLAIN)
                        .content(spec("/x", "get /items", "post /items")))
                .andExpect(status().isOk());
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void aPublishedOnlyFlowsPathsCountAndAnUploadWithThemIsRefused() throws Exception {
        publisher.publish("legacy", null, Map.of(
                "legacy.camel.yaml", "- rest:\n    id: echo-openapi\n    openApi:\n      specification: legacy-api.yaml\n",
                "legacy-api.yaml", spec("/old", "get /things"),
                "echo-flow.json", "{\"displayName\":\"Legacy Things\"}"), "someone", "Added in Git");
        long mine = create("Mine", null);
        mvc.perform(as(post("/api/flows/{id}/path-clashes", mine)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"spec\":%s}".formatted(json(spec("/old", "delete /things/{id}")))))
                .andExpect(jsonPath("$[0].flowName").value("Legacy Things"))
                .andExpect(jsonPath("$[0].folder").value("legacy"))
                .andExpect(jsonPath("$[0].flowId").doesNotExist());

        var zip = new ByteArrayOutputStream();
        FlowArchive.write("copy", Map.of("copy.camel.yaml", "- route:\n    from:\n      uri: direct:x\n      steps: []\n",
                "copy-api.yaml", spec("/old", "post /things")), zip);
        mvc.perform(as(multipart("/api/flows/upload")
                        .file(new MockMultipartFile("file", "copy.zip", "application/zip", zip.toByteArray()))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("This flow cannot be uploaded: its spec has paths other flows have: "
                        + "/old/things (in flow Legacy Things). A path can be in one flow only."));
        mvc.perform(as(get("/api/flows"))).andExpect(jsonPath("$", hasSize(1))); // nothing kept
    }

    private static String json(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }
}
