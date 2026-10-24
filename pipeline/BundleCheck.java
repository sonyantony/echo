import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.TreeMap;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Checks that flows can share one bundle image (build-flow.sh --mode bundle). They run in one Camel
 * app on one port, so they must not serve the same Base Path or path, use the same direct:
 * endpoint or route/step id, ship different files under one name, set one property to different
 * values, or set the REST configuration (one per app) differently. /api-docs is kept for the
 * bundle's combined Swagger UI page (ApiDocsPage.java). Prints every conflict and exits 1.
 *
 *   java -cp snakeyaml.jar pipeline/BundleCheck.java <flow-folder>...
 */
public class BundleCheck {

    /** Who uses something, e.g. which flows serve a path: key -> flow names. */
    private final Map<String, Map<String, List<String>>> claims = new TreeMap<>();
    private final Map<String, Map<String, String>> fileOwners = new TreeMap<>();
    private final Map<String, Map<String, String>> propertyValues = new TreeMap<>();
    private final Map<String, String> restConfigurations = new LinkedHashMap<>();
    private final List<String> problems = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        var check = new BundleCheck();
        for (String dir : args) {
            check.flow(Path.of(dir));
        }
        check.report();
    }

    private void flow(Path dir) throws Exception {
        String name = dir.getFileName().toString();
        Object doc = yaml(Files.readString(dir.resolve(name + ".camel.yaml")));
        List<?> entries = doc instanceof List<?> l ? l : List.of();
        String spec = null;
        String contextPath = null;
        var paths = new ArrayList<String>();
        var ids = new java.util.TreeSet<String>();
        for (Object entry : entries) {
            if (!(entry instanceof Map<?, ?> e)) {
                continue;
            }
            if (map(e.get("rest")) == null) {
                ids(e, ids); // the generated rest service is renamed per flow by build-flow.sh
            }
            if (map(e.get("route")) instanceof Map<?, ?> route) {
                from(map(route.get("from")), name, paths);
            }
            from(map(e.get("from")), name, paths);
            if (map(e.get("rest")) instanceof Map<?, ?> rest && map(rest.get("openApi")) instanceof Map<?, ?> api) {
                spec = str(api.get("specification"));
            }
            if (map(e.get("restConfiguration")) instanceof Map<?, ?> conf) {
                contextPath = str(conf.get("contextPath"));
                restConfigurations.put(name, new TreeMap<>(conf).toString());
            }
        }
        ids.forEach(id -> claim("id", id, name));
        if (spec != null) {
            String base = contextPath != null ? contextPath : basePath(dir.resolve(spec.replaceFirst("^classpath:", "")));
            claim("Base Path or path", normalise(base), name);
        }
        for (String path : paths) {
            claim("Base Path or path", path, name);
        }
        try (var files = Files.list(dir)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                String f = file.getFileName().toString();
                if (!f.equals("echo-flow.json") && !f.equals("application.properties")) {
                    fileOwners.computeIfAbsent(f, k -> new TreeMap<>()).put(name, Files.readString(file));
                }
            }
        }
        Path props = dir.resolve("application.properties");
        if (Files.exists(props)) {
            var p = new Properties();
            try (var in = Files.newBufferedReader(props)) {
                p.load(in);
            }
            p.stringPropertyNames().forEach(k -> propertyValues.computeIfAbsent(k, x -> new TreeMap<>()).put(name, p.getProperty(k)));
        }
    }

    /** Route and step ids: Camel needs them unique among all the routes of the app. */
    private static void ids(Object node, java.util.Set<String> ids) {
        if (node instanceof Map<?, ?> m) {
            m.forEach((k, v) -> {
                if ("id".equals(k) && v instanceof String id) {
                    ids.add(id);
                } else {
                    ids(v, ids);
                }
            });
        } else if (node instanceof List<?> l) {
            l.forEach(item -> ids(item, ids));
        }
    }

    /** A route's consumer: platform-http paths and direct: names must be unique in the app. */
    private void from(Object from, String flow, List<String> paths) {
        String uri = from instanceof Map<?, ?> f ? str(f.get("uri")) : null;
        if (uri == null) {
            return;
        }
        uri = uri.strip().replaceFirst("\\?.*$", "");
        if (uri.startsWith("platform-http:")) {
            paths.add(normalise(uri.substring("platform-http:".length())));
        } else if (uri.startsWith("direct:")) {
            claim("direct: endpoint", uri.substring("direct:".length()).replaceFirst("^//", ""), flow);
        }
    }

    /** The path of the spec's (last) server URL, like Camel's rest-openapi. */
    private static String basePath(Path spec) throws Exception {
        if (!Files.exists(spec)) {
            return "";
        }
        Object doc = yaml(Files.readString(spec));
        String base = "";
        if (doc instanceof Map<?, ?> s) {
            if (s.get("servers") instanceof List<?> servers) {
                for (Object server : servers) {
                    if (server instanceof Map<?, ?> m && m.get("url") instanceof String url) {
                        try {
                            base = Objects.requireNonNullElse(java.net.URI.create(url.strip()).getPath(), "");
                        } catch (IllegalArgumentException e) {
                            base = url.strip();
                        }
                    }
                }
            } else if (s.get("basePath") instanceof String b) {
                base = b;
            }
        }
        return base;
    }

    private void claim(String kind, String key, String flow) {
        if (key != null && !key.isBlank()) {
            // Once per flow: a route switched off (autoStartup: false) and the 404 route ECHO adds for its
            // operation both read the same direct: endpoint, which is fine inside one flow.
            var flows = claims.computeIfAbsent(kind, k -> new TreeMap<>()).computeIfAbsent(key, k -> new ArrayList<>());
            if (!flows.contains(flow)) {
                flows.add(flow);
            }
        }
    }

    private void report() {
        claims.forEach((kind, keys) -> keys.forEach((key, flows) -> {
            if (flows.size() > 1) {
                problems.add("%s %s is used by more than one flow: %s".formatted(kind, key, String.join(", ", flows)));
            }
        }));
        fileOwners.forEach((file, owners) -> {
            if (owners.values().stream().distinct().count() > 1) {
                problems.add("file %s differs between flows: %s".formatted(file, String.join(", ", owners.keySet())));
            }
        });
        propertyValues.forEach((key, values) -> {
            if (values.values().stream().distinct().count() > 1) {
                problems.add("property %s has different values in flows: %s".formatted(key, String.join(", ", values.keySet())));
            }
        });
        // The bundle's combined API docs page (ApiDocsPage.java) is at /api-docs.
        claims.getOrDefault("Base Path or path", Map.of()).forEach((path, flows) -> {
            if (path.equals("/api-docs") || path.startsWith("/api-docs/")) {
                problems.add("Base Path or path %s is used by %s, but /api-docs is the bundle's combined API docs page"
                        .formatted(path, String.join(", ", flows)));
            }
        });
        if (restConfigurations.values().stream().distinct().count() > 1) {
            problems.add("the REST configuration (Client Request Validation, Enable CORS) differs between flows: "
                    + String.join(", ", restConfigurations.keySet()));
        }
        if (problems.isEmpty()) {
            return;
        }
        System.err.println("These flows cannot share one bundle image, because they run in one app on one port:");
        problems.forEach(p -> System.err.println("  - " + p));
        System.err.println("Give each flow its own Base Path (Openapi Design) or path and rename the clashing items,"
                + " or build with --mode per-flow.");
        System.exit(1);
    }

    private static String normalise(String path) {
        String p = path.strip();
        while (p.endsWith("/") && p.length() > 1) {
            p = p.substring(0, p.length() - 1);
        }
        return p.startsWith("/") ? p : "/" + p;
    }

    private static Object yaml(String text) {
        return new Yaml(new SafeConstructor(new LoaderOptions())).load(text);
    }

    private static Object map(Object o) {
        return o instanceof Map<?, ?> ? o : null;
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
