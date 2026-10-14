package com.ey.echo.builder.flow;

/** Starting content for a new flow: an HTTP endpoint ready to receive JSON. */
final class FlowTemplates {

    private FlowTemplates() {}

    static String route(String name) {
        return """
                - route:
                    id: %1$s
                    from:
                      id: from-%1$s
                      uri: platform-http:/%1$s
                      parameters:
                        httpMethodRestrict: POST
                      steps:
                        - log:
                            id: log-request
                            message: "Received: ${body}"
                """.formatted(name);
    }

    static String applicationProperties(String name) {
        return """
                # Non-secret settings for the %s flow (ports, downstream URLs).
                """.formatted(name);
    }
}
