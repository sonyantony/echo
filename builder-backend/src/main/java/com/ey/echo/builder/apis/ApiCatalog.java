package com.ey.echo.builder.apis;

import io.swagger.parser.OpenAPIParser;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.core.util.Json31;
import io.swagger.v3.oas.models.OpenAPI;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The approved downstream APIs of this install ({@code echo.apis}), loaded once at startup. Swagger
 * 2.0 specs are converted to OpenAPI 3, which is all Camel's rest-openapi component reads. A spec
 * that cannot be loaded does not stop the Builder: Validate reports it on the flows that use it.
 */
@Component
public class ApiCatalog {

    private static final Logger LOG = LoggerFactory.getLogger(ApiCatalog.class);
    private static final Pattern ID = Pattern.compile("^[a-z0-9][a-z0-9-]*$");
    private static final String FILE_SUFFIX = ".openapi.json";

    /** An operation of a spec; {@code allowed} if flows may call it. */
    public record Operation(String id, String method, String path, List<String> tags, boolean allowed) {}

    /**
     * An approved API.
     *
     * @param fileName the flow's copy of the spec, {@code <id>.openapi.json}
     * @param content that copy: the spec as OpenAPI 3 JSON; null if it could not be loaded
     * @param hasHost the spec names a server host; if not, steps must set {@code host}
     * @param problem why the spec could not be loaded, or null
     */
    public record Api(String id, String name, String fileName, String content, Map<String, Operation> operations,
            boolean hasHost, String problem) {

        public List<String> allowedOperations() {
            return operations.values().stream().filter(Operation::allowed).map(Operation::id).toList();
        }
    }

    private final boolean only;
    private final Map<String, Api> byFileName = new LinkedHashMap<>();

    public ApiCatalog(ApiProperties properties) {
        this.only = properties.only();
        for (var spec : properties.specs()) {
            var api = load(spec);
            if (api.problem() != null) {
                LOG.error("Approved API '{}' ({}): {}", spec.id(), spec.file(), api.problem());
            } else {
                LOG.info("Approved API '{}': {} of {} operations allowed", spec.id(),
                        api.allowedOperations().size(), api.operations().size());
            }
            byFileName.put(api.fileName(), api);
        }
    }

    /** No approved APIs, and plain http allowed. */
    public static ApiCatalog none() {
        return new ApiCatalog(new ApiProperties(false, List.of()));
    }

    /** Whether flows may only call approved APIs (no plain http or https steps). */
    public boolean only() {
        return only;
    }

    public List<Api> apis() {
        return List.copyOf(byFileName.values());
    }

    /** The approved API a REST OpenApi step's specificationUri names, if any. */
    public Optional<Api> forSpecificationUri(String uri) {
        return Optional.ofNullable(byFileName.get(uri.replaceFirst("^classpath:", "")));
    }

    /**
     * The flow's files plus a current copy of each approved spec its route refers to, so Run finds
     * the spec on the classpath and Publish puts it in the flow folder, next to the route.
     */
    public Map<String, String> withSpecs(String routeFile, Map<String, String> files) {
        String route = files.getOrDefault(routeFile, "");
        var result = new LinkedHashMap<>(files);
        for (var api : byFileName.values()) {
            if (api.content() != null && route.contains(api.fileName())) {
                result.put(api.fileName(), api.content());
            }
        }
        return result;
    }

    private static Api load(ApiProperties.Spec spec) {
        String id = spec.id() == null ? "" : spec.id();
        String fileName = id + FILE_SUFFIX;
        if (!ID.matcher(id).matches()) {
            return failed(spec, fileName, "the id must be lower-case letters, digits and dashes.");
        }
        if (spec.file() == null || spec.file().isBlank()) {
            return failed(spec, fileName, "no spec file is set.");
        }
        String text;
        try {
            text = Files.readString(Path.of(spec.file()));
        } catch (IOException e) {
            return failed(spec, fileName, "cannot read the spec file " + spec.file() + ".");
        }
        var result = new OpenAPIParser().readContents(text, null, null);
        OpenAPI openApi = result.getOpenAPI();
        if (openApi == null || openApi.getPaths() == null) {
            return failed(spec, fileName, "not an OpenAPI or Swagger 2.0 spec"
                    + (result.getMessages() == null || result.getMessages().isEmpty() ? "." : ": " + result.getMessages()));
        }

        var operations = new LinkedHashMap<String, Operation>();
        openApi.getPaths().forEach((path, item) -> item.readOperationsMap().forEach((method, op) -> {
            if (op.getOperationId() != null) {
                var tags = op.getTags() == null ? List.<String>of() : List.copyOf(op.getTags());
                boolean allowed = spec.allowedTags().isEmpty() && spec.allowedOperations().isEmpty()
                        || spec.allowedOperations().contains(op.getOperationId())
                        || tags.stream().anyMatch(spec.allowedTags()::contains);
                operations.put(op.getOperationId(), new Operation(op.getOperationId(), method.name(), path, tags, allowed));
            }
        }));
        boolean hasHost = openApi.getServers() != null && openApi.getServers().stream()
                .anyMatch(s -> s.getUrl() != null && s.getUrl().matches("(?i)^https?://.*"));
        boolean v31 = openApi.getOpenapi() != null && openApi.getOpenapi().startsWith("3.1");
        String content = v31 ? Json31.pretty(openApi) : Json.pretty(openApi);
        return new Api(id, spec.name(), fileName, content, java.util.Collections.unmodifiableMap(operations), hasHost, null);
    }

    private static Api failed(ApiProperties.Spec spec, String fileName, String problem) {
        return new Api(spec.id(), spec.name(), fileName, null, Map.of(), false, problem);
    }
}
