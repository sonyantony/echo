package com.ey.echo.builder.run;

import java.io.IOException;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import org.apache.camel.CamelContext;

/** One draft running inside the Builder: its Camel context, port and recent log lines. */
final class FlowRun {

    static final int MAX_LOG_LINES = 500;

    /** A line for the editor's run panel; seq lets the UI ask only for newer lines. */
    record LogLine(long seq, Instant at, String level, String message) {}

    /** A platform-http endpoint of the flow; methods is empty when any method is accepted. */
    record Endpoint(String path, List<String> methods) {}

    final long flowId;
    final String flowName;
    final int port;
    final String startedBy;
    final Instant startedAt;
    private final Clock clock;
    private final ArrayDeque<LogLine> log = new ArrayDeque<>();
    private long nextSeq = 1;
    private volatile Instant lastActivity;

    CamelContext camel;
    Path dir;
    URLClassLoader classLoader;
    List<Endpoint> endpoints = List.of();

    FlowRun(long flowId, String flowName, int port, String startedBy, Clock clock) {
        this.flowId = flowId;
        this.flowName = flowName;
        this.port = port;
        this.startedBy = startedBy;
        this.clock = clock;
        this.startedAt = clock.instant();
        this.lastActivity = startedAt;
    }

    void log(String level, String message) {
        synchronized (log) {
            log.addLast(new LogLine(nextSeq++, clock.instant(), level, message));
            while (log.size() > MAX_LOG_LINES) {
                log.removeFirst();
            }
        }
    }

    List<LogLine> logAfter(long seq) {
        synchronized (log) {
            return log.stream().filter(l -> l.seq() > seq).toList();
        }
    }

    void touch() {
        lastActivity = clock.instant();
    }

    Instant lastActivity() {
        return lastActivity;
    }

    /** Stops Camel (and its HTTP server) and removes the flow's temporary folder. */
    void close() {
        if (camel != null) {
            try {
                camel.close();
            } catch (Exception e) {
                // stopping a test run is best-effort
            }
        }
        if (classLoader != null) {
            try {
                classLoader.close();
            } catch (IOException e) {
                // ignore
            }
        }
        if (dir != null) {
            try (Stream<Path> paths = Files.walk(dir)) {
                paths.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            } catch (IOException e) {
                // ignore
            }
        }
    }
}
