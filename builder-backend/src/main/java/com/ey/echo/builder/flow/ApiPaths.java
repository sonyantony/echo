package com.ey.echo.builder.flow;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Which flow already serves an API path. A path belongs to one flow: two flows cannot share one,
 * whatever their methods (in a bundle image only one flow can serve a Base Path). A path is the
 * Base Path plus the spec's path, compared with path parameters as placeholders and trailing ones
 * left out, so {@code /shop/shoes} and {@code /shop/shoes/{id}} are the same path. The Builder's
 * flows and the published ones (primary publish target) are checked; the flow itself (and its own
 * published folder) is not.
 */
@Component
public class ApiPaths {

    private final FlowRepository flows;
    private final ApiSpecFiles apiSpecs;
    private final PublishedNames published;

    public ApiPaths(FlowRepository flows, ApiSpecFiles apiSpecs, PublishedNames published) {
        this.flows = flows;
        this.apiSpecs = apiSpecs;
        this.published = published;
    }

    /**
     * A path of the spec another flow serves.
     *
     * @param path the path as this spec serves it (Base Path included)
     * @param specPath the path as this spec has it (without Base Path)
     * @param otherPath the path as the other flow serves it
     * @param flowName the other flow's display name
     * @param flowId the other flow's Builder id, or null if it is only published
     * @param folder the other flow's published folder, when it is only published
     */
    public record PathClash(String path, String specPath, String otherPath, String flowName, Long flowId, String folder) {}

    /**
     * The paths of specContent (all, or only those whose spec path is in specPaths) that other
     * flows serve.
     *
     * @param self the flow the spec is for, or null for one not stored yet
     * @param selfFolder its identifier (its published folder), or null
     * @param contextPath the flow's REST Context Path, used when the spec has no Base Path
     * @param specPaths the spec's own paths (without Base Path) to check; null for all
     */
    public List<PathClash> clashes(Long self, String selfFolder, String specContent, String contextPath,
            Set<String> specPaths) {
        var mine = new LinkedHashMap<String, String[]>(); // key -> {served path, spec path}
        var spec = RestFromSpec.Spec.read(specContent);
        String base = basePath(spec, contextPath);
        for (String p : spec.paths()) { // a path without operations yet counts too
            if (specPaths == null || specPaths.contains(p)) {
                mine.putIfAbsent(key(join(base, p)), new String[] {join(base, p), p});
            }
        }
        if (mine.isEmpty()) {
            return List.of();
        }
        var clashes = new LinkedHashSet<PathClash>();
        var builderNames = new java.util.HashSet<String>();
        for (var flow : flows.findAll()) {
            builderNames.add(flow.getName());
            if (Objects.equals(flow.getId(), self)) {
                continue;
            }
            var specName = apiSpecs.find(flow);
            if (specName.isEmpty()) {
                continue;
            }
            String content = flow.file(specName.get()).map(FlowFile::getContent).orElse(null);
            String route = flow.file(FlowNames.routeFile(flow.getName())).map(FlowFile::getContent).orElse(null);
            for (String theirs : served(content, RestFromSpec.contextPath(route).orElse(null))) {
                String[] m = mine.get(key(theirs));
                if (m != null) {
                    clashes.add(new PathClash(m[0], m[1], theirs, flow.getDisplayName(), flow.getId(), null));
                }
            }
        }
        for (var flow : published.flows()) {
            // A flow in the Builder too was checked there; the flow's own folder is not another flow.
            if (flow.name().equals(selfFolder) || builderNames.contains(flow.name())) {
                continue;
            }
            String route = flow.files().get(FlowNames.routeFile(flow.name()));
            var specName = RestFromSpec.specificationOf(route);
            if (specName.isEmpty()) {
                continue;
            }
            String shownName = flow.displayName() == null ? flow.name() : flow.displayName();
            for (String theirs : served(flow.files().get(specName.get()), RestFromSpec.contextPath(route).orElse(null))) {
                String[] m = mine.get(key(theirs));
                if (m != null) {
                    clashes.add(new PathClash(m[0], m[1], theirs, shownName, null, flow.name()));
                }
            }
        }
        return List.copyOf(clashes);
    }

