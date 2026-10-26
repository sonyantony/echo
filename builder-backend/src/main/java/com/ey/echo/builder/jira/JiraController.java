package com.ey.echo.builder.jira;

import com.ey.echo.builder.ai.AiProvider;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Interface > Import From Jira: the example payloads and calls of a story, for the user to check.
 * With an AI engine (echo.ai) it pairs them; without one, ECHO's own guess is shown.
 */
@RestController
class JiraController {

    record StoryRequest(String link) {}

    private final JiraProperties props;
    private final JiraClient jira;
    private final AiExampleLabeler labeler;

    JiraController(JiraProperties props, JiraClient jira, ObjectProvider<AiProvider> ai, ObjectMapper json) {
        this.props = props;
        this.jira = jira;
        AiProvider engine = ai.getIfAvailable();
        this.labeler = engine == null ? null : new AiExampleLabeler(engine, json);
    }

    @PostMapping("/api/jira/story-examples")
    StoryExamples storyExamples(@RequestBody StoryRequest request) {
        if (!props.active()) {
            throw new JiraException(HttpStatus.NOT_FOUND,
                    "Import From Jira is not set up: echo.jira.base-url and token are needed.");
        }
        String key = StoryKeys.keyOf(request.link(), props.base());
        var found = ExampleFinder.findAll(jira.read(key));
        return labeler == null ? found.guess() : labeler.label(found);
    }

    @ExceptionHandler(JiraException.class)
    ResponseEntity<ProblemDetail> failed(JiraException e) {
        return ResponseEntity.status(e.status()).body(ProblemDetail.forStatusAndDetail(e.status(), e.getMessage()));
    }
}
