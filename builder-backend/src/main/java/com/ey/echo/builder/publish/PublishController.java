package com.ey.echo.builder.publish;

import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/flows/{id}")
public class PublishController {

    private final PublishService service;
    private final PublishTargets targets;

    public PublishController(PublishService service, PublishTargets targets) {
        this.service = service;
        this.targets = targets;
    }

    /**
     * @param allowMissingRoutes false to get a 409 listing the spec's operations no route handles
     *        instead of publishing (the dialog asks, then sends true); left out, they do not stop a publish
     */
    public record PublishRequest(@Size(max = 1000) String message, Boolean allowMissingRoutes) {}

    /**
     * One target's part of a publish.
     *
     * @param target the target's id, e.g. git
     * @param name the target's name for users, e.g. Git
     * @param error why this target failed, or null
     */
    public record TargetResult(String target, String name, String location, String revision, boolean changed,
            String error) {}

    public record PublishedFlow(
            String publishedBy, Instant publishedAt, String message, boolean changed, List<TargetResult> targets) {}

    private PublishedFlow view(PublishEvent e, List<TargetOutcome> outcomes, boolean changed) {
        return new PublishedFlow(e.getPublishedBy(), e.getPublishedAt(), e.getMessage(), changed,
                outcomes.stream().map(o -> new TargetResult(o.target(), targets.displayName(o.target()),
                        o.location(), o.revision(), o.changed(), o.error())).toList());
    }

    @PostMapping("/publish")
    public ResponseEntity<?> publish(@PathVariable long id, @RequestBody(required = false) PublishRequest request,
            Principal user) {
        var outcome = service.publish(id, user.getName(), request == null ? null : request.message(),
                request == null || !Boolean.FALSE.equals(request.allowMissingRoutes()));
        return switch (outcome) {
            case PublishService.Outcome.Published p ->
                    ResponseEntity.ok(view(p.event(), p.targets(), p.changed()));
            case PublishService.Outcome.Invalid i -> ResponseEntity.unprocessableEntity().body(i.validation());
            case PublishService.Outcome.Clashes c -> ResponseEntity.status(HttpStatus.CONFLICT).body(clashes(c.clashes()));
            case PublishService.Outcome.MissingRoutes m -> ResponseEntity.status(HttpStatus.CONFLICT).body(missingRoutes(m));
        };
    }

    private static ProblemDetail missingRoutes(PublishService.Outcome.MissingRoutes missing) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
                "Not published yet: some operations of the flow's OpenAPI spec have no route and answer 404.");
        problem.setTitle("Operations without a route");
        problem.setProperty("missingRoutes", missing.operations());
        return problem;
    }

    private static ProblemDetail clashes(List<String> clashes) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
                "Not published: published flows already use these endpoints.");
        problem.setTitle("Endpoints already used");
        problem.setProperty("clashes", clashes);
        return problem;
    }

    /** Deletes the flow from the Builder and, if it was published, from every publish target. */
    @DeleteMapping
    public ResponseEntity<Void> delete(@PathVariable long id, Principal user) {
        service.delete(id, user.getName());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/history")
    public List<PublishedFlow> history(@PathVariable long id) {
        return service.history(id).stream().map(e -> view(e, e.getTargets(), true)).toList();
    }
}
