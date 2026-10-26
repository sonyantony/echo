package com.ey.echo.builder.jira;

import com.ey.echo.builder.ai.AiException;
import com.ey.echo.builder.ai.AiProvider;
import com.ey.echo.builder.jira.StoryExamples.Example;
import com.ey.echo.builder.jira.StoryExamples.Operation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Asks the install's AI engine which of a story's examples is the request and which the response of
 * which operation, and what its path and query parameters are. The engine only picks among the
 * examples ECHO found (by number); it never writes a payload, and every answer is checked: unknown
 * example numbers, methods and paths are dropped. When the engine cannot be reached or answers
 * nothing usable, ECHO's own guess is kept and the user is told why.
 */
final class AiExampleLabeler {

    static final String INSTRUCTIONS = """
            You read a Jira user story that asks for a REST API or a change to one. Its JSON examples were \
            taken out of the text and replaced by [Example n]; they are listed after the story, with where \
            each came from. Work out which API operations the story describes and, for each one, which \
            example is its request body, which is its response body, and its query parameters.

            Rules:
            - Use only the listed examples, by number. Never write or change a payload yourself.
            - Each operation has an HTTP method (GET, POST, PUT, PATCH or DELETE) and its path as the story \
            writes it: starting with "/", without the host, with {name} for path parameters. Use "" when the \
            story names no path.
            - Put sample query parameters in "query" as name=value&name=value (values from the story), or "".
            - When the story has several examples for the same request or response, for example a correction \
            in a later comment, pick the one the story says is right (usually the newest) and list the others \
            in "alternatives".
            - "request" or "response" is null when there is none. GET and DELETE usually have no request body.
            - An error body (4xx or 5xx) is not the response.
            - "reason" is one short sentence saying how you paired them.

            Answer with only a JSON object of this shape:
            {"operations":[{"method":"POST","path":"/accounts/{accountId}/payments","query":"","request":1,\
            "response":4,"alternatives":[2],"reason":"The comment of 14 Oct corrects the response."}]}
            """;
    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final int MAX_STORY = 40_000;
    private static final int MAX_EXAMPLE = 4_000;
    private static final int MAX_REASON = 300;

    private final AiProvider ai;
    private final ObjectMapper json;

    AiExampleLabeler(AiProvider ai, ObjectMapper json) {
        this.ai = ai;
        this.json = json;
    }

    StoryExamples label(ExampleFinder.Found found) {
        StoryExamples guess = found.guess();
        String engine = ai.describe();
        String answer;
        try {
            answer = ai.completeJson(INSTRUCTIONS, input(found));
        } catch (AiException e) {
            return withNote(guess, e.getMessage() + " ECHO's own guess is shown instead.");
        }
        var notes = new ArrayList<String>();
        List<Operation> operations;
        try {
            operations = operations(json.readTree(answer), guess.examples(), notes);
        } catch (IOException e) {
            return withNote(guess, "The AI engine (" + engine + ") did not answer with JSON. ECHO's own guess is shown instead.");
        }
        if (operations.isEmpty() && !guess.operations().isEmpty()) {
            return withNote(guess, "The AI engine (" + engine + ") found no operations. ECHO's own guess is shown instead.");
        }
        return new StoryExamples(guess.key(), guess.summary(), guess.link(), guess.comments(), guess.examples(),
                operations, engine, List.copyOf(notes));
    }

    /** The story, then each example with where it came from. */
    static String input(ExampleFinder.Found found) {
        var text = new StringBuilder(cut(found.transcript(), MAX_STORY)).append("\n\n# Examples\n");
        for (Example e : found.guess().examples()) {
            text.append("\n[Example ").append(e.id()).append("] from ").append(e.source()).append(":\n```json\n")
                    .append(cut(e.json(), MAX_EXAMPLE)).append("\n```\n");
        }
        return text.toString();
    }

    private static List<Operation> operations(JsonNode root, List<Example> examples, List<String> notes) {
        Set<Integer> ids = examples.stream().map(Example::id).collect(Collectors.toSet());
        var result = new ArrayList<Operation>();
        var dropped = new LinkedHashSet<String>();
        for (JsonNode op : root.path("operations")) {
            Integer request = id(op.path("request"), ids, dropped);
            Integer response = id(op.path("response"), ids, dropped);
            var alternatives = new ArrayList<Integer>();
            for (JsonNode alt : op.path("alternatives")) {
                Integer a = id(alt, ids, dropped);
                if (a != null) {
                    alternatives.add(a);
                }
            }
            String method = op.path("method").asText("").trim().toUpperCase(Locale.ROOT);
            if (!METHODS.contains(method)) {
                method = request != null ? "POST" : "GET";
            }
            String path = path(op.path("path").asText(""));
            if (path == null) {
                dropped.add("a path that is not a path (" + op.path("path").asText() + ")");
                path = "";
            }
            String query = op.path("query").asText("").trim().replaceFirst("^\\?", "");
            if (!query.isEmpty() && !path.isEmpty() && !path.contains("?") && !query.matches(".*\\s.*")) {
                path = path + "?" + query;
            }
            if (path.isEmpty() && request == null && response == null) {
                continue;
            }
            var near = new LinkedHashSet<Integer>();
            if (request != null) {
                near.add(request);
            }
            if (response != null) {
                near.add(response);
            }
            near.addAll(alternatives);
            String reason = op.path("reason").asText("").strip();
            result.add(new Operation(method, path, request, response, List.copyOf(near),
                    reason.isEmpty() ? null : cut(reason, MAX_REASON)));
        }
        if (!dropped.isEmpty()) {
            notes.add("Parts of the AI engine's answer were left out: " + String.join(", ", dropped) + ".");
        }
        return result;
    }

    /** An example number the story has, else null (noted when it was not a plain null). */
    private static Integer id(JsonNode node, Set<Integer> ids, Set<String> dropped) {
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.canConvertToInt() && ids.contains(node.asInt())) {
            return node.asInt();
        }
        String text = node.asText().replaceAll("(?i)^\\[?example\\s*|]$", "").trim();
        if (text.matches("\\d+") && ids.contains(Integer.parseInt(text))) {
            return Integer.parseInt(text);
        }
        dropped.add("example " + node.asText() + ", which the story does not have");
        return null;
    }

    /** The path as written, "" for none, null when it is not a path. */
    private static String path(String written) {
        String p = written.trim();
        if (p.isEmpty()) {
            return "";
        }
        if (p.matches("(?i)(" + String.join("|", METHODS) + ")\\s+.*")) {
            p = p.substring(p.indexOf(' ')).trim(); // "GET /cards"
        }
        if (p.matches(".*\\s.*")) {
            return null;
        }
        return ExampleFinder.pathOf(p);
    }

    private static StoryExamples withNote(StoryExamples guess, String note) {
        var notes = new ArrayList<>(guess.notes());
        notes.add(note);
        return new StoryExamples(guess.key(), guess.summary(), guess.link(), guess.comments(), guess.examples(),
                guess.operations(), null, List.copyOf(notes));
    }

    private static String cut(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max) + "\n[cut]";
    }
}
