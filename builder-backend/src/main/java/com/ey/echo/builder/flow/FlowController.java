package com.ey.echo.builder.flow;

import com.ey.echo.builder.flow.FlowDtos.CreateFlow;
import com.ey.echo.builder.flow.FlowDtos.FlowDetail;
import com.ey.echo.builder.flow.FlowDtos.FlowSummary;
import com.ey.echo.builder.flow.FlowDtos.UpdateFlow;
import jakarta.validation.Valid;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.security.Principal;
import java.util.List;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

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
        return ResponseEntity.created(URI.create("/api/flows/" + flow.getId())).body(service.detail(flow.getId()));
    }

    /** Uploads a flow zip (as made by download) as a new flow draft. */
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<FlowDetail> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "description", required = false) String description,
            Principal user) throws IOException {
        FlowArchive.Contents archive;
        try (var in = file.getInputStream()) {
            archive = FlowArchive.read(in);
        }
        var flow = service.upload(archive, name, description, user.getName());
        return ResponseEntity.created(URI.create("/api/flows/" + flow.getId())).body(service.detail(flow.getId()));
    }

    /** The flow draft as a zip of its folder, to keep on the user's computer. */
    @GetMapping(value = "/{id}/download", produces = "application/zip")
    public ResponseEntity<byte[]> download(@PathVariable long id) throws IOException {
        var name = service.get(id).getName();
        var out = new ByteArrayOutputStream();
        FlowArchive.write(name, service.files(id), out);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(name + ".zip").build().toString())
                .contentType(MediaType.parseMediaType("application/zip"))
                .body(out.toByteArray());
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

    /** Save As: the flow (route as on screen) under another display name; 409 with confirmOverwrite if a flow has it. */
    @PostMapping("/{id}/save-as")
    public ResponseEntity<FlowDetail> saveAs(@PathVariable long id, @Valid @RequestBody FlowDtos.SaveAs request,
            Principal user) {
        boolean existed = service.findByDisplayName(request.name()).isPresent();
        var flow = service.saveAs(id, request.name(), request.routeContent(), request.overwrite(), user.getName());
        var detail = service.detail(flow.getId());
        return existed ? ResponseEntity.ok(detail)
                : ResponseEntity.created(URI.create("/api/flows/" + flow.getId())).body(detail);
    }

    // DELETE /{id} is in PublishController: deleting a published flow also removes it from Git.

    // {*path} captures the rest of the URL (with a leading slash), so files may sit in sub-folders.

    @GetMapping(value = "/{id}/files/{*path}", produces = MediaType.TEXT_PLAIN_VALUE)
    public String readFile(@PathVariable long id, @PathVariable String path) {
        return service.readFile(id, stripSlash(path));
    }

    @PutMapping(value = "/{id}/files/{*path}", consumes = MediaType.ALL_VALUE)
    public ResponseEntity<Void> writeFile(
            @PathVariable long id, @PathVariable String path, @RequestBody(required = false) String content,
            Principal user) {
        retryOnConflict(() -> service.writeFile(id, stripSlash(path), content == null ? "" : content, user.getName()));
        return ResponseEntity.noContent().build();
    }

    /** Saves the flow's OpenAPI spec under the given file name (its format follows the extension). */
    @PutMapping(value = "/{id}/api-spec/{name}", consumes = MediaType.ALL_VALUE)
    public FlowDetail saveApiSpec(
            @PathVariable long id, @PathVariable String name, @RequestBody(required = false) String content,
            Principal user) {
        service.saveApiSpec(id, name, content == null ? "" : content, user.getName());
        return service.detail(id);
    }

    /** A spec to check, and which of its paths (all when left out). */
    public record PathCheck(String spec, java.util.Set<String> paths) {}

    /**
     * The paths of a spec for this flow that other flows (in the Builder or published) have, with
     * the flow that has each: Interface asks before keeping a new path, and before an upload.
     */
    @PostMapping("/{id}/path-clashes")
    public List<ApiPaths.PathClash> pathClashes(@PathVariable long id, @RequestBody PathCheck check) {
        return service.pathClashes(id, check.spec() == null ? "" : check.spec(), check.paths());
    }

    /** Every flow's OpenAPI spec (flow and file name), for picking one to copy into a flow. */
    @GetMapping("/api-specs")
    public List<FlowDtos.ApiSpecRef> apiSpecs() {
        return service.apiSpecs();
    }

    /** Copies flow sourceId's OpenAPI spec into this flow, replacing the spec it had. */
    @PostMapping("/{id}/api-spec/copy-from/{sourceId}")
    public FlowDetail copyApiSpec(@PathVariable long id, @PathVariable long sourceId, Principal user) {
        service.copyApiSpec(id, sourceId, user.getName());
        return service.detail(id);
    }

    @DeleteMapping("/{id}/files/{*path}")
    public ResponseEntity<Void> deleteFile(@PathVariable long id, @PathVariable String path, Principal user) {
        retryOnConflict(() -> service.deleteFile(id, stripSlash(path), user.getName()));
        return ResponseEntity.noContent().build();
    }

    /**
     * Runs a file change again when another change to the same flow committed first. The editor
     * saves several files at once (opening a DataMapper writes its .xsl and .kaoto together), and
     * each save touches the flow's row, so the second one used to fail on the row's version.
     */
    private static void retryOnConflict(Runnable change) {
        for (int attempt = 1; ; attempt++) {
            try {
                change.run();
                return;
            } catch (ObjectOptimisticLockingFailureException e) {
                if (attempt >= 5) {
                    throw e;
                }
            }
        }
    }

    private static String stripSlash(String path) {
        return path.startsWith("/") ? path.substring(1) : path;
    }
}
