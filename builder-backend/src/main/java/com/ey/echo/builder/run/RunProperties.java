package com.ey.echo.builder.run;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Test runs (the editor's Run button), read from {@code echo.run} in application.yaml.
 *
 * @param enabled whether users may run drafts inside the Builder
 * @param firstPort first port a running flow listens on; each running flow gets its own port
 * @param lastPort last port (inclusive); the range caps how many flows run at once
 * @param idleMinutes a run with no requests for this long is stopped
 * @param publicUrl how users reach the run ports from their browser or tools, without the port
 */
@Validated
@ConfigurationProperties("echo.run")
public record RunProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("8081") @Min(1) @Max(65535) int firstPort,
        @DefaultValue("8090") @Min(1) @Max(65535) int lastPort,
        @DefaultValue("30") @Positive int idleMinutes,
        @DefaultValue("http://localhost") @NotBlank String publicUrl) {}
