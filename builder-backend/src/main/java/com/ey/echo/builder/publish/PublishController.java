package com.ey.echo.builder.publish;

import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
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

    public PublishController(PublishService service) {
        this.service = service;
    }

    public record PublishRequest(@Size(max = 1000) String message) {}

    public record PublishedFlow(
            String commitSha, String branch, String publishedBy, Instant publishedAt, String message,
            boolean changed) {

        static PublishedFlow of(PublishEvent e, boolean changed) {
            return new PublishedFlow(e.getCommitSha(), e.getBranch(), e.getPublishedBy(), e.getPublishedAt(),
                    e.getMessage(), changed);
        }
    }

    @PostMapping("/publish")
    public ResponseEntity<?> publish(@PathVariable long id, @RequestBody(required = false) PublishRequest request,
            Principal user) {
        var outcome = service.publish(id, user.getName(), request == null ? null : request.message());
        return switch (outcome) {
            case PublishService.Outcome.Published p -> ResponseEntity.ok(PublishedFlow.of(p.event(), p.changed()));
            case PublishService.Outcome.Invalid i -> ResponseEntity.unprocessableEntity().body(i.validation());
        };
    }

    /** Deletes the flow from the Builder and, if it was published, from Git. */
    @DeleteMapping
    public ResponseEntity<Void> delete(@PathVariable long id, Principal user) {
        service.delete(id, user.getName());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/history")
    public List<PublishedFlow> history(@PathVariable long id) {
        return service.history(id).stream().map(e -> PublishedFlow.of(e, true)).toList();
    }
}
