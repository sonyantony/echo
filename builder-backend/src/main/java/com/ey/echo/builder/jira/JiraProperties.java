package com.ey.echo.builder.jira;

import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The buyer's Jira, which Interface's Import From Jira reads user stories from with one shared,
 * read-only account. Off until baseUrl and token are set. The token belongs in the local
 * config/application.yaml or .env, never in Git.
 *
 * @param baseUrl the Jira site, e.g. {@code https://acme.atlassian.net}; only links on it are read
 * @param deployment {@code cloud} (REST API 3, rich text as Atlassian Document Format) or
 *     {@code data-center} (REST API 2, wiki markup; Jira Server too). Default {@code cloud}.
 * @param username the account's email (Cloud: email + API token, Basic auth). Left out on Data
 *     Center, the token is a personal access token sent as Bearer.
 * @param token API token (Cloud) or personal access token (Data Center)
 * @param readComments whether the story's comments are read too (default true)
 */
@ConfigurationProperties("echo.jira")
public record JiraProperties(String baseUrl, String deployment, String username, String token, Boolean readComments) {

    public JiraProperties {
        baseUrl = blank(baseUrl) ? null : baseUrl.trim().replaceAll("/+$", "");
        deployment = blank(deployment) ? "cloud" : deployment.trim().toLowerCase();
        if (!deployment.equals("cloud") && !deployment.equals("data-center")) {
            throw new IllegalArgumentException("echo.jira.deployment must be cloud or data-center, not " + deployment);
        }
        username = blank(username) ? null : username.trim();
        token = blank(token) ? null : token.trim();
        readComments = readComments == null || readComments;
    }

    /** Import From Jira is offered only when the site and the account's token are set. */
    public boolean active() {
        return baseUrl != null && token != null;
    }

    public boolean cloud() {
        return deployment.equals("cloud");
    }

    URI base() {
        return URI.create(baseUrl);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
