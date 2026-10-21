package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.Flow;
import com.ey.echo.builder.flow.FlowArchive;
import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import com.ey.echo.builder.flow.FlowStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * else to the Builder flow with its name. Deleting removes it from every enabled target.
 */
@Service
public class PublishedFlowService {

    private final FlowService flows;
    private final PublishTargets targets;
    private final PublishEventRepository events;
    private final ObjectMapper json = new ObjectMapper();

    public PublishedFlowService(FlowService flows, PublishTargets targets, PublishEventRepository events) {
        this.flows = flows;
        this.targets = targets;
        this.events = events;
    }

    /**
     * @param flowId the linked Builder flow, or null if the flow is only in the publish target
     * @param draftChanged true if the linked Builder flow has changes that are not published
     * @param target where the flow is, as shown to users (e.g. {@code Git})
     */
    public record PublishedFlow(
            String name, String description, Long version, String publishedBy, Instant publishedAt, Long flowId,
            boolean draftChanged, String target) {}

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
                    flow == null ? null : flow.getId(), flow != null && flow.getStatus() == FlowStatus.DRAFT, target);
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
