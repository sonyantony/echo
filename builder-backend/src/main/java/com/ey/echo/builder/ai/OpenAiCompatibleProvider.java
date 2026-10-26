package com.ey.echo.builder.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * An engine that speaks the OpenAI chat completions protocol ({@code POST <base-url>/chat/completions}):
 * OpenAI, Azure OpenAI and most of Azure AI Foundry, Ollama, vLLM, LiteLLM and other gateways, even
 * Anthropic's OpenAI-compatible endpoint. Plain HTTP on the JDK client: no vendor SDK.
 */
public class OpenAiCompatibleProvider implements AiProvider {

    private final AiProperties.OpenAiCompatible props;
    private final Duration timeout;
    private final ObjectMapper json;
    private final HttpClient http;

    public OpenAiCompatibleProvider(AiProperties.OpenAiCompatible props, int timeoutSeconds, ObjectMapper json) {
        this.props = props;
        this.timeout = Duration.ofSeconds(timeoutSeconds);
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
                .proxy(ProxySelector.getDefault()) // honour https.proxyHost etc., like JGit and S3
                .build();
    }

    @Override
    public String completeJson(String instructions, String input) {
        String body;
        try {
            body = json.writeValueAsString(Map.of(
                    "model", props.model(),
                    "temperature", 0,
                    "response_format", Map.of("type", "json_object"),
                    "messages", List.of(
                            Map.of("role", "system", "content", instructions),
                            Map.of("role", "user", "content", input))));
        } catch (IOException e) {
            throw new AiException("Could not write the request to the AI engine.", e);
        }
        String url = props.baseUrl() + "/chat/completions"
                + (props.apiVersion() == null ? "" : "?api-version=" + URLEncoder.encode(props.apiVersion(), StandardCharsets.UTF_8));
        var request = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json");
        if (props.apiKey() != null) {
            boolean bearer = props.keyHeader().equalsIgnoreCase("Authorization");
            request.header(props.keyHeader(), bearer ? "Bearer " + props.apiKey() : props.apiKey());
        }
        HttpResponse<String> response;
        try {
            response = http.send(request.POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new AiException("Could not reach the AI engine at " + host() + ".", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiException("The AI engine was stopped.", e);
        }
        int status = response.statusCode();
        if (status == 401 || status == 403) {
            throw new AiException("The AI engine at " + host() + " did not accept ECHO's key. Check echo.ai.openai-compatible.api-key and key-header.");
        }
        if (status / 100 != 2) {
            throw new AiException("The AI engine at " + host() + " answered " + status + ".");
        }
        try {
            JsonNode content = json.readTree(response.body()).path("choices").path(0).path("message").path("content");
            if (!content.isTextual()) {
                throw new AiException("The AI engine's answer had no text.");
            }
            return stripFence(content.asText());
        } catch (IOException e) {
            throw new AiException("The AI engine's answer could not be read.", e);
        }
    }

    @Override
    public String describe() {
        return props.model() + " at " + host();
    }

    private String host() {
        String host = URI.create(props.baseUrl()).getHost();
        return host == null ? props.baseUrl() : host;
    }

    /** Some engines wrap JSON in ```json fences even when asked for a JSON object. */
    static String stripFence(String text) {
        String t = text.strip();
        if (t.startsWith("```")) {
            t = t.replaceFirst("^```[A-Za-z]*\\s*", "").replaceFirst("\\s*```$", "");
        }
        return t;
    }
}
