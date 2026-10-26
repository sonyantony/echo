package com.ey.echo.builder.flow;

import java.util.List;
import java.util.Map;

/**
 * The flows already published (in the primary publish target, as the Flows page lists them), so a
 * new flow's name is checked against them as well as against the Builder's drafts.
 */
public interface PublishedNames {

    /**
     * @param name the published folder (the flow's identifier)
     * @param displayName what users call it, from its metadata file, else the folder name
     */
    record PublishedName(String name, String displayName) {}

    /** As {@link PublishedName}, with the flow's published files (path to content). */
    record PublishedFlow(String name, String displayName, Map<String, String> files) {}

    List<PublishedName> list();

    /** The published flows with their files, to check what they serve. */
    List<PublishedFlow> flows();
}
