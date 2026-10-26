package com.ey.echo.builder.jira;

import java.util.List;

/**
 * What Import From Jira found in a story: every JSON example, and a first guess at the operations
 * they belong to, which the user checks and corrects before anything is added to the spec.
 *
 * @param comments how many comments were read
 * @param examples every JSON example, in the order the story has them
 * @param operations the guessed operations; empty when nothing was found
 */
public record StoryExamples(String key, String summary, String link, int comments, List<Example> examples,
        List<Operation> operations) {

    /**
     * @param id refers to it from an operation
     * @param json the example, pretty printed
     * @param source "Description", "Comment by Priya Shah, 14 Oct 2026"
     * @param role "request" or "response" when the text just before it says so; null when it does not
     */
    public record Example(int id, String json, String source, String role) {}

    /**
     * @param method GET, POST, ...; a guess when the story does not name one
     * @param path as the story writes it, with a sample query (/accounts/{id}/payments?status=OPEN); empty when it names none
     * @param request the example picked as its request body, or null
     * @param response the example picked as its response body, or null
     * @param examples every example found near it, newest last: the choices for request and response
     */
    public record Operation(String method, String path, Integer request, Integer response, List<Integer> examples) {}
}
