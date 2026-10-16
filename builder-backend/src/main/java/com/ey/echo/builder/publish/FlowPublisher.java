package com.ey.echo.builder.publish;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * A place published flows go: Git ({@link JGitPublisher}), S3 ({@link S3Publisher}), or anything
 * else a buyer needs. Each target keeps one folder per flow with the flow's files. Every
 * {@code FlowPublisher} bean that is {@link #enabled()} receives each publish and delete; adding a
 * target means adding a bean. Version 2's "branch + pull request" can be another implementation.
 */
public interface FlowPublisher {

    /** Short, stable id stored with each publish, e.g. {@code git} or {@code s3}. */
    String id();

    /** Name shown to users, e.g. {@code Git}. */
    String displayName();

    /** Where flows go, shown to users, e.g. the repository URL and branch. */
    String location();

    /** True when this target is switched on and configured; only enabled targets are used. */
    boolean enabled();

    /**
     * @param flowName folder name under the flows folder
     * @param previousName folder of the last publish if the flow was renamed since, else null
     * @param files all files of the flow, path to content; replaces the folder's content
     * @param author Builder user who publishes
     * @param message description of the change (the commit message for Git)
     */
    PublishResult publish(String flowName, String previousName, Map<String, String> files, String author,
            String message);

    /**
     * Deletes the flow folder. Git does this with a normal commit, so it stays recoverable from
     * its history.
     *
     * @param flowName folder name under the flows folder
     * @return changed is false when the folder was not there
     */
    PublishResult remove(String flowName, String author, String message);

    /** Flows currently in the target, one per flow folder, sorted by name. */
    List<PublishedFolder> list();

    /** Files of one published flow, path to content; empty if the target has no such flow. */
    Optional<Map<String, String>> read(String flowName);

    /** A flow folder in the target with its files, path to content. */
    record PublishedFolder(String name, Map<String, String> files) {}

    /**
     * @param revision what identifies this version in the target (the commit for Git), or null
     * @param location where the flow went, e.g. the branch or the folder URL
     * @param changed false when the target already had exactly these files
     */
    record PublishResult(String revision, String location, boolean changed) {}
}
