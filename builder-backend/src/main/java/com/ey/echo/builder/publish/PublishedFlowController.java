package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.FlowArchive;
import com.ey.echo.builder.flow.FlowService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.security.Principal;
import java.util.List;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Flows as they are in Git, listed next to the Builder drafts on the Flows page. */
@RestController
@RequestMapping("/api/published-flows")
public class PublishedFlowController {

    private final PublishedFlowService service;
    private final FlowService flows;

    public PublishedFlowController(PublishedFlowService service, FlowService flows) {
        this.service = service;
        this.flows = flows;
    }

    @GetMapping
    public List<PublishedFlowService.PublishedFlow> list() {
        return service.list();
    }

    /** The published flow as a zip, in the same layout as a draft download. */
    @GetMapping(value = "/{name}/download", produces = "application/zip")
    public ResponseEntity<byte[]> download(@PathVariable String name) throws IOException {
        var out = new ByteArrayOutputStream();
        FlowArchive.write(name, service.files(name), out);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(name + ".zip").build().toString())
                .contentType(MediaType.parseMediaType("application/zip"))
                .body(out.toByteArray());
    }

    /**
     * Copies the published flow into the Builder as a new draft, or with {@code replace=true} over
     * the draft it is linked to.
     */
    @PostMapping("/{name}/draft")
    public ResponseEntity<?> createDraft(@PathVariable String name,
            @RequestParam(defaultValue = "false") boolean replace, Principal user) {
        var flow = service.createDraft(name, replace, user.getName());
        return ResponseEntity.created(URI.create("/api/flows/" + flow.getId())).body(flows.detail(flow.getId()));
    }

    /** Keeps the flow in Git but marks it disabled, so the pipeline leaves it out of images. */
    @PostMapping("/{name}/disable")
    public ResponseEntity<Void> disable(@PathVariable String name, Principal user) {
        service.setDisabled(name, true, user.getName());
        return ResponseEntity.noContent().build();
    }

    /** Lets the pipeline build the flow again. */
    @PostMapping("/{name}/enable")
    public ResponseEntity<Void> enable(@PathVariable String name, Principal user) {
        service.setDisabled(name, false, user.getName());
        return ResponseEntity.noContent().build();
    }

    /** Removes the flow from Git and, if the Builder has it, from the Builder too. */
    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(@PathVariable String name, Principal user) {
        service.delete(name, user.getName());
        return ResponseEntity.noContent().build();
    }
}
