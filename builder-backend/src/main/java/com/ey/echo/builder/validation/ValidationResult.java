package com.ey.echo.builder.validation;

import java.util.List;

public record ValidationResult(boolean valid, List<Problem> problems) {

    public record Problem(String file, Integer line, String message) {}

    static ValidationResult of(List<Problem> problems) {
        return new ValidationResult(problems.isEmpty(), List.copyOf(problems));
    }
}
