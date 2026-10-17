package com.ey.echo.builder.editor;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where the Camel catalog that Kaoto shows comes from, and which processors it hides. Components
 * and languages are cut down to {@code echo.validation}'s allowed lists, so the editor only
 * offers what Validate accepts. Configurable in {@code echo.catalog}.
 *
 * <p>{@code locations}: tried in order; the first one with an {@code index.json} is used. The
 * defaults cover the packaged jar (UI bundled under static/), {@code mvn spring-boot:run} from
 * builder-backend and the e2e tests started from builder-ui.
 *
 * <p>{@code hiddenProcessors}: processors that need jars the Builder does not bundle, so Run
 * could not start a flow that uses them.
 */
@ConfigurationProperties("echo.catalog")
public record CatalogProperties(List<String> locations, List<String> hiddenProcessors) {

    public CatalogProperties {
        locations = locations == null || locations.isEmpty()
                ? List.of("classpath:/static/camel-catalog/", "file:../builder-ui/public/camel-catalog/",
                        "file:public/camel-catalog/")
                : List.copyOf(locations);
        hiddenProcessors = hiddenProcessors == null ? List.of() : List.copyOf(hiddenProcessors);
    }
}
