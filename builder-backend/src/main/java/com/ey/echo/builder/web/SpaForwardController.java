package com.ey.echo.builder.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Serves the UI's index.html for client-side routes (e.g. /login, /flows/12) so a browser
 * refresh works. Paths with a dot are static files; /api and /actuator are never forwarded.
 */
@Controller
public class SpaForwardController {

    @GetMapping({"/", "/{path:^(?!api$|actuator$)[^.]*}", "/{path:^(?!api$|actuator$)[^.]*}/**"})
    public String forward() {
        return "forward:/index.html";
    }
}
