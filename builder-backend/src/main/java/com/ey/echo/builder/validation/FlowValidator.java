package com.ey.echo.builder.validation;

import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.validation.ValidationResult.Problem;
import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.camel.Exchange;
import org.apache.camel.impl.DefaultCamelContext;
import org.apache.camel.support.PatternHelper;
import org.apache.camel.support.PluginHelper;
import org.apache.camel.support.ResourceHelper;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.error.MarkedYAMLException;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeTuple;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.SequenceNode;

/**
 * Checks a flow before it is published, in four steps; each step runs only if the previous
 * one passed:
 *
 * <ol>
 *   <li>the route file is well-formed YAML;
 *   <li>Camel 4.22's YAML DSL loads it into a throwaway, never-started Camel context (catches
 *       unknown steps and wrong structure, with line numbers);
 *   <li>only allowed components and expression languages, property
 *       placeholders defined in application.properties, XSLT files present in the flow, REST
 *       OpenApi steps calling allowed operations of approved APIs ({@code echo.apis}), REST
 *       configuration on platform-http with binding off and no API docs;
 *   <li>simple-language expressions parse.
 * </ol>
 */
@Component
public class FlowValidator {

    /** Expression languages that, if used, are reported as not allowed. */
    private static final Set<String> OTHER_LANGUAGES = Set.of("jsonpath", "jq", "xpath", "xquery", "groovy", "js",
            "python", "ognl", "mvel", "spel", "datasonnet", "jsonata", "csimple", "joor", "java", "wasm");
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{([^}:]+)(?::([^}]*))?}}");
    private static final Set<String> XSLT_COMPONENTS = Set.of("xslt-saxon", "xslt");
    private static final String NOTHING_MAPPED =
            "A DataMapper step has no mapping yet. Open it in the DataMapper and map its fields.";
    /** An http or https uri: group 2 is the URL after the scheme, without options. */
    private static final Pattern HTTP_URI = Pattern.compile("^(https?)(?::/*([^?]*))?(?:\\?.*)?$");

    private static final String REST_OPENAPI = "rest-openapi";
    /** An endpoint URI as an Enrich expression: a component scheme, a colon, and no spaces. */
    private static final Pattern ENDPOINT_URI = Pattern.compile("^[a-z][a-z0-9+.-]*:\\S*$");

    private final ValidationProperties properties;
    private final ApiCatalog apis;

    @org.springframework.beans.factory.annotation.Autowired
    public FlowValidator(ValidationProperties properties, ApiCatalog apis) {
        this.properties = properties;
        this.apis = apis;
    }

    public FlowValidator(ValidationProperties properties) {
        this(properties, ApiCatalog.none());
    }

    /**
     * @param routeFile name of the Camel route file inside the flow
     * @param files all files of the flow, path to content
     */
    public ValidationResult validate(String routeFile, Map<String, String> files) {
        var problems = new ArrayList<Problem>();
        String yaml = files.get(routeFile);
        if (yaml == null || yaml.isBlank()) {
            return ValidationResult.of(List.of(new Problem(routeFile, null, "The route file is empty.")));
        }

        Node root;
        try {
            root = new Yaml(new LoaderOptions()).compose(new StringReader(yaml));
        } catch (MarkedYAMLException e) {
            return ValidationResult.of(List.of(new Problem(routeFile, e.getProblemMark().getLine() + 1,
                    "Malformed YAML: " + e.getProblem())));
        }
        if (root == null) {
            return ValidationResult.of(List.of(new Problem(routeFile, null, "The route file is empty.")));
        }

        loadWithCamel(routeFile, yaml, problems);
        // Nothing mapped yet is no reason to stop: the rest of the flow is still worth checking.
        if (problems.stream().anyMatch(p -> !p.message().equals(NOTHING_MAPPED))) {
            return ValidationResult.of(problems);
        }
        // Camel stops at the first one; the walk reports each DataMapper with nothing mapped at its step.
        boolean nothingMapped = problems.removeIf(p -> p.message().equals(NOTHING_MAPPED));

        var flowProperties = loadProperties(files.get("application.properties"), problems);
        try (var checker = new ScopeChecker(routeFile, files, flowProperties, problems, nothingMapped)) {
            checker.walk(root, null);
        }
        return ValidationResult.of(problems);
    }

    private static void loadWithCamel(String routeFile, String yaml, List<Problem> problems) {
        try (var context = new DefaultCamelContext(false)) {
            context.build();
            PluginHelper.getRoutesLoader(context).loadRoutes(ResourceHelper.fromString(routeFile, yaml));
        } catch (Exception e) {
            String message = describe(e);
            // A DataMapper as Kaoto adds it (and ECHO's route scaffold does): xslt-saxon, no file yet.
            if (message.contains("resourceUri is required") && message.contains("syntax xslt")) {
                message = NOTHING_MAPPED;
            }
            problems.add(new Problem(routeFile, lineOf(e), message));
        }
    }

    private static Properties loadProperties(String content, List<Problem> problems) {
        var props = new Properties();
        if (content != null) {
            try {
                props.load(new StringReader(content));
            } catch (IOException | IllegalArgumentException e) {
                problems.add(new Problem("application.properties", null, "Cannot read properties: " + e.getMessage()));
            }
        }
        return props;
    }

    /** Walks the YAML node tree and checks components, languages and expressions. */
    private final class ScopeChecker implements AutoCloseable {

        private final String routeFile;
        private final Map<String, String> files;
        private final Properties flowProperties;
        private final List<Problem> problems;
        private final org.apache.camel.CamelContext camel = new DefaultCamelContext(false);
        // Per route, in document order: does it start with platform-http, and have the incoming
        // request's headers been removed yet?
        private boolean fromPlatformHttp;
        private boolean headersRemoved;
        private boolean headersReported;
        // Camel found a DataMapper with nothing mapped: each xslt step without a file is reported.
        private final boolean nothingMapped;

        ScopeChecker(String routeFile, Map<String, String> files, Properties flowProperties, List<Problem> problems,
                boolean nothingMapped) {
            this.routeFile = routeFile;
            this.files = files;
            this.flowProperties = flowProperties;
            this.problems = problems;
            this.nothingMapped = nothingMapped;
            camel.build();
        }

        @Override
        public void close() {
            camel.stop();
        }

        void walk(Node node, String key) {
            switch (node) {
                case MappingNode map -> {
                    checkHttpUrl(map);
                    checkApiCall(map);
                    for (NodeTuple tuple : map.getValue()) {
                        if (tuple.getKeyNode() instanceof ScalarNode k) {
                            check(k.getValue(), tuple.getValueNode());
                            walk(tuple.getValueNode(), k.getValue());
                        }
                    }
                }
                case SequenceNode seq -> seq.getValue().forEach(n -> walk(n, key));
                default -> {
                    // scalars are checked by their parent key
                }
            }
        }

        private void check(String key, Node value) {
            int line = value.getStartMark().getLine() + 1;
            if (key.equals("from") && value instanceof MappingNode from) {
                fromPlatformHttp = scalar(from, "uri").map(u -> u.startsWith("platform-http:")).orElse(false);
                headersRemoved = false;
                headersReported = false;
            } else if (key.equals("removeHeaders")) {
                String pattern = value instanceof ScalarNode s ? s.getValue()
                        : value instanceof MappingNode m ? scalar(m, "pattern").orElse("") : "";
                if (PatternHelper.matchPattern(Exchange.HTTP_URI, pattern)
                        && PatternHelper.matchPattern(Exchange.HTTP_PATH, pattern)) {
                    headersRemoved = true;
                }
            }
            if (key.equals("restConfiguration") && value instanceof MappingNode rest) {
                checkRestConfiguration(rest);
            }
            if (key.equals("enrich") && value instanceof MappingNode enrich) {
                checkEnrich(enrich);
            }
            if (key.equals("uri") && value instanceof ScalarNode s) {
                checkUri(s.getValue(), line);
            } else if (OTHER_LANGUAGES.contains(key)) {
                problems.add(new Problem(routeFile, line,
                        "The '%s' expression language is not allowed in flows (allowed languages: %s)."
                                .formatted(key, String.join(", ", properties.allowedLanguages()))));
            } else if (key.equals("simple")) {
                expressionText(value).ifPresent(text -> checkSimple(text, line));
            } else if (key.equals("log") && value instanceof ScalarNode s) {
                checkSimple(s.getValue(), line);
            } else if (key.equals("message") && value instanceof ScalarNode s) {
                checkSimple(s.getValue(), line); // log: { message: ... } is a simple expression
            }
        }

        /**
         * An http step dropped on the canvas starts as {@code uri: http} with no URL; Camel then
         * fails to start with a NullPointerException. The URL can be in the uri or in
         * {@code parameters.httpUri}, which is where Kaoto's form puts it.
         */
        private void checkHttpUrl(MappingNode step) {
            ScalarNode uri = null;
            String httpUri = null;
            for (NodeTuple t : step.getValue()) {
                if (!(t.getKeyNode() instanceof ScalarNode k)) {
                    continue;
                }
                if (k.getValue().equals("uri") && t.getValueNode() instanceof ScalarNode v) {
                    uri = v;
                } else if (k.getValue().equals("parameters") && t.getValueNode() instanceof MappingNode params) {
                    for (NodeTuple p : params.getValue()) {
                        if (p.getKeyNode() instanceof ScalarNode pk && pk.getValue().equals("httpUri")
                                && p.getValueNode() instanceof ScalarNode pv) {
                            httpUri = pv.getValue();
                        }
                    }
                }
            }
            if (uri == null) {
                return;
            }
            int line = uri.getStartMark().getLine() + 1;
            Matcher m = HTTP_URI.matcher(quietlyResolved(uri.getValue().strip()));
            if (!m.matches()) {
                return;
            }
            if ((m.group(2) == null || m.group(2).isEmpty()) && (httpUri == null || httpUri.isBlank())) {
                problems.add(new Problem(routeFile, line,
                        "This %s step has no URL. Select it on the canvas and fill in Http Uri, for example %s://host.docker.internal:9090/orders."
                                .formatted(m.group(1), m.group(1))));
            } else if (fromPlatformHttp && !headersRemoved && !headersReported
                    && !scalar(step, "parameters", "bridgeEndpoint").map(Boolean::parseBoolean).orElse(false)) {
                // The incoming request's CamelHttpUri/CamelHttpPath headers would be added to this URL.
                headersReported = true;
                problems.add(new Problem(routeFile, line,
                        "The incoming request's headers would change the URL this %s step calls. Add a Remove Headers step with pattern * before it, or turn on Bridge Endpoint in the step."
                                .formatted(m.group(1))));
            }
        }

        /**
         * REST services always run on platform-http, with binding off and no generated API docs;
         * the editor hides these settings, but an uploaded flow can still name them.
         */
        private void checkRestConfiguration(MappingNode rest) {
            scalarNode(rest, "component").filter(c -> !quietlyResolved(c.getValue().strip()).equals("platform-http"))
                    .ifPresent(c -> problems.add(new Problem(routeFile, c.getStartMark().getLine() + 1,
                            "REST services in flows always run on platform-http, so remove 'component: %s' from the REST configuration."
                                    .formatted(c.getValue()))));
            scalarNode(rest, "bindingMode").filter(b -> !b.getValue().strip().equals("off"))
                    .ifPresent(b -> problems.add(new Problem(routeFile, b.getStartMark().getLine() + 1,
                            "REST binding mode '%s' is not supported in flows (bodies stay plain JSON text), so remove 'bindingMode' from the REST configuration."
                                    .formatted(b.getValue()))));
            scalarNode(rest, "apiContextPath").filter(a -> !a.getValue().isBlank())
                    .ifPresent(a -> problems.add(new Problem(routeFile, a.getStartMark().getLine() + 1,
                            "Generated API docs are not supported in flows, so remove 'apiContextPath' from the REST configuration.")));
        }

        private static java.util.Optional<ScalarNode> scalarNode(MappingNode map, String key) {
            return map.getValue().stream()
                    .filter(t -> t.getKeyNode() instanceof ScalarNode k && k.getValue().equals(key))
                    .map(NodeTuple::getValueNode).filter(ScalarNode.class::isInstance).map(ScalarNode.class::cast)
                    .findFirst();
        }

        /**
         * A REST OpenApi step: {@code rest-openapi:<spec>#<operationId>}, or Kaoto's form with
         * {@code specificationUri} and {@code operationId} under {@code parameters}. It must call
         * an allowed operation of an approved API ({@code echo.apis}), and set {@code host} when
         * the spec names no server host.
         */
        private void checkApiCall(MappingNode step) {
            var uriNode = step.getValue().stream()
                    .filter(t -> t.getKeyNode() instanceof ScalarNode k && k.getValue().equals("uri")
                            && t.getValueNode() instanceof ScalarNode)
                    .map(t -> (ScalarNode) t.getValueNode()).findFirst().orElse(null);
            if (uriNode == null) {
                return;
            }
            checkApiCall(uriNode.getValue(), uriNode.getStartMark().getLine() + 1, "REST OpenApi step",
                    name -> scalar(step, "parameters", name));
        }

        /**
         * An Enrich step whose expression is a plain endpoint URI (simple without ${...}, or
         * constant), as ECHO's approved API drop-downs write it: the URI is checked like a To
         * step's, and a {@code rest-openapi:} one like a REST OpenApi step, its options being in
         * the URI ({@code ?host=...}).
         */
        private void checkEnrich(MappingNode enrich) {
            ScalarNode text = null;
            for (NodeTuple t : enrich.getValue()) {
                if (!(t.getKeyNode() instanceof ScalarNode k)) {
                    continue;
                }
                Node language = t.getValueNode();
                if (k.getValue().equals("expression") && language instanceof MappingNode m && m.getValue().size() == 1
                        && m.getValue().get(0).getKeyNode() instanceof ScalarNode lk) {
                    k = lk;
                    language = m.getValue().get(0).getValueNode();
                }
                if (k.getValue().equals("simple") || k.getValue().equals("constant")) {
                    text = expressionNode(language);
                }
            }
            if (text == null) {
                return;
            }
            String uri = text.getValue().strip();
            if (uri.contains("${") || !ENDPOINT_URI.matcher(uri).matches()) {
                return; // computed, or not a URI: Camel decides at run time
            }
            int line = text.getStartMark().getLine() + 1;
            checkUri(uri, line);
            String query = uri.contains("?") ? uri.substring(uri.indexOf('?') + 1) : "";
            checkApiCall(uri, line, "Enrich step", name -> java.util.Arrays.stream(query.split("&"))
                    .filter(option -> option.startsWith(name + "="))
                    .map(option -> option.substring(name.length() + 1)).findFirst());
        }

        private static ScalarNode expressionNode(Node value) {
            if (value instanceof ScalarNode s) {
                return s;
            }
            if (value instanceof MappingNode m) {
                for (NodeTuple t : m.getValue()) {
                    if (t.getKeyNode() instanceof ScalarNode k && k.getValue().equals("expression")
                            && t.getValueNode() instanceof ScalarNode v) {
                        return v;
                    }
                }
            }
            return null;
        }

        private void checkApiCall(String rawUri, int line, String what,
                java.util.function.Function<String, java.util.Optional<String>> option) {
            String uri = quietlyResolved(rawUri.strip());
            if (!uri.equals(REST_OPENAPI) && !uri.startsWith(REST_OPENAPI + ":")) {
                return;
            }
            String path = uri.length() > REST_OPENAPI.length() ? uri.substring(REST_OPENAPI.length() + 1) : "";
            path = path.replaceFirst("\\?.*$", "");
            int hash = path.indexOf('#');
            String spec = hash >= 0 ? path.substring(0, hash) : path;
            String operation = hash >= 0 ? path.substring(hash + 1) : "";
            if (spec.isBlank()) {
                spec = option.apply("specificationUri").orElse("");
            }
            if (operation.isBlank()) {
                operation = option.apply("operationId").orElse("");
            }
            spec = quietlyResolved(spec.strip());
            operation = quietlyResolved(operation.strip());

            if (fromPlatformHttp && !headersRemoved && !headersReported) {
                // The incoming request's CamelHttpUri/CamelHttpPath headers would be added to the URL.
                headersReported = true;
                problems.add(new Problem(routeFile, line,
                        "The incoming request's headers would change the URL this %s calls. Add a Remove Headers step with pattern * before it."
                                .formatted(what)));
            }
            var api = apis.forSpecificationUri(spec);
            if (api.isEmpty()) {
                if (spec.isBlank() && operation.isBlank() && !apis.only()) {
                    // As the route ECHO makes for a new operation leaves it, for the user to pick.
                    problems.add(new Problem(routeFile, line, apis.apis().isEmpty()
                            ? "This %s calls nothing yet. Set Specification Uri and Operation Id to the API operation it calls.".formatted(what)
                            : "This %s calls nothing yet. Set Specification Uri to one of: %s, and pick its Operation Id."
                                    .formatted(what, approvedFiles())));
                } else if (apis.only()) {
                    problems.add(new Problem(routeFile, line, (spec.isBlank()
                            ? "This %s has no spec. ".formatted(what)
                            : "'%s' is not an approved API. ".formatted(spec))
                            + "Set Specification Uri to one of: %s.".formatted(approvedFiles())));
                }
                return;
            }
            var a = api.get();
            if (a.problem() != null) {
                problems.add(new Problem(routeFile, line,
                        "The approved API '%s' could not be loaded: %s".formatted(a.name(), a.problem())));
                return;
            }
            var op = a.operations().get(operation);
            if (operation.isBlank()) {
                problems.add(new Problem(routeFile, line,
                        "Choose the %s operation this step calls (Operation Id).".formatted(a.name())));
            } else if (op == null) {
                problems.add(new Problem(routeFile, line,
                        "'%s' is not an operation of %s.".formatted(operation, a.name())));
            } else if (!op.allowed()) {
                problems.add(new Problem(routeFile, line,
                        "Flows may not call %s's '%s' operation (%s %s). Allowed: %s."
                                .formatted(a.name(), operation, op.method(), op.path(),
                                        String.join(", ", a.allowedOperations()))));
            }
            if (!a.hasHost() && option.apply("host").map(String::isBlank).orElse(true)) {
                problems.add(new Problem(routeFile, line,
                        "%s's spec names no server, so set Host on this %s, for example {{%s.base-url}} in application.properties."
                                .formatted(a.name(), what, a.id())));
            }
        }

        /** A scalar value at the given keys below the mapping, e.g. parameters.bridgeEndpoint. */
        private static java.util.Optional<String> scalar(MappingNode map, String... keys) {
            Node node = map;
            for (String key : keys) {
                if (!(node instanceof MappingNode m)) {
                    return java.util.Optional.empty();
                }
                node = m.getValue().stream()
                        .filter(t -> t.getKeyNode() instanceof ScalarNode k && k.getValue().equals(key))
                        .map(NodeTuple::getValueNode).findFirst().orElse(null);
            }
            return node instanceof ScalarNode s ? java.util.Optional.of(s.getValue()) : java.util.Optional.empty();
        }

        /** The uri with {{placeholders}} filled in where the flow sets them; problems are reported elsewhere. */
        private String quietlyResolved(String uri) {
            Matcher p = PLACEHOLDER.matcher(uri);
            var out = new StringBuilder();
            while (p.find()) {
                String value = flowProperties.getProperty(p.group(1).strip(), p.group(2));
                p.appendReplacement(out, Matcher.quoteReplacement(value == null ? p.group() : value));
            }
            p.appendTail(out);
            return out.toString();
        }

        private java.util.Optional<String> expressionText(Node value) {
            if (value instanceof ScalarNode s) {
                return java.util.Optional.of(s.getValue());
            }
            if (value instanceof MappingNode m) {
                for (NodeTuple t : m.getValue()) {
                    if (t.getKeyNode() instanceof ScalarNode k && k.getValue().equals("expression")
                            && t.getValueNode() instanceof ScalarNode v) {
                        return java.util.Optional.of(v.getValue());
                    }
                }
            }
            return java.util.Optional.empty();
        }

        private void checkSimple(String text, int line) {
            try {
                camel.resolveLanguage("simple").createExpression(text);
            } catch (Exception e) {
                problems.add(new Problem(routeFile, line, "Invalid expression '%s': %s"
                        .formatted(text, firstLine(e.getMessage()))));
            }
        }

        private void checkUri(String rawUri, int line) {
            String uri = resolvePlaceholders(rawUri, line);
            if (uri == null) {
                return;
            }
            int colon = uri.indexOf(':');
            String scheme = colon > 0 ? uri.substring(0, colon) : uri;
            if (!properties.allowedComponents().contains(scheme)) {
                problems.add(new Problem(routeFile, line,
                        "The '%s' component is not allowed in flows (allowed components: %s)."
                                .formatted(scheme, String.join(", ", properties.allowedComponents()))));
                return;
            }
            if (apis.only() && (scheme.equals("http") || scheme.equals("https"))) {
                problems.add(new Problem(routeFile, line,
                        "Flows may only call approved APIs (%s). Use a REST OpenApi step instead of %s."
                                .formatted(approvedNames(), scheme)));
                return;
            }
            if (XSLT_COMPONENTS.contains(scheme) && colon < 0 && nothingMapped) {
                problems.add(new Problem(routeFile, line, NOTHING_MAPPED));
            }
            if (XSLT_COMPONENTS.contains(scheme) && colon > 0) {
                String resource = uri.substring(colon + 1).replaceFirst("\\?.*$", "")
                        .replaceFirst("^(classpath|file):", "");
                if (!files.containsKey(resource)) {
                    problems.add(new Problem(routeFile, line,
                            "The mapping file '%s' is missing from the flow.".formatted(resource)));
                }
            }
        }

        private String resolvePlaceholders(String uri, int line) {
            Matcher m = PLACEHOLDER.matcher(uri);
            var out = new StringBuilder();
            while (m.find()) {
                String value = flowProperties.getProperty(m.group(1).strip(), m.group(2));
                if (value == null) {
                    problems.add(new Problem(routeFile, line,
                            "Property '%s' is not set in application.properties.".formatted(m.group(1).strip())));
                    return null;
                }
                m.appendReplacement(out, Matcher.quoteReplacement(value));
            }
            m.appendTail(out);
            return out.toString();
        }
    }

    private String approvedNames() {
        var names = apis.apis().stream().map(ApiCatalog.Api::name).toList();
        return names.isEmpty() ? "none are set up in echo.apis" : String.join(", ", names);
    }

    private String approvedFiles() {
        return apis.apis().stream().map(ApiCatalog.Api::fileName).collect(java.util.stream.Collectors.joining(", "));
    }

    private static Integer lineOf(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof MarkedYAMLException m && m.getProblemMark() != null) {
                return m.getProblemMark().getLine() + 1;
            }
            if (t.getMessage() != null) {
                var line = Pattern.compile("line (\\d+), column").matcher(t.getMessage());
                if (line.find()) {
                    return Integer.parseInt(line.group(1));
                }
            }
        }
        return null;
    }

    private static String describe(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String message = root.getMessage() != null ? root.getMessage() : root.getClass().getSimpleName();
        return firstLine(message);
    }

    private static String firstLine(String s) {
        if (s == null) {
            return "";
        }
        int nl = s.indexOf('\n');
        return (nl < 0 ? s : s.substring(0, nl)).strip();
    }
}
