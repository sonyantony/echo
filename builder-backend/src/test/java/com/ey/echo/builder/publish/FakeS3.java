package com.ey.echo.builder.publish;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentSkipListMap;

/**
 * An in-memory S3-compatible server (path-style, one bucket) standing in for the buyer's store.
 * Checks that requests are SigV4-signed with the expected key and payload hash, and lists two
 * keys per page so continuation tokens get used.
 */
final class FakeS3 implements AutoCloseable {

    static final String BUCKET = "flows-bucket";
    static final String ACCESS_KEY = "test-access-key";
    static final String SECRET_KEY = "test-secret-key";

    final ConcurrentSkipListMap<String, String> objects = new ConcurrentSkipListMap<>();
    final List<String> requests = new ArrayList<>();
    volatile boolean failing;

    private final HttpServer server;

    FakeS3() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
    }

    String endpoint() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    S3Properties properties(String prefix) {
        return new S3Properties(true, BUCKET, prefix, "eu-west-1", endpoint(), ACCESS_KEY, SECRET_KEY, null);
    }

    @Override
    public void close() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath(); // decoded
            byte[] body = exchange.getRequestBody().readAllBytes();
            synchronized (requests) {
                requests.add(method + " " + exchange.getRequestURI().getRawPath());
            }
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            if (auth == null || !auth.startsWith("AWS4-HMAC-SHA256 Credential=" + ACCESS_KEY + "/")
                    || !auth.contains("/eu-west-1/s3/aws4_request")
                    || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body))
                            .equals(exchange.getRequestHeaders().getFirst("x-amz-content-sha256"))) {
                send(exchange, 403, error("SignatureDoesNotMatch", "bad signature"));
                return;
            }
            if (failing) {
                send(exchange, 503, error("ServiceUnavailable", "Please reduce your request rate."));
                return;
            }
            String bucketPrefix = "/" + BUCKET;
            if (!path.startsWith(bucketPrefix)) {
                send(exchange, 404, error("NoSuchBucket", "The specified bucket does not exist"));
                return;
            }
            String key = path.length() <= bucketPrefix.length() + 1 ? "" : path.substring(bucketPrefix.length() + 1);
            switch (method) {
                case "PUT" -> {
                    objects.put(key, new String(body, StandardCharsets.UTF_8));
                    send(exchange, 200, "");
                }
                case "DELETE" -> {
                    objects.remove(key);
                    send(exchange, 204, null);
                }
                case "GET" -> {
                    if (key.isEmpty()) {
                        send(exchange, 200, list(query(exchange.getRequestURI().getRawQuery())));
                    } else if (objects.containsKey(key)) {
                        send(exchange, 200, objects.get(key));
                    } else {
                        send(exchange, 404, error("NoSuchKey", "The specified key does not exist."));
                    }
                }
                default -> send(exchange, 405, error("MethodNotAllowed", method));
            }
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private String list(Map<String, String> query) {
        String prefix = query.getOrDefault("prefix", "");
        String after = query.get("continuation-token");
        var keys = objects.keySet().stream().filter(k -> k.startsWith(prefix))
                .filter(k -> after == null || k.compareTo(after) > 0).toList();
        var page = keys.subList(0, Math.min(2, keys.size()));
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">");
        xml.append("<Name>").append(BUCKET).append("</Name>");
        for (String k : page) {
            xml.append("<Contents><Key>").append(k).append("</Key></Contents>");
        }
        boolean truncated = keys.size() > page.size();
        xml.append("<IsTruncated>").append(truncated).append("</IsTruncated>");
        if (truncated) {
            xml.append("<NextContinuationToken>").append(page.get(page.size() - 1)).append("</NextContinuationToken>");
        }
        return xml.append("</ListBucketResult>").toString();
    }

    private static Map<String, String> query(String raw) {
        var result = new LinkedHashMap<String, String>();
        if (raw != null) {
            for (String pair : raw.split("&")) {
                int eq = pair.indexOf('=');
                result.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                        URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
            }
        }
        return result;
    }

    private static String error(String code, String message) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Error><Code>%s</Code><Message>%s</Message></Error>"
                .formatted(code, message);
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        if (body == null) {
            exchange.sendResponseHeaders(status, -1);
            return;
        }
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            exchange.getResponseBody().write(bytes);
        }
    }
}
