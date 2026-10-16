# Apicurio OpenAPI editor (prebuilt, vendored)

The Builder's **API spec** page (`src/apispec/`) shows this editor in a frame. It is the prebuilt
Apicurio Studio editors app that Apicurio Registry ships in its UI image, unmodified, minus
unused font formats and login background images.

- Source: `apicurio/apicurio-registry-ui:3.3` (Docker Hub, published 2026-09-08), folder
  `/opt/app-root/src/editors`.
- Licence: Apache License 2.0 (Apicurio). Third-party licences: `3rdpartylicenses.txt`.
- Refresh: `scripts/update-apicurio-editor.sh [image]` (needs Docker).

It is an Angular app, so it runs in its own frame instead of inside the React app. The page
sends the spec with `postMessage({ type: 'apicurio-editingInfo', ... })` and gets every edit
back as `{ type: 'apicurio_onChange', data: { content } }`.
