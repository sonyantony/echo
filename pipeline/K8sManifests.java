import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.TreeMap;
import java.util.TreeSet;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Writes Kubernetes manifests for one app built by build-flow.sh (a bundle, or one flow in per-flow
 * mode) into <out>/k8s: a Deployment of the image, a Service, and an Ingress (or a Gateway API
 * HTTPRoute) that sends only the app's own paths to it, so other apps on the same host keep theirs.
 *
 * The paths come from the flows: each operation path of the flow's OpenAPI spec under its Base Path
 * (a path with a {param} becomes a prefix up to the param: /orders/{id} -> prefix /orders), each
 * platform-http path, the flow's Swagger UI at <Base Path>/docs and, for a bundle, /api-docs.
 * Install-wide settings (host, ingress class, TLS, namespace, ...) come from k8s.properties.
 *
 *   java -cp snakeyaml.jar pipeline/K8sManifests.java <k8s.properties> <app> <image> <out> [--api-docs] <flow-folder>...
 */
public class K8sManifests {

    record Rule(String path, boolean prefix) implements Comparable<Rule> {
        public int compareTo(Rule o) {
            int c = path.compareTo(o.path);
            return c != 0 ? c : Boolean.compare(prefix, o.prefix);
        }

        /** Whether this prefix rule already sends <other> to the app (Kubernetes prefixes match whole segments). */
        boolean covers(Rule other) {
            return prefix && !equals(other)
                    && (path.equals("/") || other.path.equals(path) || other.path.startsWith(path + "/"));
        }
    }

    public static void main(String[] args) throws Exception {
        var settings = new Properties();
        Path config = Path.of(args[0]);
        if (Files.exists(config)) {
            try (var in = Files.newBufferedReader(config)) {
                settings.load(in);
            }
        }
        if (!Boolean.parseBoolean(setting(settings, "k8s.enabled", "true"))) {
            return;
        }
        String app = dnsName(args[1]);
        String image = args[2];
        Path out = Path.of(args[3]).resolve("k8s");
        var rules = new TreeSet<Rule>();
        for (int i = 4; i < args.length; i++) {
            if (args[i].equals("--api-docs")) {
                rules.add(new Rule("/api-docs", true));
            } else {
                rules.addAll(rules(Path.of(args[i])));
            }
        }
        var paths = minimal(rules);

        Files.createDirectories(out);
        String namespace = setting(settings, "k8s.namespace", "");
        String version = image.contains(":") ? image.substring(image.lastIndexOf(':') + 1) : "";
        Files.writeString(out.resolve("deployment.yaml"), deployment(app, image, version, namespace,
                setting(settings, "k8s.replicas", "1")));
        Files.writeString(out.resolve("service.yaml"), service(app, namespace));
        Files.deleteIfExists(out.resolve("ingress.yaml"));
        Files.deleteIfExists(out.resolve("httproute.yaml"));
        String routing = setting(settings, "k8s.routing", "ingress");
        if (paths.isEmpty()) {
            System.err.println(app + ": no HTTP paths, so no " + routing + " is written");
        } else if (routing.equals("ingress")) {
            Files.writeString(out.resolve("ingress.yaml"), ingress(app, namespace, paths, settings));
        } else if (routing.equals("httproute")) {
            Files.writeString(out.resolve("httproute.yaml"), httpRoute(app, namespace, paths, settings));
        } else if (!routing.equals("none")) {
            System.err.println("k8s.routing must be ingress, httproute or none, not " + routing);
            System.exit(1);
        }
        System.err.println("Kubernetes manifests in " + out + " (" + app + "), paths: "
                + String.join(", ", paths.stream().map(r -> r.path() + (r.prefix() ? " (prefix)" : "")).toList()));
    }

    /** The paths one flow serves. */
    static List<Rule> rules(Path dir) throws Exception {
        String name = dir.getFileName().toString();
        Object doc = yaml(Files.readString(dir.resolve(name + ".camel.yaml")));
        var rules = new ArrayList<Rule>();
        String spec = null;
        String contextPath = null;
        for (Object entry : doc instanceof List<?> l ? l : List.of()) {
            if (!(entry instanceof Map<?, ?> e)) {
                continue;
            }
            if (e.get("route") instanceof Map<?, ?> route && route.get("from") instanceof Map<?, ?> from) {
                if (("echo-docs-" + name).equals(route.get("id"))) {
                    // Swagger UI: the page, its spec, script and style all live under <Base Path>/docs.
                    rules.add(new Rule(normalise(str(from.get("uri")).strip().substring("platform-http:".length())), true));
                } else if (from.get("uri") instanceof String uri && uri.strip().startsWith("platform-http:")) {
                    rules.add(httpRule(uri.strip().substring("platform-http:".length()), from.get("parameters")));
                }
            }
            if (e.get("rest") instanceof Map<?, ?> rest && rest.get("openApi") instanceof Map<?, ?> api) {
                spec = str(api.get("specification"));
            }
            if (e.get("restConfiguration") instanceof Map<?, ?> conf) {
                contextPath = str(conf.get("contextPath"));
            }
        }
        if (spec != null) {
            Path file = dir.resolve(spec.replaceFirst("^classpath:", ""));
            if (Files.exists(file) && yaml(Files.readString(file)) instanceof Map<?, ?> s) {
                String base = contextPath != null ? contextPath : basePath(s);
                if (s.get("paths") instanceof Map<?, ?> specPaths) {
                    for (Object path : specPaths.keySet()) {
                        rules.add(specRule(base, String.valueOf(path)));
                    }
                }
            }
        }
        return rules;
    }

