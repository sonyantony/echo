package com.ey.echo.builder.branding;

import java.nio.file.Path;
import java.util.ArrayList;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Serves {@code /branding/**}: the install's own files first, then the defaults in the jar. */
@Configuration
public class BrandingWebConfig implements WebMvcConfigurer {

    private final BrandingProperties properties;

    public BrandingWebConfig(BrandingProperties properties) {
        this.properties = properties;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        var locations = new ArrayList<String>();
        if (properties.assetDir() != null && !properties.assetDir().isBlank()) {
            locations.add(Path.of(properties.assetDir()).toAbsolutePath().toUri().toString());
        }
        locations.add("classpath:/branding/");
        registry.addResourceHandler("/branding/**").addResourceLocations(locations.toArray(String[]::new));
    }
}
