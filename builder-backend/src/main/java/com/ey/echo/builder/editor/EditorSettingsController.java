package com.ey.echo.builder.editor;

import com.ey.echo.builder.ai.AiProvider;
import com.ey.echo.builder.jira.JiraProperties;
import com.ey.echo.builder.run.RunProperties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Editor settings for the UI; only signed-in users open the editor, so this needs a login. */
@RestController
public class EditorSettingsController {

    /**
     * @param jiraImport whether Interface offers Import From Jira (echo.jira is set up)
     * @param aiEngine the AI engine stories are sent to ("gpt-4.1 at acme.openai.azure.com"); null without one
     */
    public record EditorSettings(int autosaveSeconds, boolean runEnabled, boolean jiraImport, String aiEngine) {}

    private final EditorSettings settings;

    public EditorSettingsController(EditorProperties properties, RunProperties run, JiraProperties jira, ObjectProvider<AiProvider> ai) {
        AiProvider engine = ai.getIfAvailable();
        this.settings = new EditorSettings(properties.autosaveSeconds(), run.enabled(), jira.active(),
                engine == null ? null : engine.describe());
    }

    @GetMapping("/api/editor/settings")
    public EditorSettings settings() {
        return settings;
    }
}
