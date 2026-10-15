package com.ey.echo.builder.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Serves the UI's index.html for the UI's client-side routes so a browser refresh works.
 * Keep in step with the routes in builder-ui/src/App.tsx.
 */
@Controller
public class SpaForwardController {

    @GetMapping({"/", "/login", "/flows", "/flows/{id}", "/playground"})
    public String forward() {
        return "forward:/index.html";
    }
}
