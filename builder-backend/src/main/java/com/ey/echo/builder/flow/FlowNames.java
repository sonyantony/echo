package com.ey.echo.builder.flow;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Rules for flow names and file paths. A flow's name (its identifier) becomes a folder in the
 * flow repository ({@code flows/<name>/}), a Camel route id and part of an image name, so it is
 * kept to lowercase letters, digits and dashes. Users type a display name ("First Flow") instead,
 * and the identifier is made from it ({@link #idFor}: first-flow).
 */
public final class FlowNames {

    private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9]*(-[a-z0-9]+)*$");
    private static final Pattern PATH_SEGMENT = Pattern.compile("^[A-Za-z0-9_.-]+$");
    public static final int MAX_NAME_LENGTH = 63;
    public static final int MAX_PATH_LENGTH = 200;
    public static final int MAX_DISPLAY_NAME_LENGTH = 100;

    private FlowNames() {}

    public static boolean isValidName(String name) {
        return name != null && name.length() <= MAX_NAME_LENGTH && NAME.matcher(name).matches();
    }

    /** Any text people would call a flow: not blank, no control characters, at most 100 characters. */
    public static boolean isValidDisplayName(String displayName) {
        return displayName != null && !displayName.isBlank() && displayName.strip().length() <= MAX_DISPLAY_NAME_LENGTH
                && displayName.codePoints().noneMatch(Character::isISOControl);
    }

    /**
     * The identifier made from a display name: lowercase letters and digits, everything else one
     * dash ("First Flow" is first-flow, "Café Orders!" is cafe-orders). It starts with a letter
     * ("2nd try" is flow-2nd-try) and is never empty (flow).
     */
    public static String idFor(String displayName) {
        String plain = Normalizer.normalize(displayName == null ? "" : displayName, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        if (plain.isEmpty()) {
            return "flow";
        }
        if (!Character.isLetter(plain.charAt(0))) {
            plain = "flow-" + plain;
        }
        return trim(plain, MAX_NAME_LENGTH);
    }

    private static String trim(String id, int max) {
        return id.length() <= max ? id : id.substring(0, max).replaceAll("-+$", "");
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
