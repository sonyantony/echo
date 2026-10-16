package com.ey.echo.builder.editor;

import com.ey.echo.builder.run.RunProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Editor settings for the UI; only signed-in users open the editor, so this needs a login. */
@RestController
public class EditorSettingsController {

    public record EditorSettings(int autosaveSeconds, boolean runEnabled) {}

    private final EditorSettings settings;

    public EditorSettingsController(EditorProperties properties, RunProperties run) {
        this.settings = new EditorSettings(properties.autosaveSeconds(), run.enabled());
    }

    @GetMapping("/api/editor/settings")
    public EditorSettings settings() {
        return settings;
    }
}
