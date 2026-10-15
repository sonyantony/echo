package com.ey.echo.builder.security;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Builder users for Version 1, read from {@code echo.security.users} in application.yaml.
 * Passwords use Spring's encoded form, e.g. {@code {bcrypt}$2a$10$...}.
 */
@Validated
@ConfigurationProperties("echo.security")
public record EchoSecurityProperties(@Valid List<User> users) {

    public EchoSecurityProperties {
        users = users == null ? List.of() : List.copyOf(users);
    }

    public record User(@NotBlank String username, @NotBlank String password, List<String> roles) {

        public User {
            roles = roles == null || roles.isEmpty() ? List.of("DESIGNER") : List.copyOf(roles);
        }
    }
}
