package com.ey.echo.builder.flow;

import java.util.regex.Pattern;

/**
 * Rules for flow names and file paths. A flow name becomes a folder in the flow repository
 * ({@code flows/<name>/}), a Camel route id and part of an image name, so it is kept to
 * lowercase letters, digits and dashes.
 */
public final class FlowNames {

    private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9]*(-[a-z0-9]+)*$");
    private static final Pattern PATH_SEGMENT = Pattern.compile("^[A-Za-z0-9_.-]+$");
    public static final int MAX_NAME_LENGTH = 63;
    public static final int MAX_PATH_LENGTH = 200;

    private FlowNames() {}

    public static boolean isValidName(String name) {
        return name != null && name.length() <= MAX_NAME_LENGTH && NAME.matcher(name).matches();
    }

    /** Relative path inside the flow folder, no "..", no absolute paths, no hidden tricks. */
    public static boolean isValidPath(String path) {
        if (path == null || path.isEmpty() || path.length() > MAX_PATH_LENGTH) {
            return false;
        }
        for (String segment : path.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")
                    || !PATH_SEGMENT.matcher(segment).matches()) {
                return false;
            }
        }
        return true;
    }

    public static String routeFile(String flowName) {
        return flowName + ".camel.yaml";
    }
}
