package com.ey.echo.builder.apis;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The downstream APIs flows may call, per install: each one an OpenAPI or Swagger 2.0 spec file
 * (YAML or JSON), usually in /config/apis/. A flow calls an operation with a REST OpenApi step,
 * {@code rest-openapi:<id>.openapi.json#<operationId>}. Configurable in {@code echo.apis}.
 *
 * <p>{@code only}: when true, flows may call nothing else; plain http and https steps are
 * rejected by Validate and hidden in the editor.
 *
 * @param specs the approved APIs
 */
@ConfigurationProperties("echo.apis")
public record ApiProperties(boolean only, List<Spec> specs) {

    public ApiProperties {
        specs = specs == null ? List.of() : List.copyOf(specs);
    }

    /**
     * @param id short name, lower case: the flow's copy of the spec is {@code <id>.openapi.json}
     * @param name shown in messages; defaults to the id
     * @param file the spec file
     * @param allowedTags operations with one of these tags may be called; with
     *     {@code allowedOperations} also empty, every operation may
     * @param allowedOperations operationIds that may be called, whatever their tags
     */
    public record Spec(String id, String name, String file, List<String> allowedTags,
            List<String> allowedOperations) {

        public Spec {
            name = name == null || name.isBlank() ? id : name;
            allowedTags = allowedTags == null ? List.of() : List.copyOf(allowedTags);
            allowedOperations = allowedOperations == null ? List.of() : List.copyOf(allowedOperations);
        }
    }
}
