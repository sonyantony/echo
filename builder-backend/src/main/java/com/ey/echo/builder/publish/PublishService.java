package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import com.ey.echo.builder.flow.FlowStatus;
import com.ey.echo.builder.validation.FlowValidator;
import com.ey.echo.builder.validation.ValidationResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Validates a flow, writes it to Git and records the publish. */
@Service
public class PublishService {

    /** ECHO's own metadata file in each published flow folder. */
    public static final String METADATA_FILE = "echo-flow.json";

    private final FlowService flows;
    private final FlowValidator validator;
    private final GitPublisher publisher;
    private final GitProperties git;
    private final PublishEventRepository events;
    private final Clock clock;
    private final ObjectMapper json = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    public PublishService(FlowService flows, FlowValidator validator, GitPublisher publisher, GitProperties git,
            PublishEventRepository events, Clock clock) {
        this.flows = flows;
        this.validator = validator;
        this.publisher = publisher;
        this.git = git;
        this.events = events;
        this.clock = clock;
    }

    public sealed interface Outcome {
        record Published(PublishEvent event, boolean changed) implements Outcome {}

        record Invalid(ValidationResult validation) implements Outcome {}
    }

    @Transactional
    public Outcome publish(long flowId, String user, String message) {
        if (!git.configured()) {
            throw new PublishException("Publishing is not configured: set echo.git.url in application.yaml.");
        }
        var flow = flows.get(flowId);
        var files = new LinkedHashMap<>(flows.files(flowId));
        var validation = validator.validate(FlowNames.routeFile(flow.getName()), files);
        if (!validation.valid()) {
            return new Outcome.Invalid(validation);
        }

        var previous = events.findFirstByFlowIdOrderByPublishedAtDescIdDesc(flowId);
        long version = events.countByFlowId(flowId) + 1;
        var now = clock.instant();
        files.put(METADATA_FILE, metadata(flow.getName(), flow.getDescription(), version, user, now.toString()));

        String commitMessage = message == null || message.isBlank()
                ? "Publish flow %s (version %d)".formatted(flow.getName(), version)
                : message.strip();
        var result = publisher.publish(flow.getName(), previous.map(PublishEvent::getFlowName).orElse(null), files,
                user, commitMessage);

        flow.setStatus(FlowStatus.PUBLISHED);
        if (!result.changed() && previous.isPresent()) {
            return new Outcome.Published(previous.get(), false);
        }
        var event = events.save(new PublishEvent(flowId, flow.getName(), result.commitSha(), result.branch(), user,
                now, commitMessage));
        return new Outcome.Published(event, result.changed());
    }

    /**
     * Deletes the flow from the Builder and, if it was ever published, its folder from Git (as a
     * normal commit, so it can be recovered from Git history). Git goes first: if it fails, the
     * draft is kept and the user can try again.
     */
    @Transactional
    public void delete(long flowId, String user) {
        var flow = flows.get(flowId);
        var lastPublish = events.findFirstByFlowIdOrderByPublishedAtDescIdDesc(flowId);
        if (lastPublish.isPresent()) {
            if (!git.configured()) {
                throw new PublishException(("Flow '%s' was published, but publishing is not configured: "
                        + "set echo.git.url in application.yaml to delete it.").formatted(flow.getName()));
            }
            String folder = lastPublish.get().getFlowName();
            publisher.remove(folder, user, "Delete flow %s".formatted(folder));
        }
        flows.delete(flowId);
    }

    @Transactional(readOnly = true)
    public List<PublishEvent> history(long flowId) {
        flows.get(flowId); // 404 for unknown flows
        return events.findByFlowIdOrderByPublishedAtDescIdDesc(flowId);
    }

    private String metadata(String name, String description, long version, String author, String publishedAt) {
        var map = new LinkedHashMap<String, Object>();
        map.put("name", name);
        map.put("description", description);
        map.put("version", version);
        map.put("author", author);
        map.put("publishedAt", publishedAt);
        try {
            return json.writeValueAsString(map) + "\n";
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
