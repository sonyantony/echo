package com.ey.echo.builder.publish;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import java.time.Instant;

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
    private String commitSha;

    @Column(nullable = false)
    private String branch;

    @Column(nullable = false)
    private String publishedBy;

    @Column(nullable = false)
    private Instant publishedAt;

    @Column(nullable = false)
    private String message;

    protected PublishEvent() {}

    public PublishEvent(Long flowId, String flowName, String commitSha, String branch, String publishedBy,
            Instant publishedAt, String message) {
        this.flowId = flowId;
        this.flowName = flowName;
        this.commitSha = commitSha;
        this.branch = branch;
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

    public String getCommitSha() {
        return commitSha;
    }

    public String getBranch() {
        return branch;
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
