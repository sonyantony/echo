package com.ey.echo.builder.jira;

import com.ey.echo.builder.jira.Story.Block;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Jira's rich text as text and code blocks. Jira Cloud sends Atlassian Document Format (a JSON
 * tree); Data Center sends wiki markup, where code is in {code}…{code} or {noformat}…{noformat}.
 */
final class StoryText {

    private static final Set<String> BLOCKS = Set.of("paragraph", "heading", "blockquote", "listItem", "tableRow",
            "panel", "rule", "expand", "nestedExpand", "decisionItem", "taskItem", "mediaSingle");
    private static final Pattern WIKI_CODE = Pattern.compile("(?s)\\{(code|noformat)(?::[^}]*)?}(.*?)\\{\\1}");

    private StoryText() {}

    /** Atlassian Document Format; a plain string (some Cloud fields) is taken as wiki markup. */
    static List<Block> fromAdf(JsonNode doc) {
        if (doc == null || doc.isNull()) {
            return List.of();
        }
        if (doc.isTextual()) {
            return fromWiki(doc.asText());
        }
        var blocks = new ArrayList<Block>();
        var text = new StringBuilder();
        walk(doc, blocks, text);
        flush(blocks, text);
        return blocks;
    }

    private static void walk(JsonNode node, List<Block> blocks, StringBuilder text) {
        String type = node.path("type").asText();
        switch (type) {
            case "codeBlock" -> {
                flush(blocks, text);
                var code = new StringBuilder();
                for (JsonNode child : node.path("content")) {
                    code.append(child.path("text").asText());
                }
                blocks.add(new Block(true, code.toString()));
            }
            case "text" -> text.append(node.path("text").asText());
            case "hardBreak" -> text.append('\n');
            case "inlineCard", "blockCard" -> text.append(node.path("attrs").path("url").asText());
            case "mention" -> text.append(node.path("attrs").path("text").asText());
            case "tableCell", "tableHeader" -> {
                for (JsonNode child : node.path("content")) {
                    walk(child, blocks, text);
                }
                text.append(" | ");
            }
            default -> {
                for (JsonNode child : node.path("content")) {
                    walk(child, blocks, text);
                }
                if (BLOCKS.contains(type)) {
                    text.append('\n');
                }
            }
        }
    }

    static List<Block> fromWiki(String wiki) {
        var blocks = new ArrayList<Block>();
        if (wiki == null || wiki.isBlank()) {
            return blocks;
        }
        var m = WIKI_CODE.matcher(wiki);
        int at = 0;
        while (m.find()) {
            add(blocks, false, wiki.substring(at, m.start()));
            blocks.add(new Block(true, m.group(2).strip()));
            at = m.end();
        }
        add(blocks, false, wiki.substring(at));
        return blocks;
    }

    private static void flush(List<Block> blocks, StringBuilder text) {
        add(blocks, false, text.toString());
        text.setLength(0);
    }

    private static void add(List<Block> blocks, boolean code, String text) {
        if (!text.isBlank()) {
            blocks.add(new Block(code, text.strip()));
        }
    }
}
