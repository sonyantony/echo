package com.ey.echo.builder.run;

import com.ey.echo.builder.run.FlowRun.Endpoint;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.StringReader;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.camel.Exchange;
import org.apache.camel.ExchangePropertyKey;
import org.apache.camel.component.platform.http.PlatformHttpEndpoint;
import org.apache.camel.component.platform.http.vertx.VertxPlatformHttpServer;
import org.apache.camel.component.platform.http.vertx.VertxPlatformHttpServerConfiguration;
import org.apache.camel.impl.DefaultCamelContext;
import org.apache.camel.spi.CamelEvent;
import org.apache.camel.spi.CamelEvent.ExchangeCompletedEvent;
import org.apache.camel.spi.CamelEvent.ExchangeCreatedEvent;
import org.apache.camel.spi.CamelEvent.ExchangeEvent;
import org.apache.camel.spi.CamelEvent.ExchangeFailedEvent;
import org.apache.camel.spi.CamelLogger;
import org.apache.camel.spi.LogListener;
import org.apache.camel.support.EventNotifierSupport;
import org.apache.camel.support.PluginHelper;
import org.apache.camel.support.ResourceHelper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Runs flow drafts inside the Builder so users can call them before publishing (the editor's Run
 * button). Each run gets its own Camel context with its own HTTP server on a port from
 * {@code echo.run.first-port}..{@code last-port}. It uses the Builder's Camel version and the
 * Version 1 components, like the flow image, but not the image's Spring Boot packaging: building
 * the image stays the final check.
 *
 * <p>The flow's files are written to a temporary folder that is first on the run's classpath, so
 * {@code xslt-saxon:kaoto-datamapper-*.xsl} finds the DataMapper files as it does in the image.
 * {@code application.properties} supplies the {@code {{placeholders}}}.
 */
@Service
public class FlowRunner {

    private static final Logger LOG = LoggerFactory.getLogger(FlowRunner.class);

    private final RunProperties properties;
    private final Clock clock;
    private final Map<Long, FlowRun> runs = new ConcurrentHashMap<>();

