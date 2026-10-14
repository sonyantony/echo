package com.ey.echo.builder.publish;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.ResetCommand.ResetType;
import org.eclipse.jgit.transport.RefSpec;
import org.eclipse.jgit.transport.URIish;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.treewalk.TreeWalk;

/** A local bare repository standing in for the buyer's Git server. */
final class GitTestRepo {

    final Path bare;

    GitTestRepo(Path dir) throws Exception {
        this.bare = dir;
        Git.init().setBare(true).setDirectory(dir.toFile()).setInitialBranch("main").call().close();
    }

    String url() {
        return bare.toUri().toString();
    }

    RevCommit head(String branch) throws IOException {
        try (var git = Git.open(bare.toFile()); var walk = new RevWalk(git.getRepository())) {
            var id = git.getRepository().resolve(Constants.R_HEADS + branch);
            return id == null ? null : walk.parseCommit(id);
        }
    }

    List<String> files(String branch) throws IOException {
        try (var git = Git.open(bare.toFile()); var walk = new RevWalk(git.getRepository())) {
            var commit = walk.parseCommit(git.getRepository().resolve(Constants.R_HEADS + branch));
            var result = new ArrayList<String>();
            try (var tree = new TreeWalk(git.getRepository())) {
                tree.addTree(commit.getTree());
                tree.setRecursive(true);
                while (tree.next()) {
                    result.add(tree.getPathString());
                }
            }
            return result;
        }
    }

    String read(String branch, String path) throws IOException {
        try (var git = Git.open(bare.toFile()); var walk = new RevWalk(git.getRepository())) {
            var commit = walk.parseCommit(git.getRepository().resolve(Constants.R_HEADS + branch));
            try (var tree = TreeWalk.forPath(git.getRepository(), path, commit.getTree())) {
                return tree == null ? null
                        : new String(git.getRepository().open(tree.getObjectId(0)).getBytes());
            }
        }
    }

    /** Someone else pushes a commit (e.g. a pipeline change) directly to the branch. */
    void pushFromElsewhere(Path cloneDir, String path, String content) throws Exception {
        try (var git = Git.init().setDirectory(cloneDir.toFile()).setInitialBranch("main").call()) {
            git.remoteAdd().setName("origin").setUri(new URIish(url())).call();
            git.fetch().setRemote("origin").setRefSpecs("+refs/heads/*:refs/remotes/origin/*").call();
            if (git.getRepository().findRef("refs/remotes/origin/main") != null) {
                git.reset().setMode(ResetType.HARD).setRef("refs/remotes/origin/main").call();
            }
            Files.createDirectories(cloneDir.resolve(path).getParent());
            Files.writeString(cloneDir.resolve(path), content);
            git.add().addFilepattern(".").call();
            git.commit().setMessage("Change from elsewhere").setAuthor("someone", "someone@example.com")
                    .setSign(false).call();
            git.push().setRemote("origin").setRefSpecs(new RefSpec("refs/heads/main:refs/heads/main")).call();
        }
    }
}
