package com.ey.echo.builder.editor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Editor settings for the UI; only signed-in users open the editor, so this needs a login. */
@RestController
public class EditorSettingsController {

    public record EditorSettings(int autosaveSeconds) {}

    private final EditorSettings settings;

    public EditorSettingsController(EditorProperties properties) {
        this.settings = new EditorSettings(properties.autosaveSeconds());
    }

    @GetMapping("/api/editor/settings")
    public EditorSettings settings() {
        return settings;
    }
}
