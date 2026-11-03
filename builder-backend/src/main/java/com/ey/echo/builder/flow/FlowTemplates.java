package com.ey.echo.builder.flow;

/**
 * Starting content for a new flow. The route file starts with no routes: they come from the flow's
 * Interface (each operation gets a {@code direct:<operationId>} route) or are added on the canvas.
 * A ready-made HTTP route used to be added here, but it listened on {@code /<flow name>} and took
 * the calls of a spec operation with the same path, before the REST service made from the spec.
 * Client Request Validation and Enable CORS start on (canvas toolbar), so requests that do not fit
 * the spec get a 400 from the start and web pages on other sites can call the flow; the flow can
 * still turn either off.
 */
final class FlowTemplates {

    private FlowTemplates() {}

    /** No routes, only the REST configuration with Client Request Validation and Enable CORS on; Kaoto opens it as a canvas with no routes. */
    static String route() {
        return """
                - restConfiguration:
                    clientRequestValidation: true
                    enableCORS: true
                """;
    }

    static String applicationProperties(String name) {
        return """
                # Non-secret settings for the %s flow (ports, downstream URLs).
                """.formatted(name);
    }
}
