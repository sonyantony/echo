package com.ey.echo.builder.ai;

/**
 * An AI engine ECHO asks for a JSON answer, chosen per install with {@code echo.ai.provider}. Each
 * engine (protocol) is one class; today there is one that speaks the OpenAI protocol
 * ({@link OpenAiCompatibleProvider}), which reaches OpenAI, Azure OpenAI, Ollama, vLLM and gateways
 * by its endpoint. Callers check every answer: an engine can be wrong.
 */
public interface AiProvider {

    /**
     * Sends the instructions and the input, and returns the engine's answer: a JSON object as text.
     *
     * @throws AiException when the engine cannot be reached or does not answer with JSON
     */
    String completeJson(String instructions, String input);

    /** What users are told read their data, e.g. "gpt-4.1 at acme.openai.azure.com". */
    String describe();
}
