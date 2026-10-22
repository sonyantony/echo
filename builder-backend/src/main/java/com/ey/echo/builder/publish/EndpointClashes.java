package com.ey.echo.builder.publish;

import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.RestFromSpec;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Stops a publish when the flow would serve an endpoint, or use an operationId, that a flow
 * already published (in the primary target, as the Flows page shows them) uses too. An endpoint is
 * a method and an effective path: the Base Path (or Context Path) plus the spec's path, or a
 * platform-http route's path, including the Swagger UI routes ECHO adds at {@code <Base Path>/docs}.
 * Path parameters match whatever their names ({@code /cards/{id}} is {@code /cards/{cardId}}), and a
 * platform-http route without {@code httpMethodRestrict} takes every method. Drafts are not
 * checked, and neither is the flow's own published folder. The pipeline's {@code BundleCheck}
 * catches the same clashes (and more) when it builds a bundle; this tells the user at Publish.
 */
@Component
public class EndpointClashes {

    private final PublishTargets targets;

    public EndpointClashes(PublishTargets targets) {
        this.targets = targets;
    }

    /**
     * @param flowName the flow being published (its folder)
     * @param previousName the folder it was last published to if renamed since, else null
     * @param files its files as they are published (with the REST part {@link RestFromSpec} adds)
     * @return one line per clash, e.g. {@code POST /api/cards is already used by flow card-orders}
     */
    public List<String> check(String flowName, String previousName, Map<String, String> files) {
        var primary = targets.primary();
        if (primary.isEmpty()) {
            return List.of();
        }
        var mine = Uses.of(flowName, files);
        var clashes = new LinkedHashSet<String>();
        for (var folder : primary.get().list()) {
            if (folder.name().equals(flowName) || folder.name().equals(previousName)) {
                continue;
            }
            var theirs = Uses.of(folder.name(), folder.files());
            for (var e : mine.endpoints()) {
                if (theirs.endpoints().stream().anyMatch(e::overlaps)) {
                    clashes.add("%s is already used by flow %s".formatted(e.label(), folder.name()));
                }
            }
            for (String id : mine.operationIds()) {
                if (theirs.operationIds().contains(id)) {
                    clashes.add("operationId %s is already used by flow %s".formatted(id, folder.name()));
                }
            }
        }
        return List.copyOf(clashes);
    }

    /**
     * Something the flow serves.
     *
     * @param method upper case, or null for every method
     * @param path normalised: leading slash, no trailing slash, path parameters as {@code {}}
     * @param label how users read it, e.g. {@code GET /cards/{id}} or {@code Swagger UI at /docs}
     */
    record Endpoint(String method, String path, String label) {

        boolean overlaps(Endpoint other) {
            return path.equals(other.path)
                    && (method == null || other.method == null || method.equals(other.method));
        }
    }

    /** What a flow's files say it serves and which operationIds its spec has. */
    record Uses(List<Endpoint> endpoints, Set<String> operationIds) {

        static Uses of(String flowName, Map<String, String> files) {
            var endpoints = new ArrayList<Endpoint>();
            var operationIds = new LinkedHashSet<String>();
            if (!(yaml(files.get(FlowNames.routeFile(flowName))) instanceof List<?> entries)) {
                return new Uses(endpoints, operationIds);
            }
            String spec = null;
            String contextPath = null;
            for (Object entry : entries) {
                if (!(entry instanceof Map<?, ?> e)) {
                    continue;
                }
                if (e.get("rest") instanceof Map<?, ?> rest && rest.get("openApi") instanceof Map<?, ?> api
                        && api.get("specification") instanceof String s) {
                    spec = s.strip().replaceFirst("^classpath:", "");
                }
                if (e.get("restConfiguration") instanceof Map<?, ?> conf && conf.get("contextPath") instanceof String c) {
                    contextPath = c;
                }
                if (e.get("route") instanceof Map<?, ?> route) {
                    from(route.get("from"), route.get("id"), endpoints);
                }
                from(e.get("from"), null, endpoints);
            }
            String specContent = spec == null ? null : files.get(spec);
            if (specContent != null) {
                int i = 0; // the spec's operations first, so they lead the list of clashes
                for (var op : RestFromSpec.servedOperations(specContent, contextPath)) {
                    endpoints.add(i++, new Endpoint(op.method(), normalise(op.path()), op.method() + " " + op.path()));
                    if (op.operationId() != null) {
                        operationIds.add(op.operationId());
                    }
                }
            }
            return new Uses(endpoints, operationIds);
        }

        /** A platform-http consumer; the Swagger UI routes are named as one thing. */
        private static void from(Object from, Object routeId, List<Endpoint> endpoints) {
            if (!(from instanceof Map<?, ?> f) || !(f.get("uri") instanceof String u)) {
                return;
            }
            String uri = u.strip();
            if (!uri.startsWith("platform-http:")) {
                return;
            }
            String query = uri.contains("?") ? uri.substring(uri.indexOf('?') + 1) : "";
            String path = uri.substring("platform-http:".length()).replaceFirst("\\?.*$", "");
            String methods = f.get("parameters") instanceof Map<?, ?> p && p.get("httpMethodRestrict") != null
                    ? String.valueOf(p.get("httpMethodRestrict"))
                    : queryParameter(query, "httpMethodRestrict");
            boolean docs = routeId instanceof String id && id.startsWith(RestFromSpec.DOCS_ROUTE_PREFIX);
            String shown = path.startsWith("/") ? path : "/" + path;
            if (methods == null || methods.isBlank()) {
                endpoints.add(new Endpoint(null, normalise(path), docs ? swaggerUi(shown) : shown + " (any method)"));
                return;
            }
            for (String m : methods.split(",")) {
                String method = m.strip().toUpperCase(java.util.Locale.ROOT);
                if (!method.isEmpty()) {
                    endpoints.add(new Endpoint(method, normalise(path), docs ? swaggerUi(shown) : method + " " + shown));
                }
            }
        }

        /** The Swagger UI page is at {@code <Base Path>/docs}; its script, style and spec sit under it. */
        private static String swaggerUi(String path) {
            int docs = path.lastIndexOf("/docs");
            return "Swagger UI at " + (docs < 0 ? path : path.substring(0, docs + "/docs".length()));
        }

        private static String queryParameter(String query, String name) {
            for (String pair : query.split("&")) {
                if (pair.startsWith(name + "=")) {
                    return java.net.URLDecoder.decode(pair.substring(name.length() + 1), java.nio.charset.StandardCharsets.UTF_8);
                }
            }
            return null;
        }
    }

    static String normalise(String path) {
        String p = Objects.requireNonNullElse(path, "").strip().replaceAll("/{2,}", "/").replaceAll("\\{[^}/]*}", "{}");
        while (p.endsWith("/") && p.length() > 1) {
            p = p.substring(0, p.length() - 1);
        }
        return p.startsWith("/") ? p : "/" + p;
    }

    private static Object yaml(String text) {
        if (text == null) {
            return null;
        }
        try {
            return new Yaml(new SafeConstructor(new LoaderOptions())).load(text);
        } catch (RuntimeException e) {
            return null; // a broken published flow cannot serve anything
        }
    }
}
