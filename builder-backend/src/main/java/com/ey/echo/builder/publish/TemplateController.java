package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.FlowDtos.SaveAs;
import com.ey.echo.builder.flow.FlowService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.security.Principal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Flow templates in Git (or the primary publish target): Open Template and Save As Template. */
@RestController
@RequestMapping("/api/templates")
public class TemplateController {

    private final TemplateService service;
    private final FlowService flows;

    public TemplateController(TemplateService service, FlowService flows) {
        this.service = service;
        this.flows = flows;
    }

    public record OpenTemplate(@NotBlank String name, @Size(max = 1000) String description) {}

    @GetMapping
    public List<TemplateService.Template> list() {
        return service.list();
    }

    /** Save As Template: 409 with confirmOverwrite if a template with that name exists. */
    @PostMapping("/from-flow/{flowId}")
    public TemplateService.Template save(@PathVariable long flowId, @Valid @RequestBody SaveAs request,
            Principal user) {
        return service.save(flowId, request.name(), request.routeContent(), request.overwrite(), user.getName());
    }

    /** Open Template: a new draft made from the template. */
    @PostMapping("/{name}/flows")
    public ResponseEntity<?> open(@PathVariable String name, @Valid @RequestBody OpenTemplate request,
            Principal user) {
        var flow = service.open(name, request.name(), request.description(), user.getName());
        return ResponseEntity.created(URI.create("/api/flows/" + flow.getId())).body(flows.detail(flow.getId()));
    }
}
