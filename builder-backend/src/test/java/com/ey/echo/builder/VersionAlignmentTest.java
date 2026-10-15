package com.ey.echo.builder;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.regex.Pattern;
import org.apache.camel.impl.DefaultCamelContext;
import org.junit.jupiter.api.Test;

/**
 * The Builder's validator, Kaoto's catalog in the UI and the runtime image must use the same
 * Camel version, or flows that validate in the Builder could fail at runtime.
 */
class VersionAlignmentTest {

    private static final Path ROOT = Path.of("..");

    private static String runtimeCamelVersion() throws IOException {
        var props = new Properties();
        props.load(new StringReader(Files.readString(ROOT.resolve("runtime-template/versions.properties"))));
        return props.getProperty("camel.version");
    }

    private static String uiCatalogCamelVersion() throws IOException {
        var script = Files.readString(ROOT.resolve("builder-ui/scripts/copy-camel-catalog.mjs"));
        var m = Pattern.compile("CAMEL_VERSION = '([^']+)'").matcher(script);
        assertThat(m.find()).as("CAMEL_VERSION in copy-camel-catalog.mjs").isTrue();
        return m.group(1);
    }

    private static String uiRuntimeCatalogName() throws IOException {
        var source = Files.readString(ROOT.resolve("builder-ui/src/editor/kaotoEnvelope.ts"));
        var m = Pattern.compile("runtimeCatalogName: 'Camel Spring Boot ([^']+)'").matcher(source);
        assertThat(m.find()).as("runtimeCatalogName in kaotoEnvelope.ts").isTrue();
        return m.group(1);
    }

    @Test
    void camelVersionIsTheSameEverywhere() throws IOException {
        String backend = new DefaultCamelContext(false).getVersion();
        assertThat(runtimeCamelVersion()).as("runtime-template").isEqualTo(backend);
        assertThat(uiCatalogCamelVersion()).as("Kaoto catalog copied by the UI").isEqualTo(backend);
        assertThat(uiRuntimeCatalogName()).as("Kaoto runtime catalog selected by the UI").isEqualTo(backend);
    }
}
