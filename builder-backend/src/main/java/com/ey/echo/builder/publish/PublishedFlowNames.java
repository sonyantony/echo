package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.PublishedNames;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** The names of the flows in the primary publish target, for the name checks of new flows. */
@Component
class PublishedFlowNames implements PublishedNames {

    private static final Logger log = LoggerFactory.getLogger(PublishedFlowNames.class);

    private final PublishTargets targets;
    private final ObjectMapper json = new ObjectMapper();

    PublishedFlowNames(PublishTargets targets) {
        this.targets = targets;
    }

    @Override
    public List<PublishedName> list() {
        var primary = targets.primary();
        if (primary.isEmpty()) {
            return List.of();
        }
        try {
            return primary.get().list().stream()
                    .map(folder -> new PublishedName(folder.name(), displayName(folder.files().get(PublishService.METADATA_FILE))))
                    .toList();
        } catch (RuntimeException e) {
            // Git out of reach: the Builder's own flows are still checked, and Publish says what is wrong.
            log.warn("Could not list the published flows to check a flow name", e);
            return List.of();
        }
    }

    private String displayName(String metadata) {
        if (metadata == null) {
            return null;
        }
        try {
            var node = json.readTree(metadata).get("displayName");
            return node == null || node.isNull() || node.asText().isBlank() ? null : node.asText();
        } catch (Exception e) {
            return null; // edited by hand and broken: the folder name still counts
        }
    }
}
