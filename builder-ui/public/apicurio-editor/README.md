# Apicurio OpenAPI editor (prebuilt, vendored)

The flow editor's **API spec** view (`src/apispec/`) shows this editor in a frame. It is the prebuilt
Apicurio Registry editors app (Registry 3.x's built-in API editor, which replaced the archived
standalone Apicurio Studio) from the Registry UI image, unmodified, minus
unused font formats and login background images.

- Source: `apicurio/apicurio-registry-ui:3.3` (Docker Hub, published 2026-09-08), folder
  `/opt/app-root/src/editors`.
- Licence: Apache License 2.0 (Apicurio). Third-party licences: `3rdpartylicenses.txt`.
- Refresh: `scripts/update-apicurio-editor.sh [image]` (needs Docker).

ECHO's theme is not in this folder (refreshing replaces everything here but this README): it is
injected into the frame from `src/apispec/apicurioTheme.css`, which targets Apicurio's class names.
After a refresh, check the API spec view in each theme.

It is an Angular app, so it runs in its own frame instead of inside the React app. The page
sends the spec with `postMessage({ type: 'apicurio-editingInfo', ... })` and gets every edit
back as `{ type: 'apicurio_onChange', data: { content } }`.
