package com.ey.echo.builder.publish;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.stream.Collectors;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;

/**
 * The few S3 REST calls the Builder needs (put, get, delete, list), signed with AWS Signature
 * Version 4 on the JDK's HTTP client. Kept to plain HTTP so the Builder needs no cloud SDK and
 * works with any S3-compatible store.
 */
class S3Client {

    private static final DateTimeFormatter AMZ_DATE =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private static final HexFormat HEX = HexFormat.of();

    private final S3Properties props;
    private final HttpClient http;
    private final Clock clock;

    S3Client(S3Properties props, Clock clock) {
        this.props = props;
        this.clock = clock;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
                .proxy(java.net.ProxySelector.getDefault()) // honour https.proxyHost etc., like JGit
                .build();
    }

    void put(String key, String content) {
        send("PUT", key, Map.of(), content.getBytes(StandardCharsets.UTF_8));
    }

    /** The object's content, or empty if there is no such key. */
    Optional<String> get(String key) {
        var response = send("GET", key, Map.of(), null);
        return response == null ? Optional.empty() : Optional.of(new String(response, StandardCharsets.UTF_8));
    }

    void delete(String key) {
        send("DELETE", key, Map.of(), null);
    }

    /** All keys starting with prefix, following continuation tokens. */
    List<String> list(String prefix) {
        var keys = new ArrayList<String>();
        String token = null;
        do {
            var query = new TreeMap<String, String>();
            query.put("list-type", "2");
            query.put("prefix", prefix);
            if (token != null) {
                query.put("continuation-token", token);
            }
            var xml = send("GET", "", query, null);
            var doc = parse(xml);
            var contents = doc.getElementsByTagName("Contents");
            for (int i = 0; i < contents.getLength(); i++) {
                keys.add(child((Element) contents.item(i), "Key"));
            }
            token = "true".equals(child(doc.getDocumentElement(), "IsTruncated"))
                    ? child(doc.getDocumentElement(), "NextContinuationToken")
                    : null;
        } while (token != null);
        return keys;
    }

    /** Returns the body; null for a 404 on GET. */
    private byte[] send(String method, String key, Map<String, String> query, byte[] body) {
        URI uri = uri(key, query);
        byte[] payload = body == null ? new byte[0] : body;
        String payloadHash = HEX.formatHex(sha256(payload));
        var headers = new TreeMap<String, String>();
        headers.put("host", hostHeader(uri));
        headers.put("x-amz-content-sha256", payloadHash);
        headers.put("x-amz-date", AMZ_DATE.format(clock.instant()));
        if (props.sessionToken() != null) {
            headers.put("x-amz-security-token", props.sessionToken());
        }
        String authorization = authorization(method, uri, headers, payloadHash);

        var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30))
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofByteArray(body))
                .header("Authorization", authorization);
        headers.forEach((name, value) -> {
            if (!name.equals("host")) { // the HTTP client sets Host itself, to the same value
                request.header(name, value);
            }
        });
        if (body != null) {
            request.header("Content-Type", "text/plain; charset=utf-8");
        }
        HttpResponse<byte[]> response;
        try {
            response = http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            throw new PublishException("S3 error: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PublishException("S3 error: interrupted", e);
        }
        int status = response.statusCode();
        if (status == 404 && method.equals("GET") && !key.isEmpty()) {
            return null;
        }
        if (status / 100 != 2) {
            throw new PublishException("S3 error: %s %s returned %d%s"
                    .formatted(method, key.isEmpty() ? "bucket listing" : key, status, errorDetail(response.body())));
        }
        return response.body();
    }

    private URI uri(String key, Map<String, String> query) {
        String path = key.isEmpty() ? "/" : "/" + encodePath(key);
        String base = props.endpoint() != null
                ? props.endpoint() + "/" + encode(props.bucket()) // path-style for S3-compatible stores
                : "https://%s.s3.%s.amazonaws.com".formatted(props.bucket(), props.region());
        String q = canonicalQuery(query);
        return URI.create(base + (key.isEmpty() && props.endpoint() != null ? "" : path) + (q.isEmpty() ? "" : "?" + q));
    }

    /** The Authorization header for SigV4 (header-based, signed payload). */
    String authorization(String method, URI uri, TreeMap<String, String> headers, String payloadHash) {
        String amzDate = headers.get("x-amz-date");
        String date = amzDate.substring(0, 8);
        String scope = "%s/%s/s3/aws4_request".formatted(date, props.region());
        String signedHeaders = String.join(";", headers.keySet());
        String canonicalHeaders = headers.entrySet().stream()
                .map(e -> e.getKey() + ":" + e.getValue().strip() + "\n").collect(Collectors.joining());
        String rawPath = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        String rawQuery = uri.getRawQuery() == null ? "" : uri.getRawQuery();
        String canonicalRequest = String.join("\n", method, rawPath, rawQuery, canonicalHeaders, signedHeaders,
                payloadHash);
        String stringToSign = String.join("\n", "AWS4-HMAC-SHA256", amzDate, scope,
                HEX.formatHex(sha256(canonicalRequest.getBytes(StandardCharsets.UTF_8))));
        byte[] key = hmac(("AWS4" + nullToEmpty(props.secretKey())).getBytes(StandardCharsets.UTF_8), date);
        key = hmac(key, props.region());
        key = hmac(key, "s3");
        key = hmac(key, "aws4_request");
        String signature = HEX.formatHex(hmac(key, stringToSign));
        return "AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s"
                .formatted(nullToEmpty(props.accessKey()), scope, signedHeaders, signature);
    }

    private static String hostHeader(URI uri) {
        return uri.getPort() == -1 ? uri.getHost() : uri.getHost() + ":" + uri.getPort();
    }

    /** Query string with keys sorted and both sides encoded, as SigV4 requires. */
    static String canonicalQuery(Map<String, String> query) {
        return new TreeMap<>(query).entrySet().stream().map(e -> encode(e.getKey()) + "=" + encode(e.getValue()))
                .collect(Collectors.joining("&"));
    }

    static String encodePath(String key) {
        return java.util.Arrays.stream(key.split("/", -1)).map(S3Client::encode).collect(Collectors.joining("/"));
    }

    /** RFC 3986 encoding: everything but unreserved characters, as SigV4 requires. */
    static String encode(String s) {
        var out = new StringBuilder();
        for (byte b : s.getBytes(StandardCharsets.UTF_8)) {
            char c = (char) (b & 0xff);
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_'
                    || c == '.' || c == '~') {
                out.append(c);
            } else {
                out.append('%').append(String.format("%02X", b & 0xff));
            }
        }
        return out.toString();
    }

    private static String errorDetail(byte[] body) {
        try {
            var root = parse(body).getDocumentElement();
            String code = child(root, "Code");
            String message = child(root, "Message");
            return code == null ? "" : ": " + code + (message == null ? "" : " (" + message + ")");
        } catch (RuntimeException e) {
            return "";
        }
    }

    private static org.w3c.dom.Document parse(byte[] xml) {
        try {
            var factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
        } catch (Exception e) {
            throw new PublishException("S3 error: unreadable response", e);
        }
    }

    private static String child(Element parent, String name) {
        var nodes = parent.getElementsByTagName(name);
        return nodes.getLength() == 0 ? null : nodes.item(0).getTextContent();
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
