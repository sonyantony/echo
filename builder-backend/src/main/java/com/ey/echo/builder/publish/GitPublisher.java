package com.ey.echo.builder.publish;

import java.util.List;
import java.util.Map;
import java.util.Optional;

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

    /** Flows currently in the repository, one per flow folder, sorted by name. */
    List<PublishedFolder> list();

    /** Files of one published flow, path to content; empty if the repository has no such flow. */
    Optional<Map<String, String>> read(String flowName);

    /** A flow folder in the repository with its files, path to content. */
    record PublishedFolder(String name, Map<String, String> files) {}

    /**
     * @param commitSha the new commit, or the current head when nothing changed
     * @param changed false when the repository already had exactly these files
     */
    record PublishResult(String commitSha, String branch, boolean changed) {}
}
