package com.ey.echo.builder.flow;

import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

/**
 * operationIds are ECHO's business, not the user's: an operation's id is its method and path in
 * camelCase ({@code GET /cards/{cardId}} is {@code getCardsCardId}), and a route handles it by
 * starting from {@code direct:<operationId>}. Openapi Design names the operations when the spec is
 * saved and renames the flow's routes with them (builder-ui {@code operationIds.ts}, the same
 * naming); this fills in any still missing when the flow leaves the editor, e.g. in a spec that
 * came in another way, so Camel does not make up names of its own (decision 0013).
 */
public final class OperationIds {

    private static final Set<String> VERBS = Set.of("get", "put", "post", "delete", "options", "head", "patch", "trace");

    private OperationIds() {
    }

    /** Method and path in camelCase: POST /cards/{cardId}/activate is postCardsCardIdActivate. */
    public static String natural(String method, String path) {
        var id = new StringBuilder(method.toLowerCase(Locale.ROOT));
        for (String word : String.valueOf(path).split("[^A-Za-z0-9]+")) {
            if (!word.isEmpty()) {
                id.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
            }
        }
        return id.toString();
    }

    /**
     * The spec with an operationId on every operation that has none: its natural name, or that name
     * with 2, 3... if another operation has it already. Unchanged (the same string) if nothing was
     * missing or the spec cannot be read; otherwise written again as JSON or YAML.
     */
    public static String fill(String specContent, boolean json) {
        Object doc;
        try {
            doc = RestFromSpec.loadSpec(specContent);
        } catch (RuntimeException e) {
            return specContent;
        }
        if (!(doc instanceof Map<?, ?> spec) || !(spec.get("paths") instanceof Map<?, ?> paths)) {
            return specContent;
        }
        var taken = new HashSet<String>();
        var missing = new java.util.ArrayList<Map<Object, Object>>();
        var bases = new java.util.ArrayList<String>();
        paths.forEach((path, item) -> {
            if (item instanceof Map<?, ?> verbs) {
                verbs.forEach((verb, op) -> {
                    String method = String.valueOf(verb).toLowerCase(Locale.ROOT);
                    if (VERBS.contains(method) && op instanceof Map<?, ?> o) {
                        if (o.get("operationId") instanceof String id && !id.isBlank()) {
                            taken.add(id.strip());
                        } else {
                            @SuppressWarnings("unchecked")
                            var operation = (Map<Object, Object>) o;
                            missing.add(operation);
                            bases.add(natural(method, String.valueOf(path)));
                        }
                    }
                });
            }
        });
        if (missing.isEmpty()) {
            return specContent;
        }
        for (int i = 0; i < missing.size(); i++) {
            String id = unique(bases.get(i), taken);
            taken.add(id);
            missing.get(i).put("operationId", id);
        }
        return json ? writeJson(spec) : writeYaml(spec);
    }

    /** base, or base2, base3... whichever is not taken yet. */
    static String unique(String base, Set<String> taken) {
        String id = base;
        for (int n = 2; taken.contains(id); n++) {
            id = base + n;
        }
        return id;
    }

    private static String writeJson(Object spec) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsString(spec);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String writeYaml(Object spec) {
        var options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setIndicatorIndent(2);
        options.setIndentWithIndicator(true);
        options.setWidth(Integer.MAX_VALUE);
        return new Yaml(options).dump(spec);
    }
}
