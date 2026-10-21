package com.ey.echo.builder.flow;

import com.ey.echo.builder.apis.ApiCatalog;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Finds a flow's own OpenAPI spec among its files. A flow has at most one, kept under the name the
 * user uploaded or saved it with ({@code customer-api.yaml}, or {@code openapi.json} in flows made
 * before names were kept), in JSON or YAML. It is the top-level .json/.yaml/.yml file whose
 * content is an OpenAPI or Swagger document, other than the route, DataMapper schemas and the
 * copies of approved downstream APIs ({@code <id>.openapi.json}, see {@link ApiCatalog}).
 */
@Component
public class ApiSpecFiles {

    /** The name flows had before specs kept their own; preferred if a flow somehow has two. */
    static final String LEGACY_NAME = "openapi.json";
    private static final Pattern SPEC_NAME = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_.-]*\\.(json|yaml|yml)$");
    private static final Set<String> RESERVED = Set.of("application.properties");

    private final ApiCatalog apis;

    public ApiSpecFiles(ApiCatalog apis) {
        this.apis = apis;
    }

    /** The flow's spec file, if it has one. */
    public Optional<String> find(Flow flow) {
        String route = FlowNames.routeFile(flow.getName());
        var candidates = flow.getFiles().stream()
                .filter(f -> isCandidateName(f.getPath(), route) && isOpenApi(f.getContent()))
                .map(FlowFile::getPath)
                .sorted()
                .toList();
        return candidates.contains(LEGACY_NAME) ? Optional.of(LEGACY_NAME) : candidates.stream().findFirst();
    }

    /** Checks a name the user gives the spec; throws a 400 saying why it cannot be used. */
    void checkName(Flow flow, String name) {
        if (name == null || !SPEC_NAME.matcher(name).matches() || name.length() > FlowNames.MAX_PATH_LENGTH) {
            throw bad("'%s' cannot be used: end the name with .yaml, .yml or .json, and use only letters, digits, '.', '-' and '_'."
                    .formatted(name));
        }
        if (!isCandidateName(name, FlowNames.routeFile(flow.getName()))) {
            throw bad("'%s' is the name of a file the flow needs for something else. Pick another name.".formatted(name));
        }
        var current = find(flow);
        if (flow.file(name).isPresent() && !current.equals(Optional.of(name))) {
            throw bad("The flow already has a file named '%s'. Pick another name.".formatted(name));
        }
    }

    void checkContent(String content) {
        if (!isOpenApi(content)) {
            throw bad("This is not an OpenAPI spec: it needs an 'openapi' (or Swagger 2.0 'swagger') field at the top.");
        }
    }

    private boolean isCandidateName(String path, String routeFile) {
        String lower = path.toLowerCase();
        return !path.contains("/")
                && (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml"))
                && !path.equals(routeFile)
                && !lower.endsWith(".camel.yaml")
                && !lower.endsWith(".schema.json")
                && !RESERVED.contains(path)
                && apis.forSpecificationUri(path).isEmpty();
    }

    /** JSON is YAML, so one parser reads both. */
    static boolean isOpenApi(String content) {
        try {
            Object doc = new Yaml(new SafeConstructor(new LoaderOptions())).load(content);
            return doc instanceof Map<?, ?> map && (map.containsKey("openapi") || map.containsKey("swagger"));
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
