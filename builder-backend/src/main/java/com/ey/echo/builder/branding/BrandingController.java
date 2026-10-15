package com.ey.echo.builder.branding;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The UI reads its branding here before login, so this endpoint is public. */
@RestController
public class BrandingController {

    public record Branding(
            String productName, String logo, String logoAlt, String favicon, BrandingProperties.Colors colors) {}

    private final Branding branding;

    public BrandingController(BrandingProperties properties) {
        this.branding = new Branding(
                properties.productName(),
                properties.logo(),
                properties.logoAlt(),
                properties.favicon(),
                properties.colors());
    }

    @GetMapping("/api/branding")
    public Branding branding() {
        return branding;
    }
}
