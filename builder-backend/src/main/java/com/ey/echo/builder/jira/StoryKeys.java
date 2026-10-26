package com.ey.echo.builder.jira;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * The story key (PAY-142) of what the user pasted: the key itself, or a link on the configured
 * Jira site (…/browse/PAY-142, a board link with selectedIssue=PAY-142, …/issues/PAY-142). Links
 * to any other site are refused, so ECHO's Jira token is never sent anywhere else.
 */
final class StoryKeys {

    private static final Pattern KEY = Pattern.compile("[A-Za-z][A-Za-z0-9_]*-\\d+");

    private StoryKeys() {}

    static String keyOf(String typed, URI site) {
        String text = typed == null ? "" : typed.trim();
        if (text.isEmpty()) {
            throw new JiraException(HttpStatus.BAD_REQUEST, "Paste the link of a Jira story, or its key such as PAY-142.");
        }
        if (KEY.matcher(text).matches()) {
            return text.toUpperCase(Locale.ROOT);
        }
        URI uri;
        try {
            uri = URI.create(text);
        } catch (IllegalArgumentException e) {
            throw new JiraException(HttpStatus.BAD_REQUEST, "That is not a link to a Jira story.");
        }
        if (uri.getScheme() == null || !uri.getScheme().matches("(?i)https?") || uri.getHost() == null) {
            throw new JiraException(HttpStatus.BAD_REQUEST, "That is not a link to a Jira story.");
        }
        if (!uri.getHost().equalsIgnoreCase(site.getHost()) || port(uri) != port(site)) {
            throw new JiraException(HttpStatus.BAD_REQUEST,
                    "ECHO reads stories from " + site.getHost() + " only, not from " + uri.getHost() + ".");
        }
        String query = uri.getRawQuery();
        if (query != null) {
            for (String pair : query.split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0 && pair.substring(0, eq).equals("selectedIssue")) {
                    String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
                    if (KEY.matcher(value).matches()) {
                        return value.toUpperCase(Locale.ROOT);
                    }
                }
            }
        }
        String[] segments = uri.getPath() == null ? new String[0] : uri.getPath().split("/");
        for (int i = segments.length - 1; i >= 0; i--) {
            if (KEY.matcher(segments[i]).matches()) {
                return segments[i].toUpperCase(Locale.ROOT);
            }
        }
        throw new JiraException(HttpStatus.BAD_REQUEST, "That link does not name a story. Open the story in Jira and copy its link.");
    }

    private static int port(URI uri) {
        if (uri.getPort() != -1) {
            return uri.getPort();
        }
        return "http".equalsIgnoreCase(uri.getScheme()) ? 80 : 443;
    }
}
