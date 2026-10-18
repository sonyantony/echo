package com.ey.echo.builder.publish;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.stream.Stream;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.ResetCommand.ResetType;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;
import org.eclipse.jgit.transport.URIish;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link FlowPublisher} for Git, on JGit: keeps a working copy in {@code echo.git.workdir}, resets it to
 * the remote branch before each publish, writes the flow folder, commits with the user as
 * author and pushes. Publishes are serialised with a lock, which is enough for about ten users.
 */
public class JGitPublisher implements FlowPublisher {

    private static final Logger log = LoggerFactory.getLogger(JGitPublisher.class);
    private static final String REMOTE = "origin";
    private static final int ATTEMPTS = 2;

    private final GitProperties props;
    /** The folder this publisher writes: the flows folder, or the templates folder next to it. */
    private final String folder;
    private final ReentrantLock lock;
    private final JGitPublisher templates;

    public JGitPublisher(GitProperties props) {
        this.props = props;
        this.folder = props.flowsFolder();
        this.lock = new ReentrantLock();
        this.templates = new JGitPublisher(props, FlowPublisher.templatesFolder(folder), lock);
    }

    /** The templates view: same working copy and lock, another folder. */
    private JGitPublisher(GitProperties props, String folder, ReentrantLock lock) {
        this.props = props;
        this.folder = folder;
        this.lock = lock;
        this.templates = this;
    }

    @Override
    public String id() {
        return "git";
    }

    @Override
    public String displayName() {
        return "Git";
    }

    @Override
    public String location() {
        String url = props.url() == null ? "" : props.url().replaceFirst("^(\\w+://)[^/@]*@", "$1"); // no credentials
        return "%s (branch %s)".formatted(url, props.branch());
    }

    @Override
    public boolean enabled() {
        return props.active();
    }

    @Override
    public PublishResult publish(String flowName, String previousName, Map<String, String> files, String author,
            String message) {
        return commit(flowName, author, message, git -> writeFlow(git, flowName, previousName, files));
    }

    @Override
    public PublishResult remove(String flowName, String author, String message) {
        return commit(flowName, author, message, git -> removeFlow(git, flowName));
    }

    @Override
    public FlowPublisher templates() {
        return templates;
    }

    @Override
    public List<PublishedFolder> list() {
        return onRemoteHead(git -> {
            Path flows = git.getRepository().getWorkTree().toPath().resolve(folder);
            var result = new ArrayList<PublishedFolder>();
            if (Files.isDirectory(flows)) {
                try (Stream<Path> dirs = Files.list(flows)) {
                    for (Path dir : dirs.filter(Files::isDirectory).sorted().toList()) {
                        result.add(new PublishedFolder(dir.getFileName().toString(), readFolder(dir)));
                    }
                }
            }
            return result;
        });
    }

    @Override
    public Optional<Map<String, String>> read(String flowName) {
        return onRemoteHead(git -> {
            Path folder = flowFolder(git, flowName);
            return Files.isDirectory(folder) ? Optional.of(readFolder(folder)) : Optional.empty();
        });
    }

    private interface Reader<T> {
        T read(Git git) throws GitAPIException, IOException;
    }

    /** Reads the working copy after making it match the remote branch. */
    private <T> T onRemoteHead(Reader<T> reader) {
        lock.lock();
        try (Git git = openWorkingCopy()) {
            syncWithRemote(git);
            return reader.read(git);
        } catch (GitAPIException | IOException e) {
            throw new PublishException("Git error: " + e.getMessage(), e);
        } finally {
            lock.unlock();
        }
    }

