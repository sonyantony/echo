# Branding the Builder

Each install of ECHO Builder can carry its own logo, product name, favicon and colours. They are
read from `echo.branding` in the Builder's `application.yaml`, so a buyer rebrands an install by
editing `config/application.yaml` and restarting; the image is not rebuilt.

The default look is EY's: product name "ECHO Builder", EY yellow (`#FFE600`) and grey (`#2E2E38`).

## Settings

| Setting | What it changes | Default |
|---|---|---|
| `product-name` | Masthead, login page, browser tab title | `ECHO Builder` |
| `logo` | Image left of the product name (masthead and login page). Shown on the masthead background, so use a version made for that colour. | `/branding/logo.svg` |
| `logo-alt` | Alt text of the logo | `EY` |
| `favicon` | Browser tab icon | `/branding/favicon.svg` (falls back to `logo`) |
| `asset-dir` | Folder whose files are served at `/branding/<file>` | `/config/branding` in the image, `./config/branding` otherwise |
| `colors.primary` / `primary-hover` | Primary buttons, selected items | `#FFE600` / `#E6CF00` |
| `colors.on-primary` | Text on primary buttons | `#2E2E38` |
| `colors.accent-text` | Text PatternFly draws in the brand colour (tabs, toggles) | `#2E2E38` |
| `colors.masthead-background` / `masthead-text` | Top bar and login page header | `#2E2E38` / `#FFFFFF` |

Leave a colour out to keep the PatternFly default for it. Colours map to PatternFly 6 tokens in
`builder-ui/src/branding/applyBranding.ts`.

## Using your own logo

1. Put the file in `config/branding/` next to `config/application.yaml` (docker-compose mounts
   `config/` at `/config`), e.g. `config/branding/acme.svg`.
2. In `config/application.yaml`:

   ```yaml
   echo:
     branding:
       product-name: Acme Integration Builder
       logo: /branding/acme.svg
       logo-alt: Acme
   ```

3. `docker compose restart`.

A file in `config/branding/` with the same name as a built-in one (`logo.svg`, `favicon.svg`)
replaces it, so dropping in `config/branding/logo.svg` is enough. `logo` can also be a full URL.

## The default EY logo

`builder-backend/src/main/resources/branding/logo.svg` is a **placeholder** (a dashed box saying
"LOGO"): the official EY logo could not be downloaded from an EY source when this was built.
Replace that file with the official EY logo (SVG, the version for dark backgrounds) and rebuild
to make it the default for every install.
