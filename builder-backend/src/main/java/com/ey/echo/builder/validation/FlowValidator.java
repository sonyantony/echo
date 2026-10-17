package com.ey.echo.builder.validation;

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
 *       placeholders defined in application.properties, XSLT files present in the flow;
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
    /** An http or https uri: group 2 is the URL after the scheme, without options. */
    private static final Pattern HTTP_URI = Pattern.compile("^(https?)(?::/*([^?]*))?(?:\\?.*)?$");

    private final ValidationProperties properties;

    public FlowValidator(ValidationProperties properties) {
        this.properties = properties;
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
        if (!problems.isEmpty()) {
            return ValidationResult.of(problems);
        }

        var flowProperties = loadProperties(files.get("application.properties"), problems);
        try (var checker = new ScopeChecker(routeFile, files, flowProperties, problems)) {
            checker.walk(root, null);
        }
        return ValidationResult.of(problems);
    }

    private static void loadWithCamel(String routeFile, String yaml, List<Problem> problems) {
        try (var context = new DefaultCamelContext(false)) {
            context.build();
            PluginHelper.getRoutesLoader(context).loadRoutes(ResourceHelper.fromString(routeFile, yaml));
        } catch (Exception e) {
            problems.add(new Problem(routeFile, lineOf(e), describe(e)));
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

        ScopeChecker(String routeFile, Map<String, String> files, Properties flowProperties, List<Problem> problems) {
            this.routeFile = routeFile;
            this.files = files;
            this.flowProperties = flowProperties;
            this.problems = problems;
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
            if (XSLT_COMPONENTS.contains(scheme)) {
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
