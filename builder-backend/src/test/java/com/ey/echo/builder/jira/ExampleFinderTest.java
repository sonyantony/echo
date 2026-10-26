package com.ey.echo.builder.jira;

import static org.assertj.core.api.Assertions.assertThat;

import com.ey.echo.builder.jira.Story.Block;
import com.ey.echo.builder.jira.Story.Part;
import com.ey.echo.builder.jira.StoryExamples.Operation;
import java.util.List;
import org.junit.jupiter.api.Test;

class ExampleFinderTest {

    private static StoryExamples find(Part... parts) {
        return ExampleFinder.find(new Story("PAY-142", "Payments", "https://jira/browse/PAY-142", List.of(parts)));
    }

    private static Part part(String source, Block... blocks) {
        return new Part(source, List.of(blocks));
    }

    private static Block text(String text) {
        return new Block(false, text);
    }

    private static Block code(String text) {
        return new Block(true, text);
    }

    @Test
    void pairsTheRequestAndResponseWithTheCallBeforeThem() {
        var found = find(part("Description",
                text("As a teller I can make a payment.\nEndpoint: POST /accounts/{accountId}/payments\nSample request:"),
                code("{ \"amount\": 12.5, \"currency\": \"EUR\" }"),
                text("Sample response:"),
                code("{ \"paymentId\": \"p-1\", \"status\": \"PENDING\" }")));

        assertThat(found.examples()).hasSize(2);
        assertThat(found.examples().get(0).role()).isEqualTo("request");
        assertThat(found.examples().get(1).role()).isEqualTo("response");
        assertThat(found.examples().get(0).json()).contains("\"amount\" : 12.5");
        assertThat(found.operations()).containsExactly(
                new Operation("POST", "/accounts/{accountId}/payments", 1, 2, List.of(1, 2), null));
    }

    @Test
    void readsQueryParametersFromTheUrlOrALineOfTheirOwn() {
        var found = find(part("Description",
                text("GET https://api.acme.com/v1/payments?status=OPEN&limit=20 returns:"),
                code("[{ \"paymentId\": \"p-1\" }]"),
                text("Then GET /customers/{id}/cards\nQuery parameters: type=DEBIT, active=true"),
                code("{ \"cards\": [] }")));

        assertThat(found.operations()).containsExactly(
                new Operation("GET", "/v1/payments?status=OPEN&limit=20", null, 1, List.of(1), null),
                new Operation("GET", "/customers/{id}/cards?type=DEBIT&active=true", null, 2, List.of(2), null));
    }

    @Test
    void aLaterCommentsExampleIsPickedAndTheEarlierOneOffered() {
        var found = find(
                part("Description", text("POST /orders\nRequest:"), code("{\"sku\": \"a\"}"), text("Response:"),
                        code("{\"orderId\": 1}")),
                part("Comment by Priya Shah, 14 Oct 2026", text("Correction, the response is:"),
                        code("{\"orderId\": 1, \"state\": \"NEW\"}")));

        assertThat(found.comments()).isEqualTo(1);
        assertThat(found.examples().get(2).source()).isEqualTo("Comment by Priya Shah, 14 Oct 2026");
        assertThat(found.operations()).containsExactly(new Operation("POST", "/orders", 1, 3, List.of(1, 2, 3), null));
    }

    @Test
    void findsJsonInPlainTextAndSeveralInOneCodeBlock() {
        var found = find(part("Description",
                code("// request\n{\"a\": 1,}\n// response\n{\"b\": [1, 2]}"),
                text("Also the error body looks like {\"code\": \"E1\"} and [optional] is not JSON.")));

        assertThat(found.examples()).extracting(StoryExamples.Example::role)
                .containsExactly("request", "response", null);
        // No call named: one operation, the method guessed from having a request.
        assertThat(found.operations()).containsExactly(new Operation("POST", "", 1, 2, List.of(1, 2, 3), null));
    }

    @Test
    void aStoryWithoutExamplesHasNoOperations() {
        var found = find(part("Description", text("Make the payments page faster. See [docs].")));
        assertThat(found.examples()).isEmpty();
        assertThat(found.operations()).isEmpty();
    }

    @Test
    void cleansUpPathsAsWritten() {
        assertThat(ExampleFinder.pathOf("/cards/%7BcardId%7D.")).isEqualTo("/cards/{cardId}");
        assertThat(ExampleFinder.pathOf("https://x.com/a/{id}?q=1),")).isEqualTo("/a/{id}?q=1");
        assertThat(ExampleFinder.pathOf("/")).isNull();
    }
}
