package com.ey.echo.builder.flow;

import static com.ey.echo.builder.flow.FlowExceptions.duplicateName;
import static com.ey.echo.builder.flow.FlowExceptions.invalidName;
import static com.ey.echo.builder.flow.FlowExceptions.invalidPath;
import static com.ey.echo.builder.flow.FlowExceptions.notFound;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class FlowService {

    private final FlowRepository flows;
    private final Clock clock;
    private final ApiSpecFiles apiSpecs;
    private final PublishedNames published;

    public FlowService(FlowRepository flows, Clock clock, ApiSpecFiles apiSpecs, PublishedNames published) {
        this.flows = flows;
        this.clock = clock;
        this.apiSpecs = apiSpecs;
        this.published = published;
    }

    @Transactional(readOnly = true)
    public List<Flow> list() {
        return flows.findAllByOrderByNameAsc();
    }

    @Transactional(readOnly = true)
    public Flow get(long id) {
        return flows.findById(id).orElseThrow(() -> notFound("Flow " + id));
    }

    @Transactional(readOnly = true)
    public java.util.Optional<Flow> findByName(String name) {
        return flows.findByNameIgnoreCase(name);
    }

    /**
     * The flow a user means by {@code name}: the one with that display name, else the one with that
     * identifier (both ignoring case).
     */
    @Transactional(readOnly = true)
    public java.util.Optional<Flow> findByDisplayName(String name) {
        String typed = name == null ? "" : name.strip();
        var all = list();
        return all.stream().filter(f -> f.getDisplayName().equalsIgnoreCase(typed)).findFirst()
                .or(() -> all.stream().filter(f -> f.getName().equalsIgnoreCase(typed)).findFirst());
    }

    /** Flow with its file list, loaded inside the transaction. */
    @Transactional(readOnly = true)
    public FlowDtos.FlowDetail detail(long id) {
        var flow = get(id);
        return FlowDtos.FlowDetail.of(flow, apiSpecs.find(flow).orElse(null));
    }

    /**
     * All files of a flow, path to content, as it leaves the editor (Run, Validate, Publish,
     * Download, Save As Template): the route file includes the REST part made from the flow's
     * OpenAPI spec ({@link RestFromSpec}).
     */
    @Transactional(readOnly = true)
    public java.util.Map<String, String> files(long id) {
        var flow = get(id);
        var result = new java.util.TreeMap<String, String>();
        flow.getFiles().forEach(f -> result.put(f.getPath(), f.getContent()));
        return RestFromSpec.apply(FlowNames.routeFile(flow.getName()), apiSpecs.find(flow), result);
    }

    /** A new flow called {@code displayName}; its identifier is made from that name ({@link FlowNames#idFor}). */
    public Flow create(String displayName, String description, String user) {
        String display = checkNewDisplayName(displayName, null);
        String name = newId(display);
        var flow = new Flow(name, display, blankToNull(description), user, now());
        flow.putFile(FlowNames.routeFile(name), FlowTemplates.route(name));
        flow.putFile("application.properties", FlowTemplates.applicationProperties(name));
        return flows.save(flow);
    }

    /**
     * Creates a flow from an uploaded zip, called {@code displayName} if given, else after the zip's
     * route file. The route file is renamed to match the flow's identifier.
     */
    public Flow importArchive(FlowArchive.Contents archive, String displayName, String description, String user) {
        String display = checkNewDisplayName(
                displayName == null || displayName.isBlank() ? archive.name() : displayName, null);
        return importArchive(archive, newId(display), display, description, user);
    }

    /**
     * Creates a flow from files under the given identifier (a published flow's folder name, which
     * must stay the same so publishing writes to that folder again).
     */
    public Flow importArchive(FlowArchive.Contents archive, String name, String displayName, String description,
            String user) {
        checkName(name);
        if (flows.existsByNameIgnoreCase(name)) {
            throw duplicateName(name);
        }
        if (description != null && description.length() > 1000) {
            throw FlowExceptions.descriptionTooLong();
        }
        String display = FlowNames.isValidDisplayName(displayName) ? displayName.strip() : null;
        var flow = new Flow(name, display, blankToNull(description), user, now());
        var originalRoute = FlowNames.routeFile(archive.name());
        // A downloaded or published flow carries the REST part made from its spec; the draft does not.
        archive.files().forEach((path, content) -> {
            if (path.equals(originalRoute)) {
                flow.putFile(FlowNames.routeFile(name), RestFromSpec.strip(content));
            } else {
                flow.putFile(path, content);
            }
        });
        return flows.save(flow);
    }

    /**
     * Renames and/or re-describes a flow. Only the display name changes: the identifier (Git folder,
     * route file) stays, so a published flow keeps its folder.
     */
    public Flow update(long id, String displayName, String description, String user) {
        var flow = get(id);
        if (!flow.getDisplayName().equals(displayName == null ? null : displayName.strip())) {
            flow.setDisplayName(checkNewDisplayName(displayName, flow));
        }
        flow.setDescription(blankToNull(description));
        flow.touch(user, now());
        return flow;
    }

    /**
     * Save As: copies a flow, with its side files, to a draft called {@code displayName}. The route
     * file is renamed to match and gets {@code routeContent} (what is on screen) when given. An
     * existing draft with that name is replaced only when {@code overwrite} is true; the source
     * keeps its last saved state. Saving under the flow's own name is a plain save.
     */
    public Flow saveAs(long sourceId, String displayName, String routeContent, boolean overwrite, String user) {
        if (!FlowNames.isValidDisplayName(displayName)) {
            throw FlowExceptions.invalidDisplayName();
        }
        String display = displayName.strip();
        var source = get(sourceId);
        String sourceRoute = FlowNames.routeFile(source.getName());
        var existing = findByDisplayName(display);
        if (existing.isPresent() && existing.get().getId().equals(sourceId)) {
            if (routeContent != null) {
                writeFile(sourceId, sourceRoute, routeContent, user);
            }
            return source;
        }
        if (existing.isPresent() && !overwrite) {
            throw FlowExceptions.confirmOverwrite(
                    "A flow named '%s' already exists. Replace it?".formatted(existing.get().getDisplayName()));
        }
        if (existing.isEmpty()) {
            checkNewDisplayName(display, null); // a published flow, or a flow with the same ID, is not replaced
        }
        var target = existing.orElseGet(() -> new Flow(newId(display), display, source.getDescription(), user, now()));
        target.setDisplayName(display);
        var files = new java.util.TreeMap<String, String>();
        source.getFiles().forEach(f -> files.put(f.getPath(), f.getContent()));
        String route = files.remove(sourceRoute);
        files.put(FlowNames.routeFile(target.getName()), routeContent != null ? routeContent : route);
        replaceFiles(target, files);
        target.touch(user, now());
        return existing.isPresent() ? target : flows.save(target);
    }

    /**
     * Creates a draft from a template's files (as read from the template folder). The template's
     * route file is renamed to match the new flow. Never overwrites a flow.
     */
    public Flow createFromTemplate(String templateName, java.util.Map<String, String> templateFiles, String name,
            String description, String user) {
        String templateRoute = FlowNames.routeFile(templateName);
        if (!templateFiles.containsKey(templateRoute)) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                    "The template '%s' has no %s.".formatted(templateName, templateRoute));
        }
        templateFiles.keySet().forEach(FlowService::checkPath);
        if (name == null || name.isBlank()) {
            throw FlowExceptions.invalidDisplayName();
        }
        return importArchive(new FlowArchive.Contents(templateName, templateFiles), name, description, user);
    }

    /**
     * Replaces a draft's files with a published version of the flow (its route file renamed to
     * match the draft). The draft then matches what is published, unless it was renamed since.
     */
    public Flow replaceWithPublished(long id, FlowArchive.Contents published, String user) {
        var flow = get(id);
        published.files().keySet().forEach(FlowService::checkPath);
        var originalRoute = FlowNames.routeFile(published.name());
        var files = new java.util.TreeMap<String, String>();
        published.files().forEach((path, content) -> {
            if (path.equals(originalRoute)) {
                files.put(FlowNames.routeFile(flow.getName()), RestFromSpec.strip(content));
            } else {
                files.put(path, content);
            }
        });
        replaceFiles(flow, files);
        flow.touch(user, now());
        if (flow.getName().equals(published.name())) {
            flow.setStatus(FlowStatus.PUBLISHED);
        }
        return flow;
    }

    /** Makes the flow's files exactly {@code files}, updating rows in place (no delete-then-insert of a path). */
    private static void replaceFiles(Flow flow, java.util.Map<String, String> files) {
        files.forEach(flow::putFile);
        flow.getFiles().removeIf(f -> !files.containsKey(f.getPath()));
    }

    public void delete(long id) {
        flows.delete(get(id));
    }

    @Transactional(readOnly = true)
    public String readFile(long id, String path) {
        checkPath(path);
        return get(id).file(path).map(FlowFile::getContent).orElseThrow(() -> notFound("File " + path));
    }

    public void writeFile(long id, String path, String content, String user) {
        checkPath(path);
        var flow = get(id);
        var existing = flow.file(path);
        if (existing.isPresent() && existing.get().getContent().equals(content)) {
            return; // unchanged: keep the PUBLISHED status
        }
        flow.putFile(path, content);
        flow.touch(user, now());
    }

    /**
     * Saves the flow's OpenAPI spec as {@code name} (the name it was uploaded or saved with, in JSON
     * or YAML). A flow has one spec, so a spec saved before under another name is removed.
     */
    public void saveApiSpec(long id, String name, String content, String user) {
        var flow = get(id);
        apiSpecs.checkName(flow, name);
        apiSpecs.checkContent(content);
        var previous = apiSpecs.find(flow);
        boolean renamed = previous.isPresent() && !previous.get().equals(name);
        if (renamed) {
            flow.removeFile(previous.get());
        }
        var existing = flow.file(name);
        if (!renamed && existing.isPresent() && existing.get().getContent().equals(content)) {
            return; // unchanged: keep the PUBLISHED status
        }
        flow.putFile(name, content);
        flow.touch(user, now());
    }

    /** Every flow's OpenAPI spec, by flow name: what Openapi Design's Copy From Another Flow offers. */
    @Transactional(readOnly = true)
    public List<FlowDtos.ApiSpecRef> apiSpecs() {
        return list().stream()
                .flatMap(f -> apiSpecs.find(f).map(spec -> new FlowDtos.ApiSpecRef(f.getId(), f.getDisplayName(), spec)).stream())
                .toList();
    }

    /**
     * Copies another flow's OpenAPI spec into this flow, under the same file name. The copy belongs
     * to this flow and replaces the spec it had (a flow has one). Copying from itself changes nothing.
     *
     * @return the copy's file name
     */
    public String copyApiSpec(long id, long sourceId, String user) {
        var source = get(sourceId);
        String name = apiSpecs.find(source)
                .orElseThrow(() -> notFound("An OpenAPI spec in flow " + source.getDisplayName()));
        if (sourceId != id) {
            saveApiSpec(id, name, source.file(name).orElseThrow().getContent(), user);
        }
        return name;
    }

    public void deleteFile(long id, String path, String user) {
        checkPath(path);
        var flow = get(id);
        if (path.equals(FlowNames.routeFile(flow.getName()))) {
            throw FlowExceptions.routeFileRequired();
        }
        if (!flow.removeFile(path)) {
            throw notFound("File " + path);
        }
        flow.touch(user, now());
    }

    private Instant now() {
        return clock.instant();
    }

    /**
     * The display name, stripped, if it is allowed and no other flow (than {@code self}) has it: no
     * Builder flow and no published flow is called that, or has the ID it makes ({@link FlowNames#idFor}),
     * all ignoring case. Otherwise a 409 that says which flow has it, so the user can open that one.
     */
    private String checkNewDisplayName(String displayName, Flow self) {
        if (!FlowNames.isValidDisplayName(displayName)) {
            throw FlowExceptions.invalidDisplayName();
        }
        String display = displayName.strip();
        String id = FlowNames.idFor(display);
        for (var other : list()) {
            if (self != null && other.getId().equals(self.getId())) {
                continue;
            }
            if (other.getDisplayName().equalsIgnoreCase(display) || other.getName().equalsIgnoreCase(display)) {
                throw FlowExceptions.nameTaken(display, other.getDisplayName(), other.getId(), null);
            }
            if (other.getName().equalsIgnoreCase(id)) {
                throw FlowExceptions.idTaken(display, id, other.getDisplayName(), other.getId(), null);
            }
        }
        for (var other : published.list()) {
            if (self != null && other.name().equals(self.getName())) {
                continue; // its own published folder
            }
            String shown = other.displayName() == null ? other.name() : other.displayName();
            if (shown.equalsIgnoreCase(display) || other.name().equalsIgnoreCase(display)) {
                throw FlowExceptions.nameTaken(display, shown, null, other.name());
            }
            if (other.name().equalsIgnoreCase(id)) {
                throw FlowExceptions.idTaken(display, id, shown, null, other.name());
            }
        }
        return display;
    }

    /** A new flow's identifier, made from its display name ({@link #checkNewDisplayName} made sure it is free). */
    private static String newId(String displayName) {
        return FlowNames.idFor(displayName);
    }

    private static void checkName(String name) {
        if (!FlowNames.isValidName(name)) {
            throw invalidName(name);
        }
    }

    private static void checkPath(String path) {
        if (!FlowNames.isValidPath(path)) {
            throw invalidPath(path);
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
