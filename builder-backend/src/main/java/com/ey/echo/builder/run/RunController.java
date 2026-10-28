package com.ey.echo.builder.run;

import com.ey.echo.builder.apis.ApiCatalog;
import com.ey.echo.builder.flow.FlowNames;
import com.ey.echo.builder.flow.FlowService;
import com.ey.echo.builder.run.FlowRun.LogLine;
import com.ey.echo.builder.validation.FlowValidator;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The editor's Run button: start, stop and call a draft running inside the Builder. Starting
 * validates the saved draft first, like publish does. A flow that uses {{placeholders}} runs with
 * the values of a properties file the user chose (Run With...), kept by {@link RunValues}.
 */
@RestController
@EnableScheduling
@RequestMapping("/api/flows/{id}/run")
public class RunController {

    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final int MAX_RESPONSE_CHARS = 1_000_000;

    private final FlowService flows;
    private final FlowValidator validator;
    private final FlowRunner runner;
    private final ApiCatalog apis;
    private final RunValues values;
    private final HttpClient http = HttpClient.newBuilder()
            .proxy(HttpClient.Builder.NO_PROXY)
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    public RunController(FlowService flows, FlowValidator validator, FlowRunner runner, ApiCatalog apis,
            RunValues values) {
        this.flows = flows;
        this.validator = validator;
        this.runner = runner;
        this.apis = apis;
        this.values = values;
    }

    /**
     * A running flow.
     *
     * @param url where users call it, e.g. http://localhost:8081
     * @param endpoints its platform-http paths, each with the full URL to call
     * @param docsUrl Swagger UI for the flow's spec, or null when it has none
     */
    public record RunInfo(long flowId, String flowName, int port, String url, List<EndpointInfo> endpoints,
            String docsUrl, String startedBy, Instant startedAt, int idleMinutes) {}

    public record EndpointInfo(String path, List<String> methods, String url) {}

    /** A request the run panel sends to the running flow. */
    public record TestRequest(String method, String path, String contentType, String body) {}

    public record TestResponse(int status, String contentType, String body, long durationMs) {}

    /**
     * The values the saved draft uses and the properties file chosen for them (null: none yet).
     * Starting answers 409 with this, and missing, when the file is needed or no longer sets them all.
     */
    public record RunValuesInfo(String fileName, List<RunValues.Placeholder> placeholders, List<String> missing) {}

    /** A properties file chosen with Run With...: its name and its text. */
    public record ChosenFile(String fileName, String content) {}

    @GetMapping("/values")
    public RunValuesInfo values(@PathVariable long id, Principal user) {
        var placeholders = RunValues.placeholders(routeOf(id));
        var chosen = values.get(id, user.getName());
        return new RunValuesInfo(chosen.map(RunValues.Chosen::fileName).orElse(null), placeholders,
                RunValues.missing(placeholders, chosen.map(RunValues.Chosen::values).orElseGet(Properties::new)));
    }

    /** Starts the saved draft, with file's values when given (and keeps them for later runs), else with those chosen before. */
    @PostMapping
    public ResponseEntity<?> start(@PathVariable long id, @RequestBody(required = false) ChosenFile file,
            Principal user) {
        var flow = flows.get(id);
        String routeFile = FlowNames.routeFile(flow.getName());
        var files = new HashMap<>(apis.withSpecs(routeFile, flows.files(id)));
        var placeholders = RunValues.placeholders(files.get(routeFile));
        if (file != null) {
            values.choose(id, user.getName(), file.fileName(), file.content(), placeholders);
        }
        var chosen = values.get(id, user.getName());
        if (!placeholders.isEmpty()) {
            var missing = RunValues.missing(placeholders, chosen.map(RunValues.Chosen::values).orElseGet(Properties::new));
            if (chosen.isEmpty() || !missing.isEmpty()) {
                return ResponseEntity.status(HttpStatus.CONFLICT).body(
                        new RunValuesInfo(chosen.map(RunValues.Chosen::fileName).orElse(null), placeholders, missing));
            }
        }
        chosen.ifPresent(c -> files.put("application.properties", RunValues.merged(files.get("application.properties"), c)));
        var validation = validator.validate(routeFile, files);
        if (!validation.valid()) {
            return ResponseEntity.unprocessableEntity().body(validation);
        }
        var run = runner.start(id, flow.getName(), routeFile, files, user.getName());
        return ResponseEntity.ok(info(run));
    }

    @GetMapping
    public ResponseEntity<RunInfo> status(@PathVariable long id) {
        return runner.get(id).map(r -> ResponseEntity.ok(info(r))).orElse(ResponseEntity.noContent().build());
    }

    @DeleteMapping
    public ResponseEntity<Void> stop(@PathVariable long id) {
        runner.stop(id);
        return ResponseEntity.noContent().build();
    }

    /** Log lines newer than {@code after} (a seq from an earlier call; 0 for all). */
    @GetMapping("/log")
    public List<LogLine> log(@PathVariable long id, @RequestParam(defaultValue = "0") long after) {
        return runner.get(id).map(r -> r.logAfter(after)).orElse(List.of());
    }

    /** Sends a request to the running flow from the Builder, so the browser needs no access to the run port. */
    @PostMapping("/request")
    public TestResponse request(@PathVariable long id, @RequestBody TestRequest request) {
        var run = runner.get(id).orElseThrow(() -> new RunException("The flow is not running. Choose Run first."));
        String method = request.method() == null ? "POST" : request.method().strip().toUpperCase();
        if (!METHODS.contains(method)) {
            throw new RunException("Method '%s' is not supported here.".formatted(request.method()));
        }
        String path = request.path() == null || request.path().isBlank() ? "/" : request.path().strip();
        if (!path.startsWith("/") || path.contains("://")) {
            throw new RunException("The path must start with / (for example /orders).");
        }
        String body = request.body() == null ? "" : request.body();
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + run.port + path))
                .timeout(Duration.ofSeconds(60))
                .method(method, body.isEmpty() && (method.equals("GET") || method.equals("DELETE"))
                        ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (!body.isEmpty()) {
            builder.header("Content-Type", request.contentType() == null || request.contentType().isBlank()
                    ? "application/json" : request.contentType());
        }
        run.touch();
        long started = System.nanoTime();
        try {
            var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            long ms = Duration.ofNanos(System.nanoTime() - started).toMillis();
            String text = response.body();
            if (text.length() > MAX_RESPONSE_CHARS) {
                text = text.substring(0, MAX_RESPONSE_CHARS) + "\n... (cut at 1,000,000 characters)";
            }
            return new TestResponse(response.statusCode(),
                    response.headers().firstValue("Content-Type").orElse(null), text, ms);
        } catch (IOException e) {
            throw new RunException("Could not call the flow: " + FlowRunner.rootMessage(e), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RunException("The request was interrupted.", e);
        }
    }

    private String routeOf(long id) {
        var flow = flows.get(id);
        return flows.files(id).get(FlowNames.routeFile(flow.getName()));
    }

    @ExceptionHandler(RunException.class)
    ResponseEntity<ProblemDetail> runFailed(RunException e) {
        return ResponseEntity.badRequest().body(ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage()));
    }

    private RunInfo info(FlowRun run) {
        String base = runner.properties().publicUrl().replaceAll("/+$", "") + ":" + run.port;
        return new RunInfo(run.flowId, run.flowName, run.port, base,
                run.endpoints.stream().map(e -> new EndpointInfo(e.path(), e.methods(), base + e.path())).toList(),
                run.docsPath == null ? null : base + run.docsPath, run.startedBy, run.startedAt, runner.properties().idleMinutes());
    }
}
