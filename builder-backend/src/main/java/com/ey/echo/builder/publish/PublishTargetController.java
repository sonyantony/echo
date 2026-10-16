package com.ey.echo.builder.publish;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Where Publish sends flows, for the Publish dialog. */
@RestController
public class PublishTargetController {

    private final PublishTargets targets;

    public PublishTargetController(PublishTargets targets) {
        this.targets = targets;
    }

    public record Target(String id, String name, String location) {}

    @GetMapping("/api/publish-targets")
    public List<Target> enabled() {
        return targets.enabled().stream().map(t -> new Target(t.id(), t.displayName(), t.location())).toList();
    }
}
