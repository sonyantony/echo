package com.ey.echo.builder.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class SpaForwardControllerTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void clientRoutesServeTheUi() throws Exception {
        mvc.perform(get("/login")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/flows/12")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void apiPathsAreNotForwarded() throws Exception {
        mvc.perform(get("/api/unknown")).andExpect(status().isUnauthorized());
    }
}
