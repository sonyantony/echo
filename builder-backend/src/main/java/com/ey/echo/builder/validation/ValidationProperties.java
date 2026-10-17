package com.ey.echo.builder.validation;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Flows may only use these Camel components and expression languages
 * (HTTP and JSON, plus the DataMapper's XSLT). Configurable in {@code echo.validation}.
 */
@ConfigurationProperties("echo.validation")
public record ValidationProperties(List<String> allowedComponents, List<String> allowedLanguages) {

    public ValidationProperties {
        allowedComponents = allowedComponents == null || allowedComponents.isEmpty()
                ? List.of("platform-http", "http", "https", "xslt-saxon", "log", "direct")
                : List.copyOf(allowedComponents);
        allowedLanguages = allowedLanguages == null || allowedLanguages.isEmpty()
                ? List.of("simple", "constant", "header", "exchangeProperty", "variable")
                : List.copyOf(allowedLanguages);
    }
}
