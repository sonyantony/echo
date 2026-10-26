package com.ey.echo.builder.jira;

import org.springframework.http.HttpStatus;

/** A story could not be read; the message is shown to the user as it is. */
public class JiraException extends RuntimeException {

    private final HttpStatus status;

    public JiraException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public JiraException(HttpStatus status, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
    }

    public HttpStatus status() {
        return status;
    }
}
