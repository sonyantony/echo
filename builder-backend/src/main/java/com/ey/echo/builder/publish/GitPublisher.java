package com.ey.echo.builder.publish;

import java.util.Map;

/**
 * Writes a flow into the flow repository. Version 1 commits straight to a branch; Version 2
 * (branch + pull request) can be another implementation of this interface.
 */
public interface GitPublisher {

    /**
     * @param flowName folder name under the flows folder
     * @param previousName folder of the last publish if the flow was renamed since, else null
     * @param files all files of the flow, path to content; replaces the folder's content
     * @param author Builder user who publishes
     * @param message commit message
     */
    PublishResult publish(String flowName, String previousName, Map<String, String> files, String author,
            String message);

    /**
     * Deletes the flow folder with a normal commit, so it stays recoverable from Git history.
     *
     * @param flowName folder name under the flows folder
     * @return changed is false when the folder was not in the repository
     */
    PublishResult remove(String flowName, String author, String message);

    /**
     * @param commitSha the new commit, or the current head when nothing changed
     * @param changed false when the repository already had exactly these files
     */
    record PublishResult(String commitSha, String branch, boolean changed) {}
}
