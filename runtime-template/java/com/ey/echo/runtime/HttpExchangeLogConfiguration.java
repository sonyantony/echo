package com.ey.echo.runtime;

import java.util.LinkedHashMap;
import org.apache.camel.CamelContext;
import org.apache.camel.spi.ComponentCustomizer;
import org.apache.camel.spring.boot.CamelContextConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;

/**
 * Turns on EY ECHO's HTTP log in a flow image (Spring Boot): the log is added to Camel before it
 * starts, and put on each http component Camel makes. Settings are the image's echo.http-log.*
 * properties (application.properties, environment variables, ConfigMap). build-flow.sh lists this
 * class as an auto-configuration; the Builder does not compile it (its Run attaches the log itself).
 */
@Configuration(proxyBeanMethods = false)
public class HttpExchangeLogConfiguration {

    @Bean
    public HttpExchangeLog echoHttpExchangeLog(ConfigurableEnvironment env) {
        var log = new HttpExchangeLog(HttpExchangeLog.Settings.from(env::getProperty),
                env.getProperty("camel.main.name", env.getProperty("spring.application.name", "")));
        var values = new LinkedHashMap<String, String>();
        for (var source : env.getPropertySources()) {
            if (source instanceof EnumerablePropertySource<?> enumerable) {
                for (String name : enumerable.getPropertyNames()) {
                    try {
                        values.putIfAbsent(name, env.getProperty(name));
                    } catch (RuntimeException e) {
                        // a value that cannot be resolved is no secret to mask
                    }
                }
            }
        }
        log.secretValues(values);
        return log;
    }

    @Bean
    public ComponentCustomizer echoHttpExchangeLogCustomizer(HttpExchangeLog log) {
        return log.httpCustomizer();
    }

    @Bean
    public CamelContextConfiguration echoHttpExchangeLogEvents(HttpExchangeLog log) {
        return new CamelContextConfiguration() {
            @Override
            public void beforeApplicationStart(CamelContext camel) {
                if (log.settings().enabled() && !camel.getManagementStrategy().getEventNotifiers().contains(log)) {
                    camel.getManagementStrategy().addEventNotifier(log);
                }
            }

            @Override
            public void afterApplicationStart(CamelContext camel) {
                // nothing to do
            }
        };
    }
}
