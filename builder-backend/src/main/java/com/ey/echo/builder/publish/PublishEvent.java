package com.ey.echo.builder.publish;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
public class PublishEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long flowId;

    @Column(nullable = false)
    private String flowName;

    @Column(nullable = false)
    private String publishedBy;

    @Column(nullable = false)
    private Instant publishedAt;

    @Column(nullable = false)
    private String message;

    /** One entry per enabled target, in target order; failed targets included. */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "publish_target", joinColumns = @JoinColumn(name = "publish_event_id"))
    @OrderColumn(name = "target_index")
    private List<TargetOutcome> targets = new ArrayList<>();

    protected PublishEvent() {}

    public PublishEvent(Long flowId, String flowName, List<TargetOutcome> targets, String publishedBy,
            Instant publishedAt, String message) {
        this.flowId = flowId;
        this.flowName = flowName;
        this.targets = new ArrayList<>(targets);
        this.publishedBy = publishedBy;
        this.publishedAt = publishedAt;
        this.message = message;
    }

    public Long getId() {
        return id;
    }

    public Long getFlowId() {
        return flowId;
    }

    public String getFlowName() {
        return flowName;
    }

    public List<TargetOutcome> getTargets() {
        return targets;
    }

    public String getPublishedBy() {
        return publishedBy;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    public String getMessage() {
        return message;
    }
}
