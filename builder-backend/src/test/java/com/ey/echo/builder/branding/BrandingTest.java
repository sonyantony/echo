package com.ey.echo.builder.branding;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class BrandingTest {

    private static Path assetDir;

    @DynamicPropertySource
    static void branding(DynamicPropertyRegistry registry) throws IOException {
        assetDir = Files.createTempDirectory("echo-branding");
        Files.writeString(assetDir.resolve("acme.svg"), "<svg>acme</svg>");
        registry.add("echo.branding.asset-dir", assetDir::toString);
        registry.add("echo.branding.colors.primary", () -> "#123456");
    }

    @Autowired
    private MockMvc mvc;

    @Test
    void brandingIsReadableBeforeLoginAndComesFromConfig() throws Exception {
        mvc.perform(get("/api/branding"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.productName").doesNotExist())
                .andExpect(jsonPath("$.logo").value("/branding/logo.svg"))
                .andExpect(jsonPath("$.favicon").value("/branding/favicon.svg"))
                .andExpect(jsonPath("$.colors.primary").value("#123456"))
                .andExpect(jsonPath("$.colors.mastheadBackground").value("#2E2E38"));
    }

    @Test
    void defaultLogoShipsInTheJar() throws Exception {
        mvc.perform(get("/branding/logo.svg")).andExpect(status().isOk());
    }

    @Test
    void installFilesAreServedFromTheAssetDir() throws Exception {
        mvc.perform(get("/branding/acme.svg"))
                .andExpect(status().isOk())
                .andExpect(content().string("<svg>acme</svg>"));
    }

    @Test
    void installFilesOverrideTheDefaults() throws Exception {
        Files.writeString(assetDir.resolve("favicon.svg"), "<svg>override</svg>");
        mvc.perform(get("/branding/favicon.svg")).andExpect(content().string("<svg>override</svg>"));
    }
}
