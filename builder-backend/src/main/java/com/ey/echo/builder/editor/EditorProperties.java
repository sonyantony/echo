package com.ey.echo.builder.editor;

import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * How the flow editor behaves for this install, read from {@code echo.editor} in application.yaml
 * and served to the UI, so a buyer can tune it without rebuilding the image.
 *
 * <p>{@code autosaveSeconds}: how often the editor saves unsaved changes to the draft; 0 turns
 * autosave off.
 */
@Validated
@ConfigurationProperties("echo.editor")
public record EditorProperties(@DefaultValue("10") @PositiveOrZero int autosaveSeconds) {}
