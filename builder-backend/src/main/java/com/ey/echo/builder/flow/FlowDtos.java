package com.ey.echo.builder.flow;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

public final class FlowDtos {

    private FlowDtos() {}

    public record CreateFlow(@NotBlank String name, @Size(max = 1000) String description) {}

    public record UpdateFlow(@NotBlank String name, @Size(max = 1000) String description) {}

    /**
     * Save As, and Save As Template.
     *
     * @param routeContent the route as shown in the editor (unsaved edits included); null copies the saved route
     * @param overwrite true once the user confirmed replacing an existing flow or template
     */
    public record SaveAs(@NotBlank String name, String routeContent, boolean overwrite) {}

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
            String apiSpec,
            String createdBy,
            Instant createdAt,
            String updatedBy,
            Instant updatedAt) {

        /** @param apiSpec the flow's OpenAPI spec file ({@link ApiSpecFiles}), or null */
        static FlowDetail of(Flow f, String apiSpec) {
            return new FlowDetail(f.getId(), f.getName(), f.getDescription(), f.getStatus(),
                    FlowNames.routeFile(f.getName()), f.getFiles().stream().map(FlowFile::getPath).sorted().toList(),
                    apiSpec,
                    f.getCreatedBy(), f.getCreatedAt(), f.getUpdatedBy(), f.getUpdatedAt());
        }
    }
}
