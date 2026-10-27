package com.ey.echo.builder.flow;

/**
 * Starting content for a new flow. The route file starts with no routes: they come from the flow's
 * Interface (each operation gets a {@code direct:<operationId>} route) or are added on the canvas.
 * A ready-made HTTP route used to be added here, but it listened on {@code /<flow name>} and took
 * the calls of a spec operation with the same path, before the REST service made from the spec.
 */
final class FlowTemplates {

    private FlowTemplates() {}

    /** An empty route list (YAML), which Kaoto opens as a canvas with no routes. */
    static String route() {
        return "[]\n";
    }

    static String applicationProperties(String name) {
        return """
                # Non-secret settings for the %s flow (ports, downstream URLs).
                """.formatted(name);
    }
}
