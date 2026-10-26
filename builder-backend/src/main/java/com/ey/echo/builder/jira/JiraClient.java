package com.ey.echo.builder.jira;

import com.ey.echo.builder.jira.Story.Part;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Reads a story (summary, description, comments) with Jira's REST API: version 3 on Cloud, 2 on
 * Data Center. Plain HTTP on the JDK client, so it works with any Jira the buyer runs. The account
 * only reads; nothing is ever written to Jira.
 */
@Component
class JiraClient {

    private static final DateTimeFormatter JIRA_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSZ");
    private static final DateTimeFormatter SHOWN = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final int PAGE = 100;

    private final JiraProperties props;
    private final ObjectMapper json;
    private final HttpClient http;

    JiraClient(JiraProperties props, ObjectMapper json) {
        this.props = props;
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
                .proxy(ProxySelector.getDefault()) // honour https.proxyHost etc., like JGit and S3
                .build();
    }

    Story read(String key) {
        if (!props.active()) {
            throw new JiraException(HttpStatus.NOT_FOUND, "Import From Jira is not set up: echo.jira.base-url and token are needed.");
        }
        String api = "/rest/api/" + (props.cloud() ? "3" : "2") + "/issue/" + URLEncoder.encode(key, StandardCharsets.UTF_8);
        JsonNode issue = get(api + "?fields=summary,description", key);
        JsonNode fields = issue.path("fields");
        var parts = new ArrayList<Part>();
        var description = StoryText.fromAdf(fields.path("description"));
        if (!description.isEmpty()) {
            parts.add(new Part("Description", description));
        }
        if (props.readComments()) {
            parts.addAll(comments(api, key));
        }
        return new Story(issue.path("key").asText(key), fields.path("summary").asText(""),
                props.baseUrl() + "/browse/" + issue.path("key").asText(key), parts);
    }

    private List<Part> comments(String api, String key) {
        var parts = new ArrayList<Part>();
        for (int start = 0; ; start += PAGE) {
            JsonNode page = get(api + "/comment?orderBy=created&startAt=" + start + "&maxResults=" + PAGE, key);
            JsonNode comments = page.path("comments");
            for (JsonNode comment : comments) {
                var blocks = StoryText.fromAdf(comment.path("body"));
                if (!blocks.isEmpty()) {
                    parts.add(new Part(source(comment), blocks));
                }
            }
            if (comments.size() < PAGE || start + comments.size() >= page.path("total").asInt(0)) {
                return parts;
            }
        }
    }

    private static String source(JsonNode comment) {
        String author = comment.path("author").path("displayName").asText("");
        String when;
        try {
            when = SHOWN.format(OffsetDateTime.parse(comment.path("created").asText(), JIRA_TIME));
        } catch (DateTimeParseException e) {
            when = "";
        }
        return "Comment" + (author.isBlank() ? "" : " by " + author) + (when.isEmpty() ? "" : ", " + when);
    }

    private JsonNode get(String pathAndQuery, String key) {
        var request = HttpRequest.newBuilder(URI.create(props.baseUrl() + pathAndQuery))
                .timeout(Duration.ofSeconds(20))
                .header("Accept", "application/json")
                .header("Authorization", authorization())
                .GET()
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new JiraException(HttpStatus.BAD_GATEWAY, "Could not reach Jira at " + props.baseUrl() + ".", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new JiraException(HttpStatus.BAD_GATEWAY, "Reading " + key + " from Jira was stopped.", e);
        }
        int status = response.statusCode();
        if (status == 401) {
            throw new JiraException(HttpStatus.BAD_GATEWAY,
                    "Jira did not accept ECHO's account. Check echo.jira.username and echo.jira.token.");
        }
        if (status == 403 || status == 404) {
            throw new JiraException(HttpStatus.NOT_FOUND, key + " was not found, or ECHO's Jira account cannot see it.");
        }
        if (status / 100 != 2) {
            throw new JiraException(HttpStatus.BAD_GATEWAY, "Jira answered " + status + " when reading " + key + ".");
        }
        try {
            return json.readTree(response.body());
        } catch (IOException e) {
            throw new JiraException(HttpStatus.BAD_GATEWAY, "Jira's answer for " + key + " could not be read.", e);
        }
    }

    /** Cloud: email + API token (Basic). Data Center: a personal access token (Bearer), or Basic with a username. */
    private String authorization() {
        if (props.username() != null) {
            String pair = props.username() + ":" + props.token();
            return "Basic " + Base64.getEncoder().encodeToString(pair.getBytes(StandardCharsets.UTF_8));
        }
        return "Bearer " + props.token();
    }
}
