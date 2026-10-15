package com.ey.echo.builder.flow;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

public final class FlowDtos {

    private FlowDtos() {}

    public record CreateFlow(@NotBlank String name, @Size(max = 1000) String description) {}

    public record UpdateFlow(@NotBlank String name, @Size(max = 1000) String description) {}

    public record FlowSummary(
            long id, String name, String description, FlowStatus status, String updatedBy, Instant updatedAt) {

        static FlowSummary of(Flow f) {
            return new FlowSummary(f.getId(), f.getName(), f.getDescription(), f.getStatus(), f.getUpdatedBy(),
                    f.getUpdatedAt());
        }
    }

    public record FlowDetail(
            long id,
            String name,
            String description,
            FlowStatus status,
            String routeFile,
            List<String> files,
            String createdBy,
            Instant createdAt,
            String updatedBy,
            Instant updatedAt) {

        static FlowDetail of(Flow f) {
            return new FlowDetail(f.getId(), f.getName(), f.getDescription(), f.getStatus(),
                    FlowNames.routeFile(f.getName()), f.getFiles().stream().map(FlowFile::getPath).sorted().toList(),
                    f.getCreatedBy(), f.getCreatedAt(), f.getUpdatedBy(), f.getUpdatedAt());
        }
    }
}
