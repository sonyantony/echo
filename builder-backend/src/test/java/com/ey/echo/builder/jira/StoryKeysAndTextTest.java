package com.ey.echo.builder.jira;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ey.echo.builder.jira.Story.Block;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import org.junit.jupiter.api.Test;

class StoryKeysAndTextTest {

    private static final URI SITE = URI.create("https://acme.atlassian.net");

    @Test
    void takesTheKeyFromTheLinksJiraGives() {
        assertThat(StoryKeys.keyOf("pay-142", SITE)).isEqualTo("PAY-142");
        assertThat(StoryKeys.keyOf("https://acme.atlassian.net/browse/PAY-142", SITE)).isEqualTo("PAY-142");
        assertThat(StoryKeys.keyOf("https://acme.atlassian.net/jira/software/projects/PAY/boards/3?selectedIssue=PAY-7", SITE))
                .isEqualTo("PAY-7");
        assertThat(StoryKeys.keyOf("https://ACME.atlassian.net:443/jira/software/projects/PAY/issues/PAY-9", SITE))
                .isEqualTo("PAY-9");
    }

    @Test
    void refusesLinksToOtherSites() {
        assertThatThrownBy(() -> StoryKeys.keyOf("https://evil.example.com/browse/PAY-142", SITE))
                .hasMessage("ECHO reads stories from acme.atlassian.net only, not from evil.example.com.");
        assertThatThrownBy(() -> StoryKeys.keyOf("https://acme.atlassian.net/jira/your-work", SITE))
                .hasMessageContaining("does not name a story");
        assertThatThrownBy(() -> StoryKeys.keyOf(" ", SITE)).hasMessageContaining("Paste the link");
    }

    @Test
    void readsAtlassianDocumentFormat() throws Exception {
        var doc = new ObjectMapper().readTree("""
                {"type":"doc","content":[
                  {"type":"paragraph","content":[{"type":"text","text":"POST "},{"type":"text","text":"/orders","marks":[{"type":"code"}]},
                    {"type":"hardBreak"},{"type":"text","text":"Request:"}]},
                  {"type":"codeBlock","attrs":{"language":"json"},"content":[{"type":"text","text":"{\\"a\\": 1}"}]},
                  {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]}]}
                ]}""");
        assertThat(StoryText.fromAdf(doc)).containsExactly(
                new Block(false, "POST /orders\nRequest:"),
                new Block(true, "{\"a\": 1}"),
                new Block(false, "one"));
    }

    @Test
    void readsWikiMarkup() {
        assertThat(StoryText.fromWiki("GET /cards\n{code:json}\n{\"a\": 1}\n{code}\nand {noformat}[{\"b\":2}]{noformat}"))
                .containsExactly(
                        new Block(false, "GET /cards"),
                        new Block(true, "{\"a\": 1}"),
                        new Block(false, "and"),
                        new Block(true, "[{\"b\":2}]"));
    }
}
