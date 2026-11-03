package com.ey.echo.builder.run;

import java.util.List;
import java.util.Optional;
import org.apache.camel.model.ExpressionNode;
import org.apache.camel.model.ProcessorDefinition;
import org.apache.camel.model.RouteDefinition;
import org.apache.camel.model.SetHeaderDefinition;
import org.apache.camel.model.SetHeadersDefinition;
import org.apache.camel.model.SetVariableDefinition;
import org.apache.camel.model.SetVariablesDefinition;

/**
 * Finds the first step in a flow that has no expression (a Set Header, Set Variable, Set Body,
 * Filter, Choice When and so on left empty), which Camel only reports as "Unsupported definition:
 * null", and names it the way the canvas shows it.
 */
final class EmptyExpressions {

    private EmptyExpressions() {}

    static Optional<String> find(List<RouteDefinition> routes) {
        for (var route : routes) {
            var found = find(route.getOutputs(), route.getRouteId());
            if (found.isPresent()) {
                return found;
            }
        }
        return Optional.empty();
    }

    private static Optional<String> find(List<ProcessorDefinition<?>> steps, String routeId) {
        for (var step : steps) {
            var found = check(step, routeId);
            if (found.isPresent()) {
                return found;
            }
            found = find(step.getOutputs(), routeId);
            if (found.isPresent()) {
                return found;
            }
        }
        return Optional.empty();
    }

    private static Optional<String> check(ProcessorDefinition<?> step, String routeId) {
        if (step instanceof SetHeadersDefinition headers) {
            for (var header : headers.getHeaders()) {
                if (header instanceof SetHeaderDefinition h && h.getExpression() == null) {
                    return Optional.of(message(step, routeId, entry("header", h.getName())));
                }
            }
        } else if (step instanceof SetVariablesDefinition variables) {
            for (var variable : variables.getVariables()) {
                if (variable instanceof SetVariableDefinition v && v.getExpression() == null) {
                    return Optional.of(message(step, routeId, entry("variable", v.getName())));
                }
            }
        } else if (step instanceof ExpressionNode node && node.getExpression() == null) {
            String what = step instanceof SetHeaderDefinition h ? "header '%s' has no value".formatted(h.getName())
                    : step instanceof SetVariableDefinition v ? "variable '%s' has no value".formatted(v.getName())
                    : "has no expression";
            return Optional.of(message(step, routeId, what));
        }
        return Optional.empty();
    }

    private static String entry(String what, String name) {
        return name == null || name.isBlank() ? "an empty %s (no name, no value) is left in it".formatted(what)
                : "the %s '%s' has no value".formatted(what, name);
    }

    private static String message(ProcessorDefinition<?> step, String routeId, String what) {
        var name = new StringBuilder("the ").append(step.getShortName()).append(" step");
        if (step.getDescription() != null && !step.getDescription().isBlank()) {
            name.append(" \"").append(step.getDescription().strip()).append('"');
        } else if (step.getId() != null) {
            name.append(" (").append(step.getId()).append(')');
        }
        if (routeId != null) {
            name.append(" in route ").append(routeId);
        }
        return name + ": " + what + ". Open the step and fill it in, or delete it.";
    }
}
