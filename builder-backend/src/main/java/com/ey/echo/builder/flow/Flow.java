package com.ey.echo.builder.flow;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Entity
public class Flow {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;

    /** What users call the flow; {@link #name} is its identifier. */
    @Column(name = "display_name")
    private String displayName;

    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FlowStatus status = FlowStatus.DRAFT;

    @Column(nullable = false)
    private String createdBy;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private String updatedBy;

    @Column(nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    @OneToMany(mappedBy = "flow", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("path")
    private List<FlowFile> files = new ArrayList<>();

    protected Flow() {}

    public Flow(String name, String displayName, String description, String user, Instant now) {
        this.name = name;
        this.displayName = displayName;
        this.description = description;
        this.createdBy = user;
        this.createdAt = now;
        touch(user, now);
    }

    /** Records an edit: the flow differs from what is in Git until it is published again. */
    public void touch(String user, Instant now) {
        this.updatedBy = user;
        this.updatedAt = now;
        this.status = FlowStatus.DRAFT;
    }

    public Optional<FlowFile> file(String path) {
        return files.stream().filter(f -> f.getPath().equals(path)).findFirst();
    }

    public FlowFile putFile(String path, String content) {
        var existing = file(path);
        if (existing.isPresent()) {
            existing.get().setContent(content);
            return existing.get();
        }
        var file = new FlowFile(this, path, content);
        files.add(file);
        return file;
    }

    public boolean removeFile(String path) {
        return files.removeIf(f -> f.getPath().equals(path));
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    /** The name users see: the one they typed, or the identifier for flows made before display names. */
    public String getDisplayName() {
        return displayName == null || displayName.isBlank() ? name : displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public FlowStatus getStatus() {
        return status;
    }

    public void setStatus(FlowStatus status) {
        this.status = status;
    }

    public String getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getUpdatedBy() {
        return updatedBy;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public long getVersion() {
        return version;
    }

    public List<FlowFile> getFiles() {
        return files;
    }
}
