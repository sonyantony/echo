package com.ey.echo.builder.publish;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/**
 * What one publish did in one target.
 *
 * @param target the target's id, e.g. {@code git}
 * @param location where the flow went, e.g. the branch or the folder URL
 * @param revision what identifies this version in the target (the commit for Git), or null
 * @param changed false when the target already had exactly these files
 * @param error why publishing to this target failed, or null if it worked
 */
@Embeddable
public record TargetOutcome(
        @Column(name = "target", nullable = false) String target,
        @Column(name = "location", nullable = false) String location,
        @Column(name = "revision") String revision,
        @Column(name = "changed", nullable = false) boolean changed,
        @Column(name = "error") String error) {

    static TargetOutcome of(FlowPublisher publisher, FlowPublisher.PublishResult result) {
        return new TargetOutcome(publisher.id(), result.location(), result.revision(), result.changed(), null);
    }

    static TargetOutcome failed(FlowPublisher publisher, String error) {
        return new TargetOutcome(publisher.id(), publisher.location(), null, false,
                error.length() > 1000 ? error.substring(0, 1000) : error);
    }

    public boolean ok() {
        return error == null;
    }
}
