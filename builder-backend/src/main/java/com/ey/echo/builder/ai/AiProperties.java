package com.ey.echo.builder.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The AI engine this install uses, if any (today: Import From Jira, to tell which example in a story
 * is which). The key belongs in the local config/application.yaml or .env, never in Git.
 *
 * @param provider {@code none} (default: no AI; ECHO's own guess is used) or {@code openai-compatible}
 * @param timeoutSeconds how long one answer may take (default 60)
 * @param openaiCompatible the engine's endpoint, key and model, for {@code openai-compatible}
 */
@ConfigurationProperties("echo.ai")
public record AiProperties(String provider, Integer timeoutSeconds, OpenAiCompatible openaiCompatible) {

    /**
     * Any engine that speaks the OpenAI chat completions protocol.
     *
     * @param baseUrl up to and without {@code /chat/completions}: {@code https://api.openai.com/v1},
     *     {@code https://<resource>.openai.azure.com/openai/v1}, {@code http://ollama:11434/v1}
     * @param apiKey the key; may be empty for a local engine that needs none
     * @param keyHeader the header the key goes in: {@code Authorization} (default, sent as
     *     {@code Bearer <key>}) or another name such as Azure's {@code api-key} (sent as it is)
     * @param model the model, or Azure's deployment name
     * @param apiVersion added as {@code ?api-version=} when set (older Azure OpenAI endpoints)
     */
    public record OpenAiCompatible(String baseUrl, String apiKey, String keyHeader, String model, String apiVersion) {

        public OpenAiCompatible {
            baseUrl = blank(baseUrl) ? null : baseUrl.trim().replaceAll("/+$", "");
            apiKey = blank(apiKey) ? null : apiKey.trim();
            keyHeader = blank(keyHeader) ? "Authorization" : keyHeader.trim();
            model = blank(model) ? null : model.trim();
            apiVersion = blank(apiVersion) ? null : apiVersion.trim();
        }
    }

    public AiProperties {
        provider = blank(provider) ? "none" : provider.trim().toLowerCase();
        if (!provider.equals("none") && !provider.equals("openai-compatible")) {
            throw new IllegalArgumentException("echo.ai.provider must be none or openai-compatible, not " + provider);
        }
        timeoutSeconds = timeoutSeconds == null || timeoutSeconds <= 0 ? 60 : timeoutSeconds;
        openaiCompatible = openaiCompatible == null ? new OpenAiCompatible(null, null, null, null, null) : openaiCompatible;
        if (provider.equals("openai-compatible") && (openaiCompatible.baseUrl() == null || openaiCompatible.model() == null)) {
            throw new IllegalArgumentException("echo.ai.openai-compatible.base-url and model are needed for provider openai-compatible");
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
