import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Writes the routes of a bundle image's combined API docs page (build-flow.sh --mode bundle): one
 * Swagger UI page at /api-docs whose "Select a definition" drop-down lists every bundled flow with
 * a spec, sorted by name ignoring case. Picking a flow loads the spec that flow already serves at
 * <Base Path>/docs/openapi, one at a time, so data types of the same name in different flows never
 * meet. Writes nothing if no flow has a spec.
 *
 *   java -cp snakeyaml.jar pipeline/ApiDocsPage.java <out.camel.yaml> <flow-folder>...
 */
public class ApiDocsPage {

    /** Where the page is; BundleCheck keeps flows off it. */
    static final String PATH = "/api-docs";
    /** Where the routes find Swagger UI (build-flow.sh sets the property, as for each flow's page). */
    static final String SWAGGER_UI = "META-INF/resources/webjars/swagger-ui/{{echo.swagger-ui.version}}/";

    record Entry(String name, String specPath) {
    }

    public static void main(String[] args) throws Exception {
        var entries = new ArrayList<Entry>();
        for (int i = 1; i < args.length; i++) {
            Path dir = Path.of(args[i]);
            String name = dir.getFileName().toString();
            String spec = specPath(Files.readString(dir.resolve(name + ".camel.yaml")), name);
            if (spec != null) {
                entries.add(new Entry(name, spec));
            }
        }
        if (entries.isEmpty()) {
            return;
        }
        entries.sort((a, b) -> {
            int c = String.CASE_INSENSITIVE_ORDER.compare(a.name(), b.name());
            return c != 0 ? c : a.name().compareTo(b.name());
        });
        Files.writeString(Path.of(args[0]), routes(entries));
        System.err.println("Combined API docs at " + PATH + ": "
                + String.join(", ", entries.stream().map(Entry::name).toList()));
    }

    /** The path of the route RestFromSpec adds to serve the flow's spec (echo-docs-<flow>-spec). */
    static String specPath(String routeYaml, String flow) {
        Object doc = new Yaml(new SafeConstructor(new LoaderOptions())).load(routeYaml);
        if (!(doc instanceof List<?> list)) {
            return null;
        }
        for (Object entry : list) {
            if (entry instanceof Map<?, ?> e && e.get("route") instanceof Map<?, ?> route
                    && ("echo-docs-" + flow + "-spec").equals(route.get("id"))
                    && route.get("from") instanceof Map<?, ?> from && from.get("uri") instanceof String uri
                    && uri.strip().startsWith("platform-http:")) {
                return uri.strip().substring("platform-http:".length()).replaceFirst("\\?.*$", "");
            }
        }
        return null;
    }

    static String routes(List<Entry> entries) {
        var urls = new ArrayList<String>();
        for (Entry e : entries) {
            // Relative to /api-docs, like each flow's page, so it also works behind a proxy.
            urls.add("{url: '%s', name: '%s'}".formatted(js(e.specPath().replaceFirst("^/+", "")), js(e.name())));
        }
        String page = """
                <!doctype html>
                <html lang="en">
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>API docs</title>
                <link rel="stylesheet" href="api-docs/swagger-ui.css">
                </head>
                <body>
                <div id="swagger-ui"></div>
                <script src="api-docs/swagger-ui-bundle.js"></script>
                <script src="api-docs/swagger-ui-standalone-preset.js"></script>
                <script>
                window.ui = SwaggerUIBundle({
                  urls: [%s],
                  dom_id: '#swagger-ui',
                  deepLinking: true,
                  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
                  plugins: [SwaggerUIBundle.plugins.DownloadUrl],
                  layout: 'StandaloneLayout',
                  requestInterceptor: function (request) {
                    var url = new URL(request.url, window.location.href);
                    if (url.origin !== window.location.origin) {
                      request.url = window.location.origin + url.pathname + url.search;
                    }
                    return request;
                  }
                });
                </script>
                </body>
                </html>
                """.formatted(String.join(", ", urls));
        // One line: YAML would fold the line breaks of a quoted string anyway. Names are escaped, so the
        // page has no {{ for Camel to take as a property placeholder.
        String oneLine = String.join("", page.lines().map(String::strip).toList());
        return route("echo-api-docs", PATH, "text/html; charset=utf-8", oneLine)
                + route("echo-api-docs-script", PATH + "/swagger-ui-bundle.js", "text/javascript",
                        "resource:classpath:" + SWAGGER_UI + "swagger-ui-bundle.js")
                + route("echo-api-docs-preset", PATH + "/swagger-ui-standalone-preset.js", "text/javascript",
                        "resource:classpath:" + SWAGGER_UI + "swagger-ui-standalone-preset.js")
                + route("echo-api-docs-style", PATH + "/swagger-ui.css", "text/css",
                        "resource:classpath:" + SWAGGER_UI + "swagger-ui.css");
    }

    private static String route(String id, String path, String contentType, String body) {
        return """
                - route:
                    id: %s
                    description: Made by EY ECHO; Swagger UI for every flow in this image
                    from:
                      uri: %s
                      parameters:
                        httpMethodRestrict: GET
                      steps:
                        - setHeader:
                            name: Content-Type
                            constant: %s
                        - setBody:
                            constant: %s
                """.formatted(quoted(id), quoted("platform-http:" + path), quoted(contentType), quoted(body));
    }

    /** Text for a single-quoted JavaScript string inside an HTML script element. */
    private static String js(String text) {
        return text.replace("\\", "\\\\").replace("'", "\\'").replace("<", "\\x3c").replace("{", "\\x7b");
    }

    /** A YAML single-quoted string. */
    private static String quoted(String text) {
        return "'" + text.replace("'", "''") + "'";
    }
}
