package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.Flow;
import com.ey.echo.builder.flow.FlowExceptions;
import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Flow templates: flow folders kept in the publish targets' {@code templates} folder, next to the
 * flows folder (so pipelines, which build the flows folder, never build them). Saving a template
 * writes it to every enabled target; listing and opening read the primary one, like the Flows page.
 */
@Service
public class TemplateService {

    private static final Logger log = LoggerFactory.getLogger(TemplateService.class);

    /** ECHO's own metadata file in each template folder. */
    public static final String METADATA_FILE = "echo-template.json";

    private final FlowService flows;
    private final PublishTargets targets;
    private final Clock clock;
    private final ObjectMapper json = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    public TemplateService(FlowService flows, PublishTargets targets, Clock clock) {
        this.flows = flows;
        this.targets = targets;
        this.clock = clock;
    }

    public record Template(String name, String description, String savedBy, String savedAt) {}

    public List<Template> list() {
        var primary = targets.primary();
        if (primary.isEmpty()) {
            return List.of();
        }
        return primary.get().templates().list().stream()
                .filter(folder -> folder.files().containsKey(FlowNames.routeFile(folder.name())))
                .map(folder -> {
                    var meta = metadata(folder.files());
                    return new Template(folder.name(), text(meta, "description"), text(meta, "savedBy"),
                            text(meta, "savedAt"));
                }).toList();
    }

    /**
     * Saves a flow as a template named {@code name}: its files, with the route file renamed and
     * holding {@code routeContent} when given. An existing template is replaced only when
     * {@code overwrite} is true.
     */
    @Transactional(readOnly = true)
    public Template save(long flowId, String name, String routeContent, boolean overwrite, String user) {
        if (!FlowNames.isValidName(name)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ("Template name '%s' is not allowed: use "
                    + "lowercase letters, digits and dashes, starting with a letter.").formatted(name));
        }
        var enabled = targets.require();
        var flow = flows.get(flowId);
        if (!overwrite && enabled.get(0).templates().read(name).isPresent()) {
            throw FlowExceptions.confirmOverwrite("A template named '%s' already exists. Replace it?".formatted(name));
        }
        var files = new LinkedHashMap<>(flows.files(flowId));
        String route = files.remove(FlowNames.routeFile(flow.getName()));
        files.put(FlowNames.routeFile(name), routeContent != null ? routeContent : route);
        var template = new Template(name, flow.getDescription(), user, clock.instant().toString());
        files.put(METADATA_FILE, metadata(template));

        var failures = new ArrayList<String>();
        for (var target : enabled) {
            try {
                target.templates().publish(name, null, files, user, "Save template " + name);
            } catch (RuntimeException e) {
                log.warn("Saving template {} to {} failed", name, target.displayName(), e);
                failures.add(target.displayName() + ": " + e.getMessage());
            }
        }
        if (!failures.isEmpty()) {
            throw new PublishException("Could not save template %s to %s".formatted(name, String.join("; ", failures)));
        }
        return template;
    }

    /** Creates a new draft named {@code flowName} from a template. */
    @Transactional
    public Flow open(String templateName, String flowName, String description, String user) {
        var all = targets.require().get(0).templates().read(templateName)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Template " + templateName + " not found"));
        var files = new LinkedHashMap<>(all);
        files.remove(METADATA_FILE);
        String desc = description == null || description.isBlank() ? text(metadata(all), "description") : description;
        return flows.createFromTemplate(templateName, files, flowName, desc, user);
    }

    private String metadata(Template t) {
        var map = new LinkedHashMap<String, Object>();
        map.put("name", t.name());
        map.put("description", t.description());
        map.put("savedBy", t.savedBy());
        map.put("savedAt", t.savedAt());
        try {
            return json.writeValueAsString(map) + "\n";
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode metadata(Map<String, String> files) {
        var content = files.get(METADATA_FILE);
        if (content != null) {
            try {
                return json.readTree(content);
            } catch (Exception e) {
                // edited by hand and broken: show the template without its metadata
            }
        }
        return json.createObjectNode();
    }

    private static String text(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }
}
