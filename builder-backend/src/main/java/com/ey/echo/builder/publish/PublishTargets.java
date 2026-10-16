package com.ey.echo.builder.publish;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** The enabled publish targets, in order (Git first). */
@Component
public class PublishTargets {

    private static final Logger log = LoggerFactory.getLogger(PublishTargets.class);

    private final List<FlowPublisher> all;

    public PublishTargets(List<FlowPublisher> all) {
        this.all = all;
    }

    /** Targets that receive publishes and deletes. */
    public List<FlowPublisher> enabled() {
        return all.stream().filter(FlowPublisher::enabled).toList();
    }

    /** The target the Flows page reads published flows from: the first enabled one. */
    public Optional<FlowPublisher> primary() {
        return enabled().stream().findFirst();
    }

    /** Enabled targets, or an error saying how to configure one. */
    List<FlowPublisher> require() {
        var enabled = enabled();
        if (enabled.isEmpty()) {
            throw new PublishException("Publishing is not configured: enable a publish target in application.yaml "
                    + "(echo.git with url, or echo.s3 with enabled: true and bucket).");
        }
        return enabled;
    }

    /** The user-facing name of a target id, also for targets that are now switched off. */
    public String displayName(String id) {
        return all.stream().filter(p -> p.id().equals(id)).map(FlowPublisher::displayName).findFirst().orElse(id);
    }

    /**
     * Removes a flow folder from every enabled target. Tries them all, then fails if any failed,
     * naming each; removing is idempotent, so trying again finishes the job.
     */
    void removeEverywhere(String flowName, String author, String message) {
        var failures = new ArrayList<String>();
        for (var target : require()) {
            try {
                target.remove(flowName, author, message);
            } catch (RuntimeException e) {
                log.warn("Could not delete flow {} from {}", flowName, target.displayName(), e);
                failures.add(target.displayName() + ": " + e.getMessage());
            }
        }
        if (!failures.isEmpty()) {
            throw new PublishException("Could not delete flow %s from %s".formatted(flowName,
                    String.join("; ", failures)));
        }
    }
}
