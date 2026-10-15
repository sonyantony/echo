package com.ey.echo.builder.flow;

import com.ey.echo.builder.flow.FlowDtos.CreateFlow;
import com.ey.echo.builder.flow.FlowDtos.FlowDetail;
import com.ey.echo.builder.flow.FlowDtos.FlowSummary;
import com.ey.echo.builder.flow.FlowDtos.UpdateFlow;
import jakarta.validation.Valid;
import java.net.URI;
import java.security.Principal;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/flows")
public class FlowController {

    private final FlowService service;

    public FlowController(FlowService service) {
        this.service = service;
    }

    @GetMapping
    public List<FlowSummary> list() {
        return service.list().stream().map(FlowSummary::of).toList();
    }

    @PostMapping
    public ResponseEntity<FlowDetail> create(@Valid @RequestBody CreateFlow request, Principal user) {
        var flow = service.create(request.name(), request.description(), user.getName());
        return ResponseEntity.created(URI.create("/api/flows/" + flow.getId())).body(FlowDetail.of(flow));
    }

    @GetMapping("/{id}")
    public FlowDetail get(@PathVariable long id) {
        return service.detail(id);
    }

    @PutMapping("/{id}")
    public FlowDetail update(@PathVariable long id, @Valid @RequestBody UpdateFlow request, Principal user) {
        service.update(id, request.name(), request.description(), user.getName());
        return service.detail(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    // {*path} captures the rest of the URL (with a leading slash), so files may sit in sub-folders.

    @GetMapping(value = "/{id}/files/{*path}", produces = MediaType.TEXT_PLAIN_VALUE)
    public String readFile(@PathVariable long id, @PathVariable String path) {
        return service.readFile(id, stripSlash(path));
    }

    @PutMapping(value = "/{id}/files/{*path}", consumes = MediaType.ALL_VALUE)
    public ResponseEntity<Void> writeFile(
            @PathVariable long id, @PathVariable String path, @RequestBody(required = false) String content,
            Principal user) {
        service.writeFile(id, stripSlash(path), content == null ? "" : content, user.getName());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}/files/{*path}")
    public ResponseEntity<Void> deleteFile(@PathVariable long id, @PathVariable String path, Principal user) {
        service.deleteFile(id, stripSlash(path), user.getName());
        return ResponseEntity.noContent().build();
    }

    private static String stripSlash(String path) {
        return path.startsWith("/") ? path.substring(1) : path;
    }
}
