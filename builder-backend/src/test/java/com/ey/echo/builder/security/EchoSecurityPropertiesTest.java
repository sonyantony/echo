package com.ey.echo.builder.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class EchoSecurityPropertiesTest {

    @Test
    void usersDefaultToTheDesignerRole() {
        var user = new EchoSecurityProperties.User("alice", "{noop}x", null);
        assertThat(user.roles()).containsExactly("DESIGNER");
    }

    @Test
    void missingUserListIsEmpty() {
        assertThat(new EchoSecurityProperties(null).users()).isEmpty();
        assertThat(new EchoSecurityProperties(List.of()).users()).isEmpty();
    }
}
