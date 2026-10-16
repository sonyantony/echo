-- A publish now goes to every enabled target (Git, S3, ...): one row per target and publish.
CREATE TABLE publish_target (
    publish_event_id  BIGINT        NOT NULL,
    target_index      INT           NOT NULL,
    target            VARCHAR(20)   NOT NULL,
    location          VARCHAR(500)  NOT NULL,
    revision          VARCHAR(200),
    changed           BOOLEAN       NOT NULL,
    error             VARCHAR(1000),
    PRIMARY KEY (publish_event_id, target_index),
    CONSTRAINT fk_publish_target_event FOREIGN KEY (publish_event_id) REFERENCES publish_event (id) ON DELETE CASCADE
);

-- Every earlier publish went to Git.
INSERT INTO publish_target (publish_event_id, target_index, target, location, revision, changed, error)
SELECT id, 0, 'git', branch, commit_sha, TRUE, NULL FROM publish_event;

ALTER TABLE publish_event DROP COLUMN commit_sha;
ALTER TABLE publish_event DROP COLUMN branch;
