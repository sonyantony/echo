package com.ey.echo.builder.publish;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The S3 publish target: one bucket, one folder per flow under {@code prefix}. Works with Amazon
 * S3 and S3-compatible stores (MinIO, Ceph, ...) through {@code endpoint}. Off by default.
 *
 * @param enabled true switches this target on (default false)
 * @param bucket bucket name; empty means this target is not configured
 * @param prefix folder in the bucket that holds one sub-folder per flow (default {@code flows})
 * @param region signing region (default {@code us-east-1})
 * @param endpoint S3-compatible server, e.g. {@code http://minio:9000}; empty means Amazon S3.
 *     With an endpoint, buckets are addressed path-style ({@code endpoint/bucket/key}).
 * @param accessKey access key id
 * @param secretKey secret access key
 * @param sessionToken session token for temporary credentials (optional)
 */
@ConfigurationProperties("echo.s3")
public record S3Properties(
        Boolean enabled,
        String bucket,
        String prefix,
        String region,
        String endpoint,
        String accessKey,
        String secretKey,
        String sessionToken) {

    public S3Properties {
        enabled = enabled != null && enabled;
        prefix = prefix == null ? null : prefix.replaceAll("^/+|/+$", "");
        prefix = blank(prefix) ? "flows" : prefix;
        region = blank(region) ? "us-east-1" : region;
        endpoint = blank(endpoint) ? null : endpoint.replaceAll("/+$", "");
        sessionToken = blank(sessionToken) ? null : sessionToken;
    }

    /** Publishing goes to S3 only when it is enabled and has a bucket. */
    public boolean active() {
        return enabled && !blank(bucket);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
