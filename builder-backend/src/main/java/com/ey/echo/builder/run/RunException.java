package com.ey.echo.builder.run;

/** A flow could not be started or called; the message is shown to the user. */
public class RunException extends RuntimeException {

    public RunException(String message) {
        super(message);
    }

    public RunException(String message, Throwable cause) {
        super(message, cause);
    }
}
