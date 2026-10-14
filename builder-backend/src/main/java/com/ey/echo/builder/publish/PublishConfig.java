package com.ey.echo.builder.publish;

import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class PublishConfig {

    @Bean
    GitPublisher gitPublisher(GitProperties props, @Value("${echo.data-dir}") Path dataDir) {
        // The working copy defaults to <data-dir>/git.
        var effective = props.workdir() != null ? props : new GitProperties(props.url(), props.branch(),
                props.username(), props.token(), props.committerName(), props.committerEmail(),
                dataDir.resolve("git"), props.flowsFolder());
        return new JGitPublisher(effective);
    }
}
