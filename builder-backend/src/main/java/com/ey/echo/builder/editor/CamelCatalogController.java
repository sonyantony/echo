package com.ey.echo.builder.editor;

import com.ey.echo.builder.validation.ValidationProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Serves Kaoto's Camel catalog, cut down to what flows may use: components to
 * {@code echo.validation.allowed-components}, expression languages to {@code allowed-languages},
 * no processors from {@code echo.catalog.hidden-processors} and no Kamelets unless the
 * {@code kamelet} component is allowed. Other catalog files are passed through unchanged.
 *
 * <p>The catalog is the one copied by builder-ui/scripts/copy-camel-catalog.mjs. Its file names
 * are hashed, so which file is which comes from the runtime index (catalogs.components.file and
 * so on). Public, like the static catalog files: it is Camel's documentation, and the playground
 * page loads it without a login.
 */
@RestController
public class CamelCatalogController {

    static final String PREFIX = "/api/camel-catalog/";

    private final ObjectMapper json;
    private final Resource root;
    private final Map<String, Predicate<String>> filters;
    private final Map<String, byte[]> filtered = new ConcurrentHashMap<>();

    public CamelCatalogController(CatalogProperties catalog, ValidationProperties validation,
            ResourceLoader resources, ObjectMapper json) {
        this.json = json;
        this.root = catalog.locations().stream().map(resources::getResource)
                .filter(r -> relative(r, "index.json").exists())
                .findFirst().orElse(null);
        this.filters = root == null ? Map.of() : filtersFor(Set.copyOf(validation.allowedComponents()),
                Set.copyOf(validation.allowedLanguages()), Set.copyOf(catalog.hiddenProcessors()));
    }

    @GetMapping(PREFIX + "**")
    public ResponseEntity<?> file(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length() + PREFIX.length());
        if (root == null || path.isEmpty() || path.contains("..") || path.contains("\\") || path.startsWith("/")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Resource file = relative(root, path);
        if (!file.exists() || !file.isReadable()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        var type = path.endsWith(".json") ? MediaType.APPLICATION_JSON
                : path.endsWith(".xsd") || path.endsWith(".xsl") ? MediaType.APPLICATION_XML
                : MediaType.APPLICATION_OCTET_STREAM;
        Predicate<String> keep = filters.get(path);
        if (keep == null) {
            return ResponseEntity.ok().contentType(type).body(file);
        }
        return ResponseEntity.ok().contentType(type).body(filtered.computeIfAbsent(path, p -> keepOnly(file, keep)));
    }

    /** Catalog file path (relative to the root) to the entry names it keeps. */
    private Map<String, Predicate<String>> filtersFor(Set<String> components, Set<String> languages,
            Set<String> hiddenProcessors) {
        var result = new HashMap<String, Predicate<String>>();
        boolean kamelets = components.contains("kamelet");
        for (JsonNode definition : read(relative(root, "index.json")).path("definitions")) {
            String index = definition.path("fileName").asText();
            int slash = index.lastIndexOf('/');
            if (slash < 0 || !index.startsWith("camel-")) {
                continue; // Citrus test catalogs and the like
            }
            String dir = index.substring(0, slash + 1);
            JsonNode catalogs = read(relative(root, index)).path("catalogs");
            put(result, dir, catalogs, "components", components::contains);
            put(result, dir, catalogs, "languages", languages::contains);
            put(result, dir, catalogs, "patterns",
                    name -> !hiddenProcessors.contains(name) && (kamelets || !name.equals("kamelet")));
            put(result, dir, catalogs, "kamelets", name -> kamelets);
            put(result, dir, catalogs, "kameletBoundaries", name -> kamelets);
        }
        return Map.copyOf(result);
    }

    private static void put(Map<String, Predicate<String>> result, String dir, JsonNode catalogs, String kind,
            Predicate<String> keep) {
        String file = catalogs.path(kind).path("file").asText("");
        if (!file.isEmpty()) {
            result.put(dir + file, keep);
        }
    }

    private byte[] keepOnly(Resource file, Predicate<String> keep) {
        var entries = (ObjectNode) read(file);
        entries.retain(entries.properties().stream().map(Map.Entry::getKey).filter(keep).toList());
        try {
            return json.writeValueAsBytes(entries);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Resource relative(Resource base, String path) {
        try {
            return base.createRelative(path);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode read(Resource resource) {
        try (InputStream in = resource.getInputStream()) {
            return json.readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read the Camel catalog file " + resource, e);
        }
    }
}
