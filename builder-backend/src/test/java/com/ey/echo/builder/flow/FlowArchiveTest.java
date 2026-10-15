package com.ey.echo.builder.flow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class FlowArchiveTest {

    private static final Path ORDERS = Path.of("../samples/flows/orders");

    static Map<String, String> sampleOrders() throws IOException {
        var files = new TreeMap<String, String>();
        try (var paths = Files.walk(ORDERS)) {
            for (var p : paths.filter(Files::isRegularFile).toList()) {
                files.put(ORDERS.relativize(p).toString().replace('\\', '/'), Files.readString(p));
            }
        }
        return files;
    }

    /** A zip with the given entries, in order; a null content makes a folder entry. */
    static byte[] zip(Map<String, String> entries) throws IOException {
        var out = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(out)) {
            for (var e : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(e.getKey()));
                if (e.getValue() != null) {
                    zip.write(e.getValue().getBytes(StandardCharsets.UTF_8));
                }
                zip.closeEntry();
            }
        }
        return out.toByteArray();
    }

    private static FlowArchive.Contents read(byte[] zip) {
        return FlowArchive.read(new ByteArrayInputStream(zip));
    }

    @Test
    void roundTripsTheSampleOrdersFlow() throws IOException {
        var files = sampleOrders();
        var out = new ByteArrayOutputStream();
        FlowArchive.write("orders", files, out);

        var contents = read(out.toByteArray());
        assertThat(contents.name()).isEqualTo("orders");
        assertThat(contents.files()).isEqualTo(files);
    }

    @Test
    void acceptsFilesAtTheTopOfTheZipAndSkipsOsJunk() throws IOException {
        var entries = new LinkedHashMap<String, String>();
        entries.put("refunds.camel.yaml", "- route: {}\n");
        entries.put("schemas/", null);
        entries.put("schemas/refund.schema.json", "{}");
        entries.put("__MACOSX/._refunds.camel.yaml", "junk");
        entries.put(".DS_Store", "junk");

        var contents = read(zip(entries));
        assertThat(contents.name()).isEqualTo("refunds");
        assertThat(contents.files()).containsOnlyKeys("refunds.camel.yaml", "schemas/refund.schema.json");
    }

    @Test
    void rejectsAZipWithoutExactlyOneRouteFile() {
        assertThatThrownBy(() -> read(zip(Map.of("orders/readme.txt", "hi"))))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("exactly one <flow-name>.camel.yaml file, found 0");
        assertThatThrownBy(() -> read(zip(Map.of("a.camel.yaml", "x", "b.camel.yaml", "y"))))
                .hasMessageContaining("found 2");
    }

    @Test
    void rejectsUnsafePaths() {
        var entries = new LinkedHashMap<String, String>();
        entries.put("orders.camel.yaml", "x");
        entries.put("../evil.sh", "x");
        assertThatThrownBy(() -> read(zip(entries))).hasMessageContaining("'../evil.sh' is not allowed");
    }

    @Test
    void rejectsSomethingThatIsNotAZipOrNotText() throws IOException {
        assertThatThrownBy(() -> read("just text".getBytes(StandardCharsets.UTF_8)))
                .hasMessageContaining("not a zip file, or the zip is empty");

        var out = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("orders.camel.yaml"));
            zip.write(new byte[] {(byte) 0xff, (byte) 0xfe, 0x00});
            zip.closeEntry();
        }
        assertThatThrownBy(() -> read(out.toByteArray())).hasMessageContaining("not a UTF-8 text file");
    }

    @Test
    void rejectsAZipThatUnpacksTooLarge() {
        var big = "x".repeat((int) FlowArchive.MAX_TOTAL_BYTES + 1);
        assertThatThrownBy(() -> read(zip(Map.of("orders.camel.yaml", big))))
                .hasMessageContaining("larger than 5 MB");
    }
}
