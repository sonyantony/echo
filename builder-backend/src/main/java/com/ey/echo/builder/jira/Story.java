package com.ey.echo.builder.jira;

import java.util.List;

/**
 * A user story as plain text: its description and each comment, in order, each split into text
 * and code blocks (code blocks are where people usually paste payloads).
 *
 * @param key PAY-142
 * @param summary the story's title
 * @param link the story in Jira, for the user to open
 * @param parts the description first, then the comments oldest first
 */
record Story(String key, String summary, String link, List<Part> parts) {

    /** @param source what the user reads as where it came from: "Description", "Comment by Priya Shah, 14 Oct 2026" */
    record Part(String source, List<Block> blocks) {}

    /** Text, or the content of a code block ({@code code} true). */
    record Block(boolean code, String text) {}
}
