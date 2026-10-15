package com.ey.echo.builder.branding;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The Builder's look for this install, read from {@code echo.branding} in application.yaml, so a
 * buyer can rebrand without rebuilding the image.
 *
 * <p>{@code logo} and {@code favicon} are URLs the browser loads. Files under {@code /branding/}
 * are served from {@code asset-dir} first (e.g. a mounted {@code /config/branding}) and then from
 * the defaults built into the jar. Unset colours keep the PatternFly defaults.
 */
@Validated
@ConfigurationProperties("echo.branding")
public record BrandingProperties(
        @NotBlank String productName, String logo, String logoAlt, String favicon, String assetDir, Colors colors) {

    public BrandingProperties {
        favicon = favicon == null || favicon.isBlank() ? logo : favicon;
        logoAlt = logoAlt == null ? "" : logoAlt;
        colors = colors == null ? new Colors(null, null, null, null, null, null) : colors;
    }

    /** CSS colour values; see {@code builder-ui/src/branding/applyBranding.ts} for where each one goes. */
    public record Colors(
            String primary,
            String primaryHover,
            String onPrimary,
            String accentText,
            String mastheadBackground,
            String mastheadText) {}
}
