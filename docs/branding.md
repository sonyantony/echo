# Branding the Builder

The product name, **EY ECHO Builder** (with "EY" in EY yellow), is fixed. What each install can
change is the buyer's **company logo**, shown left of the product name, plus the favicon and
colours. These are read from `echo.branding` in the Builder's `application.yaml`, so a buyer
brands an install by editing `config/application.yaml` and restarting; the image is not rebuilt.

The default colours are EY's: yellow (`#FFE600`) and grey (`#2E2E38`).

## Settings

| Setting | What it changes | Default |
|---|---|---|
| `logo` | The buyer's company logo, left of the product name (masthead and login page). Shown on the masthead background, so use a version made for that colour. | `/branding/logo.svg` |
| `logo-alt` | Alt text of the logo | `Company logo` |
| `favicon` | Browser tab icon | `/branding/favicon.svg` (falls back to `logo`) |
| `asset-dir` | Folder whose files are served at `/branding/<file>` | `/config/branding` in the image, `./config/branding` otherwise |
| `theme` | The look of the whole Builder, the flow editor included: `studio` (light, dot-grid canvas), `graphite` (dark throughout) or `blueprint` (light, dark grid canvas). See [Themes](#themes). | `studio` |
| `colors.primary` / `primary-hover` | Primary buttons, selected items | `#FFE600` / `#E6CF00` |
| `colors.on-primary` | Text on primary buttons | `#2E2E38` |
| `colors.accent-text` | Text PatternFly draws in the brand colour (tabs, toggles) | `#2E2E38` |
| `colors.masthead-background` / `masthead-text` | Top bar and login page header | `#2E2E38` / `#FFFFFF` |

Leave a colour out to keep the PatternFly default for it. Colours map to PatternFly 6 tokens in
`builder-ui/src/branding/applyBranding.ts`.

## Themes

`theme` restyles the Builder and the embedded Kaoto editor together (canvas, step cards,
connectors, route header, tabs, forms, catalog), so the editor matches the rest of the Builder
instead of looking like stock Kaoto. Every theme uses the Inter typeface and draws its accents in
`colors.primary`, so a buyer's own colours carry through. Links and selected toggles use
`colors.masthead-background`.

```yaml
echo:
  branding:
    theme: graphite
```

The CSS is in `builder-ui/src/branding/themes.css`; Kaoto itself is not modified. Diagrams
downloaded with **Download <flow> As Image** always use light colours on white, whatever the
theme. The API spec editor (Apicurio) keeps its own look. Kaoto's step icons are Camel's own.

## Using your own logo

1. Put the file in `config/branding/` next to `config/application.yaml` (docker-compose mounts
   `config/` at `/config`), e.g. `config/branding/acme.svg`.
2. In `config/application.yaml`:

   ```yaml
   echo:
     branding:
       logo: /branding/acme.svg
       logo-alt: Acme
   ```

3. `docker compose restart`.

A file in `config/branding/` with the same name as a built-in one (`logo.svg`, `favicon.svg`)
replaces it, so dropping in `config/branding/logo.svg` is enough. `logo` can also be a full URL.
If the logo file is missing, the Builder shows just the product name, not a broken image.

## The default logo

`builder-backend/src/main/resources/branding/logo.svg` is a **placeholder** (a dashed box saying
"LOGO") shown until an install sets its company logo.
