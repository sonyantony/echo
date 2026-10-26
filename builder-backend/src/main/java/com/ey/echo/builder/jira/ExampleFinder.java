package com.ey.echo.builder.jira;

import com.ey.echo.builder.jira.Story.Block;
import com.ey.echo.builder.jira.Story.Part;
import com.ey.echo.builder.jira.StoryExamples.Example;
import com.ey.echo.builder.jira.StoryExamples.Operation;
import com.fasterxml.jackson.core.json.JsonReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds the example payloads, calls (GET /accounts/{id}/payments?status=OPEN) and query
 * parameters a story has, without AI, and makes a first guess at which examples are the request
 * and the response of which call: an example belongs to the call written before it, and "request"
 * or "response" just before it says which it is. When a story has several examples for the same
 * thing (say, a corrected response in a later comment), the newest is picked and the others are
 * offered as choices.
 */
final class ExampleFinder {

    private static final ObjectMapper LENIENT = JsonMapper.builder()
            .enable(JsonReadFeature.ALLOW_TRAILING_COMMA, JsonReadFeature.ALLOW_JAVA_COMMENTS)
            .build();
    private static final String METHODS = "GET|POST|PUT|PATCH|DELETE";
    private static final String TARGET = "(https?://[^\\s\"'<>|]+|/[^\\s\"'<>|]*)";
    private static final Pattern CALL = Pattern.compile("\\b(" + METHODS + ")\\s+" + TARGET);
    private static final Pattern NAMED_PATH = Pattern.compile(
            "(?i)\\b(?:endpoint|path|url|uri|resource)\\s*[:=]?\\s*(?:(" + METHODS + ")\\s+)?" + TARGET);
    private static final Pattern QUERY_LINE = Pattern.compile("(?i)\\bquery\\s*(?:string|param(?:eter)?s?)\\b\\s*[:-]?([^\\n]*)");
    private static final Pattern QUERY_PAIR = Pattern.compile("([A-Za-z_][\\w.-]*)\\s*=\\s*([^\\s,&;|]+)");
    private static final Pattern REQUEST_WORDS = Pattern.compile("(?i)\\b(request|input|sends?|sent)\\b");
    private static final Pattern RESPONSE_WORDS = Pattern.compile("(?i)\\b(response|output|returns?|returned|result|reply)\\b");
    /** How far back the text before an example is read for "request" or "response". */
    private static final int HINT_REACH = 150;

    private ExampleFinder() {}

    static StoryExamples find(Story story) {
        return findAll(story).guess();
    }

    /**
     * ECHO's own guess, and the story as text with each example replaced by "[Example n]" (each part
     * under a "## Description" or "## Comment by ..." heading), for an AI engine to read.
     */
    record Found(StoryExamples guess, String transcript) {}

    static Found findAll(Story story) {
        var finder = new Run();
        for (Part part : story.parts()) {
            finder.part(part);
        }
        int comments = (int) story.parts().stream().filter(p -> !p.source().equals("Description")).count();
        var guess = new StoryExamples(story.key(), story.summary(), story.link(), comments, finder.examples,
                finder.operations(), null, List.of());
        String transcript = "# " + story.key() + ": " + story.summary() + "\n\n" + finder.transcript;
        return new Found(guess, transcript);
    }

    /** One pass over a story, in order. */
    private static final class Run {
        final List<Example> examples = new ArrayList<>();
        final List<Op> ops = new ArrayList<>();
        Op current;
        String pendingQuery;
        final StringBuilder transcript = new StringBuilder();

