package com.ey.echo.builder;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BuilderApplicationTest {

    @Autowired
    private TestRestTemplate rest;

    @Test
    void healthIsUp() {
        assertThat(rest.getForObject("/actuator/health", String.class)).contains("\"status\":\"UP\"");
    }

    /** Checked over real HTTP: MockMvc's csrf() helper replaces the token repository. */
    @Test
    void csrfEndpointIssuesTheXsrfCookie() {
        var response = rest.getForEntity("/api/auth/csrf", Void.class);
        assertThat(response.getStatusCode().value()).isEqualTo(204);
        assertThat(response.getHeaders().get("Set-Cookie")).anyMatch(c -> c.startsWith("XSRF-TOKEN="));
    }
}
