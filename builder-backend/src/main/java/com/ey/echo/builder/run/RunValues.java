package com.ey.echo.builder.run;

import java.io.IOException;
import java.io.StringReader;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * The properties file each user chose for a flow's test runs (Run, Run With...). It is kept in the
 * Builder's memory only: never saved with the flow, published or put in an image, and gone when the
 * Builder restarts, so Run asks for it again.
 */
@Component
public class RunValues {

    /** {{name}} or {{name:default}}; a leading ? (optional placeholder) is not part of the name. */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\??([^}:]+)(:([^}]*))?}}");
    /** Camel's property functions ({{env:X}}, {{sys:X}}, ...) are not settings of the flow. */
    private static final Set<String> FUNCTIONS = Set.of("env", "sys", "sysenv", "service", "service.host",
            "service.port", "bean", "ref", "configmap", "secret", "configmap-binding", "secret-binding");
    static final int MAX_FILE_CHARS = 1_000_000;

    /** A value the flow uses; fallback is the default written in the placeholder, or null. */
    public record Placeholder(String name, String fallback) {}

    /** A properties file a user chose. */
    public record Chosen(String fileName, String content) {

        Properties values() {
            return parse(fileName, content);
        }
    }

    private final Map<String, Chosen> chosen = new ConcurrentHashMap<>();

    public Optional<Chosen> get(long flowId, String user) {
        return Optional.ofNullable(chosen.get(key(flowId, user)));
    }

    /** Keeps file for later runs of the flow by user, once it sets every value in placeholders. */
    public Chosen choose(long flowId, String user, String fileName, String content, List<Placeholder> placeholders) {
        if (fileName == null || fileName.isBlank() || content == null) {
            throw new RunException("Choose a properties file.");
        }
        if (content.length() > MAX_FILE_CHARS) {
            throw new RunException("%s is too large for a properties file.".formatted(fileName));
        }
        var file = new Chosen(fileName.strip(), content);
        var missing = missing(placeholders, file.values());
        if (!missing.isEmpty()) {
            throw new RunException("%s does not set %s.".formatted(file.fileName(), String.join(", ", missing)));
        }
        chosen.put(key(flowId, user), file);
        return file;
    }

    /** The values the route uses, A to Z, without Camel's functions and the echo.* settings ECHO sets itself. */
    public static List<Placeholder> placeholders(String route) {
        var found = new TreeMap<String, Optional<String>>();
        var m = PLACEHOLDER.matcher(route == null ? "" : route);
        while (m.find()) {
            String name = m.group(1).strip();
            if (!name.isEmpty() && !FUNCTIONS.contains(name) && !name.startsWith("echo.")) {
                // Each use resolves on its own, so one use without a default means the value is needed.
                found.merge(name, Optional.ofNullable(m.group(3)), (a, b) -> a.isPresent() && b.isPresent() ? a : Optional.empty());
            }
        }
        return found.entrySet().stream().map(e -> new Placeholder(e.getKey(), e.getValue().orElse(null))).toList();
    }

    /** The names in placeholders that have no default and that values does not set. */
    public static List<String> missing(List<Placeholder> placeholders, Properties values) {
        return placeholders.stream()
                .filter(p -> p.fallback() == null && !values.containsKey(p.name()))
                .map(Placeholder::name)
                .toList();
    }

    /** The flow's application.properties with the chosen file's values on top. */
    static String merged(String applicationProperties, Chosen file) {
        return (applicationProperties == null ? "" : applicationProperties) + "\n" + file.content();
    }

    private static Properties parse(String fileName, String content) {
        var values = new Properties();
        try {
            values.load(new StringReader(content));
        } catch (IOException | IllegalArgumentException e) {
            throw new RunException("%s is not a properties file: %s".formatted(fileName, e.getMessage()), e);
        }
        return values;
    }

    private static String key(long flowId, String user) {
        return flowId + "/" + user;
    }
}
