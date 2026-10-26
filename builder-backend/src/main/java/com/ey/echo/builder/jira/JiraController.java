package com.ey.echo.builder.jira;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Interface > Import From Jira: the example payloads and calls of a story, for the user to check. */
@RestController
class JiraController {

    record StoryRequest(String link) {}

    private final JiraProperties props;
    private final JiraClient jira;

    JiraController(JiraProperties props, JiraClient jira) {
        this.props = props;
        this.jira = jira;
    }

    @PostMapping("/api/jira/story-examples")
    StoryExamples storyExamples(@RequestBody StoryRequest request) {
        if (!props.active()) {
            throw new JiraException(HttpStatus.NOT_FOUND,
                    "Import From Jira is not set up: echo.jira.base-url and token are needed.");
        }
        String key = StoryKeys.keyOf(request.link(), props.base());
        return ExampleFinder.find(jira.read(key));
    }

    @ExceptionHandler(JiraException.class)
    ResponseEntity<ProblemDetail> failed(JiraException e) {
        return ResponseEntity.status(e.status()).body(ProblemDetail.forStatusAndDetail(e.status(), e.getMessage()));
    }
}
