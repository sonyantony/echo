package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.Flow;
import com.ey.echo.builder.flow.FlowArchive;
import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import com.ey.echo.builder.flow.FlowStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Flows as they are in the primary publish target (the first enabled one: Git, else S3), next to
 * the Builder drafts. A published flow is linked to the Builder flow that last published it, or
 * else to the Builder flow with its name. Deleting removes it from every enabled target. Disabling
 * keeps it there but marks it {@code "disabled": true} in its metadata file, so the pipeline leaves
 * it out of images until it is enabled again.
 */
@Service
public class PublishedFlowService {

    private final FlowService flows;
    private final PublishTargets targets;
    private final PublishEventRepository events;
    private final ObjectMapper json = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    public PublishedFlowService(FlowService flows, PublishTargets targets, PublishEventRepository events) {
        this.flows = flows;
        this.targets = targets;
        this.events = events;
    }

    /**
     * @param flowId the linked Builder flow, or null if the flow is only in the publish target
     * @param draftChanged true if the linked Builder flow has changes that are not published
     * @param target where the flow is, as shown to users (e.g. {@code Git})
     * @param disabled true if the pipeline leaves the flow out of images
     */
    public record PublishedFlow(
            String name, String description, Long version, String publishedBy, Instant publishedAt, Long flowId,
            boolean draftChanged, String target, boolean disabled) {}

    @Transactional(readOnly = true)
    public List<PublishedFlow> list() {
        var primary = targets.primary();
        if (primary.isEmpty()) {
            return List.of();
        }
        var linked = linkedFlows();
        var target = primary.get().displayName();
        return primary.get().list().stream().map(folder -> {
            var meta = metadata(folder.files());
            var flow = linked.get(folder.name());
            if (flow == null) {
                flow = flows.findByName(folder.name()).orElse(null);
            }
            return new PublishedFlow(folder.name(), text(meta, "description"),
                    meta.hasNonNull("version") ? meta.get("version").asLong() : null, text(meta, "author"),
                    instant(text(meta, "publishedAt")),
                    flow == null ? null : flow.getId(), flow != null && flow.getStatus() == FlowStatus.DRAFT, target,
                    disabled(meta));
        }).toList();
    }

    /** The published files of a flow, without ECHO's metadata file (publishing writes it again). */
    public Map<String, String> files(String name) {
        var files = new LinkedHashMap<>(primary().read(name).orElseThrow(() -> notFound(name)));
        files.remove(PublishService.METADATA_FILE);
        return files;
    }

    /**
     * Copies a published flow into the Builder as a new draft, to edit and publish again. With
     * {@code replace}, the Builder flow it is linked to (if any) gets the published files instead,
     * discarding its unpublished changes.
     */
    @Transactional
    public Flow createDraft(String name, boolean replace, String user) {
        var all = primary().read(name).orElseThrow(() -> notFound(name));
        if (!all.containsKey(FlowNames.routeFile(name))) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "The published flow '%s' has no %s.".formatted(name, FlowNames.routeFile(name)));
        }
        var meta = metadata(all);
        var files = new LinkedHashMap<>(all);
        files.remove(PublishService.METADATA_FILE);
        var linked = replace ? linkedFlow(name) : null;
        if (linked != null) {
            return flows.replaceWithPublished(linked.getId(), new FlowArchive.Contents(name, files), user);
        }
        return flows.importArchive(new FlowArchive.Contents(name, files), name, text(meta, "description"), user);
    }

    /**
     * Removes a published flow from every enabled target and, if it is linked to a Builder flow,
     * that flow too (only once every target has removed it).
     */
    @Transactional
    public void delete(String name, String user) {
        if (primary().read(name).isEmpty()) {
            throw notFound(name);
        }
        var flow = linkedFlow(name);
        targets.removeEverywhere(name, user, "Delete flow %s".formatted(name));
        if (flow != null) {
            flows.delete(flow.getId());
        }
    }

    /**
     * Disables or enables a published flow in every enabled target that has it, by setting
     * {@code disabled} in its metadata file (in Git a normal commit). The flow's files stay as they
     * are; the pipeline skips a disabled flow. Publishing it again keeps the setting.
     */
    @Transactional(readOnly = true)
    public void setDisabled(String name, boolean disabled, String user) {
        if (primary().read(name).isEmpty()) {
            throw notFound(name);
        }
        String message = "%s flow %s".formatted(disabled ? "Disable" : "Enable", name);
        for (var target : targets.require()) {
            var files = target.read(name).orElse(null);
            if (files == null) {
                continue;
            }
            var meta = metadata(files);
            var updated = meta instanceof ObjectNode o ? o.deepCopy() : json.createObjectNode();
            if (disabled) {
                updated.put("disabled", true);
            } else {
                updated.remove("disabled");
            }
            var changed = new LinkedHashMap<>(files);
            try {
                changed.put(PublishService.METADATA_FILE, json.writeValueAsString(updated) + "\n");
            } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
                throw new IllegalStateException(e);
            }
            target.publish(name, null, changed, user, message);
        }
    }

    /** True if the flow's metadata file says the pipeline should leave it out. */
    static boolean disabled(JsonNode meta) {
        return meta.path("disabled").asBoolean(false);
    }

    /** True if the published folder of this name in the primary target is disabled. */
    boolean isDisabled(String name) {
        return targets.primary().flatMap(t -> t.read(name)).map(f -> disabled(metadata(f))).orElse(false);
    }

    /** The Builder flow that last published to this folder, else the one with its name, else null. */
    private Flow linkedFlow(String name) {
        var flow = linkedFlows().get(name);
        return flow != null ? flow : flows.findByName(name).orElse(null);
    }

    /** Builder flows by the folder they last published to. */
    private Map<String, Flow> linkedFlows() {
        var latest = new HashMap<Long, PublishEvent>();
        for (var e : events.findAll()) {
            latest.merge(e.getFlowId(), e, (a, b) -> b.getPublishedAt().isAfter(a.getPublishedAt())
                    || (b.getPublishedAt().equals(a.getPublishedAt()) && b.getId() > a.getId()) ? b : a);
        }
        var result = new HashMap<String, Flow>();
        for (var flow : flows.list()) {
            var event = latest.get(flow.getId());
            if (event != null) {
                result.put(event.getFlowName(), flow);
            }
        }
        return result;
    }

    private JsonNode metadata(Map<String, String> files) {
        var content = files.get(PublishService.METADATA_FILE);
        if (content != null) {
            try {
                return json.readTree(content);
            } catch (Exception e) {
                // edited by hand and broken: show the flow without its metadata
            }
        }
        return json.createObjectNode();
    }

    private static String text(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }

    private static Instant instant(String s) {
        try {
            return s == null ? null : Instant.parse(s);
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }

    private FlowPublisher primary() {
        return targets.require().get(0);
    }

    private static ResponseStatusException notFound(String name) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Published flow " + name + " not found");
    }
}
