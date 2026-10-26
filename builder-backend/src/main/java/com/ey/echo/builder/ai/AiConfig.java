package com.ey.echo.builder.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The install's AI engine, by {@code echo.ai.provider}; with {@code none} there is no AiProvider bean. */
@Configuration
class AiConfig {

    @Bean
    @ConditionalOnProperty(name = "echo.ai.provider", havingValue = "openai-compatible")
    AiProvider openAiCompatible(AiProperties props, ObjectMapper json) {
        return new OpenAiCompatibleProvider(props.openaiCompatible(), props.timeoutSeconds(), json);
    }
}