    /** An operation path under the Base Path: exact, or a prefix up to its first {param}. */
    static Rule specRule(String base, String path) {
        String full = normalise(normalise(base) + "/" + path);
        int param = full.indexOf('{');
        if (param < 0) {
            return new Rule(full, false);
        }
        return new Rule(normalise(full.substring(0, full.lastIndexOf('/', param))), true);
    }

    /** A platform-http consumer: a prefix if it matches on the URI prefix or has a {param}. */
    static Rule httpRule(String uri, Object parameters) {
        String path = uri.replaceFirst("\\?.*$", "");
        boolean prefix = uri.matches(".*[?&]matchOnUriPrefix=true.*")
                || parameters instanceof Map<?, ?> p && "true".equals(String.valueOf(p.get("matchOnUriPrefix")));
        Rule rule = specRule("", path);
        return prefix ? new Rule(rule.path(), true) : rule;
    }

    /** Drops rules a prefix rule already covers. */
    static List<Rule> minimal(TreeSet<Rule> rules) {
        var keep = new ArrayList<Rule>();
        for (Rule r : rules) {
            if (rules.stream().noneMatch(p -> p.covers(r))) {
                keep.add(r);
            }
        }
        return keep;
    }

    /** The path of the spec's (last) server URL, like Camel's rest-openapi. */
    static String basePath(Map<?, ?> spec) {
        String base = "";
        if (spec.get("servers") instanceof List<?> servers) {
            for (Object server : servers) {
                if (server instanceof Map<?, ?> m && m.get("url") instanceof String url) {
                    try {
                        base = Objects.requireNonNullElse(java.net.URI.create(url.strip()).getPath(), "");
                    } catch (IllegalArgumentException e) {
                        base = url.strip();
                    }
                }
            }
        } else if (spec.get("basePath") instanceof String b) {
            base = b;
        }
        return base;
    }

    static String deployment(String app, String image, String version, String namespace, String replicas) {
        return """
                # Made by EY ECHO (pipeline/K8sManifests.java)
                apiVersion: apps/v1
                kind: Deployment
                metadata:
                  name: %1$s
                %2$s  labels:
                %3$s
                spec:
                  replicas: %4$s
                  selector:
                    matchLabels:
                      app.kubernetes.io/name: %1$s
                  template:
                    metadata:
                      labels:
                %5$s
                    spec:
                      containers:
                        - name: %1$s
                          image: %6$s
                          ports:
                            - name: http
                              containerPort: 8080
                          # Flow settings and secrets ({{placeholders}}) as environment variables, e.g. FULFILMENT_URL.
                          envFrom:
                            - secretRef:
                                name: %1$s-env
                                optional: true
                            - configMapRef:
                                name: %1$s-env
                                optional: true
                          livenessProbe:
                            httpGet:
                              path: /actuator/health/liveness
                              port: http
                            initialDelaySeconds: 20
                          readinessProbe:
                            httpGet:
                              path: /actuator/health/readiness
                              port: http
                            initialDelaySeconds: 10
                """.formatted(app, namespaceLine(namespace), labels(app, version, "    "), replicas,
                labels(app, version, "        "), quoted(image));
    }

    static String service(String app, String namespace) {
        return """
                # Made by EY ECHO (pipeline/K8sManifests.java)
                apiVersion: v1
                kind: Service
                metadata:
                  name: %1$s
                %2$s  labels:
                %3$s
                spec:
                  selector:
                    app.kubernetes.io/name: %1$s
                  ports:
                    - name: http
                      port: 80
                      targetPort: http
                """.formatted(app, namespaceLine(namespace), labels(app, "", "    "));
    }

