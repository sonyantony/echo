package com.ey.echo.builder.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The OpenAI protocol against a fake engine (the JDK's HTTP server). */
class OpenAiCompatibleProviderTest {

    private HttpServer server;
    private final AtomicReference<String> uri = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicReference<String> apiKey = new AtomicReference<>();
    private volatile int status = 200;
    private volatile String answer;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            uri.set(exchange.getRequestURI().toString());
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            apiKey.set(exchange.getRequestHeaders().getFirst("api-key"));
            byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static String reply(String content) throws IOException {
        return new ObjectMapper().writeValueAsString(java.util.Map.of("choices",
                java.util.List.of(java.util.Map.of("message", java.util.Map.of("role", "assistant", "content", content)))));
    }

    @Test
    void asksForAJsonObjectWithABearerKey() throws Exception {
        answer = reply("{\"operations\": []}");
        var ai = new OpenAiCompatibleProvider(new AiProperties.OpenAiCompatible(url() + "/v1/", "sk-1", null, "gpt-4.1", null), 5, new ObjectMapper());

        assertThat(ai.completeJson("Be brief.", "Story")).isEqualTo("{\"operations\": []}");
        assertThat(uri.get()).isEqualTo("/v1/chat/completions");
        assertThat(authorization.get()).isEqualTo("Bearer sk-1");
        var sent = new ObjectMapper().readTree(body.get());
        assertThat(sent.path("model").asText()).isEqualTo("gpt-4.1");
        assertThat(sent.path("response_format").path("type").asText()).isEqualTo("json_object");
        assertThat(sent.path("messages").get(0).path("content").asText()).isEqualTo("Be brief.");
        assertThat(sent.path("messages").get(1).path("content").asText()).isEqualTo("Story");
        assertThat(ai.describe()).isEqualTo("gpt-4.1 at 127.0.0.1");
    }

    @Test
    void sendsAzuresKeyHeaderAndApiVersion() throws Exception {
        answer = reply("```json\n{\"a\": 1}\n```");
        var ai = new OpenAiCompatibleProvider(new AiProperties.OpenAiCompatible(url() + "/openai/deployments/d", "az-1", "api-key", "d", "2024-10-21"), 5, new ObjectMapper());

        assertThat(ai.completeJson("i", "x")).isEqualTo("{\"a\": 1}");
        assertThat(uri.get()).isEqualTo("/openai/deployments/d/chat/completions?api-version=2024-10-21");
        assertThat(apiKey.get()).isEqualTo("az-1");
        assertThat(authorization.get()).isNull();
    }

    @Test
    void saysPlainlyWhenTheKeyIsRefused() {
        status = 401;
        answer = "{}";
        var ai = new OpenAiCompatibleProvider(new AiProperties.OpenAiCompatible(url() + "/v1", "bad", null, "m", null), 5, new ObjectMapper());
        assertThatThrownBy(() -> ai.completeJson("i", "x")).isInstanceOf(AiException.class)
                .hasMessageContaining("did not accept ECHO's key");
    }

    @Test
    void needsAnEndpointAndModelWhenChosen() {
        assertThatThrownBy(() -> new AiProperties("openai-compatible", null, null))
                .hasMessageContaining("base-url and model are needed");
        assertThat(new AiProperties(null, null, null).provider()).isEqualTo("none");
    }
}
