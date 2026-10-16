package com.ey.echo.builder.publish;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The Git publish target: one repository, one branch (Version 1). Works with any Git server
 * over HTTPS; credentials are a username plus a password or access token.
 *
 * @param url repository URL; empty means this target is not configured
 * @param branch branch to commit to directly
 * @param username user for HTTPS authentication (optional)
 * @param token password or access token (optional)
 * @param committerName name of the Builder's committer identity
 * @param committerEmail email of the committer identity; authors are the Builder users
 * @param workdir local working copy, owned by the Builder
 * @param flowsFolder folder in the repository that holds one sub-folder per flow
 * @param enabled false switches this target off even when url is set (default true)
 */
@ConfigurationProperties("echo.git")
public record GitProperties(
        String url,
        String branch,
        String username,
        String token,
        String committerName,
        String committerEmail,
        Path workdir,
        String flowsFolder,
        Boolean enabled) {

    public GitProperties {
        branch = blank(branch) ? "main" : branch;
        committerName = blank(committerName) ? "ECHO Builder" : committerName;
        committerEmail = blank(committerEmail) ? "echo-builder@localhost" : committerEmail;
        flowsFolder = blank(flowsFolder) ? "flows" : flowsFolder;
        enabled = enabled == null || enabled;
    }

    /** Publishing goes to Git only when it is enabled and has a repository URL. */
    public boolean active() {
        return enabled && !blank(url);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
