package com.ey.echo.builder.flow;

import java.util.List;

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

    List<PublishedName> list();
}
