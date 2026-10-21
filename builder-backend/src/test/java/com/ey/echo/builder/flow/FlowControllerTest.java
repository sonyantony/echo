package com.ey.echo.builder.flow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
class FlowControllerTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FlowRepository flows;

    @BeforeEach
    void clean() {
        flows.deleteAll();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request) {
        return request.with(user("designer").roles("DESIGNER")).with(csrf());
    }

    private long create(String name) throws Exception {
        var body = mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"description\":\"Test flow\"}".formatted(name)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(body, "$.id")).longValue();
    }

    @Test
    void createsAFlowWithAnHttpRouteTemplate() throws Exception {
        mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"orders\",\"description\":\"Order intake\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", containsString("/api/flows/")))
                .andExpect(jsonPath("$.name").value("orders"))
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.routeFile").value("orders.camel.yaml"))
                .andExpect(jsonPath("$.files[0]").value("application.properties"))
                .andExpect(jsonPath("$.files[1]").value("orders.camel.yaml"))
                .andExpect(jsonPath("$.createdBy").value("designer"));
    }

    @Test
    void newRouteStartsWithPlatformHttp() throws Exception {
        long id = create("orders");
        mvc.perform(as(get("/api/flows/{id}/files/orders.camel.yaml", id)))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("uri: platform-http:/orders")));
    }

    @Test
    void listsFlowsByName() throws Exception {
        create("zeta");
        create("alpha");
        mvc.perform(as(get("/api/flows")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].name").value("alpha"))
                .andExpect(jsonPath("$[1].name").value("zeta"));
    }

    @Test
    void rejectsInvalidAndDuplicateNames() throws Exception {
        create("orders");
        mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"orders\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("A flow named 'orders' already exists."));
        mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"My Orders\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", containsString("not allowed")));
        mvc.perform(as(post("/api/flows")).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void renamingAFlowRenamesItsRouteFile() throws Exception {
        long id = create("orders");
        mvc.perform(as(put("/api/flows/{id}", id)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"order-intake\",\"description\":\"New\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("order-intake"))
                .andExpect(jsonPath("$.description").value("New"))
                .andExpect(jsonPath("$.routeFile").value("order-intake.camel.yaml"))
                .andExpect(jsonPath("$.files[1]").value("order-intake.camel.yaml"));
    }

    @Test
    void renameToAnExistingNameIsRejected() throws Exception {
        create("alpha");
        long id = create("beta");
        mvc.perform(as(put("/api/flows/{id}", id)).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"alpha\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void deletesAFlow() throws Exception {
        long id = create("orders");
        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNoContent());
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(status().isNotFound());
        mvc.perform(as(delete("/api/flows/{id}", id))).andExpect(status().isNotFound());
    }

    @Test
    void writesReadsAndDeletesSideFiles() throws Exception {
        long id = create("orders");
        mvc.perform(as(put("/api/flows/{id}/files/kaoto-datamapper-1.xsl", id))
                        .contentType(MediaType.TEXT_PLAIN).content("<xsl:stylesheet/>"))
                .andExpect(status().isNoContent());
        mvc.perform(as(put("/api/flows/{id}/files/schemas/order.schema.json", id))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"object\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(as(get("/api/flows/{id}/files/kaoto-datamapper-1.xsl", id)))
                .andExpect(content().string("<xsl:stylesheet/>"));
        mvc.perform(as(get("/api/flows/{id}/files/schemas/order.schema.json", id)))
                .andExpect(content().string("{\"type\":\"object\"}"));
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.files", hasSize(4)));

        mvc.perform(as(delete("/api/flows/{id}/files/kaoto-datamapper-1.xsl", id))).andExpect(status().isNoContent());
        mvc.perform(as(get("/api/flows/{id}/files/kaoto-datamapper-1.xsl", id))).andExpect(status().isNotFound());
    }

    @Test
    void keepsTheApiSpecUnderItsOwnNameOnePerFlow() throws Exception {
        long id = create("orders");
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.apiSpec").doesNotExist());

        String yaml = "openapi: 3.0.3\ninfo:\n  title: Customers\n  version: 1.0.0\npaths: {}\n";
        mvc.perform(as(put("/api/flows/{id}/api-spec/customer-api.yaml", id)).contentType(MediaType.TEXT_PLAIN).content(yaml))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.apiSpec").value("customer-api.yaml"));
        mvc.perform(as(get("/api/flows/{id}/files/customer-api.yaml", id))).andExpect(content().string(yaml));

        // Saved under another name (Save As, or JSON instead of YAML): the old file goes.
        String json = "{\"openapi\":\"3.0.3\",\"info\":{\"title\":\"Customers\",\"version\":\"1.0.0\"},\"paths\":{}}";
        mvc.perform(as(put("/api/flows/{id}/api-spec/customers.json", id)).contentType(MediaType.TEXT_PLAIN).content(json))
                .andExpect(jsonPath("$.apiSpec").value("customers.json"));
        mvc.perform(as(get("/api/flows/{id}/files/customer-api.yaml", id))).andExpect(status().isNotFound());
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.files", hasSize(3)));
    }

    @Test
    void listsEveryFlowsApiSpecAndCopiesOneIntoAnotherFlow() throws Exception {
        long orders = create("orders");
        long customers = create("customers");
        long empty = create("empty");
        String yaml = "openapi: 3.0.3\ninfo:\n  title: Customers\n  version: 1.0.0\npaths: {}\n";
        mvc.perform(as(put("/api/flows/{id}/api-spec/customer-api.yaml", customers)).contentType(MediaType.TEXT_PLAIN).content(yaml));
        mvc.perform(as(put("/api/flows/{id}/api-spec/orders.json", orders)).contentType(MediaType.TEXT_PLAIN)
                .content("{\"openapi\":\"3.0.3\",\"info\":{\"title\":\"Orders\",\"version\":\"1\"},\"paths\":{}}"));

        mvc.perform(as(get("/api/flows/api-specs")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].flowName").value("customers"))
                .andExpect(jsonPath("$[0].flowId").value(customers))
                .andExpect(jsonPath("$[0].fileName").value("customer-api.yaml"))
                .andExpect(jsonPath("$[1].flowName").value("orders"));

        // The copy belongs to the flow it is copied into, and replaces the spec it had.
        mvc.perform(as(post("/api/flows/{id}/api-spec/copy-from/{source}", orders, customers)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.apiSpec").value("customer-api.yaml"));
        mvc.perform(as(get("/api/flows/{id}/files/customer-api.yaml", orders))).andExpect(content().string(yaml));
        mvc.perform(as(get("/api/flows/{id}/files/orders.json", orders))).andExpect(status().isNotFound());
        mvc.perform(as(put("/api/flows/{id}/files/customer-api.yaml", orders)).contentType(MediaType.TEXT_PLAIN)
                .content(yaml.replace("Customers", "My customers")));
        mvc.perform(as(get("/api/flows/{id}/files/customer-api.yaml", customers))).andExpect(content().string(yaml));

        mvc.perform(as(post("/api/flows/{id}/api-spec/copy-from/{source}", customers, empty)))
                .andExpect(status().isNotFound());
    }

    @Test
    void findsTheApiSpecOfOlderFlowsAndIgnoresOtherJsonFiles() throws Exception {
        long id = create("orders");
        mvc.perform(as(put("/api/flows/{id}/files/order.schema.json", id)).contentType(MediaType.TEXT_PLAIN)
                .content("{\"openapi\":\"not really\"}")).andExpect(status().isNoContent());
        mvc.perform(as(put("/api/flows/{id}/files/sample.json", id)).contentType(MediaType.TEXT_PLAIN)
                .content("{\"orderId\":\"A1\"}")).andExpect(status().isNoContent());
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.apiSpec").doesNotExist());
        mvc.perform(as(put("/api/flows/{id}/files/openapi.json", id)).contentType(MediaType.TEXT_PLAIN)
                .content("{\"openapi\":\"3.0.3\"}")).andExpect(status().isNoContent());
        mvc.perform(as(get("/api/flows/{id}", id))).andExpect(jsonPath("$.apiSpec").value("openapi.json"));
    }

    @Test
    void rejectsApiSpecNamesAndContentThatCannotBeUsed() throws Exception {
        long id = create("orders");
        String spec = "openapi: 3.0.3\n";
        for (String name : new String[] {"spec.txt", "orders.camel.yaml", "order.schema.json", "../x.yaml"}) {
            mvc.perform(as(put("/api/flows/{id}/api-spec/" + name, id)).contentType(MediaType.TEXT_PLAIN).content(spec))
                    .andExpect(status().is4xxClientError());
        }
        mvc.perform(as(put("/api/flows/{id}/files/sample.json", id)).contentType(MediaType.TEXT_PLAIN).content("{}"))
                .andExpect(status().isNoContent());
        mvc.perform(as(put("/api/flows/{id}/api-spec/sample.json", id)).contentType(MediaType.TEXT_PLAIN).content(spec))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", containsString("already has a file")));
        mvc.perform(as(put("/api/flows/{id}/api-spec/x.yaml", id)).contentType(MediaType.TEXT_PLAIN).content("title: x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", containsString("not an OpenAPI spec")));
    }

    @Test
    void rejectsUnsafeFilePathsAndKeepsTheRouteFile() throws Exception {
        long id = create("orders");
        mvc.perform(as(put("/api/flows/{id}/files/a..b/../x", id)).contentType(MediaType.TEXT_PLAIN).content("x"))
                .andExpect(status().isBadRequest());
        mvc.perform(as(delete("/api/flows/{id}/files/orders.camel.yaml", id))).andExpect(status().isBadRequest());
    }

    @Test
    void validatesAFlow() throws Exception {
        long id = create("orders");
        mvc.perform(as(post("/api/flows/{id}/validate", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.problems", hasSize(0)));

        mvc.perform(as(put("/api/flows/{id}/files/orders.camel.yaml", id)).contentType(MediaType.TEXT_PLAIN)
                        .content("- route:\n    from:\n      uri: kafka:in\n      steps: []\n"))
                .andExpect(status().isNoContent());
        mvc.perform(as(post("/api/flows/{id}/validate", id)))
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.problems[0].file").value("orders.camel.yaml"))
                .andExpect(jsonPath("$.problems[0].line").value(3))
                .andExpect(jsonPath("$.problems[0].message", containsString("'kafka' component")));
    }

    @Test
    void downloadsAFlowAsAZipAndUploadsItAgain() throws Exception {
        long id = create("orders");
        mvc.perform(as(put("/api/flows/{id}/files/schemas/order.schema.json", id))
                        .contentType(MediaType.TEXT_PLAIN).content("{\"type\":\"object\"}"))
                .andExpect(status().isNoContent());

        var zip = mvc.perform(as(get("/api/flows/{id}/download", id)))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/zip"))
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"orders.zip\""))
                .andReturn().getResponse().getContentAsByteArray();
        var contents = FlowArchive.read(new ByteArrayInputStream(zip));
        assertThat(contents.name()).isEqualTo("orders");
        assertThat(contents.files()).containsOnlyKeys(
                "application.properties", "orders.camel.yaml", "schemas/order.schema.json");

        // Same name as an existing flow: refused, so nothing is overwritten.
        mvc.perform(as(multipart("/api/flows/upload").file(zipFile(zip))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("A flow named 'orders' already exists."));

        mvc.perform(as(multipart("/api/flows/upload").file(zipFile(zip))
                        .param("name", "orders-copy").param("description", "Copy of orders")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("orders-copy"))
                .andExpect(jsonPath("$.description").value("Copy of orders"))
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.routeFile").value("orders-copy.camel.yaml"))
                .andExpect(jsonPath("$.files", hasSize(3)))
                .andExpect(jsonPath("$.files[1]").value("orders-copy.camel.yaml"));
    }

    @Test
    void aDownloadCarriesTheRestServiceMadeFromTheSpecAndAnUploadLeavesItOut() throws Exception {
        long id = create("customers");
        String spec = "openapi: 3.0.3\ninfo: {title: Customers, version: 1.0.0}\nservers: [{url: /api}]\n"
                + "paths:\n  /customers:\n    get: {operationId: listCustomers, responses: {'200': {description: ok}}}\n";
        mvc.perform(as(put("/api/flows/{id}/api-spec/customer-api.yaml", id)).contentType(MediaType.TEXT_PLAIN).content(spec))
                .andExpect(status().isOk());
        String draft = mvc.perform(as(get("/api/flows/{id}/files/customers.camel.yaml", id)))
                .andReturn().getResponse().getContentAsString();
        assertThat(draft).doesNotContain("openApi");

        var zip = mvc.perform(as(get("/api/flows/{id}/download", id))).andReturn().getResponse().getContentAsByteArray();
        String published = FlowArchive.read(new ByteArrayInputStream(zip)).files().get("customers.camel.yaml");
        assertThat(published).contains("specification: 'customer-api.yaml'", "missingOperation: ignore",
                "id: 'echo-missing-listCustomers'");

        var body = mvc.perform(as(multipart("/api/flows/upload").file(zipFile(zip)).param("name", "customers-copy")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        long copy = ((Number) JsonPath.read(body, "$.id")).longValue();
        mvc.perform(as(get("/api/flows/{id}/files/customers-copy.camel.yaml", copy)))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("openApi"))))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("echo-missing"))));
    }

    @Test
    void uploadsTheSampleOrdersFlow() throws Exception {
        var out = new ByteArrayOutputStream();
        FlowArchive.write("orders", FlowArchiveTest.sampleOrders(), out);
        var body = mvc.perform(as(multipart("/api/flows/upload").file(zipFile(out.toByteArray()))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("orders"))
                .andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.id")).longValue();
        mvc.perform(as(post("/api/flows/{id}/validate", id))).andExpect(jsonPath("$.valid").value(true));
    }

    @Test
    void rejectsAnUploadThatIsNotAFlow() throws Exception {
        mvc.perform(as(multipart("/api/flows/upload").file(zipFile("not a zip".getBytes()))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", containsString("cannot be uploaded as a flow")));
    }

    private static MockMultipartFile zipFile(byte[] content) {
        return new MockMultipartFile("file", "orders.zip", "application/zip", content);
    }

    @Test
    void requiresLogin() throws Exception {
        mvc.perform(get("/api/flows")).andExpect(status().isUnauthorized());
    }
}
