package com.ey.echo.builder.ai;

/** The AI engine could not be reached or did not answer usefully; the message can be shown to users. */
public class AiException extends RuntimeException {

    public AiException(String message) {
        super(message);
    }

    public AiException(String message, Throwable cause) {
        super(message, cause);
    }
}
