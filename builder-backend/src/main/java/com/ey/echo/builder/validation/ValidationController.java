package com.ey.echo.builder.validation;

import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ValidationController {

    private final FlowService flows;
    private final FlowValidator validator;
    private final ApiCatalog apis;

    public ValidationController(FlowService flows, FlowValidator validator, ApiCatalog apis) {
        this.flows = flows;
        this.validator = validator;
        this.apis = apis;
    }

    @PostMapping("/api/flows/{id}/validate")
    public ValidationResult validate(@PathVariable long id) {
        var flow = flows.get(id);
        String routeFile = FlowNames.routeFile(flow.getName());
        return validator.validate(routeFile, apis.withSpecs(routeFile, flows.files(id)));
    }
}
