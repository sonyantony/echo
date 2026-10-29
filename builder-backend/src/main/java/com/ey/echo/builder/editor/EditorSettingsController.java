package com.ey.echo.builder.editor;

import com.ey.echo.builder.ai.AiProvider;
import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.jira.JiraProperties;
import com.ey.echo.builder.run.RunProperties;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Editor settings for the UI; only signed-in users open the editor, so this needs a login. */
@RestController
public class EditorSettingsController {

    /**
     * @param jiraImport whether Interface offers Import From Jira (echo.jira is set up)
     * @param aiEngine the AI engine stories are sent to ("gpt-4.1 at acme.openai.azure.com"); null without one
     * @param routeCall where the REST OpenApi step of a route made for a new operation points; null
     *     unless exactly one approved API is set up
     * @param apiTags the tags of each approved API, for the REST OpenApi step's Tag drop-down
     */
    public record EditorSettings(int autosaveSeconds, boolean runEnabled, boolean jiraImport, String aiEngine,
            RouteCall routeCall, List<ApiTags> apiTags) {}

    /**
     * The tags of an approved API's allowed operations, A to Z (case ignored), each with its allowed
     * operations; an operation with several tags is under each. Operations without a tag are in no tag.
     * {@code host} is the Host placeholder when the spec names no server host, null otherwise (an
     * Enrich step's rest-openapi URI then carries {@code ?host=}).
     */
    public record ApiTags(String specificationUri, String name, String host, List<Tag> tags) {}

    public record Tag(String name, List<String> operations) {}

    /**
     * The approved API a new route's REST OpenApi step calls until the user picks its operation.
     *
     * @param host the Host placeholder, when the spec names no server host; null otherwise
     */
    public record RouteCall(String specificationUri, String host) {}

    private final EditorSettings settings;

    public EditorSettingsController(EditorProperties properties, RunProperties run, JiraProperties jira,
            ObjectProvider<AiProvider> ai, ApiCatalog apis) {
        AiProvider engine = ai.getIfAvailable();
        this.settings = new EditorSettings(properties.autosaveSeconds(), run.enabled(), jira.active(),
                engine == null ? null : engine.describe(), routeCall(apis), apiTags(apis));
    }

    private static RouteCall routeCall(ApiCatalog apis) {
        var loaded = apis.apis().stream().filter(a -> a.problem() == null).toList();
        if (loaded.size() != 1) {
            return null;
        }
        var api = loaded.get(0);
        return new RouteCall(api.fileName(), hostOf(api));
    }

    private static String hostOf(ApiCatalog.Api api) {
        return api.hasHost() ? null : "{{" + api.id() + ".host}}";
    }

    private static List<ApiTags> apiTags(ApiCatalog apis) {
        return apis.apis().stream().filter(a -> a.problem() == null).map(api -> {
            var byTag = new TreeMap<String, List<String>>(String.CASE_INSENSITIVE_ORDER);
            api.operations().values().stream().filter(ApiCatalog.Operation::allowed).forEach(op ->
                    op.tags().forEach(tag -> byTag.computeIfAbsent(tag, t -> new ArrayList<>()).add(op.id())));
            var tags = byTag.entrySet().stream().map(e -> new Tag(e.getKey(), List.copyOf(e.getValue()))).toList();
            return new ApiTags(api.fileName(), api.name(), hostOf(api), tags);
        }).toList();
    }

    @GetMapping("/api/editor/settings")
    public EditorSettings settings() {
        return settings;
    }
}
