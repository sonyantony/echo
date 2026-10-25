-- The name users see ("First Flow"); flow.name stays the identifier used in Git, file and image names.
-- Null for flows made before display names: they show their identifier.
ALTER TABLE flow ADD COLUMN display_name VARCHAR(100);