    static String ingress(String app, String namespace, List<Rule> paths, Properties settings) {
        var y = new StringBuilder("""
                # Made by EY ECHO (pipeline/K8sManifests.java): only this app's paths, so other apps on the host keep theirs.
                apiVersion: networking.k8s.io/v1
                kind: Ingress
                metadata:
                  name: %s
                %s  labels:
                %s
                """.formatted(app, namespaceLine(namespace), labels(app, "", "    ")));
        var annotations = new TreeMap<String, String>();
        settings.stringPropertyNames().stream().filter(k -> k.startsWith("k8s.annotation."))
                .forEach(k -> annotations.put(k.substring("k8s.annotation.".length()), settings.getProperty(k)));
        if (!annotations.isEmpty()) {
            y.append("  annotations:\n");
            annotations.forEach((k, v) -> y.append("    ").append(k).append(": ").append(quoted(v)).append('\n'));
        }
        y.append("spec:\n");
        String ingressClass = setting(settings, "k8s.ingress-class", "");
        if (!ingressClass.isEmpty()) {
            y.append("  ingressClassName: ").append(quoted(ingressClass)).append('\n');
        }
        String host = setting(settings, "k8s.host", "");
        String tls = setting(settings, "k8s.tls-secret", "");
        if (!tls.isEmpty()) {
            y.append("  tls:\n    - secretName: ").append(quoted(tls)).append('\n');
            if (!host.isEmpty()) {
                y.append("      hosts:\n        - ").append(quoted(host)).append('\n');
            }
        }
        y.append("  rules:\n    - ");
        if (!host.isEmpty()) {
            y.append("host: ").append(quoted(host)).append("\n      ");
        }
        y.append("http:\n        paths:\n");
        for (Rule r : paths) {
            y.append("""
                              - path: %s
                                pathType: %s
                                backend:
                                  service:
                                    name: %s
                                    port:
                                      name: http
                    """.formatted(quoted(r.path()), r.prefix() ? "Prefix" : "Exact", app));
        }
        return y.toString();
    }

    static String httpRoute(String app, String namespace, List<Rule> paths, Properties settings) {
        String gateway = setting(settings, "k8s.gateway", "");
        if (gateway.isEmpty()) {
            System.err.println("k8s.routing=httproute needs k8s.gateway (<name> or <namespace>/<name>)");
            System.exit(1);
        }
        var y = new StringBuilder("""
                # Made by EY ECHO (pipeline/K8sManifests.java): only this app's paths, so other apps on the host keep theirs.
                apiVersion: gateway.networking.k8s.io/v1
                kind: HTTPRoute
                metadata:
                  name: %s
                %s  labels:
                %s
                spec:
                  parentRefs:
                    - name: %s
                """.formatted(app, namespaceLine(namespace), labels(app, "", "    "),
                quoted(gateway.substring(gateway.indexOf('/') + 1))));
        if (gateway.contains("/")) {
            y.append("      namespace: ").append(quoted(gateway.substring(0, gateway.indexOf('/')))).append('\n');
        }
        String host = setting(settings, "k8s.host", "");
        if (!host.isEmpty()) {
            y.append("  hostnames:\n    - ").append(quoted(host)).append('\n');
        }
        y.append("  rules:\n    - matches:\n");
        for (Rule r : paths) {
            y.append("""
                            - path:
                                type: %s
                                value: %s
                    """.formatted(r.prefix() ? "PathPrefix" : "Exact", quoted(r.path())));
        }
        y.append("      backendRefs:\n        - name: ").append(app).append("\n          port: 80\n");
        return y.toString();
    }

    private static String labels(String app, String version, String indent) {
        var labels = new LinkedHashMap<String, String>();
        labels.put("app.kubernetes.io/name", app);
        labels.put("app.kubernetes.io/part-of", "ey-echo");
        if (!version.isEmpty() && version.matches("[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?")) {
            labels.put("app.kubernetes.io/version", version);
        }
        var y = new ArrayList<String>();
        labels.forEach((k, v) -> y.add(indent + k + ": " + quoted(v)));
        return String.join("\n", y);
    }

    private static String namespaceLine(String namespace) {
        return namespace.isEmpty() ? "" : "  namespace: " + quoted(namespace) + "\n";
    }

    /** A Kubernetes object name: lower case letters, digits and dashes. */
    static String dnsName(String name) {
        String n = name.toLowerCase().replaceAll("[^a-z0-9-]+", "-").replaceAll("^-+|-+$", "");
        return n.length() > 63 ? n.substring(0, 63).replaceAll("-+$", "") : n;
    }

    private static String setting(Properties settings, String key, String fallback) {
        return settings.getProperty(key, fallback).strip();
    }

    private static String normalise(String path) {
        String p = path.strip().replaceAll("/{2,}", "/");
        while (p.endsWith("/") && p.length() > 1) {
            p = p.substring(0, p.length() - 1);
        }
        return p.startsWith("/") ? p : "/" + p;
    }

    private static Object yaml(String text) {
        return new Yaml(new SafeConstructor(new LoaderOptions())).load(text);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    /** A YAML single-quoted string. */
    private static String quoted(String text) {
        return "'" + text.replace("'", "''") + "'";
    }
}
