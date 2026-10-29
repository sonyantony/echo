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
                    .andExpect(jsonPath("$.routeCall").doesNotExist())
                    .andExpect(jsonPath("$.apiTags").isEmpty());
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

        @Test
        void tagsListTheirOperations() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.apiTags[0].specificationUri").value("inventory.openapi.json"))
                    .andExpect(jsonPath("$.apiTags[0].host").value("{{inventory.host}}"))
                    .andExpect(jsonPath("$.apiTags[0].tags[0].name").value("Shutdown controller"))
                    .andExpect(jsonPath("$.apiTags[0].tags[0].operations[0]").value("init"))
                    .andExpect(jsonPath("$.apiTags[0].tags[1].name").value("TMF638 Service Controller"))
                    .andExpect(jsonPath("$.apiTags[0].tags[1].operations[0]").value("createService"))
                    .andExpect(jsonPath("$.apiTags[0].tags[1].operations[1]").value("getService"));
        }
    }

    @Nested
    @SpringBootTest(properties = {
        "echo.apis.specs[0].id=inventory",
        "echo.apis.specs[0].file=src/test/resources/apis/inventory.yaml",
        "echo.apis.specs[0].allowed-tags[0]=TMF638 Service Controller"
    })
    @AutoConfigureMockMvc
    class AllowedTags {
        @Autowired
        private MockMvc mvc;

        @Test
        void onlyTagsWithAllowedOperations() throws Exception {
            mvc.perform(get("/api/editor/settings").with(user("designer").roles("DESIGNER")))
                    .andExpect(jsonPath("$.apiTags[0].tags.length()").value(1))
                    .andExpect(jsonPath("$.apiTags[0].tags[0].name").value("TMF638 Service Controller"));
        }
    }
}
