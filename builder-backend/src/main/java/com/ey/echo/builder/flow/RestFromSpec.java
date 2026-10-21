package com.ey.echo.builder.flow;

import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeTuple;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.SequenceNode;

/**
 * The REST part of a flow, made by ECHO from the flow's OpenAPI spec (the editor has no Rest tab).
 * A flow with a spec serves it contract-first: one {@code rest} service whose
 * {@code openApi.specification} is the spec file, so Camel sends each operation to
 * {@code direct:<operationId>} under the spec's Base Path (its server URL). An operation the flow
 * has no route for answers 404: ECHO adds a small route for it, and the service's
 * {@code missingOperation} is {@code ignore}, so the flow starts anyway.
 *
 * <p>The draft keeps only what the user designs (routes, and the REST configuration the Flow
 * Design menu sets); this is added to the route file whenever the flow leaves the editor (Run,
 * Validate, Publish, Download, Save As Template), so it always follows the spec as it is then,
 * and the published flow is complete for the pipeline. {@link #strip} takes it out again when a
 * published or downloaded flow comes back as a draft.
 */
public final class RestFromSpec {

    /** Routes ECHO adds for operations the flow does not implement. */
    static final String MISSING_ROUTE_PREFIX = "echo-missing-";
    private static final Set<String> VERBS = Set.of("get", "put", "post", "delete", "options", "head", "patch", "trace");
    /** A rest service with only these keys is a contract-first one, the kind ECHO makes. */
    private static final Set<String> CONTRACT_FIRST_KEYS = Set.of("id", "description", "openApi");

    private RestFromSpec() {
    }

    /**
     * The flow's files with the REST part in the route file. Without a spec only an earlier
     * generated part is taken out.
     *
     * @param spec the flow's OpenAPI spec file, if it has one ({@link ApiSpecFiles#find})
     */
    public static Map<String, String> apply(String routeFile, Optional<String> spec, Map<String, String> files) {
        String route = files.get(routeFile);
        if (route == null) {
            return files;
        }
        var result = new TreeMap<>(files);
        result.put(routeFile, applyTo(route, spec.orElse(null), spec.map(files::get).orElse(null)));
        return result;
    }

    /** The route YAML with the REST part for this spec; unchanged if it is not a YAML list (Validate says why). */
    static String applyTo(String yaml, String specName, String specContent) {
        var root = compose(yaml);
        if (root == null) {
            return yaml;
        }
        boolean changed = removeGenerated(root);
        if (specName != null && specContent != null) {
            var spec = Spec.read(specContent);
            var entries = root.getValue();
            entries.add(compose("""
                    - rest:
                        id: echo-openapi
                        openApi:
                          specification: %s
                          missingOperation: ignore
                    """.formatted(quoted(specName))).getValue().getFirst());
            var implemented = directRoutes(root);
            for (String operation : spec.operationIds()) {
                if (!implemented.contains(operation)) {
                    entries.add(compose(missingRoute(operation)).getValue().getFirst());
                }
            }
            // The spec's Base Path decides where the operations are; an older Context Path would replace it.
            if (spec.hasBasePath()) {
                restConfiguration(root).ifPresent(conf -> conf.getValue().removeIf(t -> key(t).equals("contextPath")));
            }
            changed = true;
        }
        return changed ? serialize(root) : yaml;
    }

    /** The route YAML without what {@link #apply} added, as it was in the editor. */
    public static String strip(String yaml) {
        var root = compose(yaml);
        return root != null && removeGenerated(root) ? serialize(root) : yaml;
    }

    /** Contract-first rest services and the 404 routes for missing operations. */
    private static boolean removeGenerated(SequenceNode root) {
        return root.getValue().removeIf(entry -> {
            if (!(entry instanceof MappingNode map) || map.getValue().size() != 1) {
                return false;
            }
            NodeTuple only = map.getValue().getFirst();
            if (key(only).equals("rest") && only.getValueNode() instanceof MappingNode rest) {
                return rest.getValue().stream().anyMatch(t -> key(t).equals("openApi"))
                        && rest.getValue().stream().allMatch(t -> CONTRACT_FIRST_KEYS.contains(key(t)));
            }
            return key(only).equals("route") && only.getValueNode() instanceof MappingNode route
                    && scalar(route, "id").filter(id -> id.startsWith(MISSING_ROUTE_PREFIX)).isPresent();
        });
    }

    private static String missingRoute(String operation) {
        String body = "{\"error\":\"Not found\",\"message\":\"This flow does not implement the operation %s yet.\"}"
                .formatted(operation);
        return """
                - route:
                    id: %s
                    description: Made by EY ECHO; the flow has no route for this operation of its OpenAPI spec
                    from:
                      uri: %s
                      steps:
                        - setHeader:
                            name: CamelHttpResponseCode
                            constant: 404
                        - setHeader:
                            name: Content-Type
                            constant: application/json
                        - setBody:
                            constant: %s
                """.formatted(quoted(MISSING_ROUTE_PREFIX + operation), quoted("direct:" + operation), quoted(body));
    }

