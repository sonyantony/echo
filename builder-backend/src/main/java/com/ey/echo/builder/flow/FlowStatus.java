package com.ey.echo.builder.flow;

public enum FlowStatus {
    /** Has changes that are not in Git yet. */
    DRAFT,
    /** The draft matches the last published commit. */
    PUBLISHED
}
