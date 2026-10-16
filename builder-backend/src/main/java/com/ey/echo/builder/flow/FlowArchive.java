package com.ey.echo.builder.flow;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * A flow as a zip file, so a user can keep a copy on their computer and upload it again later.
 * The zip holds the flow folder exactly as it is published to Git: {@code <name>/<name>.camel.yaml}
 * plus its side files.
 */
public final class FlowArchive {

    /** Generous for a flow (YAML, XSLT, JSON schemas) while stopping zip bombs. */
    static final int MAX_FILES = 200;
    static final long MAX_TOTAL_BYTES = 5L * 1024 * 1024;

    private static final String ROUTE_SUFFIX = ".camel.yaml";

    /** A flow read from a zip: its name (from the route file) and its files, path to content. */
    public record Contents(String name, Map<String, String> files) {}

    private FlowArchive() {}

    public static void write(String name, Map<String, String> files, OutputStream out) throws IOException {
        var zip = new ZipOutputStream(out, StandardCharsets.UTF_8);
        zip.putNextEntry(new ZipEntry(name + "/"));
        zip.closeEntry();
        for (var file : files.entrySet()) {
            zip.putNextEntry(new ZipEntry(name + "/" + file.getKey()));
            zip.write(file.getValue().getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        zip.finish();
    }

    /**
     * Reads a flow zip. Files may sit at the top of the zip or inside one top-level folder (as
     * {@link #write} produces). There must be exactly one {@code <name>.camel.yaml} at the flow's
     * top level; it names the flow.
     */
    public static Contents read(InputStream in) {
        var raw = new TreeMap<String, String>();
        long total = 0;
        try (var zip = new ZipInputStream(in, StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                var path = entry.getName().replace('\\', '/');
                if (entry.isDirectory() || isJunk(path)) {
                    continue;
                }
                if (raw.size() == MAX_FILES) {
                    throw invalid("it has more than " + MAX_FILES + " files");
                }
                var bytes = readLimited(zip, MAX_TOTAL_BYTES - total);
                total += bytes.length;
                raw.put(path, decode(bytes, path));
            }
        } catch (ZipException e) {
            throw invalid("it is not a valid zip file");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        if (raw.isEmpty()) {
            throw invalid("it is not a zip file, or the zip is empty");
        }

        var files = stripCommonFolder(raw);
        for (var path : files.keySet()) {
            if (!FlowNames.isValidPath(path)) {
                throw invalid("file path '" + path + "' is not allowed");
            }
        }
        var routes = files.keySet().stream().filter(p -> !p.contains("/") && p.endsWith(ROUTE_SUFFIX)).toList();
        if (routes.size() != 1) {
            throw invalid("it must contain exactly one <flow-name>" + ROUTE_SUFFIX + " file, found " + routes.size());
        }
        var name = routes.get(0).substring(0, routes.get(0).length() - ROUTE_SUFFIX.length());
        return new Contents(name, files);
    }

    /** Removes a single top-level folder that every file sits in, e.g. {@code orders/}. */
    private static Map<String, String> stripCommonFolder(Map<String, String> files) {
        var first = files.keySet().iterator().next();
        int slash = first.indexOf('/');
        if (slash <= 0) {
            return files;
        }
        var prefix = first.substring(0, slash + 1);
        if (!files.keySet().stream().allMatch(p -> p.startsWith(prefix))) {
            return files;
        }
        var result = new TreeMap<String, String>();
        files.forEach((path, content) -> result.put(path.substring(prefix.length()), content));
        return result;
    }

    /** Files that operating systems add when zipping a folder. */
    private static boolean isJunk(String path) {
        return path.startsWith("__MACOSX/") || path.endsWith(".DS_Store") || path.endsWith("Thumbs.db");
    }

    private static byte[] readLimited(InputStream in, long remaining) throws IOException {
        var out = new ByteArrayOutputStream();
        var buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) > 0) {
            if (out.size() + (long) n > remaining) {
                throw invalid("it is larger than " + MAX_TOTAL_BYTES / (1024 * 1024) + " MB unpacked");
            }
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }

    private static String decode(byte[] bytes, String path) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException e) {
            throw invalid("'" + path + "' is not a UTF-8 text file");
        }
    }

    private static RuntimeException invalid(String reason) {
        return FlowExceptions.invalidArchive(reason);
    }
}
