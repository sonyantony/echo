package com.ey.echo.builder.apis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ey.echo.builder.flow.FlowRepository;
import com.ey.echo.builder.publish.GitTestRepo;
import com.ey.echo.builder.run.FlowRunner;
import com.jayway.jsonpath.JsonPath;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
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

/** A flow calling an approved API: Run calls the right URL, Publish puts the spec in the flow folder. */
@SpringBootTest(properties = {
    "echo.run.first-port=18096", "echo.run.last-port=18099",
    "echo.apis.only=true",
    "echo.apis.specs[0].id=inventory",
    "echo.apis.specs[0].name=Inventory",
    "echo.apis.specs[0].file=src/test/resources/apis/inventory.yaml",
    "echo.apis.specs[0].allowed-tags=TMF638 Service Controller"
})
@AutoConfigureMockMvc
class ApprovedApiFlowTest {

    private static final Path TMP;
    private static final GitTestRepo REMOTE;

    static {
        try {
            TMP = Files.createTempDirectory("echo-apis-test");
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

    private static final String ROUTE = """
            - route:
                id: services
                from:
                  uri: platform-http:/services
                  steps:
                    - removeHeaders:
                        pattern: "*"
                    - setHeader:
                        name: Authorization
                        simple: "Bearer {{inventory.token}}"
                    - to:
                        uri: rest-openapi
                        parameters:
                          specificationUri: inventory.openapi.json
                          operationId: createService
                          host: "{{inventory.host}}"
            """;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FlowRepository flows;

    @Autowired
    private FlowRunner runner;

    private final List<String> calls = new CopyOnWriteArrayList<>();
    private HttpServer inventory;

    @BeforeEach
    void startInventory() throws Exception {
        inventory = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        inventory.createContext("/", exchange -> {
            calls.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath() + " "
                    + exchange.getRequestHeaders().getFirst("Authorization") + " "
                    + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] reply = "{\"id\":\"SVC-1\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, reply.length);
            exchange.getResponseBody().write(reply);
            exchange.close();
        });
        inventory.start();
    }

    @AfterEach
    void clean() {
        runner.stopAll();
        inventory.stop(0);
        flows.deleteAll();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long create(String name) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\"}".formatted(name)))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        put(id, name + ".camel.yaml", ROUTE);
        put(id, "application.properties", "inventory.host=http://localhost:%d\ninventory.token=t0k3n\n"
                .formatted(inventory.getAddress().getPort()));
        return id;
    }

    private void put(long id, String file, String content) throws Exception {
        mvc.perform(as(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/flows/{id}/files/{file}", id, file))
                        .contentType(MediaType.TEXT_PLAIN).content(content))
                .andExpect(status().isNoContent());
    }

    @Test
    void runCallsTheOperationAtTheSpecsPath() throws Exception {
        long id = create("services");

        mvc.perform(as(post("/api/flows/{id}/run", id))).andExpect(status().isOk());
        mvc.perform(as(post("/api/flows/{id}/run/request", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"POST\",\"path\":\"/services\",\"body\":\"{\\\"@type\\\":\\\"L3VPN\\\"}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(201))
                .andExpect(jsonPath("$.body").value("{\"id\":\"SVC-1\"}"));

        assertThat(calls).containsExactly("POST /inventory-api/v1/service Bearer t0k3n {\"@type\":\"L3VPN\"}");
    }

    @Test
    void publishPutsTheApprovedSpecInTheFlowFolder() throws Exception {
        long id = create("services");

        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isOk());

        assertThat(REMOTE.read("main", "flows/services/inventory.openapi.json"))
                .contains("\"operationId\" : \"createService\"");
    }

    @Test
    void aDisallowedOperationIsNotRunOrPublished() throws Exception {
        long id = create("services");
        put(id, "services.camel.yaml", ROUTE.replace("createService", "init"));

        mvc.perform(as(post("/api/flows/{id}/run", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.problems[0].message").value(
                        "Flows may not call Inventory's 'init' operation (POST /shutdown/init). Allowed: createService, getService."));
        mvc.perform(as(post("/api/flows/{id}/publish", id))).andExpect(status().isUnprocessableEntity());
    }
}
