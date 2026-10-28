# 0019. Test runs take their values from a properties file the user chooses

Date: 2026-10-28
Status: Accepted

Run used the flow's own `application.properties` for its `{{placeholders}}`. That file is also the
image's default, and nothing in the Builder edits it, so there was no way to run a flow against test
hosts or with a test token without changing what gets published.

- **Run asks for a file.** When the saved draft uses placeholders, the first **Run <flow>** opens
  **Run <flow> With...**: the values the route uses (same scan as decision 0018: no Camel functions, no
  `echo.*`) and a Browse button for a `.properties` file. Run stays off until the file sets every
  value that has no default in the placeholder. A flow without placeholders runs as before.
- **Later runs reuse it.** The Builder keeps the file in memory per flow and user (`RunValues`). **Run
  <flow> With...** in the Run menu picks another. Run asks again after a Builder restart, or when the
  flow now uses a value the file does not set (`POST /run` answers 409 with the values and the missing ones).
- **Test values never leave the run.** The file's values go on top of the flow's `application.properties`
  for that run only: not saved in H2, not published, not in the image. Validate and Publish still need
  the values in `application.properties`, and environments get theirs from the ConfigMap (0018).
- Values of names that look like secrets (token, password, key, ...) are masked in the dialog.