    public FlowRunner(RunProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    public boolean enabled() {
        return properties.enabled();
    }

    public RunProperties properties() {
        return properties;
    }

    /** Starts the flow, replacing an earlier run of the same flow (which frees its port first). */
    public synchronized FlowRun start(long flowId, String flowName, String routeFile, Map<String, String> files,
            String user) {
        if (!properties.enabled()) {
            throw new RunException("Test runs are turned off for this Builder.");
        }
        stop(flowId);
        int port = freePort();
        var run = new FlowRun(flowId, flowName, port, user, clock);
        try {
            run.dir = Files.createTempDirectory("echo-run-" + flowName + "-");
            for (var file : files.entrySet()) {
                Path target = run.dir.resolve(file.getKey()).normalize();
                if (!target.startsWith(run.dir)) {
                    throw new RunException("File path '%s' is not allowed.".formatted(file.getKey()));
                }
                Files.createDirectories(target.getParent());
                Files.writeString(target, file.getValue(), StandardCharsets.UTF_8);
            }
            run.classLoader = new URLClassLoader(new URL[] {run.dir.toUri().toURL()}, FlowRunner.class.getClassLoader());
            run.camel = camelFor(run, files.get("application.properties"));
            PluginHelper.getRoutesLoader(run.camel)
                    .loadRoutes(ResourceHelper.fromString(routeFile, files.getOrDefault(routeFile, "")));
            run.camel.start();
            run.endpoints = endpoints(run);
        } catch (Exception e) {
            run.close();
            throw e instanceof RunException r ? r : new RunException("The flow could not start: " + rootMessage(e), e);
        }
        run.log("INFO", "Started %s on port %d.".formatted(flowName, port));
        runs.put(flowId, run);
        LOG.info("Test run of flow {} started by {} on port {}", flowName, user, port);
        return run;
    }

    public synchronized void stop(long flowId) {
        var run = runs.remove(flowId);
        if (run != null) {
            run.close();
            LOG.info("Test run of flow {} stopped", run.flowName);
        }
    }

    public Optional<FlowRun> get(long flowId) {
        return Optional.ofNullable(runs.get(flowId));
    }

    Collection<FlowRun> runs() {
        return runs.values();
    }

    /** Stops runs nobody has called for {@code echo.run.idle-minutes}. */
    @Scheduled(fixedDelayString = "PT1M", initialDelayString = "PT1M")
    public void stopIdle() {
        var cutoff = clock.instant().minus(Duration.ofMinutes(properties.idleMinutes()));
        for (var run : List.copyOf(runs.values())) {
            if (run.lastActivity().isBefore(cutoff)) {
                LOG.info("Test run of flow {} idle for {} minutes", run.flowName, properties.idleMinutes());
                stop(run.flowId);
            }
        }
    }

    @PreDestroy
    public synchronized void stopAll() {
        for (var id : List.copyOf(runs.keySet())) {
            stop(id);
        }
    }

    private DefaultCamelContext camelFor(FlowRun run, String applicationProperties) throws Exception {
        var camel = new DefaultCamelContext();
        camel.getCamelContextExtension().setName("echo-run-" + run.flowName);
        camel.setApplicationContextClassLoader(run.classLoader);

        var props = new Properties();
        if (applicationProperties != null) {
            props.load(new StringReader(applicationProperties));
        }
        camel.getPropertiesComponent().setInitialProperties(props);

        var http = new VertxPlatformHttpServerConfiguration();
        http.setBindPort(run.port);
        camel.addService(new VertxPlatformHttpServer(http));

        // What the flow logs (log steps and the log component) and each request, for the run panel.
        camel.getCamelContextExtension().addLogListener(new LogListener() {
            @Override
            public String onLog(Exchange exchange, CamelLogger logger, String message) {
                run.log(logger.getLevel().name(), message);
                return message;
            }
        });
        Set<String> requests = ConcurrentHashMap.newKeySet();
        camel.getManagementStrategy().addEventNotifier(new EventNotifierSupport() {
            @Override
            public boolean isEnabled(CamelEvent event) {
                return event instanceof ExchangeEvent;
            }

            @Override
            public void notify(CamelEvent event) {
                run.touch();
                Exchange exchange = ((ExchangeEvent) event).getExchange();
                // Only the incoming request, not the copies multicast and split make. Copies carry a
                // correlation id when created; the original can pick one up from the last copy later.
                if (event instanceof ExchangeCreatedEvent) {
                    if (!(exchange.getFromEndpoint() instanceof PlatformHttpEndpoint)
                            || exchange.getProperty(ExchangePropertyKey.CORRELATION_ID) != null) {
                        return;
                    }
                    requests.add(exchange.getExchangeId());
                } else if (!(event instanceof ExchangeCompletedEvent || event instanceof ExchangeFailedEvent)
                        || !requests.remove(exchange.getExchangeId())) {
                    return;
                }
                switch (event) {
                    case ExchangeCreatedEvent e -> run.log("INFO", "Request: %s %s".formatted(
                            exchange.getIn().getHeader(Exchange.HTTP_METHOD, "", String.class),
                            exchange.getIn().getHeader(Exchange.HTTP_URI, "", String.class)));
                    case ExchangeFailedEvent e -> {
                        String message = exchange.getException() != null ? rootMessage(exchange.getException())
                                : "unknown error";
                        run.log("ERROR", "Failed: " + message);
                        if (message.contains("bridgeEndpoint")) {
                            run.log("INFO", "Tip: add a Remove Headers step (pattern *) before calling other "
                                    + "services, or turn on Bridge Endpoint in each http step, so the incoming "
                                    + "request's path does not change the URL called.");
                        }
                    }
                    case ExchangeCompletedEvent e -> run.log("INFO", "Done in %d ms."
                            .formatted(exchange.getClock().elapsed()));
                    default -> {
                        // other exchange events are not shown
                    }
                }
            }
        });
        return camel;
    }

    private static List<Endpoint> endpoints(FlowRun run) {
        var list = new ArrayList<Endpoint>();
        for (var route : run.camel.getRoutes()) {
            if (route.getEndpoint() instanceof PlatformHttpEndpoint http) {
                String restrict = http.getHttpMethodRestrict();
                List<String> methods = restrict == null || restrict.isBlank() ? List.of()
                        : Arrays.stream(restrict.split(",")).map(String::strip).map(String::toUpperCase).toList();
                String path = http.getPath().startsWith("/") ? http.getPath() : "/" + http.getPath();
                list.add(new Endpoint(path, methods));
            }
        }
        return list;
    }

    private int freePort() {
        var used = runs.values().stream().map(r -> r.port).toList();
        for (int port = properties.firstPort(); port <= properties.lastPort(); port++) {
            if (!used.contains(port) && canBind(port)) {
                return port;
            }
        }
        throw new RunException("All test ports (%d-%d) are in use. Stop another run and try again."
                .formatted(properties.firstPort(), properties.lastPort()));
    }

    private static boolean canBind(int port) {
        try (var socket = new ServerSocket()) {
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(port));
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    static String rootMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String message = root.getMessage() != null ? root.getMessage() : root.getClass().getSimpleName();
        int nl = message.indexOf('\n');
        return (nl < 0 ? message : message.substring(0, nl)).strip();
    }
}
