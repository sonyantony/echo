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

    public FlowService(FlowRepository flows, Clock clock) {
        this.flows = flows;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Flow> list() {
        return flows.findAllByOrderByNameAsc();
    }

    @Transactional(readOnly = true)
    public Flow get(long id) {
        return flows.findById(id).orElseThrow(() -> notFound("Flow " + id));
    }

    /** Flow with its file list, loaded inside the transaction. */
    @Transactional(readOnly = true)
    public FlowDtos.FlowDetail detail(long id) {
        return FlowDtos.FlowDetail.of(get(id));
    }

    /** All files of a flow, path to content. */
    @Transactional(readOnly = true)
    public java.util.Map<String, String> files(long id) {
        var result = new java.util.TreeMap<String, String>();
        get(id).getFiles().forEach(f -> result.put(f.getPath(), f.getContent()));
        return result;
    }

    public Flow create(String name, String description, String user) {
        checkName(name);
        if (flows.existsByNameIgnoreCase(name)) {
            throw duplicateName(name);
        }
        var flow = new Flow(name, blankToNull(description), user, now());
        flow.putFile(FlowNames.routeFile(name), FlowTemplates.route(name));
        flow.putFile("application.properties", FlowTemplates.applicationProperties(name));
        return flows.save(flow);
    }

    /** Renames and/or re-describes a flow. Renaming also renames its route file. */
    public Flow update(long id, String name, String description, String user) {
        var flow = get(id);
        if (!flow.getName().equals(name)) {
            checkName(name);
            if (flows.existsByNameIgnoreCase(name)) {
                throw duplicateName(name);
            }
            var oldRoute = FlowNames.routeFile(flow.getName());
            flow.file(oldRoute).ifPresent(f -> f.setPath(FlowNames.routeFile(name)));
            flow.setName(name);
        }
        flow.setDescription(blankToNull(description));
        flow.touch(user, now());
        return flow;
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
