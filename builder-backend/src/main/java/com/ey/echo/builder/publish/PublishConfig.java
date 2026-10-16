package com.ey.echo.builder.publish;

import java.nio.file.Path;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

/**
 * The publish targets. Each is a {@link FlowPublisher} bean and switches itself on or off from
 * its {@code enabled} setting; another target is another bean.
 */
@Configuration
class PublishConfig {

    @Bean
    @Order(1)
    JGitPublisher gitPublisher(GitProperties props, @Value("${echo.data-dir}") Path dataDir) {
        // The working copy defaults to <data-dir>/git.
        var effective = props.workdir() != null ? props : new GitProperties(props.url(), props.branch(),
                props.username(), props.token(), props.committerName(), props.committerEmail(),
                dataDir.resolve("git"), props.flowsFolder(), props.enabled());
        return new JGitPublisher(effective);
    }

    @Bean
    @Order(2)
    S3Publisher s3Publisher(S3Properties props, Clock clock) {
        return new S3Publisher(props, clock);
    }
}
