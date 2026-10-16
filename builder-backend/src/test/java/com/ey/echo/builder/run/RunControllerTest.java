package com.ey.echo.builder.run;

import static org.hamcrest.Matchers.hasItem;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** The editor's Run button through the REST API: validate, start, call, read the log, stop. */
@SpringBootTest(properties = {"echo.run.first-port=18091", "echo.run.last-port=18095"})
@AutoConfigureMockMvc
class RunControllerTest {

    private static final String PING = """
            - route:
                id: ping
                from:
                  uri: platform-http:/ping
                  parameters:
                    httpMethodRestrict: POST
                  steps:
                    - log:
                        message: "ping ${body}"
                    - setBody:
                        simple: '{"reply":"pong"}'
            """;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FlowRepository flows;

    @Autowired
    private FlowRunner runner;

    @AfterEach
    void clean() {
        runner.stopAll();
        flows.deleteAll();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long create(String name, String route) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\"}".formatted(name)))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        mvc.perform(as(put("/api/flows/{id}/files/{file}", id, name + ".camel.yaml"))
                        .contentType(MediaType.TEXT_PLAIN).content(route))
                .andExpect(status().isNoContent());
        return id;
    }

    @Test
    void runsADraftAndSendsItARequest() throws Exception {
        long id = create("ping", PING);

        mvc.perform(as(get("/api/flows/{id}/run", id))).andExpect(status().isNoContent());

        mvc.perform(as(post("/api/flows/{id}/run", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.port").value(18091))
                .andExpect(jsonPath("$.url").value("http://localhost:18091"))
                .andExpect(jsonPath("$.endpoints[0].path").value("/ping"))
                .andExpect(jsonPath("$.endpoints[0].methods[0]").value("POST"))
                .andExpect(jsonPath("$.endpoints[0].url").value("http://localhost:18091/ping"))
                .andExpect(jsonPath("$.startedBy").value("designer"));

        mvc.perform(as(post("/api/flows/{id}/run/request", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"POST\",\"path\":\"/ping\",\"body\":\"{\\\"hello\\\":1}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(200))
                .andExpect(jsonPath("$.body").value("{\"reply\":\"pong\"}"));

        mvc.perform(as(get("/api/flows/{id}/run/log", id)))
                .andExpect(jsonPath("$[*].message", hasItem("ping {\"hello\":1}")));

        mvc.perform(as(delete("/api/flows/{id}/run", id))).andExpect(status().isNoContent());
        mvc.perform(as(get("/api/flows/{id}/run", id))).andExpect(status().isNoContent());
    }

    @Test
    void anInvalidDraftIsNotStarted() throws Exception {
        long id = create("bad", PING.replace("platform-http:/ping", "kafka:orders"));

        mvc.perform(as(post("/api/flows/{id}/run", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.valid").value(false));
        mvc.perform(as(get("/api/flows/{id}/run", id))).andExpect(status().isNoContent());
    }

    @Test
    void sendingToAFlowThatIsNotRunningSaysSo() throws Exception {
        long id = create("idle", PING);

        mvc.perform(as(post("/api/flows/{id}/run/request", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"POST\",\"path\":\"/ping\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("The flow is not running. Choose Run first."));
    }

    @Test
    void settingsTellTheEditorRunIsAvailable() throws Exception {
        mvc.perform(as(get("/api/editor/settings"))).andExpect(jsonPath("$.runEnabled").value(true));
    }
}
