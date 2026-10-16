package com.ey.echo.builder.publish;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.time.Clock;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

/** SigV4 signing checked against the worked examples in the Amazon S3 API reference. */
class S3ClientTest {

    private static final String EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    private final S3Client client = new S3Client(new S3Properties(true, "examplebucket", null, "us-east-1", null,
            "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", null), Clock.systemUTC());

    private static TreeMap<String, String> headers(Map<String, String> extra, String payloadHash) {
        var headers = new TreeMap<String, String>(extra);
        headers.put("host", "examplebucket.s3.amazonaws.com");
        headers.put("x-amz-date", "20130524T000000Z");
        headers.put("x-amz-content-sha256", payloadHash);
        return headers;
    }

    @Test
    void signsAGetObjectRequest() {
        var auth = client.authorization("GET", URI.create("https://examplebucket.s3.amazonaws.com/test.txt"),
                headers(Map.of("range", "bytes=0-9"), EMPTY_HASH), EMPTY_HASH);

        assertThat(auth).isEqualTo("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/"
                + "aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
                + "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    }

    @Test
    void signsAPutObjectRequestWithAnEncodedKey() {
        String hash = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"; // "Welcome to Amazon S3."
        var uri = URI.create("https://examplebucket.s3.amazonaws.com/" + S3Client.encodePath("test$file.text"));
        var auth = client.authorization("PUT", uri, headers(Map.of("date", "Fri, 24 May 2013 00:00:00 GMT",
                "x-amz-storage-class", "REDUCED_REDUNDANCY"), hash), hash);

        assertThat(auth).endsWith("Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
    }

    @Test
    void signsAListRequest() {
        var uri = URI.create("https://examplebucket.s3.amazonaws.com/?"
                + S3Client.canonicalQuery(Map.of("prefix", "J", "max-keys", "2")));
        var auth = client.authorization("GET", uri, headers(Map.of(), EMPTY_HASH), EMPTY_HASH);

        assertThat(auth).endsWith("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
    }

    @Test
    void encodesLikeSigV4() {
        assertThat(S3Client.encodePath("flows/my flow/a+b~c.json")).isEqualTo("flows/my%20flow/a%2Bb~c.json");
        assertThat(S3Client.canonicalQuery(Map.of("prefix", "flows/", "list-type", "2")))
                .isEqualTo("list-type=2&prefix=flows%2F");
    }
}
