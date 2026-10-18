package com.ey.echo.builder.publish;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link FlowPublisher} for S3: each flow is a folder of objects, {@code <prefix>/<flow>/<file>}.
 * A publish writes the files that changed and deletes the ones the flow no longer has. S3 keeps no
 * history of its own; turn on bucket versioning for that. Publishes are serialised with a lock.
 */
public class S3Publisher implements FlowPublisher {

    private static final Logger log = LoggerFactory.getLogger(S3Publisher.class);

    private final S3Properties props;
    private final S3Client s3;
    /** The key prefix this publisher writes: the flows prefix, or the templates prefix next to it. */
    private final String prefix;
    private final ReentrantLock lock;
    private final S3Publisher templates;

    public S3Publisher(S3Properties props, java.time.Clock clock) {
        this.props = props;
        this.s3 = new S3Client(props, clock);
        this.prefix = props.prefix();
        this.lock = new ReentrantLock();
        this.templates = new S3Publisher(this);
    }

    /** The templates view of a flows publisher: same bucket and lock, another prefix. */
    private S3Publisher(S3Publisher flows) {
        this.props = flows.props;
        this.s3 = flows.s3;
        this.prefix = FlowPublisher.templatesFolder(flows.prefix);
        this.lock = flows.lock;
        this.templates = this;
    }

    @Override
    public String id() {
        return "s3";
    }

    @Override
    public String displayName() {
        return "S3";
    }

    @Override
    public String location() {
        return "s3://%s/%s/".formatted(props.bucket(), prefix)
                + (props.endpoint() == null ? "" : " at " + props.endpoint());
    }

    @Override
    public boolean enabled() {
        return props.active();
    }

    @Override
    public PublishResult publish(String flowName, String previousName, Map<String, String> files, String author,
            String message) {
        String folder = folder(flowName);
        for (String path : files.keySet()) {
            String key = folder + path;
            if (path.isEmpty() || path.startsWith("/") || java.util.Arrays.asList(path.split("/")).contains("..")
                    || !key.startsWith(folder)) {
                throw new PublishException("Invalid file path: " + path);
            }
        }
        lock.lock();
        try {
            boolean changed = false;
            var existing = new HashMap<String, String>();
            for (String key : s3.list(folder)) {
                existing.put(key, s3.get(key).orElse(null));
            }
            for (var file : files.entrySet()) {
                String key = folder + file.getKey();
                if (!file.getValue().equals(existing.get(key))) {
                    s3.put(key, file.getValue());
                    changed = true;
                }
            }
            for (String key : existing.keySet()) {
                if (!files.containsKey(key.substring(folder.length()))) {
                    s3.delete(key);
                    changed = true;
                }
            }
            if (previousName != null && !previousName.equals(flowName)) {
                changed |= deleteFolder(folder(previousName));
            }
            if (changed) {
                log.info("Published flow {} to {}", flowName, location());
            }
            return new PublishResult(null, url(folder), changed);
        } finally {
            lock.unlock();
        }
    }

    @Override
    public PublishResult remove(String flowName, String author, String message) {
        String folder = folder(flowName);
        lock.lock();
        try {
            return new PublishResult(null, url(folder), deleteFolder(folder));
        } finally {
            lock.unlock();
        }
    }

    @Override
    public FlowPublisher templates() {
        return templates;
    }

    @Override
    public List<PublishedFolder> list() {
        var byFlow = new TreeMap<String, Map<String, String>>();
        String root = prefix + "/";
        for (String key : s3.list(root)) {
            String rest = key.substring(root.length());
            int slash = rest.indexOf('/');
            if (slash <= 0 || slash == rest.length() - 1) {
                continue; // a file directly under the prefix, or a folder marker
            }
            byFlow.computeIfAbsent(rest.substring(0, slash), name -> new TreeMap<>())
                    .put(rest.substring(slash + 1), s3.get(key).orElse(""));
        }
        return byFlow.entrySet().stream().map(e -> new PublishedFolder(e.getKey(), e.getValue())).toList();
    }

    @Override
    public Optional<Map<String, String>> read(String flowName) {
        String folder = folder(flowName);
        var files = new TreeMap<String, String>();
        for (String key : s3.list(folder)) {
            if (!key.endsWith("/")) {
                s3.get(key).ifPresent(content -> files.put(key.substring(folder.length()), content));
            }
        }
        return files.isEmpty() ? Optional.empty() : Optional.of(files);
    }

    private boolean deleteFolder(String folder) {
        var keys = s3.list(folder);
        keys.forEach(s3::delete);
        return !keys.isEmpty();
    }

    /** The key prefix of a flow folder, ending in a slash. */
    private String folder(String flowName) {
        if (flowName == null || flowName.isBlank() || flowName.contains("/") || flowName.contains("\\")
                || flowName.equals(".") || flowName.equals("..")) {
            throw new PublishException("Invalid flow name: " + flowName);
        }
        return prefix + "/" + flowName + "/";
    }

    private String url(String folder) {
        return "s3://%s/%s".formatted(props.bucket(), folder);
    }
}
