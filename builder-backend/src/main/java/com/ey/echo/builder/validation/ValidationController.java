package com.ey.echo.builder.validation;

import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ValidationController {

    private final FlowService flows;
    private final FlowValidator validator;

    public ValidationController(FlowService flows, FlowValidator validator) {
        this.flows = flows;
        this.validator = validator;
    }

    @PostMapping("/api/flows/{id}/validate")
    public ValidationResult validate(@PathVariable long id) {
        var flow = flows.get(id);
        return validator.validate(FlowNames.routeFile(flow.getName()), flows.files(id));
    }
}
