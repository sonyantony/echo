package com.ey.echo.builder.editor;

import static org.hamcrest.Matchers.anEmptyMap;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/** The editor's catalog only offers what Validate accepts (fixture catalog in test-camel-catalog/). */
class CamelCatalogTest {

    static final String DIR = "/api/camel-catalog/camel-springboot/4.22.1/";

    @Nested
    @SpringBootTest(properties = "echo.catalog.locations=classpath:/test-camel-catalog/")
    @AutoConfigureMockMvc
    class Defaults {
        @Autowired
        private MockMvc mvc;

        @Test
        void componentsAreCutDownToTheAllowedOnes() throws Exception {
            mvc.perform(get(DIR + "components-1.json"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.http").exists())
                    .andExpect(jsonPath("$['rest-openapi']").exists())
                    .andExpect(jsonPath("$.kafka").doesNotExist());
        }

        @Test
        void hiddenProcessorsAndKameletsAreLeftOut() throws Exception {
            mvc.perform(get(DIR + "patterns-1.json"))
                    .andExpect(jsonPath("$.setBody").exists())
                    .andExpect(jsonPath("$.choice").exists())
                    .andExpect(jsonPath("$.marshal").doesNotExist())
                    .andExpect(jsonPath("$.kamelet").doesNotExist());
            mvc.perform(get(DIR + "kamelets-1.json")).andExpect(jsonPath("$", anEmptyMap()));
            mvc.perform(get(DIR + "boundaries-1.json")).andExpect(jsonPath("$", anEmptyMap()));
        }

        @Test
        void languagesAreCutDownToTheAllowedOnes() throws Exception {
            mvc.perform(get(DIR + "languages-1.json"))
                    .andExpect(jsonPath("$.simple").exists())
                    .andExpect(jsonPath("$.jq").doesNotExist());
        }

        @Test
        void restConfigurationShowsOnlyContextPathRequestValidationAndCorsAtTheTopLevel() throws Exception {
            for (String part : List.of("properties", "propertiesSchema.properties")) {
                mvc.perform(get(DIR + "entities-1.json"))
                        .andExpect(jsonPath("$.restConfiguration." + part + ".*", hasSize(3)))
                        .andExpect(jsonPath("$.restConfiguration." + part + ".contextPath").exists())
                        .andExpect(jsonPath("$.restConfiguration." + part + ".clientRequestValidation").exists())
                        .andExpect(jsonPath("$.restConfiguration." + part + ".enableCORS").exists());
            }
            mvc.perform(get(DIR + "entities-1.json"))
                    .andExpect(content().string(containsString(
                            "\"properties\":{\"contextPath\":{\"title\":\"Context Path\",\"$comment\":\"group:consumer\"},"
                                    + "\"clientRequestValidation\":{\"$comment\":\"group:consumer\"},"
                                    + "\"enableCORS\":{\"$comment\":\"group:consumer\"}}")))
                    .andExpect(jsonPath("$.restConfiguration.properties.enableCORS.group").value("consumer"))
                    .andExpect(jsonPath("$.restConfiguration.properties.enableCORS.label").value("consumer"))
                    .andExpect(jsonPath("$.rest.propertiesSchema.properties.path").exists());
        }

        @Test
        void otherFilesArePassedThroughWithoutALogin() throws Exception {
            mvc.perform(get("/api/camel-catalog/index.json"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.definitions[0].fileName").value("camel-springboot/4.22.1/index-abc.json"));
            mvc.perform(get(DIR + "models-1.json"))
                    .andExpect(content().json("{\"kafka\":{\"model\":\"kept as is\"}}"));
        }

        @Test
        void onlyCatalogFilesAreServed() throws Exception {
            mvc.perform(get(DIR + "missing.json")).andExpect(status().isNotFound());
            mvc.perform(get("/api/camel-catalog/../application.yaml")).andExpect(status().is4xxClientError());
        }
    }

    @Nested
    @SpringBootTest(properties = {
        "echo.catalog.locations=classpath:/test-camel-catalog/",
        "echo.catalog.hidden-processors=",
        "echo.validation.allowed-components=kafka,kamelet"
    })
    @AutoConfigureMockMvc
    class FromConfig {
        @Autowired
        private MockMvc mvc;

        @Test
        void followsTheInstallsAllowedComponents() throws Exception {
            mvc.perform(get(DIR + "components-1.json"))
                    .andExpect(jsonPath("$.kafka").exists())
                    .andExpect(jsonPath("$.http").doesNotExist());
            mvc.perform(get(DIR + "patterns-1.json"))
                    .andExpect(jsonPath("$.marshal").exists())
                    .andExpect(jsonPath("$.kamelet").exists());
            mvc.perform(get(DIR + "kamelets-1.json")).andExpect(jsonPath("$['aws-s3-source']").exists());
        }
    }
    @Nested
    @SpringBootTest(properties = {
        "echo.catalog.locations=classpath:/test-camel-catalog/",
        "echo.apis.only=true",
        "echo.apis.specs[0].id=inventory",
        "echo.apis.specs[0].file=src/test/resources/apis/inventory.yaml",
        "echo.apis.specs[0].allowed-tags=TMF638 Service Controller"
    })
    @AutoConfigureMockMvc
    class ApprovedApisOnly {
        @Autowired
        private MockMvc mvc;

        @Test
        void plainHttpIsHiddenAndRestOpenApiOffersTheApprovedOperations() throws Exception {
            mvc.perform(get(DIR + "components-1.json"))
                    .andExpect(jsonPath("$.http").doesNotExist())
                    .andExpect(jsonPath("$['rest-openapi'].properties.specificationUri.enum[0]")
                            .value("inventory.openapi.json"))
                    .andExpect(jsonPath("$['rest-openapi'].properties.specificationUri.defaultValue").doesNotExist())
                    .andExpect(jsonPath("$['rest-openapi'].properties.operationId.enum")
                            .value(org.hamcrest.Matchers.contains("createService", "getService")))
                    .andExpect(jsonPath("$['rest-openapi'].propertiesSchema.properties.specificationUri.enum[0]")
                            .value("inventory.openapi.json"))
                    .andExpect(jsonPath("$['rest-openapi'].propertiesSchema.properties.specificationUri.default")
                            .doesNotExist())
                    .andExpect(jsonPath("$['rest-openapi'].propertiesSchema.properties.operationId.enum")
                            .value(org.hamcrest.Matchers.contains("createService", "getService")));
        }
    }
}
