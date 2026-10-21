package com.ey.echo.builder.editor;

import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.validation.ValidationProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
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
 * <p>When flows may only call approved APIs ({@code echo.apis.only}), http and https are left out
 * too, and the REST OpenApi step's Specification Uri and Operation Id become drop-downs of the
 * approved specs and their allowed operations.
 *
 * <p>The REST configuration form shows only {@link #SHOWN_REST_CONFIGURATION}, in that order and
 * with no collapsible groups: flows always serve REST on platform-http (the only REST transport
 * bundled), on the address the runtime listens on, with no generated API docs (they need
 * camel-openapi-java) and binding off, so bodies stay plain JSON text for DataMapper and http
 * steps. The other settings stay at Camel's defaults.
 *
 * <p>The catalog is the one copied by builder-ui/scripts/copy-camel-catalog.mjs. Its file names
 * are hashed, so which file is which comes from the runtime index (catalogs.components.file and
 * so on). Public, like the static catalog files: it is Camel's documentation, and the playground
 * page loads it without a login.
 */
@RestController
public class CamelCatalogController {

    static final String PREFIX = "/api/camel-catalog/";
    static final List<String> SHOWN_REST_CONFIGURATION = List.of("contextPath", "clientRequestValidation", "enableCORS");
    /** Kaoto shows properties of this group at the top level of the form, not in a collapsible section. */
    private static final String TOP_LEVEL_GROUP = "consumer";

    static final String OPENAPI_DEFINITION = "org.apache.camel.model.rest.OpenApiDefinition";
    static final String OPENAPI_SPECIFICATION_TITLE = "Openapi Specification";

    private final ObjectMapper json;
    private final Resource root;
    private final Map<String, Predicate<String>> filters;
    private final Set<String> componentFiles = ConcurrentHashMap.newKeySet();
    private final Set<String> entityFiles = ConcurrentHashMap.newKeySet();
    private final ApiCatalog apis;
    private final Map<String, byte[]> filtered = new ConcurrentHashMap<>();

    public CamelCatalogController(CatalogProperties catalog, ValidationProperties validation,
            ResourceLoader resources, ObjectMapper json, ApiCatalog apis) {
        this.json = json;
        this.apis = apis;
        this.root = catalog.locations().stream().map(resources::getResource)
                .filter(r -> relative(r, "index.json").exists())
                .findFirst().orElse(null);
        var components = new java.util.HashSet<>(validation.allowedComponents());
        if (apis.only()) {
            components.removeAll(Set.of("http", "https"));
        }
        this.filters = root == null ? Map.of() : filtersFor(Set.copyOf(components),
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
        if (entityFiles.contains(path)) {
            return ResponseEntity.ok().contentType(type).body(filtered.computeIfAbsent(path, p -> restForms(file)));
        }
        Predicate<String> keep = filters.get(path);
        if (keep == null) {
            return ResponseEntity.ok().contentType(type).body(file);
        }
        return ResponseEntity.ok().contentType(type).body(filtered.computeIfAbsent(path, p -> keepOnly(p, file, keep)));
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
            componentFiles.add(dir + catalogs.path("components").path("file").asText(""));
            String entities = catalogs.path("entities").path("file").asText("");
            if (!entities.isEmpty()) {
                entityFiles.add(dir + entities);
            }
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

    private byte[] keepOnly(String path, Resource file, Predicate<String> keep) {
        var entries = (ObjectNode) read(file);
        entries.retain(entries.properties().stream().map(Map.Entry::getKey).filter(keep).toList());
        if (apis.only() && componentFiles.contains(path) && entries.get("rest-openapi") instanceof ObjectNode restOpenApi) {
            offerApprovedApis(restOpenApi);
        }
        try {
            return json.writeValueAsBytes(entries);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * The entities catalog with restConfiguration's form cut down to {@link #SHOWN_REST_CONFIGURATION},
     * and the Rest service's Open Api "Specification" called {@value #OPENAPI_SPECIFICATION_TITLE} (the
     * Builder shows a drop-down of the flows' specs in its place, see builder-ui SpecificationPicker).
     */
    private byte[] restForms(Resource file) {
        var entities = (ObjectNode) read(file);
        entities.forEach(entity -> {
            if (entity.path("propertiesSchema").path("definitions").path(OPENAPI_DEFINITION).path("properties")
                    .get("specification") instanceof ObjectNode specification) {
                specification.put("title", OPENAPI_SPECIFICATION_TITLE);
            }
        });
        if (entities.get("restConfiguration") instanceof ObjectNode rest) {
            for (JsonNode node : List.of(rest, rest.path("propertiesSchema"))) {
                if (!(node instanceof ObjectNode owner && owner.get("properties") instanceof ObjectNode all)) {
                    continue;
                }
                var shown = owner.putObject("properties"); // in SHOWN_REST_CONFIGURATION's order
                for (String name : SHOWN_REST_CONFIGURATION) {
                    if (all.get(name) instanceof ObjectNode property) {
                        if (property.has("group")) {
                            property.put("group", TOP_LEVEL_GROUP).put("label", TOP_LEVEL_GROUP);
                        }
                        if (property.has("$comment")) {
                            property.put("$comment", "group:" + TOP_LEVEL_GROUP);
                        }
                        shown.set(name, property);
                    }
                }
            }
        }
        try {
            return json.writeValueAsBytes(entities);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Specification Uri and Operation Id become drop-downs of what flows may call: Kaoto builds
     * the form from {@code propertiesSchema} (a JSON schema), where an enum is a drop-down.
     */
    private void offerApprovedApis(ObjectNode restOpenApi) {
        var specs = apis.apis().stream().map(ApiCatalog.Api::fileName).toList();
        var operations = apis.apis().stream().flatMap(api -> api.allowedOperations().stream()).distinct().toList();
        for (JsonNode properties : List.of(restOpenApi.path("properties"),
                restOpenApi.path("propertiesSchema").path("properties"))) {
            if (properties.get("specificationUri") instanceof ObjectNode spec) {
                enumOf(spec, specs);
                spec.remove(List.of("default", "defaultValue"));
            }
            if (properties.get("operationId") instanceof ObjectNode operation) {
                enumOf(operation, operations);
            }
        }
    }

    private static void enumOf(ObjectNode property, List<String> values) {
        ArrayNode array = property.putArray("enum");
        values.forEach(array::add);
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
