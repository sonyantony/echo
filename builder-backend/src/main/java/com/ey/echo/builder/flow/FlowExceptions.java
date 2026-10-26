package com.ey.echo.builder.flow;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Errors the flow API reports as RFC 9457 problem details. */
public final class FlowExceptions {

    private FlowExceptions() {}

    static ResponseStatusException notFound(String what) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, what + " not found");
    }

    static ResponseStatusException invalidName(String name) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Flow name '%s' is not allowed: use lowercase letters, digits and dashes, starting with a letter (max %d)."
                        .formatted(name, FlowNames.MAX_NAME_LENGTH));
    }

    static ResponseStatusException invalidDisplayName() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Give the flow a name of at most %d characters.".formatted(FlowNames.MAX_DISPLAY_NAME_LENGTH));
    }

    static ResponseStatusException invalidPath(String path) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "File path '%s' is not allowed.".formatted(path));
    }

    static ResponseStatusException duplicateName(String name) {
        return new ResponseStatusException(HttpStatus.CONFLICT, "A flow named '%s' already exists.".formatted(name));
    }

    /**
     * A new name another flow already has: 409 with {@code "nameTaken": true} and that flow, so the
     * user can open it instead: its Builder draft ({@code existingFlowId}) or, if it is only
     * published, its published folder ({@code existingFolder}).
     */
    static ResponseStatusException nameTaken(String name, String existingName, Long existingFlowId, String existingFolder) {
        return taken("A flow named '%s' already exists.".formatted(existingName), existingName, existingFlowId, existingFolder);
    }

    /** As {@link #nameTaken}, for a name whose ID ({@link FlowNames#idFor}) another flow has. */
    static ResponseStatusException idTaken(String name, String id, String existingName, Long existingFlowId,
            String existingFolder) {
        return taken("The name '%s' makes the ID %s, which flow '%s' already has.".formatted(name, id, existingName),
                existingName, existingFlowId, existingFolder);
    }

    private static ResponseStatusException taken(String message, String existingName, Long existingFlowId,
            String existingFolder) {
        var e = new ResponseStatusException(HttpStatus.CONFLICT, message);
        e.getBody().setProperty("nameTaken", true);
        e.getBody().setProperty("existingName", existingName);
        if (existingFlowId != null) {
            e.getBody().setProperty("existingFlowId", existingFlowId);
        }
        if (existingFolder != null) {
            e.getBody().setProperty("existingFolder", existingFolder);
        }
        return e;
    }

    /**
     * A save that would replace something: 409 with {@code "confirmOverwrite": true}, so the
     * editor asks the user and sends the request again with {@code overwrite: true}.
     */
    public static ResponseStatusException confirmOverwrite(String message) {
        var e = new ResponseStatusException(HttpStatus.CONFLICT, message);
        e.getBody().setProperty("confirmOverwrite", true);
        return e;
    }

    static ResponseStatusException descriptionTooLong() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "The description is limited to 1000 characters.");
    }

    static ResponseStatusException invalidArchive(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "This file cannot be uploaded as a flow: " + reason + ".");
    }

    static ResponseStatusException routeFileRequired() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "The flow's route file cannot be deleted.");
    }
}