        void part(Part part) {
            var before = new StringBuilder(); // the part's text since its last example, for role hints
            transcript.append("## ").append(part.source()).append("\n\n");
            for (Block block : part.blocks()) {
                String text = block.text();
                var shown = new StringBuilder();
                int at = 0;
                for (int[] span : jsonSpans(text)) {
                    String between = text.substring(at, span[0]);
                    calls(between);
                    before.append(between);
                    int id = body(text.substring(span[0], span[1]), part.source(), role(before));
                    shown.append(between).append("[Example ").append(id).append(']');
                    before.setLength(0);
                    at = span[1];
                }
                calls(text.substring(at));
                before.append(text.substring(at)).append('\n');
                shown.append(text.substring(at));
                String piece = shown.toString().strip();
                transcript.append(block.code() && !piece.matches("\\[Example \\d+]") ? "```\n" + piece + "\n```" : piece).append("\n\n");
            }
        }

        /** Calls, named paths and query parameter lines, in the order they appear. */
        void calls(String text) {
            record Found(int at, String method, String target, String query) {}
            var found = new ArrayList<Found>();
            Matcher m = CALL.matcher(text);
            while (m.find()) {
                found.add(new Found(m.start(), m.group(1), m.group(2), null));
            }
            m = NAMED_PATH.matcher(text);
            while (m.find()) {
                int start = m.start();
                String target = m.group(2);
                if (found.stream().noneMatch(f -> Math.abs(f.at() - start) < 40 && sameTarget(f.target(), target))) {
                    found.add(new Found(start, m.group(1), target, null));
                }
            }
            m = QUERY_LINE.matcher(text);
            while (m.find()) {
                var pairs = new ArrayList<String>();
                Matcher p = QUERY_PAIR.matcher(m.group(1));
                while (p.find()) {
                    pairs.add(p.group(1) + "=" + p.group(2));
                }
                if (!pairs.isEmpty()) {
                    found.add(new Found(m.start(), null, null, String.join("&", pairs)));
                }
            }
            found.sort((a, b) -> Integer.compare(a.at(), b.at()));
            for (Found f : found) {
                if (f.target() == null) {
                    query(f.query());
                } else {
                    String path = pathOf(f.target());
                    if (path != null) {
                        call(f.method(), path);
                    }
                }
            }
        }

        void call(String method, String pathAndQuery) {
            int q = pathAndQuery.indexOf('?');
            String path = q < 0 ? pathAndQuery : pathAndQuery.substring(0, q);
            String query = q < 0 ? null : pathAndQuery.substring(q + 1);
            for (Op op : ops) {
                if (op.path.equals(path) && (method == null || op.method == null || op.method.equals(method))) {
                    if (op.method == null) {
                        op.method = method;
                    }
                    if (op.query == null) {
                        op.query = query;
                    }
                    current = op;
                    return;
                }
            }
            // A body found before any call belongs to the first call named after it.
            if (current != null && current.path.isEmpty() && current.method == null) {
                current.method = method;
                current.path = path;
                current.query = query;
            } else {
                current = new Op(method, path, query);
                ops.add(current);
            }
            if (current.query == null && pendingQuery != null) {
                current.query = pendingQuery;
            }
            pendingQuery = null;
        }

        void query(String query) {
            if (current != null && current.query == null) {
                current.query = query;
            } else if (current == null) {
                pendingQuery = query;
            }
        }

        /** Adds the example and returns its id. */
        int body(String raw, String source, String role) {
            String pretty;
            try {
                pretty = LENIENT.writerWithDefaultPrettyPrinter().writeValueAsString(LENIENT.readTree(raw));
            } catch (Exception e) {
                throw new IllegalStateException(e); // jsonSpans only returns what parses
            }
            int id = examples.size() + 1;
            examples.add(new Example(id, pretty, source, role));
            if (current == null) {
                current = new Op(null, "", pendingQuery);
                pendingQuery = null;
                ops.add(current);
            }
            current.examples.add(id);
            return id;
        }