    /** The operations the flow has a {@code direct:} route for. */
    private static Set<String> directRoutes(SequenceNode root) {
        var names = new LinkedHashSet<String>();
        for (Node entry : root.getValue()) {
            if (!(entry instanceof MappingNode map)) {
                continue;
            }
            for (NodeTuple t : map.getValue()) {
                Optional<String> uri = switch (key(t)) {
                    case "route" -> t.getValueNode() instanceof MappingNode route ? scalar(route, "from", "uri") : Optional.empty();
                    case "from" -> t.getValueNode() instanceof MappingNode from ? scalar(from, "uri") : Optional.empty();
                    default -> Optional.empty();
                };
                uri.map(String::strip).filter(u -> u.startsWith("direct:"))
                        .map(u -> u.substring("direct:".length()).replaceFirst("^//", "").replaceFirst("\\?.*$", ""))
                        .ifPresent(names::add);
            }
        }
        return names;
    }

    private static Optional<MappingNode> restConfiguration(SequenceNode root) {
        return root.getValue().stream()
                .filter(MappingNode.class::isInstance).map(MappingNode.class::cast)
                .flatMap(m -> m.getValue().stream())
                .filter(t -> key(t).equals("restConfiguration") && t.getValueNode() instanceof MappingNode)
                .map(t -> (MappingNode) t.getValueNode())
                .findFirst();
    }

    /**
     * The paths the flow serves for its spec, as Camel works them out: the REST configuration's
     * Context Path if the route file still sets one, otherwise the spec's Base Path, then each
     * operation's path. For the Run panel.
     */
    public static Map<String, List<String>> servedPaths(String specContent, String contextPath) {
        var spec = Spec.read(specContent);
        String base = contextPath != null && !contextPath.isBlank() ? contextPath : spec.basePath();
        base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        var paths = new java.util.LinkedHashMap<String, List<String>>();
        for (var op : spec.operations()) {
            String path = base + (op.path().startsWith("/") ? op.path() : "/" + op.path());
            paths.computeIfAbsent(path.startsWith("/") ? path : "/" + path, p -> new ArrayList<>()).add(op.method());
        }
        return paths;
    }

    /** One operation of the spec. */
    record Operation(String method, String path, String operationId) {
    }

    /** What ECHO needs from the spec: its operations and its Base Path (the path of its server URL). */
    record Spec(List<Operation> operations, String basePath) {

        boolean hasBasePath() {
            return !basePath.isEmpty();
        }

        List<String> operationIds() {
            return operations.stream().map(Operation::operationId).filter(java.util.Objects::nonNull).distinct().toList();
        }

        static Spec read(String content) {
            Object doc;
            try {
                doc = new Yaml(new SafeConstructor(new LoaderOptions())).load(content);
            } catch (RuntimeException e) {
                return new Spec(List.of(), ""); // Camel reports a broken spec when the flow starts
            }
            if (!(doc instanceof Map<?, ?> map)) {
                return new Spec(List.of(), "");
            }
            var operations = new ArrayList<Operation>();
            if (map.get("paths") instanceof Map<?, ?> paths) {
                paths.forEach((path, item) -> {
                    if (item instanceof Map<?, ?> verbs) {
                        verbs.forEach((verb, op) -> {
                            String method = String.valueOf(verb).toLowerCase();
                            if (VERBS.contains(method) && op instanceof Map<?, ?> o) {
                                String id = o.get("operationId") instanceof String i && !i.isBlank() ? i.strip() : null;
                                operations.add(new Operation(method.toUpperCase(), String.valueOf(path), id));
                            }
                        });
                    }
                });
            }
            return new Spec(List.copyOf(operations), basePath(map));
        }

        /** Like Camel's RestOpenApiHelper: the path of the (last) server URL, without a trailing slash. */
        private static String basePath(Map<?, ?> spec) {
            String base = "";
            if (spec.get("servers") instanceof List<?> servers) {
                for (Object server : servers) {
                    if (server instanceof Map<?, ?> s && s.get("url") instanceof String url) {
                        String path;
                        try {
                            path = java.net.URI.create(url.strip()).getPath();
                        } catch (IllegalArgumentException e) {
                            path = url.strip();
                        }
                        base = path == null ? "" : path;
                    }
                }
            } else if (spec.get("basePath") instanceof String b) {
                base = b.strip(); // Swagger 2.0
            }
            while (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            return base;
        }
    }

    private static SequenceNode compose(String yaml) {
        try {
            return new Yaml(new LoaderOptions()).compose(new StringReader(yaml)) instanceof SequenceNode seq ? seq : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String serialize(Node root) {
        var options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setIndent(2);
        options.setIndicatorIndent(2);
        options.setIndentWithIndicator(true);
        options.setWidth(Integer.MAX_VALUE);
        var out = new StringWriter();
        new Yaml(options).serialize(root, out);
        // SnakeYAML indents the top-level list too; Kaoto starts it at the margin.
        return out.toString().replaceAll("(?m)^  ", "");
    }

    private static String key(NodeTuple tuple) {
        return tuple.getKeyNode() instanceof ScalarNode k ? k.getValue() : "";
    }

    private static Optional<String> scalar(MappingNode map, String... keys) {
        Node node = map;
        for (String key : keys) {
            if (!(node instanceof MappingNode m)) {
                return Optional.empty();
            }
            node = m.getValue().stream().filter(t -> key(t).equals(key)).map(NodeTuple::getValueNode).findFirst().orElse(null);
        }
        return node instanceof ScalarNode s ? Optional.of(s.getValue()) : Optional.empty();
    }

    /** A YAML single-quoted string. */
    private static String quoted(String text) {
        return "'" + text.replace("'", "''") + "'";
    }
}
