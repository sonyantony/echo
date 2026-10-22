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

Leave a colour out to keep the theme's default for it, which is EY's. Each colour sets one theme
token (`--echo-brand`, `--echo-on-brand` ...; see `builder-ui/src/branding/applyBranding.ts`).

## Themes

`theme` restyles the Builder and its embedded editors together: Kaoto (canvas, step cards,
connectors, route header, tabs, forms, catalog) and the Openapi Design editor (pages, dialogs,
code editor; dark under graphite too), so the editors match the rest of the Builder
instead of looking like stock Kaoto. Every theme uses the Inter typeface and draws its accents in
`colors.primary`, so a buyer's own colours carry through. Links and selected toggles use
`colors.masthead-background` in the light themes.

```yaml
echo:
  branding:
    theme: graphite
```

Kaoto itself is not modified. Diagrams downloaded with **Download <flow> As Image** always use
light colours on white, whatever the theme. Kaoto's step icons are Camel's own, so graphite keeps
the step cards light.

### How the themes are built

```
builder-ui/src/theme/
  themes.css            the themes: every colour, and the only file with colour values
  kaoto-mapping.css     PatternFly 6 (ECHO's screens, Kaoto) and Kaoto's canvas -> tokens
  apicurio-mapping.css  Apicurio (Openapi Design editor) -> tokens
  echo.css              ECHO's shared look (Inter, corners, links, tags); no colours
```

`themes.css` defines each theme as one block of `--echo-*` tokens: the page, surfaces, menus and
dialogs, text, borders, links, the canvas, step cards, connectors and code colours, plus the
canvas pattern made from them. Every theme sets the same tokens, and a comment at the top of the
file lists what each one is for. A shared block holds what is the same in every theme: the brand
colour defaults (replaced by `echo.branding.colors`), EY yellow for the product name, and the
light colours of downloaded diagrams.

The two mapping files hold no colours. They only say which part of each embedded app uses which
token, e.g. "Kaoto's canvas background is `--echo-canvas`". Kaoto is PatternFly 6, so its mapping
mostly sets PatternFly's own colour variables from the tokens; Apicurio is PatternFly 3, which
has no colour variables, so its mapping picks Apicurio's parts by class name. They only need
changing when an upgrade of Kaoto or Apicurio renames those parts. ECHO's own stylesheets use the
tokens directly.

To change a colour, edit it in `themes.css`. To add a theme, copy a theme's block in `themes.css`,
rename it and change the values, then add its name to `THEMES` in `branding/applyBranding.ts` (and
to `DARK_THEMES` if it is dark, which switches PatternFly to its dark palette).

Checks: `src/theme/themes.test.ts` fails if a theme misses a token, a mapping uses a token no
theme defines, or a colour value appears outside `themes.css`. The `themes` e2e test opens the
main screens in every theme, Kaoto's canvas and the Openapi Design editor's pages and dialogs
included, fails on text that cannot be read against its background, and attaches a screenshot of
each screen per theme to the Playwright report. Run it after upgrading Kaoto or Apicurio.

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