        List<Operation> operations() {
            var result = new ArrayList<Operation>();
            Map<Integer, Example> byId = new LinkedHashMap<>();
            examples.forEach(e -> byId.put(e.id(), e));
            for (Op op : ops) {
                if (op.examples.isEmpty() && op.path.isEmpty()) {
                    continue;
                }
                Integer request = last(op.examples, byId, "request");
                Integer response = last(op.examples, byId, "response");
                var unknown = op.examples.stream().filter(id -> byId.get(id).role() == null).toList();
                if (!unknown.isEmpty()) {
                    if (response == null) {
                        response = unknown.getLast();
                    }
                    if (request == null && !"GET".equals(op.method) && !"DELETE".equals(op.method)) {
                        Integer first = unknown.getFirst();
                        request = first.equals(response) ? null : first;
                    }
                }
                String method = op.method != null ? op.method : request != null ? "POST" : "GET";
                String path = op.path + (op.query == null || op.query.isEmpty() ? "" : "?" + op.query);
                result.add(new Operation(method, path, request, response, List.copyOf(op.examples), null));
            }
            return result;
        }

        private static Integer last(List<Integer> ids, Map<Integer, Example> byId, String role) {
            Integer found = null;
            for (Integer id : ids) {
                if (role.equals(byId.get(id).role())) {
                    found = id;
                }
            }
            return found;
        }
    }

    private static final class Op {
        String method;
        String path;
        String query;
        final List<Integer> examples = new ArrayList<>();

        Op(String method, String path, String query) {
            this.method = method;
            this.path = path;
            this.query = query;
        }
    }

    /** "request" or "response" when the text just before an example says so (the word nearest it wins). */
    static String role(CharSequence before) {
        String tail = before.subSequence(Math.max(0, before.length() - HINT_REACH), before.length()).toString();
        int request = lastMatch(REQUEST_WORDS, tail);
        int response = lastMatch(RESPONSE_WORDS, tail);
        if (request < 0 && response < 0) {
            return null;
        }
        return request > response ? "request" : "response";
    }

    private static int lastMatch(Pattern pattern, String text) {
        int at = -1;
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            at = m.start();
        }
        return at;
    }

    /** The path and query of a URL or path as written; null when it is not one. */
    static String pathOf(String target) {
        String t = target.replaceAll("[.,;:)\\]}>'\"]+$", "").replace("%7B", "{").replace("%7D", "}")
                .replace("%7b", "{").replace("%7d", "}");
        if (t.startsWith("http")) {
            try {
                var uri = URI.create(t.replace("{", "%7B").replace("}", "%7D"));
                String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
                t = (path + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery())).replace("%7B", "{").replace("%7D", "}");
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        return t.startsWith("/") && t.length() > 1 && !t.startsWith("//") ? t : null;
    }

    private static boolean sameTarget(String a, String b) {
        String pa = pathOf(a);
        return pa != null && pa.equals(pathOf(b));
    }

    /** Start and end of each JSON object, or array holding an object, that the text has. */
    static List<int[]> jsonSpans(String text) {
        var spans = new ArrayList<int[]>();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c != '{' && c != '[') {
                continue;
            }
            int end = closing(text, i);
            if (end < 0) {
                continue;
            }
            if (parses(text.substring(i, end))) {
                spans.add(new int[] {i, end});
                i = end - 1;
            }
        }
        return spans;
    }

    private static boolean parses(String candidate) {
        try {
            JsonNode node = LENIENT.readTree(candidate);
            if (node.isObject()) {
                return !node.isEmpty();
            }
            if (node.isArray()) {
                for (JsonNode item : node) {
                    if (item.isObject()) {
                        return true;
                    }
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /** The index just after the bracket that closes the one at start, skipping strings; -1 when there is none. */
    private static int closing(String text, int start) {
        int depth = 0;
        boolean inString = false;
        for (int i = start; i < text.length(); i++) {
            char c = text.charAt(i);
            if (inString) {
                if (c == '\\') {
                    i++;
                } else if (c == '"') {
                    inString = false;
                }
            } else if (c == '"') {
                inString = true;
            } else if (c == '{' || c == '[') {
                depth++;
            } else if (c == '}' || c == ']') {
                depth--;
                if (depth == 0) {
                    return i + 1;
                }
            }
        }
        return -1;
    }
}
