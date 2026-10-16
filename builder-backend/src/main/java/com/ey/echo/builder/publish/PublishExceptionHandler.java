package com.ey.echo.builder.publish;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Publish target errors (unreachable server, rejected push, not configured) as 502 problem details. */
@RestControllerAdvice(assignableTypes = {PublishController.class, PublishedFlowController.class})
class PublishExceptionHandler {

    @ExceptionHandler(PublishException.class)
    ResponseEntity<ProblemDetail> publishFailed(PublishException e) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, e.getMessage());
        problem.setTitle("Publish failed");
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(problem);
    }
}
