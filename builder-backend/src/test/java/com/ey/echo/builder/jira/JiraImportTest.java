package com.ey.echo.builder.jira;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** Import From Jira against a fake Jira (the JDK's HTTP server), Cloud and Data Center. */
class JiraImportTest {

    /** A fake Jira: path -> JSON body; any other path is 404. Records the Authorization headers it got. */
    static final class FakeJira {
        final HttpServer server;
        final Map<String, String> answers = new java.util.concurrent.ConcurrentHashMap<>();
        final List<String> requests = new CopyOnWriteArrayList<>();
        final List<String> authorizations = new CopyOnWriteArrayList<>();

        FakeJira() {
            try {
                server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
            server.createContext("/", exchange -> {
                String uri = exchange.getRequestURI().toString();
                requests.add(uri);
                authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
                String path = exchange.getRequestURI().getPath();
                String body = answers.get(path);
                byte[] bytes = (body == null ? "{}" : body).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(body == null ? 404 : 200, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }
    }

    static final FakeJira JIRA = new FakeJira();

    @AfterAll
    static void stop() {
        JIRA.server.stop(0);
    }

    private static String request(String link) {
        return "{\"link\": \"" + link + "\"}";
    }

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    class Cloud {
        @DynamicPropertySource
        static void jira(DynamicPropertyRegistry registry) {
            registry.add("echo.jira.base-url", JIRA::url);
            registry.add("echo.jira.username", () -> "echo-bot@acme.com");
            registry.add("echo.jira.token", () -> "secret-token");
        }

        @Autowired
        private MockMvc mvc;

        @BeforeEach
        void story() {
            JIRA.answers.put("/rest/api/3/issue/PAY-142", """
                    {"key":"PAY-142","fields":{"summary":"Pay a bill","description":{"type":"doc","content":[
                      {"type":"paragraph","content":[{"type":"text","text":"POST /accounts/{id}/payments"},{"type":"hardBreak"},{"type":"text","text":"Request:"}]},
                      {"type":"codeBlock","content":[{"type":"text","text":"{\\"amount\\": 10}"}]}]}}}""");
            JIRA.answers.put("/rest/api/3/issue/PAY-142/comment", """
                    {"startAt":0,"maxResults":100,"total":1,"comments":[
                      {"author":{"displayName":"Priya Shah"},"created":"2026-10-14T09:12:00.000+0000",
                       "body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Response: {\\"paymentId\\": \\"p-1\\"}"}]}]}}]}""");
        }

        @Test
        void findsTheExamplesOfAStoryAndItsComments() throws Exception {
            mvc.perform(post("/api/jira/story-examples").with(user("designer").roles("DESIGNER")).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request(JIRA.url() + "/browse/PAY-142")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.key").value("PAY-142"))
                    .andExpect(jsonPath("$.summary").value("Pay a bill"))
                    .andExpect(jsonPath("$.link").value(JIRA.url() + "/browse/PAY-142"))
                    .andExpect(jsonPath("$.comments").value(1))
                    .andExpect(jsonPath("$.examples[1].source").value("Comment by Priya Shah, 14 Oct 2026"))
                    .andExpect(jsonPath("$.operations[0].method").value("POST"))
                    .andExpect(jsonPath("$.operations[0].path").value("/accounts/{id}/payments"))
                    .andExpect(jsonPath("$.operations[0].request").value(1))
                    .andExpect(jsonPath("$.operations[0].response").value(2));
            // Email + API token, as Basic auth.
            assertThat(JIRA.authorizations.getLast()).isEqualTo("Basic ZWNoby1ib3RAYWNtZS5jb206c2VjcmV0LXRva2Vu");
        }

        @Test
        void aStoryJiraDoesNotHaveIsSaidPlainly() throws Exception {
            mvc.perform(post("/api/jira/story-examples").with(user("designer").roles("DESIGNER")).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request("PAY-999")))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.detail").value("PAY-999 was not found, or ECHO's Jira account cannot see it."));
        }

        @Test
        void linksToOtherSitesAreNotFollowed() throws Exception {
            int before = JIRA.requests.size();
            mvc.perform(post("/api/jira/story-examples").with(user("designer").roles("DESIGNER")).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request("https://evil.example.com/browse/PAY-142")))
                    .andExpect(status().isBadRequest());
            assertThat(JIRA.requests).hasSize(before);
        }

        @Test
        void theEditorIsToldImportFromJiraIsOn() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.jiraImport").value(true));
        }

        @Test
        void needsALogin() throws Exception {
            mvc.perform(post("/api/jira/story-examples").with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request("PAY-142")))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    class DataCenter {
        @DynamicPropertySource
        static void jira(DynamicPropertyRegistry registry) {
            registry.add("echo.jira.base-url", JIRA::url);
            registry.add("echo.jira.deployment", () -> "data-center");
            registry.add("echo.jira.username", () -> "");
            registry.add("echo.jira.token", () -> "pat-123");
        }

        @Autowired
        private MockMvc mvc;

        @Test
        void readsWikiMarkupWithAPersonalAccessToken() throws Exception {
            JIRA.answers.put("/rest/api/2/issue/OPS-7", """
                    {"key":"OPS-7","fields":{"summary":"Cards","description":"GET /cards?status=ACTIVE\\nResponse:\\n{code:json}\\n[{\\"cardId\\": \\"c-1\\"}]\\n{code}"}}""");
            JIRA.answers.put("/rest/api/2/issue/OPS-7/comment", "{\"startAt\":0,\"maxResults\":100,\"total\":0,\"comments\":[]}");

            mvc.perform(post("/api/jira/story-examples").with(user("designer").roles("DESIGNER")).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request(JIRA.url() + "/browse/OPS-7")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.operations[0].method").value("GET"))
                    .andExpect(jsonPath("$.operations[0].path").value("/cards?status=ACTIVE"))
                    .andExpect(jsonPath("$.operations[0].response").value(1));
            assertThat(JIRA.authorizations.getLast()).isEqualTo("Bearer pat-123");
        }
    }

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    class WithAnAiEngine {
        @DynamicPropertySource
        static void jira(DynamicPropertyRegistry registry) {
            registry.add("echo.jira.base-url", JIRA::url);
            registry.add("echo.jira.username", () -> "echo-bot@acme.com");
            registry.add("echo.jira.token", () -> "secret-token");
            registry.add("echo.ai.provider", () -> "openai-compatible");
            registry.add("echo.ai.openai-compatible.base-url", () -> JIRA.url() + "/v1");
            registry.add("echo.ai.openai-compatible.api-key", () -> "sk-test");
            registry.add("echo.ai.openai-compatible.model", () -> "gpt-test");
        }

        @Autowired
        private MockMvc mvc;

        @Test
        void theEnginePairsTheExamples() throws Exception {
            JIRA.answers.put("/rest/api/3/issue/PAY-150", """
                    {"key":"PAY-150","fields":{"summary":"Refunds","description":{"type":"doc","content":[
                      {"type":"paragraph","content":[{"type":"text","text":"Refund a payment. We get {\\"amount\\": 5} and answer {\\"refundId\\": \\"r-1\\"}"}]}]}}}""");
            JIRA.answers.put("/rest/api/3/issue/PAY-150/comment", "{\"startAt\":0,\"maxResults\":100,\"total\":0,\"comments\":[]}");
            JIRA.answers.put("/v1/chat/completions", """
                    {"choices":[{"message":{"role":"assistant","content":
                      "{\\"operations\\":[{\\"method\\":\\"POST\\",\\"path\\":\\"/payments/{id}/refunds\\",\\"request\\":1,\\"response\\":2,\\"reason\\":\\"The story says what is sent and answered.\\"}]}"}}]}""");

            mvc.perform(post("/api/jira/story-examples").with(user("designer").roles("DESIGNER")).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request("PAY-150")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.engine").value("gpt-test at 127.0.0.1"))
                    .andExpect(jsonPath("$.operations[0].method").value("POST"))
                    .andExpect(jsonPath("$.operations[0].path").value("/payments/{id}/refunds"))
                    .andExpect(jsonPath("$.operations[0].request").value(1))
                    .andExpect(jsonPath("$.operations[0].response").value(2))
                    .andExpect(jsonPath("$.operations[0].reason").value("The story says what is sent and answered."));
            assertThat(JIRA.authorizations.getLast()).isEqualTo("Bearer sk-test");
        }

        @Test
        void theEditorIsToldWhichEngineStoriesGoTo() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.aiEngine").value("gpt-test at 127.0.0.1"));
        }
    }

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    class NotSetUp {
        @Autowired
        private MockMvc mvc;

        @Test
        void isOffAndSaysWhatIsMissing() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.jiraImport").value(false));
            mvc.perform(post("/api/jira/story-examples").with(user("designer").roles("DESIGNER")).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(request("PAY-142")))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.detail").value("Import From Jira is not set up: echo.jira.base-url and token are needed."));
        }
    }
}
