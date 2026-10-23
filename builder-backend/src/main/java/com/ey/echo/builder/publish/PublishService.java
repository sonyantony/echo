package com.ey.echo.builder.publish;

import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import com.ey.echo.builder.flow.FlowStatus;
import com.ey.echo.builder.validation.FlowValidator;
import com.ey.echo.builder.validation.ValidationResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Validates a flow, writes it to every enabled publish target and records the publish. */
@Service
public class PublishService {

    private static final Logger log = LoggerFactory.getLogger(PublishService.class);

    /** ECHO's own metadata file in each published flow folder. */
    public static final String METADATA_FILE = "echo-flow.json";

    private final FlowService flows;
    private final FlowValidator validator;
    private final PublishTargets targets;
    private final PublishEventRepository events;
    private final Clock clock;
    private final ApiCatalog apis;
    private final EndpointClashes clashes;
    private final PublishedFlowService published;
    private final ObjectMapper json = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    public PublishService(FlowService flows, FlowValidator validator, PublishTargets targets,
            PublishEventRepository events, Clock clock, ApiCatalog apis, EndpointClashes clashes,
            PublishedFlowService published) {
        this.flows = flows;
        this.published = published;
        this.clashes = clashes;
        this.apis = apis;
        this.validator = validator;
        this.targets = targets;
        this.events = events;
        this.clock = clock;
    }

    public sealed interface Outcome {
        /**
         * @param event the recorded publish (the previous one if nothing changed anywhere)
         * @param targets what this publish did in each enabled target, including failures
         */
        record Published(PublishEvent event, List<TargetOutcome> targets, boolean changed) implements Outcome {}

        record Invalid(ValidationResult validation) implements Outcome {}

        /** The flow would serve endpoints (or use operationIds) a published flow already does. */
        record Clashes(List<String> clashes) implements Outcome {}
    }

    /**
     * Publishes to every enabled target. A target that fails does not stop the others: the result
     * lists each target's outcome. Only when every target fails is the publish an error.
     */
    @Transactional
    public Outcome publish(long flowId, String user, String message) {
        var enabled = targets.require();
        var flow = flows.get(flowId);
        String routeFile = FlowNames.routeFile(flow.getName());
        // A current copy of each approved API spec the flow calls goes into the flow folder.
        var files = new LinkedHashMap<>(apis.withSpecs(routeFile, flows.files(flowId)));
        var validation = validator.validate(routeFile, files);
        if (!validation.valid()) {
            return new Outcome.Invalid(validation);
        }

        var previous = events.findFirstByFlowIdOrderByPublishedAtDescIdDesc(flowId);
        String previousName = previous.map(PublishEvent::getFlowName).orElse(null);
        var clashing = clashes.check(flow.getName(), previousName, files);
        if (!clashing.isEmpty()) {
            return new Outcome.Clashes(clashing);
        }
        long version = events.countByFlowId(flowId) + 1;
        var now = clock.instant();
        // A flow disabled on the Open Flow page stays disabled when a new version is published.
        boolean disabled = published.isDisabled(previousName != null ? previousName : flow.getName());
        files.put(METADATA_FILE, metadata(flow.getName(), flow.getDescription(), version, user, now.toString(),
                disabled));

        String commitMessage = message == null || message.isBlank()
                ? "Publish flow %s (version %d)".formatted(flow.getName(), version)
                : message.strip();
        var outcomes = new ArrayList<TargetOutcome>();
        for (var target : enabled) {
            try {
                outcomes.add(TargetOutcome.of(target,
                        target.publish(flow.getName(), previousName, files, user, commitMessage)));
            } catch (RuntimeException e) {
                log.warn("Publishing flow {} to {} failed", flow.getName(), target.displayName(), e);
                outcomes.add(TargetOutcome.failed(target, e.getMessage() == null ? e.toString() : e.getMessage()));
            }
        }
        if (outcomes.stream().noneMatch(TargetOutcome::ok)) {
            throw new PublishException(outcomes.stream()
                    .map(o -> targets.displayName(o.target()) + ": " + o.error())
                    .collect(java.util.stream.Collectors.joining("; ")));
        }

        flow.setStatus(FlowStatus.PUBLISHED);
        boolean changed = outcomes.stream().anyMatch(TargetOutcome::changed);
        if (!changed && previous.isPresent() && outcomes.stream().allMatch(TargetOutcome::ok)) {
            return new Outcome.Published(previous.get(), outcomes, false);
        }
        var event = events.save(new PublishEvent(flowId, flow.getName(), outcomes, user, now, commitMessage));
        return new Outcome.Published(event, outcomes, changed);
    }

    /**
     * Deletes the flow from the Builder and, if it was ever published, its folder from every
     * enabled target (in Git as a normal commit, so it can be recovered from Git history). The
     * targets go first: if one fails, the draft is kept and the user can try again.
     */
    @Transactional
    public void delete(long flowId, String user) {
        flows.get(flowId); // 404 for unknown flows
        var lastPublish = events.findFirstByFlowIdOrderByPublishedAtDescIdDesc(flowId);
        if (lastPublish.isPresent()) {
            String folder = lastPublish.get().getFlowName();
            targets.removeEverywhere(folder, user, "Delete flow %s".formatted(folder));
        }
        flows.delete(flowId);
    }

    @Transactional(readOnly = true)
    public List<PublishEvent> history(long flowId) {
        flows.get(flowId); // 404 for unknown flows
        return events.findByFlowIdOrderByPublishedAtDescIdDesc(flowId);
    }

    private String metadata(String name, String description, long version, String author, String publishedAt,
            boolean disabled) {
        var map = new LinkedHashMap<String, Object>();
        map.put("name", name);
        map.put("description", description);
        map.put("version", version);
        map.put("author", author);
        map.put("publishedAt", publishedAt);
        if (disabled) {
            map.put("disabled", true);
        }
        try {
            return json.writeValueAsString(map) + "\n";
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
