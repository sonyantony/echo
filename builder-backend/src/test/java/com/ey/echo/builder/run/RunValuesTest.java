package com.ey.echo.builder.run;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ey.echo.builder.run.RunValues.Placeholder;
import java.util.List;
import org.junit.jupiter.api.Test;

class RunValuesTest {

    @Test
    void findsTheFlowsValuesWithoutFunctionsOrEchoSettings() {
        String route = """
                uri: "http://{{inventory.host}}:{{inventory.port:9090}}/items?token={{env:TOKEN}}"
                message: "{{ fulfilment.api.token }} {{echo.swagger-ui.version}} {{?optional.name}} {{sys:user.home}}"
                """;
        assertThat(RunValues.placeholders(route)).containsExactly(
                new Placeholder("fulfilment.api.token", null),
                new Placeholder("inventory.host", null),
                new Placeholder("inventory.port", "9090"),
                new Placeholder("optional.name", null));
    }

    @Test
    void aUseWithoutDefaultMakesTheValueNeeded() {
        assertThat(RunValues.placeholders("{{a:1}} {{a}} {{b:2}} {{b:3}}"))
                .containsExactly(new Placeholder("a", null), new Placeholder("b", "2"));
    }

    @Test
    void keepsAFileOnlyWhenItSetsEveryNeededValue() {
        var values = new RunValues();
        var needed = List.of(new Placeholder("a", null), new Placeholder("b", "2"));

        assertThatThrownBy(() -> values.choose(1, "designer", "x.properties", "b=3", needed))
                .hasMessage("x.properties does not set a.");
        assertThat(values.get(1, "designer")).isEmpty();

        values.choose(1, "designer", "y.properties", "# test\na = 1\n", needed);
        assertThat(values.get(1, "designer")).get().extracting(RunValues.Chosen::fileName).isEqualTo("y.properties");
        assertThat(values.get(1, "tester")).isEmpty();
        assertThat(values.get(2, "designer")).isEmpty();
    }

    @Test
    void theFilesValuesGoOnTopOfTheFlowsApplicationProperties() {
        var file = new RunValues.Chosen("t.properties", "a=file");
        assertThat(RunValues.merged("a=flow\nb=flow", file)).isEqualTo("a=flow\nb=flow\na=file");
    }
}