    private static Map<String, String> readFolder(Path folder) throws IOException {
        var files = new TreeMap<String, String>();
        try (Stream<Path> walk = Files.walk(folder)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                try {
                    files.put(folder.relativize(file).toString().replace('\\', '/'), Files.readString(file));
                } catch (java.nio.charset.CharacterCodingException e) {
                    log.warn("Skipping non-text file {}", file); // flows are text; nothing else is editable
                }
            }
        }
        return files;
    }

    /** Changes the working copy; returns false if nothing changed. */
    private interface Change {
        boolean apply(Git git) throws GitAPIException, IOException;
    }

    private PublishResult commit(String flowName, String author, String message, Change change) {
        lock.lock();
        try (Git git = openWorkingCopy()) {
            for (int attempt = 1; ; attempt++) {
                syncWithRemote(git);
                if (!change.apply(git)) {
                    return new PublishResult(head(git), props.branch(), false);
                }
                var authorIdent = new PersonIdent(author, props.committerEmail());
                var committer = new PersonIdent(props.committerName(), props.committerEmail());
                var commit = git.commit().setMessage(message).setAuthor(authorIdent).setCommitter(committer)
                        .setSign(false).call();
                if (push(git)) {
                    log.info("Committed flow {} as {} on {}", flowName, commit.getName(), props.branch());
                    return new PublishResult(commit.getName(), props.branch(), true);
                }
                if (attempt >= ATTEMPTS) {
                    throw new PublishException("The branch '%s' changed while publishing; try again."
                            .formatted(props.branch()));
                }
                log.info("Push of {} rejected, retrying on the new remote head", flowName);
            }
        } catch (GitAPIException | IOException e) {
            throw new PublishException("Git error: " + e.getMessage(), e);
        } finally {
            lock.unlock();
        }
    }

    private Git openWorkingCopy() throws GitAPIException, IOException {
        Path dir = props.workdir();
        if (Files.isDirectory(dir.resolve(".git"))) {
            Git git = Git.open(dir.toFile());
            git.remoteSetUrl().setRemoteName(REMOTE).setRemoteUri(remoteUri()).call();
            return git;
        }
        Files.createDirectories(dir);
        Git git = Git.init().setDirectory(dir.toFile()).setInitialBranch(props.branch()).call();
        git.remoteAdd().setName(REMOTE).setUri(remoteUri()).call();
        return git;
    }

    /** Makes the working copy match the remote branch exactly (the Builder owns this copy). */
    private void syncWithRemote(Git git) throws GitAPIException, IOException {
        git.fetch().setRemote(REMOTE).setCredentialsProvider(credentials())
                .setRefSpecs("+refs/heads/*:refs/remotes/%s/*".formatted(REMOTE)) // the branch may not exist yet
                .call();
        Ref remoteBranch = git.getRepository().findRef("refs/remotes/%s/%s".formatted(REMOTE, props.branch()));
        if (remoteBranch == null) {
            return; // empty repository or new branch: the first publish creates it
        }
        git.checkout().setName(props.branch()).setCreateBranch(
                git.getRepository().findRef(Constants.R_HEADS + props.branch()) == null)
                .setStartPoint(remoteBranch.getName()).setForced(true).call();
        git.reset().setMode(ResetType.HARD).setRef(remoteBranch.getName()).call();
        git.clean().setCleanDirectories(true).setForce(true).call();
    }

    /** Replaces the flow folder's content. Returns false if nothing changed. */
    private boolean writeFlow(Git git, String flowName, String previousName, Map<String, String> files)
            throws GitAPIException, IOException {
        Path folder = flowFolder(git, flowName);
        Path flows = folder.getParent();
        deleteRecursively(folder);
        if (previousName != null && !previousName.equals(flowName)) {
            deleteRecursively(flows.resolve(previousName).normalize());
        }
        for (var file : files.entrySet()) {
            Path target = folder.resolve(file.getKey()).normalize();
            if (!target.startsWith(folder)) {
                throw new PublishException("Invalid file path: " + file.getKey());
            }
            Files.createDirectories(target.getParent());
            Files.writeString(target, file.getValue());
        }
        return stage(git);
    }

    /** Deletes the flow folder. Returns false if it was not there. */
    private boolean removeFlow(Git git, String flowName) throws GitAPIException, IOException {
        deleteRecursively(flowFolder(git, flowName));
        return stage(git);
    }

    private Path flowFolder(Git git, String flowName) {
        Path flows = git.getRepository().getWorkTree().toPath().resolve(folder);
        Path folder = flows.resolve(flowName).normalize();
        if (!folder.startsWith(flows) || folder.equals(flows)) {
            throw new PublishException("Invalid flow name: " + flowName);
        }
        return folder;
    }

    /** Stages everything under this publisher's folder. Returns false if nothing changed. */
    private boolean stage(Git git) throws GitAPIException {
        git.add().addFilepattern(folder).call();
        git.add().addFilepattern(folder).setUpdate(true).call(); // stage deletions
        var status = git.status().call();
        return !status.getAdded().isEmpty() || !status.getChanged().isEmpty() || !status.getRemoved().isEmpty();
    }

    private boolean push(Git git) throws GitAPIException {
        Iterable<PushResult> results = git.push().setRemote(REMOTE).setCredentialsProvider(credentials())
                .setRefSpecs(new org.eclipse.jgit.transport.RefSpec(
                        "refs/heads/%1$s:refs/heads/%1$s".formatted(props.branch())))
                .call();
        for (PushResult result : results) {
            for (RemoteRefUpdate update : result.getRemoteUpdates()) {
                switch (update.getStatus()) {
                    case OK, UP_TO_DATE -> { }
                    case REJECTED_NONFASTFORWARD, REJECTED_REMOTE_CHANGED -> {
                        return false;
                    }
                    default -> throw new PublishException("Push failed: %s %s"
                            .formatted(update.getStatus(), update.getMessage() == null ? "" : update.getMessage()));
                }
            }
        }
        return true;
    }

    private String head(Git git) throws IOException {
        var head = git.getRepository().resolve(Constants.HEAD);
        return head == null ? null : head.getName();
    }

    private URIish remoteUri() {
        try {
            return new URIish(props.url());
        } catch (java.net.URISyntaxException e) {
            throw new PublishException("Invalid echo.git.url: " + props.url(), e);
        }
    }

    private CredentialsProvider credentials() {
        if (props.username() == null && props.token() == null) {
            return null;
        }
        return new UsernamePasswordCredentialsProvider(
                props.username() == null ? "" : props.username(), props.token() == null ? "" : props.token());
    }

    private static void deleteRecursively(Path path) throws IOException {
        if (!Files.exists(path)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(path)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        }
    }
}
