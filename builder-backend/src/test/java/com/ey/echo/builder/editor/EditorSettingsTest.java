package com.ey.echo.builder.editor;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

class EditorSettingsTest {

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    class Defaults {
        @Autowired
        private MockMvc mvc;

        @Test
        void autosaveDefaultsToTenSeconds() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.autosaveSeconds").value(10));
        }

        @Test
        void withoutApprovedApisNewRoutesCallNothingYet() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.routeCall").doesNotExist());
        }

        @Test
        void needsALogin() throws Exception {
            mvc.perform(get("/api/editor/settings")).andExpect(status().isUnauthorized());
        }
    }

    @Nested
    @SpringBootTest(properties = "echo.editor.autosave-seconds=30")
    @AutoConfigureMockMvc
    class FromConfig {
        @Autowired
        private MockMvc mvc;

        @Test
        void autosaveIntervalComesFromConfig() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.autosaveSeconds").value(30));
        }
    }

    @Nested
    @SpringBootTest(properties = {
        "echo.apis.specs[0].id=inventory",
        "echo.apis.specs[0].file=src/test/resources/apis/inventory.yaml"
    })
    @AutoConfigureMockMvc
    class OneApprovedApi {
        @Autowired
        private MockMvc mvc;

        @Test
        void newRoutesCallItsSpec() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.routeCall.specificationUri").value("inventory.openapi.json"))
                    .andExpect(jsonPath("$.routeCall.host").value("{{inventory.host}}"));
        }
    }
}
