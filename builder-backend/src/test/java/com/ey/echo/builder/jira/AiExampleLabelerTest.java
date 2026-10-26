package com.ey.echo.builder.jira;

import static org.assertj.core.api.Assertions.assertThat;

import com.ey.echo.builder.ai.AiException;
import com.ey.echo.builder.ai.AiProvider;
import com.ey.echo.builder.jira.Story.Block;
import com.ey.echo.builder.jira.Story.Part;
import com.ey.echo.builder.jira.StoryExamples.Operation;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class AiExampleLabelerTest {

    private final AtomicReference<String> input = new AtomicReference<>();

    private AiProvider engine(Function<String, String> answer) {
        return new AiProvider() {
            @Override
            public String completeJson(String instructions, String in) {
                input.set(in);
                return answer.apply(in);
            }

            @Override
            public String describe() {
                return "gpt-test at ai.example.com";
            }
        };
    }

    private static final Story STORY = new Story("PAY-142", "Pay a bill", "https://jira/browse/PAY-142", List.of(
            new Part("Description", List.of(new Block(false, "Customers pay bills. Body:"), new Block(true, "{\"amount\": 10}"),
                    new Block(false, "and we send back {\"paymentId\": \"p-1\"}"))),
            new Part("Comment by Priya Shah, 14 Oct 2026", List.of(new Block(false, "Actually the reply is"),
                    new Block(true, "{\"paymentId\": \"p-1\", \"state\": \"NEW\"}")))));

    private StoryExamples label(Function<String, String> answer) {
        return new AiExampleLabeler(engine(answer), new ObjectMapper()).label(ExampleFinder.findAll(STORY));
    }

    @Test
    void sendsTheStoryWithExamplesByNumberAndTakesTheEnginesPairing() {
        var result = label(in -> """
                {"operations":[{"method":"post","path":"POST /accounts/{id}/payments","query":"",
                  "request":1,"response":"Example 3","alternatives":[2],"reason":"The comment corrects the response."}]}""");

        assertThat(input.get()).contains("# PAY-142: Pay a bill", "## Description", "Body:\n\n[Example 1]",
                "we send back [Example 2]", "## Comment by Priya Shah, 14 Oct 2026",
                "[Example 3] from Comment by Priya Shah, 14 Oct 2026:\n```json\n{\n  \"paymentId\" : \"p-1\"");
        assertThat(result.engine()).isEqualTo("gpt-test at ai.example.com");
        assertThat(result.notes()).isEmpty();
        assertThat(result.operations()).containsExactly(new Operation("POST", "/accounts/{id}/payments", 1, 3,
                List.of(1, 3, 2), "The comment corrects the response."));
    }

    @Test
    void dropsWhatTheStoryDoesNotHaveAndAddsTheQuery() {
        var result = label(in -> """
                {"operations":[{"method":"FETCH","path":"/payments","query":"status=OPEN&limit=5","request":null,"response":9},
                               {"method":"GET","path":"see the docs","response":2}]}""");

        assertThat(result.operations()).containsExactly(
                new Operation("GET", "/payments?status=OPEN&limit=5", null, null, List.of(), null),
                new Operation("GET", "", null, 2, List.of(2), null));
        assertThat(result.notes()).containsExactly("Parts of the AI engine's answer were left out: example 9, which the "
                + "story does not have, a path that is not a path (see the docs).");
    }

    @Test
    void keepsEchosOwnGuessWhenTheEngineFails() {
        var result = label(in -> {
            throw new AiException("Could not reach the AI engine at ai.example.com.");
        });
        assertThat(result.engine()).isNull();
        assertThat(result.notes()).containsExactly("Could not reach the AI engine at ai.example.com. ECHO's own guess is shown instead.");
        assertThat(result.operations()).isEqualTo(ExampleFinder.find(STORY).operations());

        assertThat(label(in -> "Sorry, I cannot help.").notes())
                .containsExactly("The AI engine (gpt-test at ai.example.com) did not answer with JSON. ECHO's own guess is shown instead.");
        assertThat(label(in -> "{\"operations\": []}").notes())
                .containsExactly("The AI engine (gpt-test at ai.example.com) found no operations. ECHO's own guess is shown instead.");
    }
}