    /**
     * The clashes of the paths that content has and previous (the spec as stored before) did not:
     * paths the flow had already are left as they are.
     */
    public List<PathClash> newClashes(Flow self, String previous, String content) {
        String route = self.file(FlowNames.routeFile(self.getName())).map(FlowFile::getContent).orElse(null);
        String contextPath = RestFromSpec.contextPath(route).orElse(null);
        var had = new java.util.HashSet<String>();
        served(previous, contextPath).forEach(p -> had.add(key(p)));
        var spec = RestFromSpec.Spec.read(content);
        String base = basePath(spec, contextPath);
        var added = new LinkedHashSet<String>();
        for (String p : spec.paths()) {
            if (!had.contains(key(join(base, p)))) {
                added.add(p);
            }
        }
        return added.isEmpty() ? List.of() : clashes(self.getId(), self.getName(), content, contextPath, added);
    }

    /** The paths (Base Path included) a spec serves, each once. */
    private static Set<String> served(String specContent, String contextPath) {
        if (specContent == null) {
            return Set.of();
        }
        var spec = RestFromSpec.Spec.read(specContent);
        String base = basePath(spec, contextPath);
        var result = new LinkedHashSet<String>();
        spec.paths().forEach(p -> result.add(join(base, p)));
        return result;
    }

    private static String basePath(RestFromSpec.Spec spec, String contextPath) {
        return spec.hasBasePath() || contextPath == null ? spec.basePath() : contextPath;
    }

    private static String join(String base, String path) {
        String b = base == null ? "" : base.strip();
        while (b.endsWith("/")) {
            b = b.substring(0, b.length() - 1);
        }
        if (!b.isEmpty() && !b.startsWith("/")) {
            b = "/" + b;
        }
        return b + (path.startsWith("/") ? path : "/" + path);
    }

    /**
     * What makes two paths the same: path parameters as {@code {}} whatever their names, trailing
     * ones left out ({@code /shop/shoes/{id}} is {@code /shop/shoes}), no trailing slash.
     */
    static String key(String path) {
        String p = Objects.requireNonNullElse(path, "").strip().replaceAll("/{2,}", "/").replaceAll("\\{[^}/]*}", "{}");
        boolean changed = true;
        while (changed) {
            changed = false;
            if (p.endsWith("/") && p.length() > 1) {
                p = p.substring(0, p.length() - 1);
                changed = true;
            }
            if (p.endsWith("/{}")) {
                p = p.substring(0, p.length() - 3);
                changed = true;
            }
        }
        return p.isEmpty() ? "/" : p.startsWith("/") ? p : "/" + p;
    }

    /** One line naming the clashes, e.g. {@code /shop/orders (in flow Order Reader)}. */
    public static String describe(List<PathClash> clashes) {
        var parts = new LinkedHashSet<String>();
        for (var c : clashes) {
            parts.add("%s (in flow %s)".formatted(c.path(), c.flowName()));
        }
        return String.join(", ", parts);
    }

    /** As a 409: {@code pathClashes} lists them, so the editor can show which flow has each path. */
    public static org.springframework.web.server.ResponseStatusException conflict(String message, List<PathClash> clashes) {
        var e = new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,
                message + " " + describe(clashes) + ". A path can be in one flow only.");
        e.getBody().setProperty("pathClashes", clashes.stream().map(c -> {
            var m = new LinkedHashMap<String, Object>();
            m.put("path", c.path());
            m.put("specPath", c.specPath());
            m.put("otherPath", c.otherPath());
            m.put("flowName", c.flowName());
            if (c.flowId() != null) {
                m.put("flowId", c.flowId());
            }
            if (c.folder() != null) {
                m.put("folder", c.folder());
            }
            return m;
        }).toList());
        return e;
    }
}
